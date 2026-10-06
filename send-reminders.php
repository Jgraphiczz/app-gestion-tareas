<?php
/**
 * Envía los avisos push cuyo momento ha llegado.
 * Este script NO se abre desde el navegador: se ejecuta automáticamente
 * cada minuto mediante una tarea cron en aaPanel. Ver instrucciones.
 *
 * Requiere: composer require minishlink/web-push   (ejecutado en esta carpeta)
 */

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/config.php';

use Minishlink\WebPush\WebPush;
use Minishlink\WebPush\Subscription;

$pdo = db();

$auth = [
    'VAPID' => [
        'subject' => VAPID_SUBJECT,
        'publicKey' => VAPID_PUBLIC_KEY,
        'privateKey' => VAPID_PRIVATE_KEY,
    ],
];
$webPush = new WebPush($auth);

$now = time();
$tasks = $pdo->query("
    SELECT t.*, c.name AS category_name
    FROM tasks t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.done = 0 AND t.due_at IS NOT NULL AND t.reminders IS NOT NULL AND t.reminders != '[]'
")->fetchAll();

foreach ($tasks as $task) {
    $due = strtotime($task['due_at'] . ' UTC');
    $reminders = json_decode($task['reminders'], true) ?: [];
    $notified = json_decode($task['notified'], true) ?: [];
    $changed = false;

    foreach ($reminders as $mins) {
        if (in_array($mins, $notified)) continue;
        $triggerAt = $due - ($mins * 60);
        if ($now >= $triggerAt) {
            $label = $mins >= 1440 ? round($mins / 1440) . ' día(s)' : ($mins >= 60 ? round($mins / 60) . ' hora(s)' : $mins . ' min');
            $dueDate = new DateTime($task['due_at'], new DateTimeZone('UTC'));
            $dueDate->setTimezone(new DateTimeZone(date_default_timezone_get() ?: 'Europe/Madrid'));
            $horaTexto = $dueDate->format('H:i');
            $bodyParts = [];
            if ($task['category_name']) $bodyParts[] = $task['category_name'];
            $bodyParts[] = 'vence a las ' . $horaTexto . ' (en ' . $label . ')';
            if (!empty($task['description'])) $bodyParts[] = mb_substr($task['description'], 0, 80);
            $payload = json_encode([
                'title' => '⏰ ' . $task['text'],
                'body' => implode(' · ', $bodyParts),
                'taskId' => $task['id'],
            ]);

            $subs = $pdo->prepare('SELECT * FROM push_subscriptions WHERE user_id = ?');
            $subs->execute([$task['user_id']]);
            foreach ($subs->fetchAll() as $sub) {
                $subscription = Subscription::create([
                    'endpoint' => $sub['endpoint'],
                    'publicKey' => $sub['p256dh'],
                    'authToken' => $sub['auth_key'],
                ]);
                $webPush->queueNotification($subscription, $payload);
            }
            $notified[] = $mins;
            $changed = true;
        }
    }

    if ($changed) {
        $pdo->prepare('UPDATE tasks SET notified = ? WHERE id = ?')->execute([json_encode($notified), $task['id']]);
    }
}

foreach ($webPush->flush() as $report) {
    if (!$report->isSuccess() && ($report->isSubscriptionExpired() || $report->getResponse()?->getStatusCode() == 410)) {
        // Suscripción caducada (navegador desinstalado, permiso revocado...): la borramos.
        $endpoint = $report->getRequest()->getUri()->__toString();
        $pdo->prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')->execute([$endpoint]);
    }
}

echo "OK " . date('Y-m-d H:i:s') . " — " . count($tasks) . " tareas revisadas\n";