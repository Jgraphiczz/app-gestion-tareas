<?php
/**
 * Chat: conversación sencilla con el modelo (Groq). Sin estado en el servidor: el navegador manda
 * los últimos mensajes y aquí solo se añade el contexto, se cuenta el uso y se devuelve la respuesta.
 * Comparte clave y límite diario con assistant.php (ver ai_common.php).
 */
require_once __DIR__ . '/ai_common.php';

[$me, $pdo, $model] = aiBoot();

$b = json_decode(file_get_contents('php://input'), true) ?? [];
$history = [];
foreach (array_slice((array)($b['messages'] ?? []), -12) as $m) {         // solo los 12 últimos: contexto corto = más barato y rápido
    $role = $m['role'] ?? '';
    $content = trim(mb_substr((string)($m['content'] ?? ''), 0, 4000));
    if (($role === 'user' || $role === 'assistant') && $content !== '') $history[] = ['role' => $role, 'content' => $content];
}
if (!$history || end($history)['role'] !== 'user') aout(['error' => 'Escribe algo primero.'], 400);

$remaining = aiCountUsage($pdo, $me['id']);
[, , $nowTxt] = aiNowText((string)($b['tz'] ?? ''));

$system = "Eres el asistente de chat de una app personal de tareas, gastos y notas. Responde siempre en español, de forma clara, cercana y breve "
    . "(lo justo para resolver la duda; listas cortas si ayudan). Puedes usar Markdown sencillo: **negrita**, listas y bloques de código.\n"
    . "Ahora es: $nowTxt.\n"
    . "No tienes acceso a las tareas, gastos ni notas del usuario en esta conversación y no puedes consultar internet: si te lo piden, "
    . "dilo con naturalidad. Si el usuario quiere apuntar una tarea o un gasto, sugiérele el botón ✨ de la cabecera, que lo hace en un paso. "
    . "Si no sabes algo, dilo; no inventes datos.";

$payload = [
    'model' => $model,
    'messages' => array_merge([['role' => 'system', 'content' => $system]], $history),
    'temperature' => 0.6,
    'max_completion_tokens' => 1500,
    'reasoning_effort' => 'low',
];
[$code, $res, $err] = groqCall($payload);
if ($code === 400) [$code, $res, $err] = groqCall($payload);
groqCheck($code, $res, $err);

$reply = trim((string)($res['choices'][0]['message']['content'] ?? ''));
if ($reply === '') aout(['error' => 'No he podido generar una respuesta. Prueba a reformular la pregunta.'], 502);
aout(['reply' => $reply, 'remaining' => $remaining]);
