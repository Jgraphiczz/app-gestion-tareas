<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

$me = requireAuth();
$pdo = db();
$action = $_GET['action'] ?? '';
$b = json_decode(file_get_contents('php://input'), true) ?? [];

try {
    if ($action === 'vapid_public_key') {
        echo json_encode(['key' => VAPID_PUBLIC_KEY]);
        exit;
    }

    if ($action === 'subscribe' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $endpoint = $b['endpoint'] ?? '';
        $p256dh = $b['keys']['p256dh'] ?? '';
        $auth = $b['keys']['auth'] ?? '';
        if (!$endpoint || !$p256dh || !$auth) { http_response_code(400); echo json_encode(['error' => 'suscripción incompleta']); exit; }
        $stmt = $pdo->prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_key) VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth_key = VALUES(auth_key)');
        $stmt->execute([$me['id'], $endpoint, $p256dh, $auth]);
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($action === 'unsubscribe' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $endpoint = $b['endpoint'] ?? '';
        $pdo->prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')->execute([$endpoint, $me['id']]);
        echo json_encode(['ok' => true]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'acción no válida']);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}