<?php
/**
 * Herramientas de SOLO LECTURA que el chat puede usar cuando el usuario lo permite ("Permitir que el chat consulte mis datos").
 * El modelo no ve la base de datos: pide una función con parámetros, aquí se ejecuta una consulta preparada limitada al
 * usuario de la sesión y se devuelve un resultado pequeño. Cada herramienta solo existe si el rol del usuario puede usar ese módulo.
 */
require_once __DIR__ . '/features.php';

function ctDate($v) { $d = DateTime::createFromFormat('Y-m-d', trim((string)$v)); return ($d && $d->format('Y-m-d') === trim((string)$v)) ? $d->format('Y-m-d') : null; }
function ctLimit($v, $def = 20, $max = 40) { $n = (int)$v; return $n > 0 ? min($n, $max) : $def; }
function ctLike($s) { return '%' . addcslashes(trim((string)$s), '%_\\') . '%'; }

/** [definiciones para la API, ejecutor, etiquetas]. $perm = permResolve(). */
function chatTools($pdo, $uid, $perm, $tzName) {
    $can = function (array $mods) use ($perm) { if ($perm['role'] === 'admin') return true; foreach ($mods as $m) if (($perm['modules'][$m] ?? 'allow') === 'allow') return true; return false; };
    $tz = new DateTimeZone(featValidTz($tzName));
    $fn = function ($name, $desc, $props, $req = []) { return ['type' => 'function', 'function' => ['name' => $name, 'description' => $desc, 'parameters' => ['type' => 'object', 'properties' => $props, 'required' => $req]]]; };
    $S = ['type' => 'string']; $I = ['type' => 'integer'];
    $dateP = ['type' => 'string', 'description' => 'Fecha YYYY-MM-DD'];
    $defs = []; $impl = [];

    $utc = function ($localDate, $endOfDay) use ($tz) {            // fecha local → instante UTC
        $d = new DateTime($localDate . ($endOfDay ? ' 23:59:59' : ' 00:00:00'), $tz);
        return $d->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    };

    if ($can(['tareas', 'calendario'])) {
        $defs[] = $fn('consultar_tareas', 'Lista las tareas del usuario con filtros. Úsala para "qué tengo pendiente", "tareas de esta semana", "qué vence mañana"…',
            ['estado' => ['type' => 'string', 'enum' => ['pendientes', 'hechas', 'todas']], 'desde' => $dateP, 'hasta' => $dateP, 'solo_vencidas' => ['type' => 'boolean'], 'categoria' => $S, 'texto' => $S, 'limite' => $I]);
        $impl['consultar_tareas'] = function ($a) use ($pdo, $uid, $tz, $utc) {
            $w = ['t.user_id = ?']; $p = [$uid];
            $estado = $a['estado'] ?? 'pendientes';
            if ($estado === 'pendientes') $w[] = 't.done = 0'; elseif ($estado === 'hechas') $w[] = 't.done = 1';
            if ($d = ctDate($a['desde'] ?? '')) { $w[] = 't.due_at >= ?'; $p[] = $utc($d, false); }
            if ($d = ctDate($a['hasta'] ?? '')) { $w[] = 't.due_at <= ?'; $p[] = $utc($d, true); }
            if (!empty($a['solo_vencidas'])) { $w[] = 't.done = 0 AND t.due_at < UTC_TIMESTAMP()'; }
            if (!empty($a['categoria'])) { $w[] = 'c.name LIKE ?'; $p[] = ctLike($a['categoria']); }
            if (!empty($a['texto'])) { $w[] = 't.text LIKE ?'; $p[] = ctLike($a['texto']); }
            $sql = ' FROM tasks t LEFT JOIN categories c ON c.id = t.category_id WHERE ' . implode(' AND ', $w);
            $c = $pdo->prepare('SELECT COUNT(*)' . $sql); $c->execute($p); $total = (int)$c->fetchColumn();
            $q = $pdo->prepare('SELECT t.text, t.due_at, t.done, t.priority, t.repeat_rule, t.checklist, c.name AS cat' . $sql . ' ORDER BY (t.due_at IS NULL), t.due_at ASC LIMIT ' . ctLimit($a['limite'] ?? 0));
            $q->execute($p);
            $items = array_map(function ($r) use ($tz) {
                $ck = json_decode($r['checklist'] ?? '[]', true) ?: [];
                return array_filter(['tarea' => $r['text'], 'vence' => $r['due_at'] ? (new DateTime($r['due_at'], new DateTimeZone('UTC')))->setTimezone($tz)->format('Y-m-d H:i') : 'sin fecha',
                    'hecha' => (bool)$r['done'], 'prioridad' => [0 => null, 1 => 'baja', 2 => 'media', 3 => 'alta'][(int)$r['priority']] ?? null, 'categoria' => $r['cat'], 'se_repite' => $r['repeat_rule'],
                    'subtareas' => $ck ? count(array_filter($ck, fn($x) => !empty($x['d']))) . '/' . count($ck) : null], fn($v) => $v !== null);
            }, $q->fetchAll());
            return ['total_encontradas' => $total, 'mostradas' => count($items), 'tareas' => $items];
        };
    }

    if ($can(['gastos', 'estadisticas'])) {
        $defs[] = $fn('resumen_gastos', 'Totales de gastos e ingresos en un periodo, opcionalmente agrupados por categoría, mes o día. Úsala para "cuánto he gastado…", "gasto por categorías", "balance del mes". Sin fechas usa el mes actual.',
            ['desde' => $dateP, 'hasta' => $dateP, 'tipo' => ['type' => 'string', 'enum' => ['gasto', 'ingreso', 'todos']], 'agrupar_por' => ['type' => 'string', 'enum' => ['categoria', 'mes', 'dia', 'ninguno']], 'categoria' => $S]);
        $impl['resumen_gastos'] = function ($a) use ($pdo, $uid, $tz) {
            $now = new DateTime('now', $tz);
            $desde = ctDate($a['desde'] ?? '') ?: $now->format('Y-m-01'); $hasta = ctDate($a['hasta'] ?? '') ?: $now->format('Y-m-t');
            $w = ['m.user_id = ?', '(m.group_id IS NULL OR m.paid_by = ?)', 'm.date >= ?', 'm.date <= ?']; $p = [$uid, $uid, $desde, $hasta];
            $tipo = $a['tipo'] ?? 'todos'; if ($tipo === 'gasto' || $tipo === 'ingreso') { $w[] = 'm.type = ?'; $p[] = $tipo; }
            if (!empty($a['categoria'])) { $w[] = 'fc.name LIKE ?'; $p[] = ctLike($a['categoria']); }
            $from = ' FROM movements m LEFT JOIN finance_categories fc ON fc.id = m.category_id WHERE ' . implode(' AND ', $w);
            $t = $pdo->prepare("SELECT m.type, SUM(m.amount) AS s, COUNT(*) AS n" . $from . ' GROUP BY m.type'); $t->execute($p);
            $tot = ['gasto' => 0.0, 'ingreso' => 0.0, 'n' => 0];
            foreach ($t->fetchAll() as $r) { $tot[$r['type']] = round((float)$r['s'], 2); $tot['n'] += (int)$r['n']; }
            $out = ['desde' => $desde, 'hasta' => $hasta, 'total_gastos' => $tot['gasto'], 'total_ingresos' => $tot['ingreso'], 'balance' => round($tot['ingreso'] - $tot['gasto'], 2), 'movimientos' => $tot['n']];
            $by = $a['agrupar_por'] ?? 'ninguno';
            if (in_array($by, ['categoria', 'mes', 'dia'], true)) {
                $key = ['categoria' => "COALESCE(fc.name, 'Sin categoría')", 'mes' => "DATE_FORMAT(m.date, '%Y-%m')", 'dia' => 'm.date'][$by];
                $g = $pdo->prepare("SELECT $key AS k, m.type, SUM(m.amount) AS s, COUNT(*) AS n" . $from . " GROUP BY k, m.type ORDER BY " . ($by === 'categoria' ? 's DESC' : 'k ASC') . ' LIMIT 40');
                $g->execute($p);
                $out['grupos'] = array_map(fn($r) => ['clave' => $r['k'], 'tipo' => $r['type'], 'total' => round((float)$r['s'], 2), 'movimientos' => (int)$r['n']], $g->fetchAll());
            }
            return $out;
        };
        $defs[] = $fn('listar_movimientos', 'Lista movimientos concretos (gastos o ingresos) más recientes con filtros.',
            ['desde' => $dateP, 'hasta' => $dateP, 'tipo' => ['type' => 'string', 'enum' => ['gasto', 'ingreso', 'todos']], 'categoria' => $S, 'texto' => $S, 'limite' => $I]);
        $impl['listar_movimientos'] = function ($a) use ($pdo, $uid) {
            $w = ['m.user_id = ?', '(m.group_id IS NULL OR m.paid_by = ?)']; $p = [$uid, $uid];
            if ($d = ctDate($a['desde'] ?? '')) { $w[] = 'm.date >= ?'; $p[] = $d; }
            if ($d = ctDate($a['hasta'] ?? '')) { $w[] = 'm.date <= ?'; $p[] = $d; }
            $tipo = $a['tipo'] ?? 'todos'; if ($tipo === 'gasto' || $tipo === 'ingreso') { $w[] = 'm.type = ?'; $p[] = $tipo; }
            if (!empty($a['categoria'])) { $w[] = 'fc.name LIKE ?'; $p[] = ctLike($a['categoria']); }
            if (!empty($a['texto'])) { $w[] = 'm.description LIKE ?'; $p[] = ctLike($a['texto']); }
            $q = $pdo->prepare('SELECT m.date, m.type, m.amount, m.description, fc.name AS cat FROM movements m LEFT JOIN finance_categories fc ON fc.id = m.category_id WHERE ' . implode(' AND ', $w) . ' ORDER BY m.date DESC, m.id DESC LIMIT ' . ctLimit($a['limite'] ?? 0));
            $q->execute($p);
            return ['movimientos' => array_map(fn($r) => ['fecha' => $r['date'], 'tipo' => $r['type'], 'importe' => round((float)$r['amount'], 2), 'descripcion' => $r['description'], 'categoria' => $r['cat'] ?? 'Sin categoría'], $q->fetchAll())];
        };
        $defs[] = $fn('consultar_presupuestos', 'Presupuestos mensuales del usuario y cuánto lleva gastado este mes en cada uno.', []);
        $impl['consultar_presupuestos'] = function ($a) use ($pdo, $uid, $tz) {
            $first = (new DateTime('now', $tz))->format('Y-m-01');
            $q = $pdo->prepare('SELECT b.category_id, b.amount, fc.name FROM budgets b LEFT JOIN finance_categories fc ON fc.id = b.category_id WHERE b.user_id = ?'); $q->execute([$uid]);
            $s = $pdo->prepare("SELECT category_id, SUM(amount) AS s FROM movements WHERE user_id = ? AND type = 'gasto' AND date >= ? AND (group_id IS NULL OR paid_by = ?) GROUP BY category_id"); $s->execute([$uid, $first, $uid]);
            $by = []; $sum = 0.0; foreach ($s->fetchAll() as $r) { $by[(int)$r['category_id']] = (float)$r['s']; $sum += (float)$r['s']; }
            $out = array_map(function ($r) use ($by, $sum) {
                $spent = (int)$r['category_id'] === 0 ? $sum : ($by[(int)$r['category_id']] ?? 0);
                return ['presupuesto' => (int)$r['category_id'] === 0 ? 'TOTAL del mes' : ($r['name'] ?? 'Categoría'), 'limite' => (float)$r['amount'], 'gastado' => round($spent, 2), 'porcentaje' => $r['amount'] > 0 ? round($spent / $r['amount'] * 100) : null];
            }, $q->fetchAll());
            return $out ? ['presupuestos' => $out] : ['presupuestos' => [], 'nota' => 'El usuario aún no ha definido presupuestos.'];
        };
    }

    if ($can(['notas'])) {
        $defs[] = $fn('buscar_notas', 'Busca en las notas propias del usuario por texto y devuelve título y un fragmento.', ['texto' => $S, 'limite' => $I], ['texto']);
        $impl['buscar_notas'] = function ($a) use ($pdo, $uid) {
            $t = trim((string)($a['texto'] ?? '')); if ($t === '') return ['error' => 'Falta el texto a buscar.'];
            $q = $pdo->prepare('SELECT title, content, updated_at FROM notes WHERE user_id = ? AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC LIMIT ' . ctLimit($a['limite'] ?? 0, 5, 8));
            $q->execute([$uid, ctLike($t), ctLike($t)]);
            return ['notas' => array_map(function ($r) use ($t) {
                $c = trim(preg_replace('/\s+/', ' ', strip_tags((string)$r['content']))); $pos = mb_stripos($c, $t);
                $frag = mb_substr($c, max(0, ($pos === false ? 0 : $pos) - 70), 240);
                return ['titulo' => $r['title'], 'fragmento' => $frag, 'actualizada' => $r['updated_at']];
            }, $q->fetchAll())];
        };
    }

    if ($can(['compra'])) {
        $defs[] = $fn('ver_lista_compra', 'Productos pendientes de la lista de la compra (personal y de los grupos del usuario).', []);
        $impl['ver_lista_compra'] = function ($a) use ($pdo, $uid) {
            $gids = [];
            try { $g = $pdo->prepare('SELECT group_id FROM group_members WHERE user_id = ?'); $g->execute([$uid]); $gids = array_map('intval', $g->fetchAll(PDO::FETCH_COLUMN)); } catch (Exception $e) {}
            $q = $pdo->prepare('SELECT name, qty, group_id FROM shopping_items WHERE archived = 0 AND done = 0 AND ((group_id IS NULL AND user_id = ?)' . ($gids ? ' OR group_id IN (' . implode(',', $gids) . ')' : '') . ') ORDER BY id DESC LIMIT 80');
            $q->execute([$uid]);
            $names = []; if ($gids) { $n = $pdo->query('SELECT id, name FROM `groups` WHERE id IN (' . implode(',', $gids) . ')')->fetchAll(); $names = array_column($n, 'name', 'id'); }
            $out = ['personal' => []]; 
            foreach ($q->fetchAll() as $r) {
                $item = $r['name'] . ($r['qty'] ? ' (' . $r['qty'] . ')' : '');
                if ($r['group_id'] === null) $out['personal'][] = $item; else $out['grupo: ' . ($names[$r['group_id']] ?? $r['group_id'])][] = $item;
            }
            return $out;
        };
    }

    $run = function ($name, $argsJson) use ($impl) {
        if (!isset($impl[$name])) return ['error' => 'Herramienta no disponible.'];
        $a = json_decode((string)$argsJson, true); if (!is_array($a)) $a = [];
        try { return $impl[$name]($a); } catch (Exception $e) { error_log('[chat_tools] ' . $name . ': ' . $e->getMessage()); return ['error' => 'No se pudo consultar ese dato.']; }
    };
    return [$defs, $run];
}
