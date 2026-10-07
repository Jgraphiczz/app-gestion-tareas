<?php
/**
 * Funciones del día a día: tareas repetidas / subtareas / prioridad, presupuestos, lista de la compra
 * compartida y preferencias por usuario (resumen de la mañana, enlace del calendario).
 * Las tablas y columnas nuevas se crean solas la primera vez (ver también schema.sql).
 */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/perm.php';

const TASK_REPEATS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];

function featColumnExists($pdo, $table, $col) {
    return (bool)$pdo->query("SHOW COLUMNS FROM `$table` LIKE " . $pdo->quote($col))->fetch();
}

/** Crea lo que falte. true = todo listo. En web se intenta una vez por sesión. */
function featEnsureSchema($pdo) {
    if (session_status() === PHP_SESSION_ACTIVE && !empty($_SESSION['feat_schema_ok'])) return true;
    try {
        if (!featColumnExists($pdo, 'tasks', 'priority')) $pdo->exec('ALTER TABLE tasks ADD COLUMN priority TINYINT NOT NULL DEFAULT 0');
        if (!featColumnExists($pdo, 'tasks', 'repeat_rule')) $pdo->exec('ALTER TABLE tasks ADD COLUMN repeat_rule VARCHAR(16) NULL');
        if (!featColumnExists($pdo, 'tasks', 'checklist')) $pdo->exec('ALTER TABLE tasks ADD COLUMN checklist TEXT NULL');
        $pdo->exec("CREATE TABLE IF NOT EXISTS budgets (
            id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, category_id INT NOT NULL DEFAULT 0,
            amount DECIMAL(12,2) NOT NULL, created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_budget (user_id, category_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $pdo->exec("CREATE TABLE IF NOT EXISTS shopping_items (
            id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, group_id INT NULL, name VARCHAR(120) NOT NULL, qty VARCHAR(30) NULL,
            done TINYINT(1) NOT NULL DEFAULT 0, done_by INT NULL, archived TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, done_at TIMESTAMP NULL DEFAULT NULL,
            KEY idx_shop_group (group_id, archived), KEY idx_shop_user (user_id, archived)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $pdo->exec("CREATE TABLE IF NOT EXISTS user_prefs (
            user_id INT NOT NULL PRIMARY KEY, brief_enabled TINYINT(1) NOT NULL DEFAULT 0, brief_time CHAR(5) NOT NULL DEFAULT '08:00',
            tz VARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid', last_brief DATE NULL, calendar_token CHAR(40) NULL,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_cal_token (calendar_token)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        if (session_status() === PHP_SESSION_ACTIVE) $_SESSION['feat_schema_ok'] = 1;
        return true;
    } catch (Exception $e) {
        error_log('[features] ' . $e->getMessage());
        return false;
    }
}

/* ---------------------------------------------------------------- tareas */
function featValidTz($name) {
    return in_array((string)$name, DateTimeZone::listIdentifiers(), true) ? $name : 'Europe/Madrid';
}
function featUserTz($pdo, $userId) {
    try {
        $s = $pdo->prepare('SELECT tz FROM user_prefs WHERE user_id = ?');
        $s->execute([$userId]);
        return featValidTz($s->fetchColumn());
    } catch (Exception $e) { return 'Europe/Madrid'; }
}
function featCleanChecklist($raw) {
    $out = [];
    foreach (array_slice(is_array($raw) ? $raw : [], 0, 30) as $it) {
        $t = trim(mb_substr((string)($it['t'] ?? ''), 0, 120));
        if ($t !== '') $out[] = ['t' => $t, 'd' => !empty($it['d'])];
    }
    return $out;
}
function featCleanRepeat($v) { return in_array($v, TASK_REPEATS, true) ? $v : null; }

/** Siguiente vencimiento (UTC, 'Y-m-d H:i:s') de una tarea repetida, manteniendo la hora local del usuario y saltando lo ya pasado. */
function featNextDue($dueUtc, $rule, $tzName) {
    $tz = new DateTimeZone(featValidTz($tzName));
    $d = (new DateTime($dueUtc, new DateTimeZone('UTC')))->setTimezone($tz);
    $now = new DateTime('now', $tz);
    $anchor = (int)$d->format('j');
    $guard = 0;
    do {
        switch ($rule) {
            case 'daily':    $d->modify('+1 day'); break;
            case 'weekly':   $d->modify('+7 days'); break;
            case 'weekdays': do { $d->modify('+1 day'); } while ((int)$d->format('N') > 5); break;
            case 'yearly':   $d->modify('+1 year'); break;
            case 'monthly':
                $h = (int)$d->format('G'); $i = (int)$d->format('i');
                $d->modify('first day of next month');
                $d->setDate((int)$d->format('Y'), (int)$d->format('n'), min($anchor, (int)$d->format('t')));
                $d->setTime($h, $i);
                break;
            default: return null;
        }
    } while ($d <= $now && ++$guard < 800);
    return $d->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
}

function featTaskOut($t) {
    $t['reminders'] = json_decode($t['reminders'] ?? '[]', true) ?: [];
    $t['notified'] = json_decode($t['notified'] ?? '[]', true) ?: [];
    $t['done'] = (bool)$t['done'];
    $t['priority'] = (int)($t['priority'] ?? 0);
    $t['repeat_rule'] = $t['repeat_rule'] ?? null;
    $t['checklist'] = json_decode($t['checklist'] ?? '[]', true) ?: [];
    return $t;
}

/** Al completar una tarea repetida se crea la siguiente ocurrencia (la anterior queda hecha, sin repetición). Devuelve la nueva fila. */
function featSpawnNext($pdo, $task, $userId) {
    $rule = featCleanRepeat($task['repeat_rule'] ?? null);
    if (!$rule || empty($task['due_at'])) return null;
    $next = featNextDue($task['due_at'], $rule, featUserTz($pdo, $userId));
    if (!$next) return null;
    $list = json_decode($task['checklist'] ?? '[]', true) ?: [];
    foreach ($list as &$it) $it['d'] = false;
    unset($it);
    $pdo->prepare('INSERT INTO tasks (user_id, category_id, tag_id, text, description, due_at, reminders, notified, priority, repeat_rule, checklist) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$userId, $task['category_id'], $task['tag_id'], $task['text'], $task['description'], $next, $task['reminders'] ?: '[]', '[]',
                   (int)($task['priority'] ?? 0), $rule, json_encode($list, JSON_UNESCAPED_UNICODE)]);
    $newId = $pdo->lastInsertId();                              // antes del UPDATE: PDO lo pone a 0 tras otra sentencia
    $pdo->prepare('UPDATE tasks SET repeat_rule = NULL WHERE id = ?')->execute([$task['id']]);
    $q = $pdo->prepare('SELECT * FROM tasks WHERE id = ?');
    $q->execute([$newId]);
    return featTaskOut($q->fetch());
}

/* ------------------------------------------------------- rutas genéricas */
/**
 * Maneja ?resource=budgets | shopping | prefs. Si el recurso no es suyo, no hace nada.
 * $gids = grupos del usuario (userGroupIds de api.php).
 */
function featRoute($pdo, $me, $resource, $method, $id, $b, array $gids) {
    if (!in_array($resource, ['budgets', 'shopping', 'prefs'], true)) return;
    if (!featEnsureSchema($pdo)) pout(['error' => 'Esta función necesita crear tablas en la base de datos. Ejecuta schema.sql (phpMyAdmin) y recarga.'], 500);
    $uid = (int)$me['id'];
    $action = $_GET['action'] ?? '';

    /* ----- presupuestos ----- */
    if ($resource === 'budgets') {
        if ($method === 'GET') {
            $s = $pdo->prepare('SELECT id, category_id, amount FROM budgets WHERE user_id = ?'); $s->execute([$uid]);
            pout(array_map(fn($r) => ['id' => (int)$r['id'], 'category_id' => (int)$r['category_id'], 'amount' => (float)$r['amount']], $s->fetchAll()));
        }
        if ($method === 'POST' || $method === 'PUT') {
            $cat = (int)($b['category_id'] ?? 0);
            $amount = is_numeric($b['amount'] ?? null) ? round((float)$b['amount'], 2) : 0;
            if ($amount <= 0 || $amount > 100000000) pout(['error' => 'El presupuesto debe ser mayor que 0.'], 400);
            if ($cat) { $q = $pdo->prepare('SELECT id FROM finance_categories WHERE id = ? AND user_id = ?'); $q->execute([$cat, $uid]); if (!$q->fetch()) pout(['error' => 'Categoría no válida.'], 400); }
            $pdo->prepare('INSERT INTO budgets (user_id, category_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = VALUES(amount)')->execute([$uid, $cat, $amount]);
            $q = $pdo->prepare('SELECT id, category_id, amount FROM budgets WHERE user_id = ? AND category_id = ?'); $q->execute([$uid, $cat]);
            $r = $q->fetch();
            pout(['id' => (int)$r['id'], 'category_id' => (int)$r['category_id'], 'amount' => (float)$r['amount']], 201);
        }
        if ($method === 'DELETE' && $id) { $pdo->prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?')->execute([$id, $uid]); pout(['ok' => true]); }
        pout(['error' => 'petición no válida'], 400);
    }

    /* ----- lista de la compra (personal + grupos) ----- */
    if ($resource === 'shopping') {
        $scopeSql = function () use ($gids) {
            $sql = '(i.group_id IS NULL AND i.user_id = ?)'; $params = [];
            if ($gids) $sql .= ' OR i.group_id IN (' . implode(',', array_fill(0, count($gids), '?')) . ')';
            return [$sql, $gids];
        };
        $canSee = function ($item) use ($uid, $gids) { return $item['group_id'] === null ? (int)$item['user_id'] === $uid : in_array((int)$item['group_id'], $gids, true); };
        $names = function ($ids) use ($pdo) {
            if (!$ids) return [];
            $q = $pdo->prepare('SELECT id, username FROM users WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')'); $q->execute(array_values($ids));
            return array_column($q->fetchAll(), 'username', 'id');
        };
        $outItems = function ($rows) use ($names) {
            $who = $names(array_unique(array_filter(array_merge(array_column($rows, 'user_id'), array_column($rows, 'done_by')))));
            return array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name'], 'qty' => $r['qty'], 'done' => (bool)$r['done'],
                'group_id' => $r['group_id'] === null ? null : (int)$r['group_id'], 'added_by' => $who[$r['user_id']] ?? '', 'done_by' => $r['done_by'] ? ($who[$r['done_by']] ?? '') : null,
                'created_at' => $r['created_at']], $rows);
        };

        if ($method === 'GET') {
            [$sql, $gp] = $scopeSql();
            $q = $pdo->prepare("SELECT i.* FROM shopping_items i WHERE i.archived = 0 AND ($sql) ORDER BY i.done ASC, i.id DESC");
            $q->execute(array_merge([$uid], $gp));
            $items = $outItems($q->fetchAll());
            $groups = [];
            if ($gids) { $g = $pdo->prepare('SELECT id, name FROM `groups` WHERE id IN (' . implode(',', array_fill(0, count($gids), '?')) . ') ORDER BY name'); $g->execute($gids); $groups = $g->fetchAll(); }
            // sugerencias: lo que más se ha comprado en cada lista
            $sug = [];
            $scopes = [[null, 'i.group_id IS NULL AND i.user_id = ?', [$uid]]];
            foreach ($gids as $gid) $scopes[] = [$gid, 'i.group_id = ?', [$gid]];
            foreach ($scopes as [$gid, $cond, $p]) {
                $q = $pdo->prepare("SELECT MIN(i.name) AS name, COUNT(*) AS c FROM shopping_items i WHERE ($cond) GROUP BY LOWER(i.name) ORDER BY c DESC, MAX(i.id) DESC LIMIT 14");
                $q->execute($p);
                $sug[$gid === null ? '0' : (string)$gid] = array_column($q->fetchAll(), 'name');
            }
            pout(['items' => $items, 'groups' => $groups, 'suggestions' => (object)$sug]);       // objeto, no lista (las claves son '0' y los ids de grupo)
        }
        if ($method === 'POST' && $action === 'clear') {
            $gid = !empty($b['group_id']) ? (int)$b['group_id'] : null;
            if ($gid !== null && !in_array($gid, $gids, true)) pout(['error' => 'no autorizado'], 403);
            if ($gid === null) $pdo->prepare('UPDATE shopping_items SET archived = 1 WHERE done = 1 AND group_id IS NULL AND user_id = ?')->execute([$uid]);
            else $pdo->prepare('UPDATE shopping_items SET archived = 1 WHERE done = 1 AND group_id = ?')->execute([$gid]);
            pout(['ok' => true]);
        }
        if ($method === 'POST') {
            $gid = !empty($b['group_id']) ? (int)$b['group_id'] : null;
            if ($gid !== null && !in_array($gid, $gids, true)) pout(['error' => 'no autorizado'], 403);
            $list = isset($b['names']) && is_array($b['names']) ? $b['names'] : [['name' => $b['name'] ?? '', 'qty' => $b['qty'] ?? null]];
            $created = [];
            foreach (array_slice($list, 0, 30) as $it) {
                $it = is_array($it) ? $it : ['name' => $it];
                $name = trim(mb_substr(preg_replace('/\s+/', ' ', (string)($it['name'] ?? '')), 0, 120));
                if ($name === '') continue;
                $qty = isset($it['qty']) && $it['qty'] !== '' ? trim(mb_substr((string)$it['qty'], 0, 30)) : null;
                $dup = $gid === null
                    ? $pdo->prepare('SELECT * FROM shopping_items WHERE archived = 0 AND done = 0 AND group_id IS NULL AND user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1')
                    : $pdo->prepare('SELECT * FROM shopping_items WHERE archived = 0 AND done = 0 AND group_id = ? AND LOWER(name) = LOWER(?) LIMIT 1');
                $dup->execute($gid === null ? [$uid, $name] : [$gid, $name]);
                if ($row = $dup->fetch()) { $created[] = $row; continue; }               // ya estaba pendiente: no se duplica
                $pdo->prepare('INSERT INTO shopping_items (user_id, group_id, name, qty) VALUES (?, ?, ?, ?)')->execute([$uid, $gid, $name, $qty]);
                $q = $pdo->prepare('SELECT * FROM shopping_items WHERE id = ?'); $q->execute([$pdo->lastInsertId()]);
                $created[] = $q->fetch();
            }
            pout(['items' => $outItems($created)], 201);
        }
        if (!$id) pout(['error' => 'petición no válida'], 400);
        $q = $pdo->prepare('SELECT * FROM shopping_items WHERE id = ?'); $q->execute([$id]);
        $item = $q->fetch();
        if (!$item || !$canSee($item)) pout(['error' => 'no autorizado'], 403);
        if ($method === 'PATCH') {
            $f = []; $v = [];
            if (array_key_exists('done', $b)) {
                $f[] = 'done = ?'; $v[] = $b['done'] ? 1 : 0;
                $f[] = 'done_by = ?'; $v[] = $b['done'] ? $uid : null;
                $f[] = 'done_at = ' . ($b['done'] ? 'NOW()' : 'NULL');
            }
            if (array_key_exists('name', $b)) { $n = trim(mb_substr((string)$b['name'], 0, 120)); if ($n !== '') { $f[] = 'name = ?'; $v[] = $n; } }
            if (array_key_exists('qty', $b)) { $f[] = 'qty = ?'; $v[] = $b['qty'] === '' || $b['qty'] === null ? null : trim(mb_substr((string)$b['qty'], 0, 30)); }
            if ($f) { $v[] = $id; $pdo->prepare('UPDATE shopping_items SET ' . implode(', ', $f) . ' WHERE id = ?')->execute($v); }
            $q->execute([$id]);
            pout($outItems([$q->fetch()])[0]);
        }
        if ($method === 'DELETE') { $pdo->prepare('DELETE FROM shopping_items WHERE id = ?')->execute([$id]); pout(['ok' => true]); }
        pout(['error' => 'petición no válida'], 400);
    }

    /* ----- preferencias: resumen de la mañana y enlace del calendario ----- */
    if ($resource === 'prefs') {
        $get = function () use ($pdo, $uid) {
            $s = $pdo->prepare('SELECT brief_enabled, brief_time, tz, calendar_token FROM user_prefs WHERE user_id = ?'); $s->execute([$uid]);
            $r = $s->fetch() ?: ['brief_enabled' => 0, 'brief_time' => '08:00', 'tz' => 'Europe/Madrid', 'calendar_token' => null];
            $url = null;
            if ($r['calendar_token']) {
                $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
                $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
                $url = ($https ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/calendar.php?t=' . $r['calendar_token'];
            }
            return ['brief_enabled' => (bool)$r['brief_enabled'], 'brief_time' => $r['brief_time'], 'tz' => $r['tz'], 'calendar_url' => $url];
        };
        if ($method === 'GET') pout($get());
        if ($method === 'PATCH') {
            $time = (string)($b['brief_time'] ?? '08:00');
            if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time)) $time = '08:00';
            $tz = featValidTz($b['tz'] ?? 'Europe/Madrid');
            $pdo->prepare('INSERT INTO user_prefs (user_id, brief_enabled, brief_time, tz) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE brief_enabled = VALUES(brief_enabled), brief_time = VALUES(brief_time), tz = VALUES(tz)')
                ->execute([$uid, !empty($b['brief_enabled']) ? 1 : 0, $time, $tz]);
            pout($get());
        }
        if ($method === 'POST' && $action === 'calendar_token') {          // crear o regenerar (el enlace anterior deja de funcionar)
            $token = bin2hex(random_bytes(20));
            $pdo->prepare('INSERT INTO user_prefs (user_id, calendar_token) VALUES (?, ?) ON DUPLICATE KEY UPDATE calendar_token = VALUES(calendar_token)')->execute([$uid, $token]);
            pout($get());
        }
        if ($method === 'DELETE' && $action === 'calendar_token') { $pdo->prepare('UPDATE user_prefs SET calendar_token = NULL WHERE user_id = ?')->execute([$uid]); pout($get()); }
        pout(['error' => 'petición no válida'], 400);
    }
}

/* ------------------------------------------------- resumen de la mañana */
const BRIEF_WEATHER = [0 => 'Despejado', 1 => 'Poco nuboso', 2 => 'Parcialmente nublado', 3 => 'Nublado', 45 => 'Niebla', 48 => 'Niebla', 51 => 'Llovizna', 53 => 'Llovizna', 55 => 'Llovizna',
    61 => 'Lluvia', 63 => 'Lluvia', 65 => 'Lluvia fuerte', 71 => 'Nieve', 73 => 'Nieve', 75 => 'Nieve', 80 => 'Chubascos', 81 => 'Chubascos', 82 => 'Chubascos fuertes', 95 => 'Tormenta', 96 => 'Tormenta', 99 => 'Tormenta'];

function featForecast($lat, $lon) {
    if (!function_exists('curl_init')) return null;
    $ch = curl_init('https://api.open-meteo.com/v1/forecast?latitude=' . (float)$lat . '&longitude=' . (float)$lon . '&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto&forecast_days=1');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_CONNECTTIMEOUT => 4]);
    $raw = curl_exec($ch); curl_close($ch);
    $j = $raw ? json_decode($raw, true) : null;
    if (empty($j['daily']['temperature_2m_max'][0])) return null;
    return ['max' => round($j['daily']['temperature_2m_max'][0]), 'min' => round($j['daily']['temperature_2m_min'][0]), 'label' => BRIEF_WEATHER[(int)($j['daily']['weathercode'][0] ?? 0)] ?? ''];
}

/** Compone el aviso diario de un usuario respetando sus permisos de módulo. Devuelve [titulo, cuerpo]. */
function featBuildBrief($pdo, $user, $tzName, $withWeather = true) {
    $uid = (int)$user['id'];
    $perm = permResolve($pdo, $uid);
    $can = function (array $mods) use ($perm) { if ($perm['role'] === 'admin') return true; foreach ($mods as $m) if (($perm['modules'][$m] ?? 'allow') === 'allow') return true; return false; };
    $tz = new DateTimeZone(featValidTz($tzName));
    $now = new DateTime('now', $tz);
    $lines = [];

    if ($can(['tareas', 'calendario'])) {
        $endUtc = (clone $now)->setTime(23, 59, 59)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $startUtc = (clone $now)->setTime(0, 0, 0)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $q = $pdo->prepare('SELECT text, due_at FROM tasks WHERE user_id = ? AND done = 0 AND due_at IS NOT NULL AND due_at <= ? ORDER BY due_at ASC LIMIT 200');
        $q->execute([$uid, $endUtc]);
        $rows = $q->fetchAll(); $overdue = 0; $today = [];
        foreach ($rows as $r) { if ($r['due_at'] < $startUtc) $overdue++; else $today[] = $r; }
        $total = count($rows);
        if ($total === 0) $lines[] = 'Hoy no tienes tareas con fecha. ¡Día libre!';
        else {
            $l = $total === 1 ? '1 tarea para hoy' : "$total tareas para hoy";
            if ($overdue) $l .= $overdue === 1 ? ' (1 vencida)' : " ($overdue vencidas)";
            $lines[] = $l;
            $next = null;
            foreach ($today as $r) { if ($r['due_at'] >= (clone $now)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s')) { $next = $r; break; } }
            if (!$next && $today) $next = $today[0];
            if ($next) $lines[] = 'Próxima: ' . (new DateTime($next['due_at'], new DateTimeZone('UTC')))->setTimezone($tz)->format('H:i') . ' ' . mb_substr($next['text'], 0, 50);
        }
    }
    if ($withWeather && $can(['tiempo'])) {
        try {
            $w = $pdo->prepare('SELECT weather_name, weather_lat, weather_lon FROM users WHERE id = ?'); $w->execute([$uid]); $w = $w->fetch();
            if ($w && $w['weather_lat'] !== null && ($f = featForecast($w['weather_lat'], $w['weather_lon']))) $lines[] = trim($f['label'] . ' · ' . $f['max'] . '°/' . $f['min'] . '° en ' . $w['weather_name']);
        } catch (Exception $e) {}
    }
    if ($can(['gastos', 'estadisticas'])) {
        try {
            $first = $now->format('Y-m-01');
            $q = $pdo->prepare("SELECT category_id, SUM(amount) AS s FROM movements WHERE user_id = ? AND type = 'gasto' AND date >= ? AND (group_id IS NULL OR paid_by = ?) GROUP BY category_id");
            $q->execute([$uid, $first, $uid]);
            $by = []; $sum = 0;
            foreach ($q->fetchAll() as $r) { $by[(int)$r['category_id']] = (float)$r['s']; $sum += (float)$r['s']; }
            if ($sum > 0) {
                $b = $pdo->prepare('SELECT b.category_id, b.amount, fc.name FROM budgets b LEFT JOIN finance_categories fc ON fc.id = b.category_id WHERE b.user_id = ?');
                $b->execute([$uid]);
                $budgets = $b->fetchAll(); $tot = null; $warn = [];
                foreach ($budgets as $r) {
                    if ((int)$r['category_id'] === 0) { $tot = (float)$r['amount']; continue; }
                    $pct = $r['amount'] > 0 ? ($by[(int)$r['category_id']] ?? 0) / $r['amount'] * 100 : 0;
                    if ($pct >= 80) $warn[] = $r['name'] . ' ' . round($pct) . ' %';
                }
                $l = 'Este mes: ' . number_format($sum, 2, ',', '.') . ' € gastados';
                if ($tot) $l .= ' (' . round($sum / $tot * 100) . ' % del presupuesto)';
                $lines[] = $l;
                if ($warn) $lines[] = '⚠ Cerca del límite: ' . implode(', ', array_slice($warn, 0, 3));
            }
        } catch (Exception $e) {}
    }
    if ($can(['compra'])) {
        try {
            $gids = [];
            $g = $pdo->prepare('SELECT group_id FROM group_members WHERE user_id = ?'); $g->execute([$uid]); $gids = array_map('intval', $g->fetchAll(PDO::FETCH_COLUMN));
            $sql = 'SELECT COUNT(*) FROM shopping_items WHERE archived = 0 AND done = 0 AND ((group_id IS NULL AND user_id = ?)' . ($gids ? ' OR group_id IN (' . implode(',', $gids) . ')' : '') . ')';
            $c = $pdo->prepare($sql); $c->execute([$uid]); $n = (int)$c->fetchColumn();
            if ($n) $lines[] = 'Compra: ' . $n . ($n === 1 ? ' producto pendiente' : ' productos pendientes');
        } catch (Exception $e) {}
    }
    $h = (int)$now->format('G');
    $title = ($h < 13 ? '☀️ Buenos días' : ($h < 20 ? '🌤 Buenas tardes' : '🌙 Buenas noches')) . ', ' . $user['username'];
    return [$title, implode("\n", $lines) ?: 'Abre la app para ver tu día.'];
}
