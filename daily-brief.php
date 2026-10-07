<?php
/**
 * Resumen de la mañana: un aviso push al día con las tareas de hoy, el tiempo, lo gastado y la compra pendiente.
 * Se ejecuta por cron (igual que send-reminders.php), por ejemplo cada 5 minutos:
 *     php /ruta/a/la/app/daily-brief.php
 * Cada usuario elige su hora y su zona horaria en Perfil → Resumen de la mañana; aquí solo se envía a quien toca.
 *
 * Opciones (para probar):  --dry-run  no envía, solo muestra lo que enviaría
 *                          --force    ignora la hora y el "ya enviado hoy"
 *                          --user=ID  solo ese usuario
 */
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("Este script solo se ejecuta desde la línea de comandos (cron).\n"); }
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/features.php';

$opts = array_slice($argv, 1);
$dry = in_array('--dry-run', $opts, true); $force = in_array('--force', $opts, true);
$only = null; foreach ($opts as $o) if (strpos($o, '--user=') === 0) $only = (int)substr($o, 7);

$pdo = db();
if (!featEnsureSchema($pdo)) { fwrite(STDERR, "No se pudieron preparar las tablas.\n"); exit(1); }

$webPush = null;
if (!$dry) {
    require_once __DIR__ . '/vendor/autoload.php';
    $webPush = new Minishlink\WebPush\WebPush(['VAPID' => ['subject' => VAPID_SUBJECT, 'publicKey' => VAPID_PUBLIC_KEY, 'privateKey' => VAPID_PRIVATE_KEY]]);
}

$rows = $pdo->query('SELECT p.*, u.username, u.id AS uid, u.active FROM user_prefs p JOIN users u ON u.id = p.user_id WHERE p.brief_enabled = 1 AND u.active = 1')->fetchAll();
$sent = 0;
foreach ($rows as $r) {
    $uid = (int)$r['uid'];
    if ($only && $only !== $uid) continue;
    $tz = new DateTimeZone(featValidTz($r['tz']));
    $now = new DateTime('now', $tz);
    $due = DateTime::createFromFormat('Y-m-d H:i', $now->format('Y-m-d') . ' ' . $r['brief_time'], $tz);
    $limit = (clone $due)->modify('+4 hours');                       // si el cron estuvo parado, no se manda a deshoras
    $alreadyToday = $r['last_brief'] === $now->format('Y-m-d');
    if (!$force && ($now < $due || $now > $limit || $alreadyToday)) continue;

    [$title, $body] = featBuildBrief($pdo, ['id' => $uid, 'username' => $r['username']], $r['tz']);
    if ($dry) { echo "[$uid {$r['username']}] $title\n$body\n---\n"; $sent++; continue; }

    $subs = $pdo->prepare('SELECT * FROM push_subscriptions WHERE user_id = ?'); $subs->execute([$uid]);
    $list = $subs->fetchAll();
    foreach ($list as $sub) {
        $webPush->queueNotification(Minishlink\WebPush\Subscription::create(['endpoint' => $sub['endpoint'], 'publicKey' => $sub['p256dh'], 'authToken' => $sub['auth_key']]),
            json_encode(['title' => $title, 'body' => $body, 'url' => './']));
    }
    if ($list) { $pdo->prepare('UPDATE user_prefs SET last_brief = ? WHERE user_id = ?')->execute([$now->format('Y-m-d'), $uid]); $sent++; }
}
if ($webPush) {
    foreach ($webPush->flush() as $report) {
        if (!$report->isSuccess() && ($report->isSubscriptionExpired() || $report->getResponse()?->getStatusCode() == 410)) {
            $pdo->prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')->execute([$report->getRequest()->getUri()->__toString()]);
        }
    }
}
echo 'OK ' . date('Y-m-d H:i:s') . " — resúmenes: $sent\n";
