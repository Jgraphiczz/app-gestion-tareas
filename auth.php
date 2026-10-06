<?php
require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

startSession();
$action = $_GET['action'] ?? '';
$b = json_decode(file_get_contents('php://input'), true) ?? [];

function safeUser($row) {
    return ['id' => (int)$row['id'], 'username' => $row['username'], 'role' => $row['role'], 'group_id' => $row['group_id'] ? (int)$row['group_id'] : null];
}

try {
    $pdo = db();

    if ($action === 'register' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $username = trim($b['username'] ?? '');
        $password = $b['password'] ?? '';
        if (strlen($username) < 3 || strlen($password) < 6) {
            http_response_code(400); echo json_encode(['error' => 'usuario mínimo 3 caracteres, contraseña mínimo 6']); exit;
        }
        $stmt = $pdo->prepare('SELECT id FROM users WHERE username = ?');
        $stmt->execute([$username]);
        if ($stmt->fetch()) { http_response_code(409); echo json_encode(['error' => 'ese usuario ya existe']); exit; }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
        $stmt->execute([$username, $hash, 'user']);
        $id = $pdo->lastInsertId();

        $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $user = safeUser($stmt->fetch());
        $_SESSION['user'] = $user;
        echo json_encode($user);
        exit;
    }

    if ($action === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $username = trim($b['username'] ?? '');
        $password = $b['password'] ?? '';
        $stmt = $pdo->prepare('SELECT * FROM users WHERE username = ?');
        $stmt->execute([$username]);
        $row = $stmt->fetch();
        if (!$row || !$row['active'] || !password_verify($password, $row['password_hash'])) {
            http_response_code(401); echo json_encode(['error' => 'usuario o contraseña incorrectos']); exit;
        }
        $user = safeUser($row);
        $_SESSION['user'] = $user;
        echo json_encode($user);
        exit;
    }

    if ($action === 'change_password' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $u = currentUser();
        if (!$u) { http_response_code(401); echo json_encode(['error' => 'no autenticado']); exit; }
        $current = $b['current_password'] ?? '';
        $newPass = $b['new_password'] ?? '';
        if (strlen($newPass) < 6) { http_response_code(400); echo json_encode(['error' => 'la nueva contraseña debe tener al menos 6 caracteres']); exit; }
        $stmt = $pdo->prepare('SELECT password_hash FROM users WHERE id = ?');
        $stmt->execute([$u['id']]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($current, $row['password_hash'])) {
            http_response_code(401); echo json_encode(['error' => 'la contraseña actual no es correcta']); exit;
        }
        $hash = password_hash($newPass, PASSWORD_DEFAULT);
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$hash, $u['id']]);
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($action === 'me') {
        $u = currentUser();
        if (!$u) { http_response_code(401); echo json_encode(['error' => 'no autenticado']); exit; }
        echo json_encode($u);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'acción no válida']);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}