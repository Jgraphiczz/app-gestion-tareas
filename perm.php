<?php
/**
 * Módulos, roles y permisos.
 *
 * Cada módulo tiene, para cada rol, uno de tres estados:
 *   allow  → se ve y se puede usar
 *   locked → se ve (con candado) pero al abrirlo sale el mensaje de permisos
 *   hidden → no aparece
 * El administrador (users.role = 'admin') lo tiene todo permitido. Los demás usuarios usan el rol que
 * tengan asignado (users.role_id) o, si no tienen, el rol marcado como "por defecto".
 *
 * Las tablas se crean solas la primera vez (como ensureSchema de api.php). Si el usuario de la base de
 * datos no tiene permiso para crearlas, todo sigue funcionando con los valores por defecto y el panel de
 * administración lo avisa; en ese caso se puede ejecutar schema.sql a mano.
 */
require_once __DIR__ . '/config.php';

const APP_MODULES = [
    'tareas'       => 'Tareas',
    'calendario'   => 'Calendario',
    'chat'         => 'Chat',
    'notas'        => 'Notas',
    'diagramas'    => 'Diagramas',
    'gastos'       => 'Gastos',
    'estadisticas' => 'Estadísticas',
    'tiempo'       => 'Tiempo',
    'grupo'        => 'Grupos',
    'asistente'    => 'Asistente ✨ (apuntar con IA)',
];
const PERM_STATES = ['allow', 'locked', 'hidden'];
const PERM_DEFAULT_MESSAGE = 'Tu rol no tiene acceso a este módulo. Si lo necesitas, pídeselo a un administrador.';

function pout($data, $code = 200) { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }

/** Estado por defecto de cada módulo cuando un rol no lo define: todo permitido salvo el chat (solo administradores). */
function permDefaultModules() {
    $m = [];
    foreach (array_keys(APP_MODULES) as $k) $m[$k] = $k === 'chat' ? 'hidden' : 'allow';
    return $m;
}
function permNormalizeModules($raw) {
    $raw = is_string($raw) ? (json_decode($raw, true) ?: []) : (is_array($raw) ? $raw : []);
    $out = permDefaultModules();
    foreach (APP_MODULES as $k => $_) if (isset($raw[$k]) && in_array($raw[$k], PERM_STATES, true)) $out[$k] = $raw[$k];
    return $out;
}
function permAllAllowed() { return array_fill_keys(array_keys(APP_MODULES), 'allow'); }

/* ---------- esquema ---------- */
/** Crea las tablas si faltan. Devuelve true si todo está listo. Se intenta una vez por sesión. */
function permEnsureSchema($pdo) {
    if (!empty($_SESSION['perm_schema_ok'])) return true;
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS roles (
            id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(60) NOT NULL, description VARCHAR(200) NOT NULL DEFAULT '',
            modules TEXT NULL, is_default TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_role_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $pdo->exec("CREATE TABLE IF NOT EXISTS app_settings (
            k VARCHAR(60) NOT NULL PRIMARY KEY, v MEDIUMTEXT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        if (!$pdo->query("SHOW COLUMNS FROM users LIKE 'role_id'")->fetch()) $pdo->exec('ALTER TABLE users ADD COLUMN role_id INT NULL');
        if ((int)$pdo->query('SELECT COUNT(*) FROM roles')->fetchColumn() === 0) {
            $pdo->prepare('INSERT INTO roles (name, description, modules, is_default) VALUES (?, ?, ?, 1)')
                ->execute(['Usuario', 'Rol por defecto: todos los módulos salvo el chat.', json_encode(permDefaultModules())]);
        }
        $_SESSION['perm_schema_ok'] = 1;
        unset($_SESSION['perm_schema_err']);
        return true;
    } catch (Exception $e) {
        $_SESSION['perm_schema_err'] = $e->getMessage();
        return false;
    }
}

/* ---------- consulta de permisos ---------- */
function permSettings($pdo) {
    try {
        $v = $pdo->query("SELECT v FROM app_settings WHERE k = 'messages'")->fetchColumn();
        $m = $v ? (json_decode($v, true) ?: []) : [];
    } catch (Exception $e) { $m = []; }
    $out = ['_default' => PERM_DEFAULT_MESSAGE];
    foreach ($m as $k => $t) if (($k === '_default' || isset(APP_MODULES[$k])) && is_string($t) && trim($t) !== '') $out[$k] = trim($t);
    return $out;
}

/** Permisos efectivos del usuario, siempre leídos de la base de datos (un cambio de rol se nota al momento). */
function permResolve($pdo, $userId) {
    permEnsureSchema($pdo);
    $role = 'user'; $roleId = null; $roleName = null; $modules = null;
    try {
        $s = $pdo->prepare('SELECT role, role_id FROM users WHERE id = ?');
        $s->execute([$userId]);
    } catch (Exception $e) {                       // aún sin columna role_id
        $s = $pdo->prepare('SELECT role FROM users WHERE id = ?');
        $s->execute([$userId]);
    }
    $row = $s->fetch();
    if ($row) { $role = $row['role']; $roleId = isset($row['role_id']) && $row['role_id'] !== null ? (int)$row['role_id'] : null; }

    if ($role === 'admin') {
        $modules = permAllAllowed(); $roleName = 'Administrador';
    } else {
        try {
            $r = null;
            if ($roleId) { $q = $pdo->prepare('SELECT * FROM roles WHERE id = ?'); $q->execute([$roleId]); $r = $q->fetch(); }
            if (!$r) $r = $pdo->query('SELECT * FROM roles WHERE is_default = 1 ORDER BY id LIMIT 1')->fetch();
            if ($r) { $modules = permNormalizeModules($r['modules']); $roleName = $r['name']; $roleId = (int)$r['id']; }
        } catch (Exception $e) { /* sin tablas: valores por defecto */ }
        if ($modules === null) { $modules = permDefaultModules(); $roleName = 'Usuario'; }
    }
    return ['role' => $role, 'role_id' => $roleId, 'role_name' => $roleName, 'modules' => $modules, 'messages' => permSettings($pdo)];
}

/** Datos que se añaden al usuario en login / registro / me para que el navegador pinte los módulos. */
function permPublic($pdo, $userId) {
    $p = permResolve($pdo, $userId);
    $p['schema_ok'] = !empty($_SESSION['perm_schema_ok']);
    return $p;
}

function permMessage($pdo, $module) {
    $m = permSettings($pdo);
    return $m[$module] ?? $m['_default'];
}

/** Corta con 403 si el usuario no puede usar ninguno de los módulos indicados. */
function permRequire($pdo, $userId, array $anyOf) {
    $p = permResolve($pdo, $userId);
    if ($p['role'] === 'admin') return $p;
    foreach ($anyOf as $mod) if (($p['modules'][$mod] ?? 'allow') === 'allow') return $p;
    $mod = $anyOf[0];
    pout(['error' => $p['messages'][$mod] ?? $p['messages']['_default'], 'code' => 'module_' . ($p['modules'][$mod] ?? 'hidden'), 'module' => $mod], 403);
}

/** Recurso de api.php → módulos que lo pueden usar (basta con que uno esté permitido). */
function permResourceModules($resource) {
    static $map = [
        'tasks' => ['tareas', 'calendario'], 'categories' => ['tareas', 'calendario'], 'tags' => ['tareas', 'calendario'],
        'movements' => ['gastos', 'estadisticas'], 'finance_categories' => ['gastos', 'estadisticas'],
        'loans' => ['gastos', 'estadisticas'], 'recurring_items' => ['gastos', 'estadisticas'],
        'notes' => ['notas'], 'note_image' => ['notas'], 'diagrams' => ['diagramas'],
        'weather_location' => ['tiempo'], 'weather_locations' => ['tiempo'],
        'my_groups' => ['grupo', 'gastos'], 'group_invites' => ['grupo'], 'group_members' => ['grupo'],
        'shares' => ['notas', 'diagramas'],
    ];
    return $map[$resource] ?? null;
}

/** Quita de la respuesta de ?resource=all los datos de los módulos que el usuario no puede usar. */
function permFilterAll($payload, $p) {
    if ($p['role'] === 'admin') return $payload;
    $ok = function (array $mods) use ($p) { foreach ($mods as $m) if (($p['modules'][$m] ?? 'allow') === 'allow') return true; return false; };
    $blank = function (array $keys) use (&$payload) { foreach ($keys as $k) if (array_key_exists($k, $payload)) $payload[$k] = is_array($payload[$k]) && array_values($payload[$k]) === $payload[$k] ? [] : null; };
    if (!$ok(['tareas', 'calendario'])) $blank(['categories', 'tags', 'tasks']);
    if (!$ok(['gastos', 'estadisticas'])) $blank(['finance_categories', 'movements', 'loans', 'recurring_items']);
    if (!$ok(['notas'])) $blank(['notes']);
    if (!$ok(['tiempo'])) { $blank(['weather_locations']); $payload['weather_location'] = null; }
    if (!$ok(['grupo', 'gastos'])) { $payload['group'] = null; $blank(['group_members', 'my_groups']); }
    if (!$ok(['grupo'])) $payload['groups_data'] = ['groups' => [], 'invites' => []];
    return $payload;
}

/* ---------- administración: roles y mensajes ---------- */
function permSanitizeName($s, $max) { return trim(mb_substr(preg_replace('/\s+/', ' ', (string)$s), 0, $max)); }

function permRoleRow($pdo, $r) {
    $count = $r['is_default']
        ? $pdo->query("SELECT COUNT(*) FROM users WHERE role <> 'admin' AND (role_id IS NULL OR role_id = " . (int)$r['id'] . ')')->fetchColumn()
        : $pdo->query('SELECT COUNT(*) FROM users WHERE role_id = ' . (int)$r['id'] . " AND role <> 'admin'")->fetchColumn();
    return ['id' => (int)$r['id'], 'name' => $r['name'], 'description' => $r['description'], 'is_default' => (bool)$r['is_default'],
            'modules' => permNormalizeModules($r['modules']), 'users' => (int)$count];
}

/**
 * Rutas de administración: ?resource=roles (GET, POST, PATCH, DELETE) y ?resource=app_settings (PATCH).
 * Devuelve normalmente sin hacer nada si el recurso no es suyo.
 */
function permAdminRoute($pdo, $resource, $method, $id, $b) {
    if ($resource !== 'roles' && $resource !== 'app_settings') return;
    requireAdmin();
    if (!permEnsureSchema($pdo)) pout(['error' => 'No se pueden crear las tablas de roles. Ejecuta el archivo schema.sql en la base de datos.', 'schema_ok' => false, 'detail' => $_SESSION['perm_schema_err'] ?? ''], 500);

    if ($resource === 'app_settings') {
        if ($method !== 'PATCH') pout(['error' => 'petición no válida'], 400);
        $in = is_array($b['messages'] ?? null) ? $b['messages'] : [];
        $clean = [];
        foreach ($in as $k => $t) {
            if ($k !== '_default' && !isset(APP_MODULES[$k])) continue;
            $t = trim(mb_substr((string)$t, 0, 300));
            if ($t !== '') $clean[$k] = $t;
        }
        $pdo->prepare('INSERT INTO app_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)')->execute(['messages', json_encode($clean, JSON_UNESCAPED_UNICODE)]);
        pout(['ok' => true, 'messages' => permSettings($pdo)]);
    }

    /* roles */
    if ($method === 'GET') {
        $rows = $pdo->query('SELECT * FROM roles ORDER BY is_default DESC, name ASC')->fetchAll();
        pout(['roles' => array_map(fn($r) => permRoleRow($pdo, $r), $rows), 'modules' => APP_MODULES, 'messages' => permSettings($pdo),
              'default_message' => PERM_DEFAULT_MESSAGE, 'schema_ok' => true]);
    }
    if ($method === 'POST') {
        $name = permSanitizeName($b['name'] ?? '', 60);
        if (mb_strlen($name) < 2) pout(['error' => 'Ponle un nombre al rol (mínimo 2 letras).'], 400);
        $dup = $pdo->prepare('SELECT id FROM roles WHERE name = ?'); $dup->execute([$name]);
        if ($dup->fetch()) pout(['error' => 'Ya existe un rol con ese nombre.'], 409);
        $pdo->prepare('INSERT INTO roles (name, description, modules, is_default) VALUES (?, ?, ?, 0)')
            ->execute([$name, permSanitizeName($b['description'] ?? '', 200), json_encode(permNormalizeModules($b['modules'] ?? []))]);
        $r = $pdo->query('SELECT * FROM roles WHERE id = ' . (int)$pdo->lastInsertId())->fetch();
        pout(permRoleRow($pdo, $r), 201);
    }
    if (!$id) pout(['error' => 'petición no válida'], 400);
    $s = $pdo->prepare('SELECT * FROM roles WHERE id = ?'); $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) pout(['error' => 'El rol no existe.'], 404);

    if ($method === 'PATCH') {
        $fields = []; $vals = [];
        if (array_key_exists('name', $b)) {
            $name = permSanitizeName($b['name'], 60);
            if (mb_strlen($name) < 2) pout(['error' => 'Ponle un nombre al rol (mínimo 2 letras).'], 400);
            $dup = $pdo->prepare('SELECT id FROM roles WHERE name = ? AND id <> ?'); $dup->execute([$name, $id]);
            if ($dup->fetch()) pout(['error' => 'Ya existe un rol con ese nombre.'], 409);
            $fields[] = 'name = ?'; $vals[] = $name;
        }
        if (array_key_exists('description', $b)) { $fields[] = 'description = ?'; $vals[] = permSanitizeName($b['description'], 200); }
        if (array_key_exists('modules', $b)) { $fields[] = 'modules = ?'; $vals[] = json_encode(permNormalizeModules($b['modules'])); }
        if ($fields) { $vals[] = $id; $pdo->prepare('UPDATE roles SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($vals); }
        if (!empty($b['is_default']) && !$r['is_default']) {
            $pdo->exec('UPDATE roles SET is_default = 0');
            $pdo->prepare('UPDATE roles SET is_default = 1 WHERE id = ?')->execute([$id]);
        }
        $s->execute([$id]);
        pout(permRoleRow($pdo, $s->fetch()));
    }
    if ($method === 'DELETE') {
        if ($r['is_default']) pout(['error' => 'No se puede borrar el rol por defecto. Marca otro como predeterminado primero.'], 400);
        $pdo->prepare('UPDATE users SET role_id = NULL WHERE role_id = ?')->execute([$id]);   // pasan al rol por defecto
        $pdo->prepare('DELETE FROM roles WHERE id = ?')->execute([$id]);
        pout(['ok' => true]);
    }
    pout(['error' => 'petición no válida'], 400);
}
