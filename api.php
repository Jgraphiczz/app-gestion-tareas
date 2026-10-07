<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/perm.php';

header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

function uid() { return bin2hex(random_bytes(8)); }
function body() { return json_decode(file_get_contents('php://input'), true) ?? []; }
function out($data, $code = 200) { http_response_code($code); echo json_encode($data); exit; }

function categoryBelongsToUser($pdo, $catId, $userId) {
    $s = $pdo->prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?');
    $s->execute([$catId, $userId]);
    return (bool)$s->fetch();
}
function financeCategoryBelongsToUser($pdo, $catId, $userId) {
    $s = $pdo->prepare('SELECT id FROM finance_categories WHERE id = ? AND user_id = ?');
    $s->execute([$catId, $userId]);
    return (bool)$s->fetch();
}

// ---------------------------------------------------------------------------
// COMPARTIR: permisos
// ---------------------------------------------------------------------------
const SHARE_TABLES = ['note' => 'notes', 'diagram' => 'diagrams'];

/** Grupos a los que pertenece un usuario. ÚNICO punto que conoce cómo se guardan las pertenencias:
 *  el grupo "antiguo" que asigna el administrador (users.group_id) + los grupos creados por los
 *  propios usuarios e invitaciones aceptadas (tabla group_members). */
function userGroupIds($pdo, $userId) {
    $ids = [];
    $s = $pdo->prepare('SELECT group_id FROM users WHERE id = ? AND group_id IS NOT NULL');
    $s->execute([$userId]);
    foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $g) $ids[] = (int)$g;
    try {
        $s = $pdo->prepare('SELECT group_id FROM group_members WHERE user_id = ?');
        $s->execute([$userId]);
        foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $g) $ids[] = (int)$g;
    } catch (Exception $e) { /* la tabla aún no existe: solo cuenta el grupo antiguo */ }
    return array_values(array_unique($ids));
}

// ---------------------------------------------------------------------------
// ESQUEMA NUEVO (se crea solo la primera vez: no hace falta ejecutar SQL a mano)
// ---------------------------------------------------------------------------
function ensureSchema($pdo) {
    $pdo->exec("CREATE TABLE IF NOT EXISTS group_members (
        group_id INT NOT NULL, user_id INT NOT NULL, role VARCHAR(10) NOT NULL DEFAULT 'member',
        joined_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id), KEY idx_gm_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS group_invites (
        id INT AUTO_INCREMENT PRIMARY KEY, group_id INT NOT NULL, invited_user_id INT NOT NULL, invited_by INT NOT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_invite (group_id, invited_user_id), KEY idx_inv_user (invited_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS weather_locations (
        id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, name VARCHAR(160) NOT NULL,
        latitude DOUBLE NOT NULL, longitude DOUBLE NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_wl_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

// ---------------------------------------------------------------------------
// GRUPOS (crear, invitar, aceptar, salir)
// ---------------------------------------------------------------------------
function groupRole($pdo, $gid, $uid) {
    $s = $pdo->prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?');
    $s->execute([$gid, $uid]);
    $r = $s->fetchColumn();
    return $r === false ? null : $r;
}

/** Todo lo que la pantalla de grupos necesita: mis grupos (con miembros) e invitaciones recibidas. */
function groupsBundle($pdo, $me) {
    $uid = (int)$me['id'];
    $gids = userGroupIds($pdo, $uid);
    $groups = [];
    if ($gids) {
        $gs = $pdo->prepare('SELECT id, name FROM `groups` WHERE id IN (' . implode(',', array_fill(0, count($gids), '?')) . ') ORDER BY name ASC');
        $gs->execute($gids);
        foreach ($gs->fetchAll() as $g) {
            $gid = (int)$g['id'];
            $m = $pdo->prepare("SELECT u.id, u.username, COALESCE(gm.role, 'member') AS role
                FROM users u LEFT JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = ?
                WHERE u.active = 1 AND (gm.group_id IS NOT NULL OR u.group_id = ?)
                ORDER BY (gm.role = 'owner') DESC, u.username ASC");
            $m->execute([$gid, $gid]);
            $members = array_map(function($r) { return ['id' => (int)$r['id'], 'username' => $r['username'], 'role' => $r['role']]; }, $m->fetchAll());
            $myRole = 'member'; $hasOwner = false;
            foreach ($members as $mm) { if ($mm['role'] === 'owner') $hasOwner = true; if ($mm['id'] === $uid) $myRole = $mm['role']; }
            $pending = [];
            if ($myRole === 'owner') {
                $p = $pdo->prepare('SELECT i.id, u.username FROM group_invites i JOIN users u ON u.id = i.invited_user_id WHERE i.group_id = ? ORDER BY i.created_at ASC');
                $p->execute([$gid]);
                $pending = array_map(function($r) { return ['id' => (int)$r['id'], 'username' => $r['username']]; }, $p->fetchAll());
            }
            $groups[] = ['id' => $gid, 'name' => $g['name'], 'my_role' => $myRole, 'has_owner' => $hasOwner,
                'is_expenses' => ((int)($me['group_id'] ?? 0) === $gid), 'members' => $members, 'pending' => $pending];
        }
    }
    $iv = $pdo->prepare('SELECT i.id, i.group_id, g.name AS group_name, u.username AS invited_by
        FROM group_invites i JOIN `groups` g ON g.id = i.group_id JOIN users u ON u.id = i.invited_by
        WHERE i.invited_user_id = ? ORDER BY i.created_at DESC');
    $iv->execute([$uid]);
    return ['groups' => $groups, 'invites' => $iv->fetchAll()];
}

// ---------------------------------------------------------------------------
// CIUDADES DEL TIEMPO (varias, una activa)
// ---------------------------------------------------------------------------
function weatherLocationsList($pdo, $uid) {
    $s = $pdo->prepare('SELECT id, name, latitude, longitude, is_active FROM weather_locations WHERE user_id = ? ORDER BY created_at ASC, id ASC');
    $s->execute([$uid]);
    return array_map(function($r) {
        return ['id' => (int)$r['id'], 'name' => $r['name'], 'latitude' => (float)$r['latitude'], 'longitude' => (float)$r['longitude'], 'is_active' => (bool)$r['is_active']];
    }, $s->fetchAll());
}
/** users.weather_* sigue reflejando la ciudad activa (así nada de lo anterior se rompe). */
function syncActiveWeather($pdo, $uid) {
    $s = $pdo->prepare('SELECT name, latitude, longitude FROM weather_locations WHERE user_id = ? AND is_active = 1 LIMIT 1');
    $s->execute([$uid]);
    $r = $s->fetch();
    $pdo->prepare('UPDATE users SET weather_name = ?, weather_lat = ?, weather_lon = ? WHERE id = ?')
        ->execute($r ? [$r['name'], $r['latitude'], $r['longitude'], $uid] : [null, null, null, $uid]);
}

/** Elementos de un tipo que otros han compartido con este usuario (directo o por grupo).
 *  Devuelve [id_elemento => 'view'|'edit'] (si hay dos vías, gana 'edit'). */
function sharedAccessMap($pdo, $type, $userId) {
    $groups = userGroupIds($pdo, $userId);
    $sql = "SELECT resource_id, permission FROM shares WHERE resource_type = ? AND ((recipient_type = 'user' AND recipient_id = ?)";
    $params = [$type, $userId];
    if ($groups) {
        $sql .= " OR (recipient_type = 'group' AND recipient_id IN (" . implode(',', array_fill(0, count($groups), '?')) . "))";
        $params = array_merge($params, $groups);
    }
    $sql .= ")";
    $s = $pdo->prepare($sql);
    $s->execute($params);
    $map = [];
    foreach ($s->fetchAll() as $r) {
        $rid = (int)$r['resource_id'];
        $map[$rid] = (($map[$rid] ?? '') === 'edit' || $r['permission'] === 'edit') ? 'edit' : 'view';
    }
    return $map;
}

/** Acceso de $me a un elemento: 'owner' | 'edit' | 'view' | null (no existe o sin acceso). */
function resourceAccess($pdo, $type, $rid, $me) {
    if (!isset(SHARE_TABLES[$type])) return null;
    $table = SHARE_TABLES[$type];
    $s = $pdo->prepare("SELECT user_id FROM $table WHERE id = ?");
    $s->execute([$rid]);
    $row = $s->fetch();
    if (!$row) return null;
    if ((int)$row['user_id'] === (int)$me['id']) return 'owner';
    $map = sharedAccessMap($pdo, $type, $me['id']);
    return $map[(int)$rid] ?? null;
}

/** Si el cliente manda base_updated_at y otra persona guardó después, responde 409. */
function assertNoConflict($pdo, $table, $id, $b) {
    if (empty($b['base_updated_at'])) return;
    $s = $pdo->prepare("SELECT updated_at FROM $table WHERE id = ?");
    $s->execute([$id]);
    $cur = $s->fetchColumn();
    if ($cur !== false && (string)$cur !== (string)$b['base_updated_at']) {
        out(['error' => 'conflict', 'updated_at' => $cur], 409);
    }
}
function currentUpdatedAt($pdo, $table, $id) {
    $s = $pdo->prepare("SELECT updated_at FROM $table WHERE id = ?");
    $s->execute([$id]);
    return $s->fetchColumn();
}

/** Notas visibles para $me: las suyas + las que le han compartido (directo o por grupo). */
function fetchNotesList($pdo, $me) {
    $noteAccess = sharedAccessMap($pdo, 'note', $me['id']);
    $sql = "SELECT n.*, u.username AS owner_username,
                (SELECT COUNT(*) FROM shares sh WHERE sh.resource_type = 'note' AND sh.resource_id = n.id) AS share_count
            FROM notes n JOIN users u ON u.id = n.user_id
            WHERE n.user_id = ?";
    $params = [$me['id']];
    if ($noteAccess) { $sql .= ' OR n.id IN (' . implode(',', array_fill(0, count($noteAccess), '?')) . ')'; $params = array_merge($params, array_keys($noteAccess)); }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $notes = array_map(function($n) use ($me, $noteAccess) {
        $mine = ((int)$n['user_id'] === (int)$me['id']);
        $n['access'] = $mine ? 'owner' : ($noteAccess[(int)$n['id']] ?? 'view');
        $n['pinned'] = $mine ? (bool)$n['pinned'] : false;      // fijar es cosa del dueño
        $n['share_count'] = $mine ? (int)$n['share_count'] : 0; // el receptor no ve con quién más se comparte
        return $n;
    }, $stmt->fetchAll());
    usort($notes, function($a, $b) {
        if ($a['pinned'] !== $b['pinned']) return $a['pinned'] ? -1 : 1;
        return strcmp($b['updated_at'], $a['updated_at']);
    });
    return $notes;
}

// ---------------------------------------------------------------------------
// PRÉSTAMOS Y RECURRENTES (gastos fijos / nómina)
// ---------------------------------------------------------------------------

/** Cuota mensual por el sistema de amortización francés (el habitual en préstamos). */
function monthlyPayment($principal, $taePercent, $months) {
    $r = ($taePercent / 100) / 12;
    if ($r == 0) return round($principal / $months, 2);
    $factor = pow(1 + $r, $months);
    return round($principal * $r * $factor / ($factor - 1), 2);
}

function ymPlusMonths($startDate, $n) {
    $d = new DateTime($startDate);
    $d->modify("+$n months");
    return $d;
}

/** Genera los movimientos de préstamos y recurrentes que ya tocan y aún no existen.
 *  Se llama en cada carga de 'all': barato (pocas filas por usuario) y así no depende
 *  de que haya un cron corriendo para que aparezcan a tiempo. */
function materializeRecurring($pdo, $userId) {
    $today = new DateTime('today');

    // Préstamos: hasta 60 cuotas por pasada (5 años), de sobra para ponerse al día
    $loans = $pdo->prepare('SELECT * FROM loans WHERE user_id = ? AND active = 1 AND installments_generated < months');
    $loans->execute([$userId]);
    foreach ($loans->fetchAll() as $loan) {
        $n = (int)$loan['installments_generated'];
        $guard = 0;
        while ($n < (int)$loan['months'] && $guard < 60) {
            $due = ymPlusMonths($loan['start_date'], $n);
            if ($due > $today) break;
            $ins = $pdo->prepare('INSERT INTO movements (user_id, type, amount, category_id, description, date, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $ins->execute([$userId, 'gasto', $loan['monthly_payment'], $loan['category_id'], $loan['name'] . ' (cuota ' . ($n + 1) . '/' . $loan['months'] . ')', $due->format('Y-m-d'), 'loan', $loan['id']]);
            $n++;
            $guard++;
        }
        if ($n !== (int)$loan['installments_generated']) {
            $active = $n >= (int)$loan['months'] ? 0 : 1; // préstamo totalmente pagado -> se desactiva solo
            $pdo->prepare('UPDATE loans SET installments_generated = ?, active = ? WHERE id = ?')->execute([$n, $active, $loan['id']]);
        }
    }

    // Gastos fijos / nómina: indefinidos hasta end_date o hasta desactivarlos
    $items = $pdo->prepare('SELECT * FROM recurring_items WHERE user_id = ? AND active = 1');
    $items->execute([$userId]);
    foreach ($items->fetchAll() as $item) {
        $cursor = $item['last_generated_period']
            ? DateTime::createFromFormat('Y-m-d', $item['last_generated_period'] . '-01')->modify('+1 month')
            : new DateTime(substr($item['start_date'], 0, 8) . '01');
        $guard = 0;
        $lastPeriod = $item['last_generated_period'];
        while ($guard < 60) {
            $day = min((int)$item['day_of_month'], (int)$cursor->format('t'));
            $due = new DateTime($cursor->format('Y-m') . '-' . str_pad($day, 2, '0', STR_PAD_LEFT));
            if ($due < new DateTime($item['start_date'])) { $cursor->modify('+1 month'); $guard++; continue; }
            if ($item['end_date'] && $due->format('Y-m-d') > $item['end_date']) break;
            if ($due > $today) break;
            $ins = $pdo->prepare('INSERT INTO movements (user_id, type, amount, category_id, description, date, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $ins->execute([$userId, $item['type'], $item['amount'], $item['category_id'], $item['name'], $due->format('Y-m-d'), 'recurring', $item['id']]);
            $lastPeriod = $cursor->format('Y-m');
            $cursor->modify('+1 month');
            $guard++;
        }
        if ($lastPeriod !== $item['last_generated_period']) {
            $pdo->prepare('UPDATE recurring_items SET last_generated_period = ? WHERE id = ?')->execute([$lastPeriod, $item['id']]);
        }
    }
}

// ---------------------------------------------------------------------------
// IMÁGENES DE NOTAS
// ---------------------------------------------------------------------------
const NOTE_IMAGE_MAX_BYTES = 3 * 1024 * 1024;       // por imagen (ya llegan comprimidas desde el navegador)
const NOTE_IMAGE_MAX_PER_NOTE = 40;
const NOTE_IMAGE_MAX_PER_USER_BYTES = 50 * 1024 * 1024;

/** Ids de imágenes referenciados en el contenido de una nota, sea cual sea el orden de los
 *  parámetros, el escapado (&amp;) o si la URL es relativa o absoluta. */
function referencedNoteImageIds($content) {
    $ids = [];
    if (preg_match_all('/api\.php\?[^\s"\'()<>]*/i', (string)$content, $m)) {
        foreach ($m[0] as $url) {
            $url = html_entity_decode($url, ENT_QUOTES | ENT_HTML5);
            parse_str((string)substr($url, strpos($url, '?') + 1), $q);
            if (($q['resource'] ?? '') === 'note_image' && ctype_digit((string)($q['id'] ?? ''))) $ids[] = (int)$q['id'];
        }
    }
    return array_values(array_unique($ids));
}

/** Borra las imágenes de una nota que ya no aparecen en su contenido. Solo toca las de más
 *  de 24 h: así nunca se pierde una imagen recién subida cuyo texto aún no se ha guardado. */
function cleanupOrphanNoteImages($pdo, $noteId, $content) {
    $keep = referencedNoteImageIds($content);
    $sql = 'DELETE FROM note_images WHERE note_id = ? AND created_at < (NOW() - INTERVAL 1 DAY)';
    $params = [$noteId];
    if ($keep) {
        $sql .= ' AND id NOT IN (' . implode(',', array_fill(0, count($keep), '?')) . ')';
        $params = array_merge($params, $keep);
    }
    $pdo->prepare($sql)->execute($params);
}

$me = requireAuth();
$pdo = db();
$resource = $_GET['resource'] ?? '';
$id = $_GET['id'] ?? null;
$method = $_SERVER['REQUEST_METHOD'];

if (empty($_SESSION['schema_v2'])) {
    try { ensureSchema($pdo); $_SESSION['schema_v2'] = 1; } catch (Exception $e) { /* sin permisos: las funciones nuevas se desactivan solas */ }
}

// Rol y permisos siempre frescos desde la base de datos (un cambio de rol o de módulos se nota al momento)
$perm = permResolve($pdo, $me['id']);
$_SESSION['user']['role'] = $perm['role'];
$me['role'] = $perm['role'];

try {
    permAdminRoute($pdo, $resource, $method, $id, body());                 // roles y mensajes (solo administradores)
    if ($mods = permResourceModules($resource)) permRequire($pdo, $me['id'], $mods);   // 403 con el mensaje configurado

    /* ===================== ADMIN: usuarios y grupos ===================== */
    if ($resource === 'users') {
        requireAdmin();
        if ($method === 'GET') {
            try { $rows = $pdo->query('SELECT id, username, email, role, role_id, group_id, active, created_at FROM users ORDER BY created_at ASC')->fetchAll(); }
            catch (Exception $e) { $rows = $pdo->query('SELECT id, username, email, role, group_id, active, created_at FROM users ORDER BY created_at ASC')->fetchAll(); }
            $roleNames = [];
            try { foreach ($pdo->query('SELECT id, name, is_default FROM roles')->fetchAll() as $r) $roleNames[(int)$r['id']] = $r; } catch (Exception $e) {}
            $defaultRole = null; foreach ($roleNames as $r) if ($r['is_default']) $defaultRole = $r;
            foreach ($rows as &$row) {
                $rid = isset($row['role_id']) && $row['role_id'] !== null ? (int)$row['role_id'] : null;
                $rr = ($rid && isset($roleNames[$rid])) ? $roleNames[$rid] : $defaultRole;
                $row['role_id'] = $rid;
                $row['role_name'] = $row['role'] === 'admin' ? 'Administrador' : ($rr ? $rr['name'] : 'Usuario');
            }
            unset($row);
            out($rows);
        }
        if ($method === 'POST') {
            $b = body();
            $username = trim($b['username'] ?? '');
            $password = $b['password'] ?? '';
            if (strlen($username) < 3 || strlen($password) < 6) out(['error' => 'datos incompletos'], 400);
            $hash = password_hash($password, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare('INSERT INTO users (username, email, password_hash, role, group_id) VALUES (?, ?, ?, ?, ?)');
            $stmt->execute([$username, $b['email'] ?? null, $hash, $b['role'] ?? 'user', $b['group_id'] ?? null]);
            $newId = $pdo->lastInsertId();
            if (!empty($b['role_id'])) { try { $pdo->prepare('UPDATE users SET role_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM roles WHERE id = ?)')->execute([$b['role_id'], $newId, $b['role_id']]); } catch (Exception $e) {} }
            $row = $pdo->query("SELECT id, username, email, role, group_id, active, created_at FROM users WHERE id = $newId")->fetch();
            out($row, 201);
        }
        if ($method === 'PATCH' && $id) {
            $b = body();
            if ((int)$id === (int)$me['id'] && ((array_key_exists('role', $b) && $b['role'] !== 'admin') || (array_key_exists('active', $b) && !$b['active'])))
                out(['error' => 'No puedes quitarte el rol de administrador ni desactivar tu propia cuenta.'], 400);
            if (array_key_exists('role', $b) && !in_array($b['role'], ['admin', 'user'], true)) out(['error' => 'rol no válido'], 400);
            $fields = []; $vals = [];
            foreach (['role', 'group_id', 'active', 'email'] as $f) {
                if (array_key_exists($f, $b)) { $fields[] = "$f = ?"; $vals[] = $b[$f]; }
            }
            if (array_key_exists('role_id', $b)) {
                $rid = $b['role_id'] ? (int)$b['role_id'] : null;
                if ($rid) { $q = $pdo->prepare('SELECT id FROM roles WHERE id = ?'); $q->execute([$rid]); if (!$q->fetch()) out(['error' => 'El rol no existe.'], 400); }
                $fields[] = 'role_id = ?'; $vals[] = $rid;
            }
            if (!empty($b['new_password'])) {
                if (strlen($b['new_password']) < 6) out(['error' => 'la contraseña debe tener al menos 6 caracteres'], 400);
                $fields[] = 'password_hash = ?';
                $vals[] = password_hash($b['new_password'], PASSWORD_DEFAULT);
            }
            if ($fields) {
                $vals[] = $id;
                $pdo->prepare('UPDATE users SET ' . implode(',', $fields) . ' WHERE id = ?')->execute($vals);
            }
            out(['ok' => true]);
        }
        if ($method === 'DELETE' && $id) {
            if ((int)$id === (int)$me['id']) out(['error' => 'no puedes borrar tu propia cuenta de admin'], 400);
            $pdo->prepare("DELETE FROM shares WHERE recipient_type = 'user' AND recipient_id = ?")->execute([$id]);
            try {                                                    // conversaciones y ajustes del chat de ese usuario
                $pdo->prepare('DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE user_id = ?)')->execute([$id]);
                $pdo->prepare('DELETE FROM chat_conversations WHERE user_id = ?')->execute([$id]);
                $pdo->prepare('DELETE FROM chat_settings WHERE user_id = ?')->execute([$id]);
            } catch (Exception $e) { /* el chat aún no se ha usado */ }
            $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }
        out(['error' => 'petición no válida'], 400);
    }

    if ($resource === 'groups') {
        requireAdmin();
        if ($method === 'GET') out($pdo->query('SELECT * FROM groups ORDER BY created_at ASC')->fetchAll());
        if ($method === 'POST') {
            $b = body();
            $pdo->prepare('INSERT INTO groups (name) VALUES (?)')->execute([$b['name']]);
            $newId = $pdo->lastInsertId();
            out($pdo->query("SELECT * FROM groups WHERE id = $newId")->fetch(), 201);
        }
        if ($method === 'DELETE' && $id) {
            $pdo->prepare("DELETE FROM shares WHERE recipient_type = 'group' AND recipient_id = ?")->execute([$id]);
            $pdo->prepare('DELETE FROM groups WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }
        out(['error' => 'petición no válida'], 400);
    }

    /* ===================== Datos propios del usuario ===================== */
    if ($resource === 'all' && $method === 'GET') {
        materializeRecurring($pdo, $me['id']);
        $catStmt = $pdo->prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY created_at ASC');
        $catStmt->execute([$me['id']]);
        $categories = $catStmt->fetchAll();
        $catIds = array_column($categories, 'id');

        $tags = [];
        if ($catIds) {
            $in = implode(',', array_fill(0, count($catIds), '?'));
            $s = $pdo->prepare("SELECT * FROM tags WHERE category_id IN ($in) ORDER BY created_at ASC");
            $s->execute($catIds);
            $tags = $s->fetchAll();
        }

        $taskStmt = $pdo->prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC');
        $taskStmt->execute([$me['id']]);
        $tasks = array_map(function($t) {
            $t['reminders'] = json_decode($t['reminders'] ?? '[]', true) ?: [];
            $t['notified'] = json_decode($t['notified'] ?? '[]', true) ?: [];
            $t['done'] = (bool)$t['done'];
            return $t;
        }, $taskStmt->fetchAll());

        $fcStmt = $pdo->prepare('SELECT * FROM finance_categories WHERE user_id = ? ORDER BY created_at ASC');
        $fcStmt->execute([$me['id']]);
        $financeCategories = $fcStmt->fetchAll();

        if ($me['group_id']) {
            $s = $pdo->prepare('SELECT id, username FROM users WHERE group_id = ?');
            $s->execute([$me['group_id']]);
            $groupMembers = $s->fetchAll();
            $g = $pdo->prepare('SELECT * FROM groups WHERE id = ?');
            $g->execute([$me['group_id']]);
            $group = $g->fetch();
        } else { $groupMembers = []; $group = null; }

        $movStmt = $pdo->prepare('SELECT * FROM movements WHERE user_id = ? OR group_id = ? ORDER BY date DESC, created_at DESC');
        $movStmt->execute([$me['id'], $me['group_id'] ?: 0]);
        $movements = $movStmt->fetchAll();

        $notes = fetchNotesList($pdo, $me);

        // Grupos a los que pertenezco (para poder compartir con ellos)
        $myGroups = [];
        $gids = userGroupIds($pdo, $me['id']);
        if ($gids) {
            $gs = $pdo->prepare('SELECT id, name FROM `groups` WHERE id IN (' . implode(',', array_fill(0, count($gids), '?')) . ')');
            $gs->execute($gids);
            $myGroups = $gs->fetchAll();
        }

        $wStmt = $pdo->prepare('SELECT weather_name, weather_lat, weather_lon FROM users WHERE id = ?');
        $wStmt->execute([$me['id']]);
        $wRow = $wStmt->fetch();
        $weatherLocation = ($wRow && $wRow['weather_name']) ? ['name' => $wRow['weather_name'], 'latitude' => (float)$wRow['weather_lat'], 'longitude' => (float)$wRow['weather_lon']] : null;

        try {
            $weatherLocations = weatherLocationsList($pdo, $me['id']);
            if (!$weatherLocations && $weatherLocation) {   // primera vez: la ciudad que ya tenía pasa a ser la activa
                $pdo->prepare('INSERT INTO weather_locations (user_id, name, latitude, longitude, is_active) VALUES (?, ?, ?, ?, 1)')
                    ->execute([$me['id'], $weatherLocation['name'], $weatherLocation['latitude'], $weatherLocation['longitude']]);
                $weatherLocations = weatherLocationsList($pdo, $me['id']);
            }
            $groupsData = groupsBundle($pdo, $me);
        } catch (Exception $e) { $weatherLocations = []; $groupsData = ['groups' => [], 'invites' => []]; }

        $loansStmt = $pdo->prepare('SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC');
        $loansStmt->execute([$me['id']]);
        $loans = $loansStmt->fetchAll();

        $recStmt = $pdo->prepare('SELECT * FROM recurring_items WHERE user_id = ? ORDER BY active DESC, created_at DESC');
        $recStmt->execute([$me['id']]);
        $recurringItems = $recStmt->fetchAll();

        out(permFilterAll([
            'categories' => $categories, 'tags' => $tags, 'tasks' => $tasks,
            'finance_categories' => $financeCategories, 'movements' => $movements,
            'group' => $group, 'group_members' => $groupMembers, 'me' => $me,
            'notes' => $notes, 'weather_location' => $weatherLocation, 'weather_locations' => $weatherLocations, 'groups_data' => $groupsData, 'my_groups' => $myGroups, 'loans' => $loans, 'recurring_items' => $recurringItems,
        ], $perm));
    }

    /* ===================== Mis grupos: crear, invitar, aceptar, salir ===================== */
    if ($resource === 'my_groups') {
        if ($method === 'GET') out(groupsBundle($pdo, $me));
        if ($method === 'POST') {
            $b = body();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '' || mb_strlen($name) > 60) out(['error' => 'El nombre del grupo debe tener entre 1 y 60 caracteres'], 400);
            $pdo->prepare('INSERT INTO `groups` (name) VALUES (?)')->execute([$name]);
            $gid = (int)$pdo->lastInsertId();
            $pdo->prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')")->execute([$gid, $me['id']]);
            out(groupsBundle($pdo, $me), 201);
        }
        if ($method === 'DELETE' && $id) {
            $gid = (int)$id;
            if (groupRole($pdo, $gid, $me['id']) !== 'owner') out(['error' => 'Solo el propietario puede eliminar el grupo'], 403);
            $c = $pdo->prepare('SELECT COUNT(*) FROM movements WHERE group_id = ?');
            $c->execute([$gid]);
            if ((int)$c->fetchColumn() > 0) out(['error' => 'El grupo tiene gastos compartidos y no se puede eliminar'], 409);
            $pdo->prepare("DELETE FROM shares WHERE recipient_type = 'group' AND recipient_id = ?")->execute([$gid]);
            $pdo->prepare('DELETE FROM group_invites WHERE group_id = ?')->execute([$gid]);
            $pdo->prepare('DELETE FROM group_members WHERE group_id = ?')->execute([$gid]);
            $pdo->prepare('UPDATE users SET group_id = NULL WHERE group_id = ?')->execute([$gid]);
            $pdo->prepare('DELETE FROM `groups` WHERE id = ?')->execute([$gid]);
            out(groupsBundle($pdo, $me));
        }
        out(['error' => 'petición no válida'], 400);
    }

    if ($resource === 'group_invites') {
        if ($method === 'POST') {                       // el propietario invita por nombre de usuario
            $b = body();
            $gid = (int)($b['group_id'] ?? 0);
            $uname = trim((string)($b['username'] ?? ''));
            if (groupRole($pdo, $gid, $me['id']) !== 'owner') out(['error' => 'Solo el propietario puede invitar'], 403);
            if ($uname === '') out(['error' => 'Escribe un nombre de usuario'], 400);
            $q = $pdo->prepare('SELECT id FROM users WHERE username = ? AND active = 1');
            $q->execute([$uname]);
            $target = $q->fetch();
            if (!$target) out(['error' => 'No existe ningún usuario con ese nombre'], 404);
            $tid = (int)$target['id'];
            if ($tid === (int)$me['id']) out(['error' => 'Ya perteneces a este grupo'], 400);
            $legacy = $pdo->prepare('SELECT 1 FROM users WHERE id = ? AND group_id = ?');
            $legacy->execute([$tid, $gid]);
            if (groupRole($pdo, $gid, $tid) !== null || $legacy->fetch()) out(['error' => 'Esa persona ya es miembro del grupo'], 409);
            $pdo->prepare('INSERT IGNORE INTO group_invites (group_id, invited_user_id, invited_by) VALUES (?, ?, ?)')->execute([$gid, $tid, $me['id']]);
            out(groupsBundle($pdo, $me), 201);
        }
        if ($method === 'PATCH' && $id) {               // la persona invitada acepta o rechaza
            $b = body();
            $s = $pdo->prepare('SELECT * FROM group_invites WHERE id = ? AND invited_user_id = ?');
            $s->execute([(int)$id, $me['id']]);
            $inv = $s->fetch();
            if (!$inv) out(['error' => 'Invitación no encontrada'], 404);
            if (!empty($b['accept'])) {
                $pdo->prepare("INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')")->execute([$inv['group_id'], $me['id']]);
            }
            $pdo->prepare('DELETE FROM group_invites WHERE id = ?')->execute([(int)$id]);
            out(groupsBundle($pdo, $me));
        }
        if ($method === 'DELETE' && $id) {              // el propietario cancela, o el invitado la descarta
            $s = $pdo->prepare('SELECT * FROM group_invites WHERE id = ?');
            $s->execute([(int)$id]);
            $inv = $s->fetch();
            if (!$inv) out(['error' => 'Invitación no encontrada'], 404);
            if ((int)$inv['invited_user_id'] !== (int)$me['id'] && groupRole($pdo, (int)$inv['group_id'], $me['id']) !== 'owner') out(['error' => 'no autorizado'], 403);
            $pdo->prepare('DELETE FROM group_invites WHERE id = ?')->execute([(int)$id]);
            out(groupsBundle($pdo, $me));
        }
        out(['error' => 'petición no válida'], 400);
    }

    if ($resource === 'group_members' && $method === 'DELETE') {   // salir del grupo o (propietario) quitar a alguien
        $gid = (int)($_GET['group_id'] ?? 0);
        $target = (int)($_GET['user_id'] ?? 0);
        $myRole = groupRole($pdo, $gid, $me['id']);
        if ($target === (int)$me['id']) {
            if ($myRole === null) out(['error' => 'No eres miembro de este grupo'], 404);
            if ($myRole === 'owner') out(['error' => 'El propietario no puede salir del grupo; elimínalo si ya no lo necesitas'], 409);
        } else {
            if ($myRole !== 'owner') out(['error' => 'Solo el propietario puede quitar miembros'], 403);
        }
        $pdo->prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ? AND role <> 'owner'")->execute([$gid, $target]);
        out(groupsBundle($pdo, $me));
    }

    /* ===================== Ciudades del tiempo ===================== */
    if ($resource === 'weather_locations') {
        $reply = function($code = 200) use ($pdo, $me) { out(['locations' => weatherLocationsList($pdo, $me['id'])], $code); };
        if ($method === 'GET') $reply();
        if ($method === 'POST') {
            $b = body();
            $name = trim((string)($b['name'] ?? ''));
            $lat = $b['latitude'] ?? null; $lon = $b['longitude'] ?? null;
            if ($name === '' || !is_numeric($lat) || !is_numeric($lon) || abs($lat) > 90 || abs($lon) > 180) out(['error' => 'ciudad no válida'], 400);
            $name = mb_substr($name, 0, 160);
            $list = weatherLocationsList($pdo, $me['id']);
            foreach ($list as $l) if (abs($l['latitude'] - $lat) < 0.01 && abs($l['longitude'] - $lon) < 0.01) $reply();   // ya estaba
            if (count($list) >= 12) out(['error' => 'Máximo 12 ciudades'], 400);
            $pdo->prepare('INSERT INTO weather_locations (user_id, name, latitude, longitude, is_active) VALUES (?, ?, ?, ?, ?)')
                ->execute([$me['id'], $name, $lat, $lon, $list ? 0 : 1]);
            syncActiveWeather($pdo, $me['id']);
            $reply(201);
        }
        if ($method === 'PATCH' && $id) {
            $s = $pdo->prepare('SELECT id FROM weather_locations WHERE id = ? AND user_id = ?');
            $s->execute([(int)$id, $me['id']]);
            if (!$s->fetch()) out(['error' => 'no encontrada'], 404);
            $pdo->prepare('UPDATE weather_locations SET is_active = (id = ?) WHERE user_id = ?')->execute([(int)$id, $me['id']]);
            syncActiveWeather($pdo, $me['id']);
            $reply();
        }
        if ($method === 'DELETE' && $id) {
            $pdo->prepare('DELETE FROM weather_locations WHERE id = ? AND user_id = ?')->execute([(int)$id, $me['id']]);
            $a = $pdo->prepare('SELECT COUNT(*) FROM weather_locations WHERE user_id = ? AND is_active = 1');
            $a->execute([$me['id']]);
            if ((int)$a->fetchColumn() === 0) {             // si se borró la activa, pasa a serlo la más antigua
                $pdo->prepare('UPDATE weather_locations SET is_active = 1 WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT 1')->execute([$me['id']]);
            }
            syncActiveWeather($pdo, $me['id']);
            $reply();
        }
        out(['error' => 'petición no válida'], 400);
    }

    if ($resource === 'categories') {
        if ($method === 'GET') {
            $s = $pdo->prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY created_at ASC');
            $s->execute([$me['id']]); out($s->fetchAll());
        }
        if ($method === 'POST') {
            $b = body();
            $pdo->prepare('INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)')->execute([$me['id'], $b['name'], $b['color'] ?? null]);
            $newId = $pdo->lastInsertId();
            out($pdo->query("SELECT * FROM categories WHERE id = $newId")->fetch(), 201);
        }
        if ($method === 'DELETE' && $id) {
            if (!categoryBelongsToUser($pdo, $id, $me['id'])) out(['error' => 'no autorizado'], 403);
            $pdo->prepare('DELETE FROM categories WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }
    }

    if ($resource === 'tags') {
        if ($method === 'POST') {
            $b = body();
            if (!categoryBelongsToUser($pdo, $b['category_id'], $me['id'])) out(['error' => 'no autorizado'], 403);
            $pdo->prepare('INSERT INTO tags (category_id, name) VALUES (?, ?)')->execute([$b['category_id'], $b['name']]);
            $newId = $pdo->lastInsertId();
            out($pdo->query("SELECT * FROM tags WHERE id = $newId")->fetch(), 201);
        }
        if ($method === 'DELETE' && $id) {
            $s = $pdo->prepare('SELECT t.id FROM tags t JOIN categories c ON c.id = t.category_id WHERE t.id = ? AND c.user_id = ?');
            $s->execute([$id, $me['id']]);
            if (!$s->fetch()) out(['error' => 'no autorizado'], 403);
            $pdo->prepare('DELETE FROM tags WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }
    }

    if ($resource === 'tasks') {
        if ($method === 'POST') {
            $b = body();
            if (!categoryBelongsToUser($pdo, $b['category_id'], $me['id'])) out(['error' => 'no autorizado'], 403);
            $stmt = $pdo->prepare('INSERT INTO tasks (user_id, category_id, tag_id, text, description, due_at, reminders, notified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([
                $me['id'], $b['category_id'], $b['tag_id'] ?? null, $b['text'], $b['description'] ?? null,
                !empty($b['due_at']) ? gmdate('Y-m-d H:i:s', strtotime($b['due_at'])) : null,
                json_encode($b['reminders'] ?? []), json_encode([])
            ]);
            $newId = $pdo->lastInsertId();
            $row = $pdo->query("SELECT * FROM tasks WHERE id = $newId")->fetch();
            $row['reminders'] = json_decode($row['reminders'], true) ?: [];
            $row['notified'] = json_decode($row['notified'], true) ?: [];
            $row['done'] = (bool)$row['done'];
            out($row, 201);
        }
        if ($method === 'PATCH' && $id) {
            $s = $pdo->prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?');
            $s->execute([$id, $me['id']]);
            if (!$s->fetch()) out(['error' => 'no autorizado'], 403);
            $b = body();
            $fields = []; $vals = [];
            if (array_key_exists('done', $b)) { $fields[] = 'done = ?'; $vals[] = $b['done'] ? 1 : 0; }
            if (array_key_exists('notified', $b)) { $fields[] = 'notified = ?'; $vals[] = json_encode($b['notified']); }
            if (array_key_exists('due_at', $b)) { $fields[] = 'due_at = ?'; $vals[] = $b['due_at'] ? gmdate('Y-m-d H:i:s', strtotime($b['due_at'])) : null; }
            if (array_key_exists('reminders', $b)) { $fields[] = 'reminders = ?'; $vals[] = json_encode($b['reminders']); }
            if (array_key_exists('description', $b)) { $fields[] = 'description = ?'; $vals[] = $b['description']; }
            if (array_key_exists('category_id', $b) && categoryBelongsToUser($pdo, $b['category_id'], $me['id'])) { $fields[] = 'category_id = ?'; $vals[] = $b['category_id']; }
            if ($fields) { $vals[] = $id; $pdo->prepare('UPDATE tasks SET ' . implode(',', $fields) . ' WHERE id = ?')->execute($vals); }
            out(['ok' => true]);
        }
        if ($method === 'DELETE' && $id) {
            $s = $pdo->prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?');
            $s->execute([$id, $me['id']]);
            out(['ok' => true]);
        }
    }

    if ($resource === 'finance_categories') {
        if ($method === 'POST') {
            $b = body();
            $pdo->prepare('INSERT INTO finance_categories (user_id, name, color) VALUES (?, ?, ?)')->execute([$me['id'], $b['name'], $b['color'] ?? null]);
            $newId = $pdo->lastInsertId();
            out($pdo->query("SELECT * FROM finance_categories WHERE id = $newId")->fetch(), 201);
        }
        if ($method === 'DELETE' && $id) {
            $s = $pdo->prepare('DELETE FROM finance_categories WHERE id = ? AND user_id = ?');
            $s->execute([$id, $me['id']]);
            out(['ok' => true]);
        }
    }

    if ($resource === 'loans') {
        if ($method === 'POST') {
            $b = body();
            $principal = (float)($b['principal'] ?? 0);
            $tae = (float)($b['tae'] ?? 0);
            $months = (int)($b['months'] ?? 0);
            if ($principal <= 0 || $months <= 0) out(['error' => 'importe y plazo deben ser mayores que 0'], 400);
            if (!empty($b['category_id']) && !financeCategoryBelongsToUser($pdo, $b['category_id'], $me['id'])) $b['category_id'] = null;
            $payment = monthlyPayment($principal, $tae, $months);
            $stmt = $pdo->prepare('INSERT INTO loans (user_id, name, principal, tae, months, monthly_payment, start_date, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$me['id'], trim($b['name']) ?: 'Préstamo', $principal, $tae, $months, $payment, $b['start_date'] ?? date('Y-m-d'), $b['category_id'] ?? null]);
            $newId = $pdo->lastInsertId();
            materializeRecurring($pdo, $me['id']);
            out($pdo->query("SELECT * FROM loans WHERE id = $newId")->fetch(), 201);
        }
        if ($method === 'PATCH' && $id) {
            $s = $pdo->prepare('SELECT id FROM loans WHERE id = ? AND user_id = ?'); $s->execute([$id, $me['id']]);
            if (!$s->fetch()) out(['error' => 'no autorizado'], 403);
            $b = body();
            if (array_key_exists('active', $b)) $pdo->prepare('UPDATE loans SET active = ? WHERE id = ?')->execute([$b['active'] ? 1 : 0, $id]);
            out(['ok' => true]);
        }
        if ($method === 'DELETE' && $id) {
            $s = $pdo->prepare('SELECT id FROM loans WHERE id = ? AND user_id = ?'); $s->execute([$id, $me['id']]);
            if (!$s->fetch()) out(['error' => 'no autorizado'], 403);
            $pdo->prepare('DELETE FROM loans WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }
    }

    if ($resource === 'recurring_items') {
        if ($method === 'POST') {
            $b = body();
            $amount = (float)($b['amount'] ?? 0);
            $day = max(1, min(28, (int)($b['day_of_month'] ?? 1)));
            if ($amount <= 0) out(['error' => 'el importe debe ser mayor que 0'], 400);
            if (!in_array($b['type'] ?? '', ['gasto', 'ingreso'], true)) out(['error' => 'tipo no válido'], 400);
            if (!empty($b['category_id']) && !financeCategoryBelongsToUser($pdo, $b['category_id'], $me['id'])) $b['category_id'] = null;
            $stmt = $pdo->prepare('INSERT INTO recurring_items (user_id, type, name, amount, category_id, day_of_month, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$me['id'], $b['type'], trim($b['name']) ?: ($b['type'] === 'ingreso' ? 'Ingreso fijo' : 'Gasto fijo'), $amount, $b['category_id'] ?? null, $day, $b['start_date'] ?? date('Y-m-d'), $b['end_date'] ?? null]);
            $newId = $pdo->lastInsertId();
            materializeRecurring($pdo, $me['id']);
            out($pdo->query("SELECT * FROM recurring_items WHERE id = $newId")->fetch(), 201);
        }
        if ($method === 'PATCH' && $id) {
            $s = $pdo->prepare('SELECT id FROM recurring_items WHERE id = ? AND user_id = ?'); $s->execute([$id, $me['id']]);
            if (!$s->fetch()) out(['error' => 'no autorizado'], 403);
            $b = body();
            if (array_key_exists('active', $b)) $pdo->prepare('UPDATE recurring_items SET active = ? WHERE id = ?')->execute([$b['active'] ? 1 : 0, $id]);
            out(['ok' => true]);
        }
        if ($method === 'DELETE' && $id) {
            $s = $pdo->prepare('SELECT id FROM recurring_items WHERE id = ? AND user_id = ?'); $s->execute([$id, $me['id']]);
            if (!$s->fetch()) out(['error' => 'no autorizado'], 403);
            $pdo->prepare('DELETE FROM recurring_items WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }
    }

    if ($resource === 'movements') {
        if ($method === 'POST') {
            $b = body();
            $groupId = null;
            if (!empty($b['group_id']) && $me['group_id'] && (int)$b['group_id'] === (int)$me['group_id']) $groupId = $me['group_id'];
            $paidBy = $me['id'];
            if (!empty($b['paid_by'])) {
                if ($groupId) {
                    $s = $pdo->prepare('SELECT id FROM users WHERE id = ? AND group_id = ?');
                    $s->execute([$b['paid_by'], $groupId]);
                    if ($s->fetch()) $paidBy = (int)$b['paid_by'];
                } elseif ((int)$b['paid_by'] === (int)$me['id']) {
                    $paidBy = $me['id'];
                }
            }
            if (!empty($b['category_id']) && !financeCategoryBelongsToUser($pdo, $b['category_id'], $me['id'])) {
                $b['category_id'] = null;
            }
            if (!in_array($b['type'] ?? '', ['gasto', 'ingreso'], true)) out(['error' => 'tipo no válido'], 400);
            if (!is_numeric($b['amount'] ?? null) || (float)$b['amount'] <= 0) out(['error' => 'el importe debe ser mayor que 0'], 400);
            $stmt = $pdo->prepare('INSERT INTO movements (user_id, group_id, paid_by, type, amount, category_id, description, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$me['id'], $groupId, $paidBy, $b['type'], $b['amount'], $b['category_id'] ?? null, $b['description'] ?? '', $b['date'] ?? date('Y-m-d')]);
            $newId = $pdo->lastInsertId();
            out($pdo->query("SELECT * FROM movements WHERE id = $newId")->fetch(), 201);
        }
        if ($method === 'PATCH' && $id) {
            // Solo quien registró el movimiento puede editarlo (igual que borrarlo)
            $s = $pdo->prepare('SELECT * FROM movements WHERE id = ? AND user_id = ?');
            $s->execute([$id, $me['id']]);
            $m = $s->fetch();
            if (!$m) out(['error' => 'no autorizado'], 403);
            $b = body();
            $fields = []; $vals = [];
            if (array_key_exists('type', $b)) {
                if (!in_array($b['type'], ['gasto', 'ingreso'], true)) out(['error' => 'tipo no válido'], 400);
                $fields[] = 'type = ?'; $vals[] = $b['type'];
            }
            if (array_key_exists('amount', $b)) {
                if (!is_numeric($b['amount']) || (float)$b['amount'] <= 0) out(['error' => 'el importe debe ser mayor que 0'], 400);
                $fields[] = 'amount = ?'; $vals[] = (float)$b['amount'];
            }
            if (array_key_exists('date', $b)) {
                $d = DateTime::createFromFormat('Y-m-d', (string)$b['date']);
                if (!$d || $d->format('Y-m-d') !== $b['date']) out(['error' => 'fecha no válida'], 400);
                $fields[] = 'date = ?'; $vals[] = $b['date'];
            }
            if (array_key_exists('description', $b)) { $fields[] = 'description = ?'; $vals[] = mb_substr((string)$b['description'], 0, 160); }
            if (array_key_exists('category_id', $b)) {
                $cat = $b['category_id'] ?: null;
                if ($cat && !financeCategoryBelongsToUser($pdo, $cat, $me['id'])) $cat = null;
                $fields[] = 'category_id = ?'; $vals[] = $cat;
            }
            if (array_key_exists('paid_by', $b) && $m['group_id']) {
                $q = $pdo->prepare('SELECT id FROM users WHERE id = ? AND group_id = ?');
                $q->execute([$b['paid_by'], $m['group_id']]);
                if ($q->fetch()) { $fields[] = 'paid_by = ?'; $vals[] = (int)$b['paid_by']; }
            }
            if ($fields) { $vals[] = $id; $pdo->prepare('UPDATE movements SET ' . implode(',', $fields) . ' WHERE id = ?')->execute($vals); }
            $q = $pdo->prepare('SELECT * FROM movements WHERE id = ?'); $q->execute([$id]);
            out($q->fetch());
        }
        if ($method === 'DELETE' && $id) {
            $s = $pdo->prepare('SELECT id FROM movements WHERE id = ? AND user_id = ?');
            $s->execute([$id, $me['id']]);
            if (!$s->fetch()) out(['error' => 'no autorizado'], 403);
            $pdo->prepare('DELETE FROM movements WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }
    }

    if ($resource === 'weather_location') {
        if ($method === 'POST' || $method === 'PATCH') {
            $b = body();
            $stmt = $pdo->prepare('UPDATE users SET weather_name = ?, weather_lat = ?, weather_lon = ? WHERE id = ?');
            $stmt->execute([$b['name'] ?? null, $b['latitude'] ?? null, $b['longitude'] ?? null, $me['id']]);
            out(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('UPDATE users SET weather_name = NULL, weather_lat = NULL, weather_lon = NULL WHERE id = ?')->execute([$me['id']]);
            out(['ok' => true]);
        }
    }

    if ($resource === 'diagrams') {
        if ($method === 'GET' && !$id) {
            // Lista ligera (sin escena): mis diagramas + los compartidos conmigo
            $access = sharedAccessMap($pdo, 'diagram', $me['id']);
            $sql = "SELECT d.id, d.user_id, d.title, d.thumbnail, d.created_at, d.updated_at, u.username AS owner_username,
                        (SELECT COUNT(*) FROM shares sh WHERE sh.resource_type = 'diagram' AND sh.resource_id = d.id) AS share_count
                    FROM diagrams d JOIN users u ON u.id = d.user_id
                    WHERE d.user_id = ?";
            $params = [$me['id']];
            if ($access) { $sql .= ' OR d.id IN (' . implode(',', array_fill(0, count($access), '?')) . ')'; $params = array_merge($params, array_keys($access)); }
            $sql .= ' ORDER BY d.updated_at DESC';
            $s = $pdo->prepare($sql);
            $s->execute($params);
            $rows = array_map(function($d) use ($me, $access) {
                $mine = ((int)$d['user_id'] === (int)$me['id']);
                $d['access'] = $mine ? 'owner' : ($access[(int)$d['id']] ?? 'view');
                $d['share_count'] = $mine ? (int)$d['share_count'] : 0;
                return $d;
            }, $s->fetchAll());
            out($rows);
        }
        if ($method === 'GET' && $id) {
            $acc = resourceAccess($pdo, 'diagram', (int)$id, $me);
            if (!$acc) out(['error' => 'no encontrado'], 404);
            $s = $pdo->prepare('SELECT d.id, d.user_id, d.title, d.scene, d.thumbnail, d.updated_at, u.username AS owner_username FROM diagrams d JOIN users u ON u.id = d.user_id WHERE d.id = ?');
            $s->execute([$id]);
            $row = $s->fetch();
            $row['scene'] = $row['scene'] ? json_decode($row['scene'], true) : null;
            $row['access'] = $acc;
            out($row);
        }
        if ($method === 'POST') {
            $b = body();
            $title = trim($b['title'] ?? '') ?: 'Diagrama sin título';
            $scene = isset($b['scene']) ? json_encode($b['scene']) : null;
            $stmt = $pdo->prepare('INSERT INTO diagrams (user_id, title, scene, thumbnail) VALUES (?, ?, ?, ?)');
            $stmt->execute([$me['id'], mb_substr($title, 0, 160), $scene, $b['thumbnail'] ?? null]);
            $newId = $pdo->lastInsertId();
            $s = $pdo->prepare('SELECT id, title, thumbnail, created_at, updated_at FROM diagrams WHERE id = ?');
            $s->execute([$newId]);
            $row = $s->fetch();
            $row['access'] = 'owner'; $row['owner_username'] = $me['username']; $row['share_count'] = 0;
            out($row, 201);
        }
        if ($method === 'PATCH' && $id) {
            $acc = resourceAccess($pdo, 'diagram', (int)$id, $me);
            if (!$acc) out(['error' => 'no encontrado'], 404);
            if ($acc === 'view') out(['error' => 'solo lectura'], 403);
            $b = body();
            assertNoConflict($pdo, 'diagrams', $id, $b);
            $fields = []; $vals = [];
            if (array_key_exists('title', $b)) { $fields[] = 'title = ?'; $vals[] = mb_substr(trim($b['title']) ?: 'Diagrama sin título', 0, 160); }
            if (array_key_exists('scene', $b)) { $fields[] = 'scene = ?'; $vals[] = json_encode($b['scene']); }
            if (array_key_exists('thumbnail', $b)) { $fields[] = 'thumbnail = ?'; $vals[] = $b['thumbnail']; }
            if ($fields) { $vals[] = $id; $pdo->prepare('UPDATE diagrams SET ' . implode(',', $fields) . ' WHERE id = ?')->execute($vals); }
            out(['ok' => true, 'updated_at' => currentUpdatedAt($pdo, 'diagrams', $id)]);
        }
        if ($method === 'DELETE' && $id) {
            $acc = resourceAccess($pdo, 'diagram', (int)$id, $me);
            if (!$acc) out(['error' => 'no encontrado'], 404);
            if ($acc !== 'owner') out(['error' => 'solo el propietario puede borrar'], 403);
            $pdo->prepare("DELETE FROM shares WHERE resource_type = 'diagram' AND resource_id = ?")->execute([$id]);
            $pdo->prepare('DELETE FROM diagrams WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }
    }

    if ($resource === 'weather_location') {
        if ($method === 'POST' || $method === 'PATCH') {
            $b = body();
            $stmt = $pdo->prepare('UPDATE users SET weather_name = ?, weather_lat = ?, weather_lon = ? WHERE id = ?');
            $stmt->execute([$b['name'] ?? null, $b['latitude'] ?? null, $b['longitude'] ?? null, $me['id']]);
            out(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('UPDATE users SET weather_name = NULL, weather_lat = NULL, weather_lon = NULL WHERE id = ?')->execute([$me['id']]);
            out(['ok' => true]);
        }
    }

    if ($resource === 'diagrams') {
        if ($method === 'GET' && !$id) {
            // Lista ligera: sin la escena completa (puede pesar bastante)
            $s = $pdo->prepare('SELECT id, title, thumbnail, created_at, updated_at FROM diagrams WHERE user_id = ? ORDER BY updated_at DESC');
            $s->execute([$me['id']]);
            out($s->fetchAll());
        }
        if ($method === 'GET' && $id) {
            $s = $pdo->prepare('SELECT id, title, scene, thumbnail, updated_at FROM diagrams WHERE id = ? AND user_id = ?');
            $s->execute([$id, $me['id']]);
            $row = $s->fetch();
            if (!$row) out(['error' => 'no encontrado'], 404);
            $row['scene'] = $row['scene'] ? json_decode($row['scene'], true) : null;
            out($row);
        }
        if ($method === 'POST') {
            $b = body();
            $title = trim($b['title'] ?? '') ?: 'Diagrama sin título';
            $scene = isset($b['scene']) ? json_encode($b['scene']) : null;
            $stmt = $pdo->prepare('INSERT INTO diagrams (user_id, title, scene, thumbnail) VALUES (?, ?, ?, ?)');
            $stmt->execute([$me['id'], mb_substr($title, 0, 160), $scene, $b['thumbnail'] ?? null]);
            $newId = $pdo->lastInsertId();
            $s = $pdo->prepare('SELECT id, title, thumbnail, created_at, updated_at FROM diagrams WHERE id = ?');
            $s->execute([$newId]);
            out($s->fetch(), 201);
        }
        if ($method === 'PATCH' && $id) {
            $s = $pdo->prepare('SELECT id FROM diagrams WHERE id = ? AND user_id = ?');
            $s->execute([$id, $me['id']]);
            if (!$s->fetch()) out(['error' => 'no autorizado'], 403);
            $b = body();
            $fields = []; $vals = [];
            if (array_key_exists('title', $b)) { $fields[] = 'title = ?'; $vals[] = mb_substr(trim($b['title']) ?: 'Diagrama sin título', 0, 160); }
            if (array_key_exists('scene', $b)) { $fields[] = 'scene = ?'; $vals[] = json_encode($b['scene']); }
            if (array_key_exists('thumbnail', $b)) { $fields[] = 'thumbnail = ?'; $vals[] = $b['thumbnail']; }
            if ($fields) { $vals[] = $id; $pdo->prepare('UPDATE diagrams SET ' . implode(',', $fields) . ' WHERE id = ?')->execute($vals); }
            out(['ok' => true]);
        }
        if ($method === 'DELETE' && $id) {
            $pdo->prepare('DELETE FROM diagrams WHERE id = ? AND user_id = ?')->execute([$id, $me['id']]);
            out(['ok' => true]);
        }
    }

    if ($resource === 'shares') {
        $shareRow = function($sid) use ($pdo) {
            $q = $pdo->prepare("SELECT s.id, s.recipient_type, s.recipient_id, s.permission,
                    CASE WHEN s.recipient_type = 'user' THEN u.username ELSE g.name END AS name
                FROM shares s
                LEFT JOIN users u ON (s.recipient_type = 'user' AND u.id = s.recipient_id)
                LEFT JOIN `groups` g ON (s.recipient_type = 'group' AND g.id = s.recipient_id)
                WHERE s.id = ?");
            $q->execute([$sid]);
            return $q->fetch();
        };

        if ($method === 'GET') {
            $type = $_GET['type'] ?? ''; $rid = (int)($_GET['rid'] ?? 0);
            if (!isset(SHARE_TABLES[$type])) out(['error' => 'tipo no válido'], 400);
            $acc = resourceAccess($pdo, $type, $rid, $me);
            if (!$acc) out(['error' => 'no encontrado'], 404);
            if ($acc !== 'owner') out(['error' => 'solo el propietario gestiona quién tiene acceso'], 403);
            $q = $pdo->prepare("SELECT s.id, s.recipient_type, s.recipient_id, s.permission,
                    CASE WHEN s.recipient_type = 'user' THEN u.username ELSE g.name END AS name
                FROM shares s
                LEFT JOIN users u ON (s.recipient_type = 'user' AND u.id = s.recipient_id)
                LEFT JOIN `groups` g ON (s.recipient_type = 'group' AND g.id = s.recipient_id)
                WHERE s.resource_type = ? AND s.resource_id = ? ORDER BY s.created_at ASC");
            $q->execute([$type, $rid]);
            out($q->fetchAll());
        }

        if ($method === 'POST') {
            $b = body();
            $type = $b['type'] ?? ''; $rid = (int)($b['rid'] ?? 0);
            if (!isset(SHARE_TABLES[$type])) out(['error' => 'tipo no válido'], 400);
            $acc = resourceAccess($pdo, $type, $rid, $me);
            if (!$acc) out(['error' => 'no encontrado'], 404);
            if ($acc !== 'owner') out(['error' => 'solo el propietario puede compartir'], 403);
            $perm = (($b['permission'] ?? 'view') === 'edit') ? 'edit' : 'view';

            if (($b['recipient_type'] ?? '') === 'user') {
                $uname = trim($b['username'] ?? '');
                if ($uname === '') out(['error' => 'escribe un nombre de usuario'], 400);
                $q = $pdo->prepare('SELECT id FROM users WHERE username = ? AND active = 1');
                $q->execute([$uname]);
                $target = $q->fetch();
                if (!$target) out(['error' => 'No existe ningún usuario con ese nombre'], 404);
                if ((int)$target['id'] === (int)$me['id']) out(['error' => 'No puedes compartir contigo mismo'], 400);
                $recipientType = 'user'; $recipientId = (int)$target['id'];
            } elseif (($b['recipient_type'] ?? '') === 'group') {
                $gid = (int)($b['group_id'] ?? 0);
                if (!in_array($gid, userGroupIds($pdo, $me['id']), true)) out(['error' => 'No perteneces a ese grupo'], 403);
                $recipientType = 'group'; $recipientId = $gid;
            } else {
                out(['error' => 'destinatario no válido'], 400);
            }

            $pdo->prepare('INSERT INTO shares (resource_type, resource_id, owner_id, recipient_type, recipient_id, permission)
                           VALUES (?, ?, ?, ?, ?, ?)
                           ON DUPLICATE KEY UPDATE permission = VALUES(permission)')
                ->execute([$type, $rid, $me['id'], $recipientType, $recipientId, $perm]);
            $q = $pdo->prepare('SELECT id FROM shares WHERE resource_type = ? AND resource_id = ? AND recipient_type = ? AND recipient_id = ?');
            $q->execute([$type, $rid, $recipientType, $recipientId]);
            out($shareRow($q->fetchColumn()), 201);
        }

        if (($method === 'PATCH' || $method === 'DELETE') && $id) {
            $q = $pdo->prepare('SELECT owner_id FROM shares WHERE id = ?');
            $q->execute([$id]);
            $ownerId = $q->fetchColumn();
            if ($ownerId === false) out(['error' => 'no encontrado'], 404);
            if ((int)$ownerId !== (int)$me['id']) out(['error' => 'solo el propietario puede cambiar los accesos'], 403);
            if ($method === 'PATCH') {
                $b = body();
                $perm = (($b['permission'] ?? 'view') === 'edit') ? 'edit' : 'view';
                $pdo->prepare('UPDATE shares SET permission = ? WHERE id = ?')->execute([$perm, $id]);
                out($shareRow($id));
            }
            $pdo->prepare('DELETE FROM shares WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }
    }

    if ($resource === 'note_image') {
        // Servir: el acceso a la imagen es el acceso a su nota (propietario o compartida con el usuario)
        if ($method === 'GET' && $id) {
            $q = $pdo->prepare('SELECT note_id, mime, data FROM note_images WHERE id = ?');
            $q->execute([$id]);
            $img = $q->fetch();
            if (!$img || !resourceAccess($pdo, 'note', (int)$img['note_id'], $me)) out(['error' => 'no encontrado'], 404);
            header('Content-Type: ' . $img['mime']);
            header('X-Content-Type-Options: nosniff');
            header("Content-Security-Policy: default-src 'none'; sandbox");
            header('Cache-Control: private, max-age=86400');
            header('Content-Length: ' . strlen($img['data']));
            echo $img['data'];
            exit;
        }
        // Subir: cuerpo binario crudo; solo con permiso de edición sobre la nota
        if ($method === 'POST') {
            $noteId = (int)($_GET['note_id'] ?? 0);
            $acc = resourceAccess($pdo, 'note', $noteId, $me);
            if (!$acc) out(['error' => 'no encontrado'], 404);
            if ($acc === 'view') out(['error' => 'solo lectura'], 403);
            $raw = file_get_contents('php://input');
            if ($raw === '' || $raw === false) out(['error' => 'imagen vacía'], 400);
            if (strlen($raw) > NOTE_IMAGE_MAX_BYTES) out(['error' => 'La imagen pesa demasiado (máx. 3 MB).'], 413);
            // El tipo se deduce del contenido real, no de lo que diga el cliente. SVG queda fuera a propósito.
            $info = @getimagesizefromstring($raw);
            $types = [IMAGETYPE_JPEG => 'image/jpeg', IMAGETYPE_PNG => 'image/png', IMAGETYPE_GIF => 'image/gif', IMAGETYPE_WEBP => 'image/webp'];
            if (!$info || !isset($types[$info[2]])) out(['error' => 'Formato no admitido (usa JPG, PNG, GIF o WebP).'], 415);
            $q = $pdo->prepare('SELECT COUNT(*) FROM note_images WHERE note_id = ?'); $q->execute([$noteId]);
            if ((int)$q->fetchColumn() >= NOTE_IMAGE_MAX_PER_NOTE) out(['error' => 'Esta nota ya tiene el máximo de imágenes (' . NOTE_IMAGE_MAX_PER_NOTE . ').'], 413);
            $q = $pdo->prepare('SELECT COALESCE(SUM(size),0) FROM note_images WHERE user_id = ?'); $q->execute([$me['id']]);
            if ((int)$q->fetchColumn() + strlen($raw) > NOTE_IMAGE_MAX_PER_USER_BYTES) out(['error' => 'Has alcanzado tu límite de espacio para imágenes.'], 413);
            $stmt = $pdo->prepare('INSERT INTO note_images (note_id, user_id, mime, size, data) VALUES (?, ?, ?, ?, ?)');
            $stmt->bindValue(1, $noteId, PDO::PARAM_INT);
            $stmt->bindValue(2, $me['id'], PDO::PARAM_INT);
            $stmt->bindValue(3, $types[$info[2]]);
            $stmt->bindValue(4, strlen($raw), PDO::PARAM_INT);
            $stmt->bindValue(5, $raw, PDO::PARAM_LOB);
            $stmt->execute();
            $newId = (int)$pdo->lastInsertId();
            out(['id' => $newId, 'url' => 'api.php?resource=note_image&id=' . $newId], 201);
        }
    }

    if ($resource === 'notes') {
        if ($method === 'GET' && !$id) out(fetchNotesList($pdo, $me));
        if ($method === 'POST') {
            $b = body();
            $stmt = $pdo->prepare('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)');
            $stmt->execute([$me['id'], $b['title'] ?? '', $b['content'] ?? '']);
            $newId = $pdo->lastInsertId();
            $row = $pdo->query("SELECT * FROM notes WHERE id = $newId")->fetch();
            $row['pinned'] = (bool)$row['pinned'];
            $row['access'] = 'owner'; $row['owner_username'] = $me['username']; $row['share_count'] = 0;
            out($row, 201);
        }
        if ($method === 'PATCH' && $id) {
            $acc = resourceAccess($pdo, 'note', (int)$id, $me);
            if (!$acc) out(['error' => 'no encontrado'], 404);
            $b = body();
            $touchesContent = array_key_exists('title', $b) || array_key_exists('content', $b);
            if (array_key_exists('pinned', $b) && $acc !== 'owner') out(['error' => 'solo el propietario puede fijar la nota'], 403);
            if ($touchesContent && $acc === 'view') out(['error' => 'solo lectura'], 403);
            if ($touchesContent) assertNoConflict($pdo, 'notes', $id, $b);
            $fields = []; $vals = [];
            foreach (['title', 'content'] as $f) {
                if (array_key_exists($f, $b)) { $fields[] = "$f = ?"; $vals[] = $b[$f]; }
            }
            if (array_key_exists('pinned', $b)) {
                $fields[] = 'pinned = ?'; $vals[] = $b['pinned'] ? 1 : 0;
                // Fijar no es una edición: no debe cambiar la fecha ni provocar avisos de conflicto a los demás
                if (!$touchesContent) $fields[] = 'updated_at = updated_at';
            }
            if ($fields) { $vals[] = $id; $pdo->prepare('UPDATE notes SET ' . implode(',', $fields) . ' WHERE id = ?')->execute($vals); }
            if (array_key_exists('content', $b)) cleanupOrphanNoteImages($pdo, (int)$id, $b['content']);
            out(['ok' => true, 'updated_at' => currentUpdatedAt($pdo, 'notes', $id)]);
        }
        if ($method === 'DELETE' && $id) {
            $acc = resourceAccess($pdo, 'note', (int)$id, $me);
            if (!$acc) out(['error' => 'no encontrado'], 404);
            if ($acc !== 'owner') out(['error' => 'solo el propietario puede borrar'], 403);
            $pdo->prepare("DELETE FROM shares WHERE resource_type = 'note' AND resource_id = ?")->execute([$id]);
            $pdo->prepare('DELETE FROM notes WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }
    }

    out(['error' => 'petición no válida'], 400);
} catch (Exception $e) {
    out(['error' => $e->getMessage()], 500);
}