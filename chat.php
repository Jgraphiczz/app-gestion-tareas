<?php
/**
 * Chat con memoria: las conversaciones se guardan en la base de datos (por usuario) y cada usuario puede
 * escribir unas instrucciones personales que se añaden al contexto del modelo.
 *
 * POST con {"action": ...}:
 *   list                         → conversaciones del usuario
 *   get      {id}                → mensajes de una conversación
 *   send     {conversation_id?, text, tz}  → responde y guarda (crea la conversación si no se indica)
 *   rename   {id, title}
 *   delete   {id}
 *   settings_get / settings_save {about, style}
 * Solo pueden usarlo los roles con el módulo "chat" permitido (por defecto, solo administradores).
 */
require_once __DIR__ . '/ai_common.php';

[$me, $pdo, $model] = aiBoot(['chat']);
$uid = (int)$me['id'];

function chatEnsure($pdo) {
    if (!empty($_SESSION['chat_schema_ok'])) return;
    $pdo->exec("CREATE TABLE IF NOT EXISTS chat_conversations (
        id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, title VARCHAR(120) NOT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_chat_user (user_id, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS chat_messages (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, conversation_id INT NOT NULL, role VARCHAR(12) NOT NULL, content MEDIUMTEXT NOT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_chat_conv (conversation_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS chat_settings (
        user_id INT NOT NULL PRIMARY KEY, about TEXT NULL, style TEXT NULL,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $_SESSION['chat_schema_ok'] = 1;
}
try { chatEnsure($pdo); }
catch (Exception $e) { error_log('[chat] ' . $e->getMessage()); aout(['error' => 'El chat necesita crear sus tablas en la base de datos. Pide al administrador que ejecute schema.sql.'], 500); }

$b = json_decode(file_get_contents('php://input'), true) ?? [];
$action = (string)($b['action'] ?? 'send');

function ownConversation($pdo, $uid, $id) {
    $s = $pdo->prepare('SELECT * FROM chat_conversations WHERE id = ? AND user_id = ?');
    $s->execute([(int)$id, $uid]);
    $c = $s->fetch();
    if (!$c) aout(['error' => 'La conversación no existe.'], 404);
    return $c;
}
function convOut($c) { return ['id' => (int)$c['id'], 'title' => $c['title'], 'updated_at' => $c['updated_at']]; }
function getSettings($pdo, $uid) {
    $s = $pdo->prepare('SELECT about, style FROM chat_settings WHERE user_id = ?');
    $s->execute([$uid]);
    $r = $s->fetch();
    return ['about' => $r['about'] ?? '', 'style' => $r['style'] ?? ''];
}

if ($action === 'list') {
    $s = $pdo->prepare('SELECT id, title, updated_at FROM chat_conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100');
    $s->execute([$uid]);
    aout(['conversations' => array_map('convOut', $s->fetchAll())]);
}
if ($action === 'get') {
    $c = ownConversation($pdo, $uid, $b['id'] ?? 0);
    $s = $pdo->prepare('SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC');
    $s->execute([$c['id']]);
    aout(['conversation' => convOut($c), 'messages' => $s->fetchAll()]);
}
if ($action === 'rename') {
    $c = ownConversation($pdo, $uid, $b['id'] ?? 0);
    $title = trim(mb_substr(preg_replace('/\s+/', ' ', (string)($b['title'] ?? '')), 0, 120));
    if ($title === '') aout(['error' => 'Ponle un título a la conversación.'], 400);
    $pdo->prepare('UPDATE chat_conversations SET title = ? WHERE id = ?')->execute([$title, $c['id']]);
    aout(['ok' => true, 'title' => $title]);
}
if ($action === 'delete') {
    $c = ownConversation($pdo, $uid, $b['id'] ?? 0);
    $pdo->prepare('DELETE FROM chat_messages WHERE conversation_id = ?')->execute([$c['id']]);
    $pdo->prepare('DELETE FROM chat_conversations WHERE id = ?')->execute([$c['id']]);
    aout(['ok' => true]);
}
if ($action === 'settings_get') aout(getSettings($pdo, $uid));
if ($action === 'settings_save') {
    $about = trim(mb_substr((string)($b['about'] ?? ''), 0, 1500));
    $style = trim(mb_substr((string)($b['style'] ?? ''), 0, 1500));
    $pdo->prepare('INSERT INTO chat_settings (user_id, about, style) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE about = VALUES(about), style = VALUES(style)')->execute([$uid, $about, $style]);
    aout(['ok' => true, 'about' => $about, 'style' => $style]);
}
if ($action !== 'send') aout(['error' => 'acción no válida'], 400);

/* ---------- enviar un mensaje ---------- */
$text = trim(mb_substr((string)($b['text'] ?? ''), 0, 4000));
if ($text === '') aout(['error' => 'Escribe algo primero.'], 400);

$conv = !empty($b['conversation_id']) ? ownConversation($pdo, $uid, $b['conversation_id']) : null;
$history = [];
if ($conv) {                                                  // la memoria: los últimos 20 mensajes de esta conversación
    $s = $pdo->prepare('SELECT role, content FROM (SELECT id, role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 20) t ORDER BY id ASC');
    $s->execute([$conv['id']]);
    $history = $s->fetchAll();
}
$history[] = ['role' => 'user', 'content' => $text];

$remaining = aiCountUsage($pdo, $uid);
[, , $nowTxt] = aiNowText((string)($b['tz'] ?? ''));
$set = getSettings($pdo, $uid);

$system = "Eres el asistente de chat de una app personal de tareas, gastos y notas. Responde siempre en español, de forma clara, cercana y breve "
    . "(lo justo para resolver la duda; listas cortas si ayudan). Puedes usar Markdown sencillo: **negrita**, listas y bloques de código.\n"
    . "Ahora es: $nowTxt.\n"
    . "No tienes acceso a las tareas, gastos ni notas del usuario en esta conversación y no puedes consultar internet: si te lo piden, "
    . "dilo con naturalidad. Si el usuario quiere apuntar una tarea o un gasto, sugiérele el botón ✨ de la cabecera. "
    . "Si no sabes algo, dilo; no inventes datos.";
if ($set['about'] !== '') $system .= "\n\nLo que el usuario quiere que sepas de él:\n" . $set['about'];
if ($set['style'] !== '') $system .= "\n\nCómo quiere el usuario que respondas (respeta estas preferencias):\n" . $set['style'];

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

/* ---------- guardar (solo si todo ha ido bien: un fallo no deja mensajes a medias) ---------- */
if (!$conv) {
    $title = trim(mb_substr(preg_replace('/\s+/', ' ', $text), 0, 48));
    if (mb_strlen($text) > 48) $title = rtrim($title, " .,;:") . '…';
    $pdo->prepare('INSERT INTO chat_conversations (user_id, title) VALUES (?, ?)')->execute([$uid, $title]);
    $conv = ownConversation($pdo, $uid, $pdo->lastInsertId());
}
$ins = $pdo->prepare('INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, ?, ?)');
$ins->execute([$conv['id'], 'user', $text]);
$ins->execute([$conv['id'], 'assistant', $reply]);
$pdo->prepare('UPDATE chat_conversations SET updated_at = NOW() WHERE id = ?')->execute([$conv['id']]);
$conv = ownConversation($pdo, $uid, $conv['id']);

aout(['conversation' => convOut($conv), 'reply' => $reply, 'remaining' => $remaining]);
