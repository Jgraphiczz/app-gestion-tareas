<?php
/**
 * Asistente: convierte una frase ("apúntame 12€ de gasolina y recuérdame mañana a las 9 llamar al dentista")
 * en acciones propuestas (tareas / movimientos). NO guarda nada: el navegador enseña las tarjetas y,
 * al aceptar, crea cada cosa con los endpoints normales de api.php.
 *
 * Configuración en config.php (el fichero no está en git):
 *   define('GROQ_API_KEY', 'gsk_...');
 *   define('GROQ_MODEL', 'openai/gpt-oss-20b');        // opcional
 *   define('ASSISTANT_DAILY_LIMIT', 40);               // opcional: mensajes por usuario y día
 */
require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

function aout($data, $code = 200) { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') aout(['error' => 'método no permitido'], 405);
$me = requireAuth();
$pdo = db();

if (!defined('GROQ_API_KEY') || !GROQ_API_KEY) aout(['error' => 'El asistente no está configurado todavía (falta GROQ_API_KEY en config.php).'], 503);
$model = defined('GROQ_MODEL') && GROQ_MODEL ? GROQ_MODEL : 'openai/gpt-oss-20b';
$limit = defined('ASSISTANT_DAILY_LIMIT') ? (int)ASSISTANT_DAILY_LIMIT : 40;

$b = json_decode(file_get_contents('php://input'), true) ?? [];
$text = trim((string)($b['text'] ?? ''));
if ($text === '') aout(['error' => 'Escribe o di algo primero.'], 400);
$text = mb_substr($text, 0, 600);

/* ---------- límite diario por usuario (protege la cuota gratuita) ---------- */
$used = null;
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS assistant_usage (
        user_id INT NOT NULL, day DATE NOT NULL, n INT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->prepare('INSERT INTO assistant_usage (user_id, day, n) VALUES (?, CURDATE(), 1) ON DUPLICATE KEY UPDATE n = n + 1')->execute([$me['id']]);
    $s = $pdo->prepare('SELECT n FROM assistant_usage WHERE user_id = ? AND day = CURDATE()');
    $s->execute([$me['id']]);
    $used = (int)$s->fetchColumn();
} catch (Exception $e) {                       // sin permiso para crear la tabla: contador en la sesión
    $k = 'assist_' . date('Ymd');
    $_SESSION[$k] = ($_SESSION[$k] ?? 0) + 1;
    $used = $_SESSION[$k];
}
if ($limit > 0 && $used > $limit) aout(['error' => "Has llegado al límite de hoy ($limit mensajes). Mañana podrás seguir."], 429);

/* ---------- contexto: hora local y categorías del usuario ---------- */
$tzName = (string)($b['tz'] ?? '');
$tz = new DateTimeZone(in_array($tzName, DateTimeZone::listIdentifiers(), true) ? $tzName : 'Europe/Madrid');
$now = new DateTime('now', $tz);
$dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
$nowTxt = $dias[(int)$now->format('w')] . ' ' . $now->format('Y-m-d H:i') . ' (' . $tz->getName() . ')';

$cats = $pdo->prepare('SELECT id, name FROM categories WHERE user_id = ? ORDER BY created_at ASC');
$cats->execute([$me['id']]);
$taskCats = $cats->fetchAll();
$fcats = $pdo->prepare('SELECT id, name FROM finance_categories WHERE user_id = ? ORDER BY created_at ASC');
$fcats->execute([$me['id']]);
$finCats = $fcats->fetchAll();
$names = fn($rows) => $rows ? implode(', ', array_map(fn($r) => '"' . $r['name'] . '"', $rows)) : '(ninguna)';

$system = "Eres el asistente de una app personal de tareas y gastos. Conviertes lo que dice el usuario en llamadas a funciones; no inventes datos.\n"
    . "Ahora es: $nowTxt. Calcula 'hoy', 'mañana', 'el viernes', 'en 2 horas'… a partir de esa fecha.\n"
    . "Categorías de tareas del usuario: " . $names($taskCats) . ".\n"
    . "Categorías de gastos/ingresos del usuario: " . $names($finCats) . ".\n"
    . "Reglas:\n"
    . "- Para 'categoria' usa EXACTAMENTE un nombre de la lista correspondiente, o null si ninguno encaja.\n"
    . "- Una frase puede contener varias cosas: llama a la función una vez por cada una.\n"
    . "- 'recuérdame', 'avísame' o 'no se me olvide' con una hora: pon avisos_min [0] salvo que diga con cuánta antelación.\n"
    . "- Si dan fecha pero no hora para una tarea, usa 09:00. Si no dan fecha, fecha_hora = null.\n"
    . "- 'texto' de la tarea: corto, en infinitivo o sustantivo, sin la fecha ni la hora.\n"
    . "- Un gasto es dinero que sale; un ingreso (nómina, cobro, venta) es dinero que entra. Importe siempre positivo, con punto decimal.\n"
    . "- Si el mensaje no pide crear ninguna tarea ni movimiento, no llames a ninguna función y responde en una frase corta "
    . "explicando que puedes crear tareas, gastos e ingresos, con un ejemplo.";

$tools = [
    ['type' => 'function', 'function' => [
        'name' => 'crear_tarea',
        'description' => 'Crea una tarea o recordatorio.',
        'parameters' => ['type' => 'object', 'properties' => [
            'texto' => ['type' => 'string'],
            'descripcion' => ['type' => 'string'],
            'categoria' => ['type' => 'string'],
            'fecha_hora' => ['type' => 'string', 'description' => 'Hora local YYYY-MM-DD HH:MM. Omitir si no hay fecha.'],
            'avisos_min' => ['type' => 'array', 'items' => ['type' => 'integer', 'enum' => [0, 15, 60, 180, 1440]], 'description' => 'Minutos de antelación del aviso'],
        ], 'required' => ['texto']],
    ]],
    ['type' => 'function', 'function' => [
        'name' => 'crear_movimiento',
        'description' => 'Registra un gasto o un ingreso de dinero.',
        'parameters' => ['type' => 'object', 'properties' => [
            'tipo' => ['type' => 'string', 'enum' => ['gasto', 'ingreso']],
            'importe' => ['type' => 'number'],
            'descripcion' => ['type' => 'string'],
            'categoria' => ['type' => 'string'],
            'fecha' => ['type' => 'string', 'description' => 'YYYY-MM-DD, por defecto hoy'],
        ], 'required' => ['tipo', 'importe', 'descripcion']],
    ]],
];

/* ---------- llamada a Groq ---------- */
function groqCall($payload) {
    $ch = curl_init(defined('GROQ_ENDPOINT') ? GROQ_ENDPOINT : 'https://api.groq.com/openai/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 25,
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

$payload = [
    'model' => $model,
    'messages' => [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $text]],
    'tools' => $tools,
    'tool_choice' => 'auto',
    'temperature' => 0.1,
    'max_completion_tokens' => 900,
    'reasoning_effort' => 'low',
];
[$code, $res, $err] = groqCall($payload);
if ($code === 400) [$code, $res, $err] = groqCall($payload);          // gpt-oss a veces genera una llamada mal formada: un reintento
if ($code === 429) aout(['error' => 'El servicio gratuito está saturado. Prueba de nuevo en un minuto.'], 503);
if ($code === 401 || $code === 403) { error_log('[assistant] Groq rechazó la clave (HTTP ' . $code . ')'); aout(['error' => 'La clave del asistente no es válida.'], 502); }
if ($code !== 200 || !is_array($res)) {
    error_log('[assistant] Groq HTTP ' . $code . ' ' . $err . ' ' . json_encode($res));
    aout(['error' => 'El asistente no ha podido responder. Inténtalo otra vez.'], 502);
}

$msg = $res['choices'][0]['message'] ?? [];

/* ---------- validar lo que propone el modelo (nunca se fía tal cual) ---------- */
function findCat($rows, $name) {
    $n = mb_strtolower(trim((string)$name));
    if ($n === '') return null;
    foreach ($rows as $r) if (mb_strtolower($r['name']) === $n) return $r;
    foreach ($rows as $r) { $m = mb_strtolower($r['name']); if (mb_strpos($m, $n) !== false || mb_strpos($n, $m) !== false) return $r; }
    return null;
}
function parseLocal($s, $tz, $fmt) {
    $d = DateTime::createFromFormat($fmt, trim((string)$s), $tz);
    return ($d && $d->format($fmt) === trim((string)$s)) ? $d : null;
}

$actions = [];
foreach (array_slice($msg['tool_calls'] ?? [], 0, 6) as $call) {
    $name = $call['function']['name'] ?? '';
    $a = json_decode($call['function']['arguments'] ?? '', true);
    if (!is_array($a)) continue;

    if ($name === 'crear_tarea') {
        $t = trim(mb_substr((string)($a['texto'] ?? ''), 0, 200));
        if ($t === '') continue;
        $cat = findCat($taskCats, $a['categoria'] ?? null);
        $due = !empty($a['fecha_hora']) ? parseLocal($a['fecha_hora'], $tz, 'Y-m-d H:i') : null;
        $rem = [];
        if ($due) foreach ((array)($a['avisos_min'] ?? []) as $m) if (in_array($m, [0, 15, 60, 180, 1440], true) && !in_array($m, $rem, true)) $rem[] = $m;
        $actions[] = [
            'type' => 'task',
            'text' => $t,
            'description' => !empty($a['descripcion']) ? mb_substr((string)$a['descripcion'], 0, 500) : '',
            'category_id' => $cat ? (int)$cat['id'] : null,
            'category_name' => $cat ? $cat['name'] : null,
            'due_at' => $due ? (clone $due)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z') : null,
            'reminders' => $rem,
        ];
    } elseif ($name === 'crear_movimiento') {
        $type = $a['tipo'] ?? '';
        $amount = is_numeric($a['importe'] ?? null) ? round((float)$a['importe'], 2) : 0;
        if (!in_array($type, ['gasto', 'ingreso'], true) || $amount <= 0 || $amount > 100000000) continue;
        $cat = findCat($finCats, $a['categoria'] ?? null);
        $date = parseLocal($a['fecha'] ?? '', $tz, 'Y-m-d');
        $actions[] = [
            'type' => 'movement',
            'kind' => $type,
            'amount' => $amount,
            'description' => mb_substr(trim((string)($a['descripcion'] ?? '')), 0, 160),
            'category_id' => $cat ? (int)$cat['id'] : null,
            'category_name' => $cat ? $cat['name'] : null,
            'date' => ($date ?: $now)->format('Y-m-d'),
        ];
    }
}

$reply = trim((string)($msg['content'] ?? ''));
if (!$actions && $reply === '') $reply = 'No he entendido qué crear. Prueba con algo como: "gasto de 12 € en gasolina" o "recuérdame mañana a las 9 llamar al dentista".';
aout(['message' => $actions ? '' : $reply, 'actions' => $actions, 'remaining' => $limit > 0 ? max(0, $limit - $used) : null]);
