/* Pestaña Chat: conversación con el modelo (chat.php → Groq). El historial vive solo en este navegador
   (localStorage, por usuario) y se borra al cerrar sesión. Usa las globales de la app (me, showToast, loadNotesRich…). */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const coarse = matchMedia('(pointer:coarse)');
  const $ = id => document.getElementById(id);
  const key = () => 'chat_msgs_' + (typeof me !== 'undefined' && me ? me.id : 'x');
  const SUGGESTIONS = [
    ['Organizar mi semana', 'Dame un método sencillo para organizar mi semana de trabajo y no olvidar nada.'],
    ['Redactar un mensaje', 'Ayúdame a redactar un mensaje educado y breve para pedir un cambio de fecha en una reunión.'],
    ['Explícamelo fácil', 'Explícame con un ejemplo sencillo qué es el interés compuesto.'],
    ['Ideas de menú', 'Dame 5 ideas de cenas rápidas y saludables para esta semana.'],
  ];
  const ic = {
    send: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M5 15V6a2 2 0 0 1 2-2h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    fresh: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3zM14 7l3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  let msgs = [], loadedFor = null, busy = false, rec = null, remaining = null, mdMod = null;

  function load() { try { const v = JSON.parse(localStorage.getItem(key())); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function save() { try { localStorage.setItem(key(), JSON.stringify(msgs.slice(-40))); } catch (e) {} }

  async function toHtml(text) {
    try {
      mdMod = mdMod || await loadNotesRich();
      return mdMod.renderNoteHtml(text);
    } catch (e) {
      return '<p>' + escapeHtml(text).replace(/\n/g, '<br>') + '</p>';
    }
  }

  window.renderChat = function () {
    const root = $('chatMain'); if (!root) return;
    document.body.classList.remove('chat-typing');
    if (loadedFor !== me.id) { msgs = load(); loadedFor = me.id; }
    root.innerHTML = `
      <div class="chat">
        <div class="chat-top">
          <div class="chat-id"><span class="orb sm"></span><div><b>Asistente</b><small>Conversación sencilla · español</small></div></div>
          <button class="chat-ghost" id="chatNew" type="button" title="Nueva conversación" aria-label="Nueva conversación">${ic.fresh}<span>Nueva</span></button>
        </div>
        <div class="chat-scroll" id="chatScroll"><div class="chat-feed" id="chatFeed"></div></div>
        <div class="chat-composer">
          <div class="chat-box">
            <textarea id="chatInput" rows="1" maxlength="2000" placeholder="Escribe un mensaje…" aria-label="Mensaje"></textarea>
            ${SR ? `<button class="chat-round" id="chatMic" type="button" title="Dictar" aria-label="Dictar">${ic.mic}</button>` : ''}
            <button class="chat-send" id="chatSend" type="button" title="Enviar" aria-label="Enviar" disabled>${ic.send}</button>
          </div>
          <div class="chat-foot" id="chatFoot"></div>
        </div>
      </div>`;
    const input = $('chatInput');
    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 150) + 'px'; $('chatSend').disabled = busy || !input.value.trim(); };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !coarse.matches) { e.preventDefault(); submit(); }
    });
    // En móvil, mientras se escribe se oculta la barra inferior. Al tocar "Enviar" el campo pierde el foco:
    // se espera un instante antes de volver a mostrarla para que el diseño no se mueva a mitad del toque.
    let blurT = 0;
    input.addEventListener('focus', () => { clearTimeout(blurT); if (coarse.matches) document.body.classList.add('chat-typing'); });
    input.addEventListener('blur', () => { blurT = setTimeout(() => document.body.classList.remove('chat-typing'), 250); });
    ['chatSend', 'chatMic'].forEach(id => { const b = $(id); if (b) b.addEventListener('mousedown', e => e.preventDefault()); });   // no quitar el foco al campo
    $('chatSend').onclick = submit;
    $('chatNew').onclick = newChat;
    if (SR && $('chatMic')) $('chatMic').onclick = toggleMic;
    paintFoot();
    paintAll();

    function submit() { const t = input.value; if (!t.trim() || busy) return; input.value = ''; grow(); ask(t); }
    window._chatSubmit = submit;
  };

  function paintFoot() {
    const f = $('chatFoot'); if (!f) return;
    f.textContent = remaining != null && remaining <= 8 ? `Te quedan ${remaining} mensajes de IA hoy.` : 'La IA puede equivocarse. Tus mensajes se envían a Groq para generar la respuesta.';
  }

  /* ---------- pintar mensajes ---------- */
  function paintAll() {
    const feed = $('chatFeed'); if (!feed) return;
    feed.innerHTML = '';
    if (!msgs.length) { feed.appendChild(emptyState()); return; }
    msgs.forEach(m => feed.appendChild(m.role === 'user' ? userEl(m.content) : aiEl(m.content, false)));
    scrollEnd(false);
  }
  function emptyState() {
    const d = document.createElement('div'); d.className = 'chat-empty';
    d.innerHTML = `<span class="orb lg"></span><h2>¿En qué te echo una mano?</h2><p>Pregúntame lo que quieras: dudas, ideas, textos, cuentas rápidas…</p>
      <div class="chat-sugg">${SUGGESTIONS.map((s, i) => `<button type="button" data-i="${i}">${escapeHtml(s[0])}</button>`).join('')}</div>`;
    d.querySelectorAll('button').forEach(b => { b.onclick = () => ask(SUGGESTIONS[b.dataset.i][1]); });
    return d;
  }
  function userEl(text) {
    const el = document.createElement('div'); el.className = 'msg user';
    const b = document.createElement('div'); b.className = 'bubble'; b.textContent = text; el.appendChild(b);
    return el;
  }
  function aiEl(text, animate) {
    const el = document.createElement('div'); el.className = 'msg ai';
    el.innerHTML = '<span class="orb xs"></span><div class="ai-col"><div class="bubble note-rendered"></div><div class="msg-actions"><button type="button" class="chat-ghost sm" aria-label="Copiar">' + ic.copy + '<span>Copiar</span></button></div></div>';
    const bubble = el.querySelector('.bubble');
    toHtml(text).then(html => {
      bubble.innerHTML = html;
      if (animate) [...bubble.children].forEach((c, i) => { c.classList.add('reveal'); c.style.animationDelay = (i * 90) + 'ms'; });
      bubble.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
      scrollEnd(true);
    });
    el.querySelector('.msg-actions button').onclick = () => {
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => showToast('Copiado.'), () => showToast('No se pudo copiar.'));
    };
    return el;
  }
  function typingEl() {
    const el = document.createElement('div'); el.className = 'msg ai typing';
    el.innerHTML = '<span class="orb xs spin"></span><div class="dots" aria-label="Escribiendo"><i></i><i></i><i></i></div>';
    return el;
  }
  function errorEl(text) {
    const el = document.createElement('div'); el.className = 'msg err';
    el.innerHTML = `<div class="err-box"><span>${escapeHtml(text)}</span><button type="button" class="chat-ghost sm">Reintentar</button></div>`;
    el.querySelector('button').onclick = () => { el.remove(); request(); };
    return el;
  }
  function scrollEnd(smooth) {
    const sc = $('chatScroll'); if (!sc) return;
    sc.scrollTo({ top: sc.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  /* ---------- enviar / recibir ---------- */
  function ask(text) {
    text = String(text).trim(); if (!text || busy) return;
    const feed = $('chatFeed');
    if (!msgs.length) feed.innerHTML = '';
    msgs.push({ role: 'user', content: text }); save();
    feed.appendChild(userEl(text)); scrollEnd(true);
    request();
  }
  async function request() {
    const feed = $('chatFeed'); if (!feed) return;
    busy = true; $('chatSend').disabled = true; stopMic();
    const typing = typingEl(); feed.appendChild(typing); scrollEnd(true);
    try {
      const res = await fetch('./chat.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs.slice(-12), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
      msgs.push({ role: 'assistant', content: data.reply }); save();
      remaining = data.remaining; paintFoot();
      typing.remove();
      feed.appendChild(aiEl(data.reply, true));
      if (window.MobileX) MobileX.haptic(8);
    } catch (e) {
      typing.remove();
      feed.appendChild(errorEl(navigator.onLine ? e.message : 'Sin conexión: el chat necesita internet.'));
      scrollEnd(true);
    } finally {
      busy = false;
      const i = $('chatInput'); if (i) $('chatSend').disabled = !i.value.trim();
    }
  }
  function newChat() {
    if (!msgs.length) return;
    const backup = msgs; msgs = []; save(); paintAll();
    showToast('Conversación borrada.', { label: 'Deshacer', fn: () => { msgs = backup; save(); paintAll(); } });
  }

  /* ---------- dictado ---------- */
  function stopMic() { if (rec) { try { rec.stop(); } catch (e) {} } }
  function toggleMic() {
    if (rec) { stopMic(); return; }
    const input = $('chatInput'), base = input.value.trim();
    rec = new SR(); rec.lang = 'es-ES'; rec.interimResults = true; rec.continuous = false;
    rec.onresult = e => { input.value = (base ? base + ' ' : '') + [...e.results].map(r => r[0].transcript).join(' '); input.dispatchEvent(new Event('input')); };
    rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') showToast('Permite el micrófono para dictar.'); };
    rec.onend = () => { rec = null; $('chatMic')?.classList.remove('rec'); };
    $('chatMic').classList.add('rec');
    try { rec.start(); } catch (e) { rec = null; $('chatMic').classList.remove('rec'); }
  }
})();
