<?php
/**
 * Calendario personal en formato iCalendar (.ics). Cada usuario tiene su propio enlace secreto
 * (se crea en Perfil → Sincronizar calendario) y lo añade a Google Calendar, Apple Calendar o Outlook
 * como "calendario por URL / suscripción". Solo lectura: la app envía las tareas con fecha al calendario.
 * El enlace identifica al usuario por su token (no hay sesión), así que no se debe compartir.
 */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/features.php';

function icsEsc($s) { return str_replace(["\\", ";", ",", "\r\n", "\n", "\r"], ["\\\\", "\;", "\\,", "\\n", "\\n", "\\n"], (string)$s); }
function icsFold($line) {                                    // líneas de máximo 75 bytes, sin partir caracteres UTF-8
    $out = ''; $cur = ''; $len = 0;
    foreach (preg_split('//u', $line, -1, PREG_SPLIT_NO_EMPTY) as $ch) {
        $b = strlen($ch);
        if ($len + $b > 74) { $out .= $cur . "\r\n "; $cur = ''; $len = 1; }
        $cur .= $ch; $len += $b;
    }
    return $out . $cur;
}
function icsDt($utc) { return gmdate('Ymd\THis\Z', strtotime($utc . ' UTC')); }
function notFound() { http_response_code(404); header('Content-Type: text/plain; charset=utf-8'); echo "Enlace de calendario no válido o desactivado.\n"; exit; }

$token = strtolower(preg_replace('/[^A-Fa-f0-9]/', '', (string)($_GET['t'] ?? '')));
if (strlen($token) !== 40) notFound();

$pdo = db();
try {
    $s = $pdo->prepare('SELECT p.user_id, u.username, u.active FROM user_prefs p JOIN users u ON u.id = p.user_id WHERE p.calendar_token = ?');
    $s->execute([$token]);
    $u = $s->fetch();
} catch (Exception $e) { $u = false; }
if (!$u || !(int)$u['active']) notFound();
$uid = (int)$u['user_id'];

$perm = permResolve($pdo, $uid);                              // si su rol no puede usar tareas/calendario, el feed va vacío
$allowed = $perm['role'] === 'admin' || ($perm['modules']['tareas'] ?? 'allow') === 'allow' || ($perm['modules']['calendario'] ?? 'allow') === 'allow';

$tasks = [];
if ($allowed) {
    $q = $pdo->prepare("SELECT t.*, c.name AS category_name FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.user_id = ? AND t.due_at IS NOT NULL AND (t.done = 0 OR t.due_at >= (UTC_TIMESTAMP() - INTERVAL 14 DAY)) ORDER BY t.due_at ASC LIMIT 1500");
    $q->execute([$uid]);
    $tasks = $q->fetchAll();
}

$hostFull = preg_replace('/[^a-z0-9.\-:]/i', '', $_SERVER['HTTP_HOST'] ?? 'localhost');
$host = explode(':', $hostFull)[0];                          // para los UID: sin puerto
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
$appUrl = ($https ? 'https://' : 'http://') . $hostFull . $dir . '/';
$RR = ['daily' => 'FREQ=DAILY', 'weekdays' => 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'weekly' => 'FREQ=WEEKLY', 'monthly' => 'FREQ=MONTHLY', 'yearly' => 'FREQ=YEARLY'];

$L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//App Gestion Personal//Tareas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' . icsEsc('Mis tareas · ' . $u['username']), 'X-WR-CALDESC:' . icsEsc('Tareas con fecha de App Gestión Personal'),
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
$stamp = gmdate('Ymd\THis\Z');
foreach ($tasks as $t) {
    $done = (bool)$t['done'];
    $start = strtotime($t['due_at'] . ' UTC');
    $prio = (int)($t['priority'] ?? 0);
    $check = json_decode($t['checklist'] ?? '[]', true) ?: [];
    $desc = [];
    if ($t['category_name']) $desc[] = 'Categoría: ' . $t['category_name'];
    if (!empty($t['description'])) $desc[] = $t['description'];
    foreach ($check as $c) $desc[] = ($c['d'] ? '☑ ' : '☐ ') . $c['t'];
    $desc[] = 'Abrir en la app: ' . $appUrl;
    $L[] = 'BEGIN:VEVENT';
    $L[] = 'UID:task-' . $t['id'] . '@' . $host;
    $L[] = 'DTSTAMP:' . $stamp;
    $L[] = 'DTSTART:' . gmdate('Ymd\THis\Z', $start);
    $L[] = 'DTEND:' . gmdate('Ymd\THis\Z', $start + 1800);
    $L[] = 'SUMMARY:' . icsEsc(($done ? '✓ ' : ($prio === 3 ? '❗ ' : '')) . $t['text']);
    $L[] = 'DESCRIPTION:' . icsEsc(implode("\n", $desc));
    if ($t['category_name']) $L[] = 'CATEGORIES:' . icsEsc($t['category_name']);
    if ($prio) $L[] = 'PRIORITY:' . [1 => 9, 2 => 5, 3 => 1][$prio];
    $L[] = 'STATUS:CONFIRMED';
    $L[] = 'TRANSP:TRANSPARENT';
    if (!$done && !empty($t['repeat_rule']) && isset($RR[$t['repeat_rule']])) $L[] = 'RRULE:' . $RR[$t['repeat_rule']];
    if (!$done) foreach ((json_decode($t['reminders'] ?? '[]', true) ?: []) as $m) {
        $m = (int)$m;
        $trig = $m === 0 ? 'PT0S' : ($m % 1440 === 0 ? 'P' . ($m / 1440) . 'D' : ($m % 60 === 0 ? 'PT' . ($m / 60) . 'H' : 'PT' . $m . 'M'));
        $L[] = 'BEGIN:VALARM'; $L[] = 'ACTION:DISPLAY'; $L[] = 'DESCRIPTION:' . icsEsc($t['text']); $L[] = 'TRIGGER:' . ($m === 0 ? '' : '-') . $trig; $L[] = 'END:VALARM';
    }
    $L[] = 'END:VEVENT';
}
$L[] = 'END:VCALENDAR';

header('Content-Type: text/calendar; charset=utf-8');
header('Content-Disposition: inline; filename="tareas.ics"');
header('Cache-Control: private, max-age=300');
header('X-Robots-Tag: noindex, nofollow');
echo implode("\r\n", array_map('icsFold', $L)) . "\r\n";
