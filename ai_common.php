<?php
/** Piezas comunes de assistant.php (crear tareas/gastos) y chat.php (conversación): clave de Groq,
 *  límite diario por usuario y llamada HTTP. Se incluye desde ellos; no se llama directamente. */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/perm.php';

function aout($data, $code = 200) { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }

/** Comprueba método, sesión, permiso del módulo y clave. Devuelve [$me, $pdo, $model]. */
function aiBoot(array $modules) {
    header('Content-Type: application/json; charset=utf-8');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') aout(['error' => 'método no permitido'], 405);
    $me = requireAuth();
    $pdo = db();
    permRequire($pdo, $me['id'], $modules);                 // 403 con el mensaje de permisos configurado
    if (!defined('GROQ_API_KEY') || !GROQ_API_KEY) aout(['error' => 'El asistente no está configurado todavía (falta GROQ_API_KEY en config.php).'], 503);
    $model = defined('GROQ_MODEL') && GROQ_MODEL ? GROQ_MODEL : 'openai/gpt-oss-20b';
    return [$me, $pdo, $model];
}

/** Cuenta este mensaje y corta si se pasa del límite diario (protege la cuota gratuita). Devuelve los que quedan (o null). */
function aiCountUsage($pdo, $userId) {
    $limit = defined('ASSISTANT_DAILY_LIMIT') ? (int)ASSISTANT_DAILY_LIMIT : 60;
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS assistant_usage (
            user_id INT NOT NULL, day DATE NOT NULL, n INT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $pdo->prepare('INSERT INTO assistant_usage (user_id, day, n) VALUES (?, CURDATE(), 1) ON DUPLICATE KEY UPDATE n = n + 1')->execute([$userId]);
        $s = $pdo->prepare('SELECT n FROM assistant_usage WHERE user_id = ? AND day = CURDATE()');
        $s->execute([$userId]);
        $used = (int)$s->fetchColumn();
    } catch (Exception $e) {                       // sin permiso para crear la tabla: contador en la sesión
        $k = 'assist_' . date('Ymd');
        $_SESSION[$k] = ($_SESSION[$k] ?? 0) + 1;
        $used = $_SESSION[$k];
    }
    if ($limit > 0 && $used > $limit) aout(['error' => "Has llegado al límite de hoy ($limit mensajes). Mañana podrás seguir."], 429);
    return $limit > 0 ? max(0, $limit - $used) : null;
}

function groqCall($payload) {
    $ch = curl_init(defined('GROQ_ENDPOINT') ? GROQ_ENDPOINT : 'https://api.groq.com/openai/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 40,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . GROQ_API_KEY],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return [$code, $raw === false ? null : json_decode($raw, true), $err];
}

/** Errores comunes de Groq convertidos en mensajes claros. Si todo va bien, no hace nada. */
function groqCheck($code, $res, $err) {
    if ($code === 429) aout(['error' => 'El servicio gratuito está saturado. Prueba de nuevo en un minuto.'], 503);
    if ($code === 401 || $code === 403) { error_log('[assistant] Groq rechazó la clave (HTTP ' . $code . ')'); aout(['error' => 'La clave del asistente no es válida.'], 502); }
    if ($code !== 200 || !is_array($res)) {
        error_log('[assistant] Groq HTTP ' . $code . ' ' . $err . ' ' . json_encode($res));
        aout(['error' => 'El asistente no ha podido responder. Inténtalo otra vez.'], 502);
    }
}

function aiNowText($tzName) {
    $tz = new DateTimeZone(in_array($tzName, DateTimeZone::listIdentifiers(), true) ? $tzName : 'Europe/Madrid');
    $now = new DateTime('now', $tz);
    $dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return [$tz, $now, $dias[(int)$now->format('w')] . ' ' . $now->format('Y-m-d H:i') . ' (' . $tz->getName() . ')'];
}
