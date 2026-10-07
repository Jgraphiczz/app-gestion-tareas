<?php
/**
 * Asistente: convierte una frase ("apúntame 12€ de gasolina y recuérdame mañana a las 9 llamar al dentista")
 * en acciones propuestas (tareas / movimientos). NO guarda nada: el navegador enseña las tarjetas y,
 * al aceptar, crea cada cosa con los endpoints normales de api.php.
 *
 * Configuración en config.php (el fichero no está en git):
 *   define('GROQ_API_KEY', 'gsk_...');
 *   define('GROQ_MODEL', 'openai/gpt-oss-20b');        // opcional
 *   define('ASSISTANT_DAILY_LIMIT', 60);               // opcional: mensajes de IA (asistente + chat) por usuario y día
 */
require_once __DIR__ . '/ai_common.php';

[$me, $pdo, $model] = aiBoot(['asistente']);

$b = json_decode(file_get_contents('php://input'), true) ?? [];
$text = trim((string)($b['text'] ?? ''));
if ($text === '') aout(['error' => 'Escribe o di algo primero.'], 400);
$text = mb_substr($text, 0, 600);

$remaining = aiCountUsage($pdo, $me['id']);

/* ---------- contexto: hora local y categorías del usuario ---------- */
[$tz, $now, $nowTxt] = aiNowText((string)($b['tz'] ?? ''));

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
groqCheck($code, $res, $err);

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
aout(['message' => $actions ? '' : $reply, 'actions' => $actions, 'remaining' => $remaining]);
