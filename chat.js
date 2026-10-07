/* Pestaña Chat con memoria: las conversaciones se guardan en el servidor (chat.php) y se pueden retomar,
   renombrar y borrar. Además cada usuario tiene unas instrucciones personales que se aplican a todas.
   Usa las globales de la app (me, showToast, loadNotesRich, escapeHtml…) solo al ejecutarse. */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const coarse = matchMedia('(pointer:coarse)');
  const $ = id => document.getElementById(id);
  const lastKey = () => 'chat_last_' + (typeof me !== 'undefined' && me ? me.id : 'x');
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
    fresh: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h10M4 17h16" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h9M18 7h1M5 17h1M10 17h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="17" r="2.2" stroke="currentColor" stroke-width="1.8"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3zM14 7l3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9.5 7V5h5v2M7 7l1 12h8l1-12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  window.chatReset = () => { convs = []; activeId = null; msgs = []; settings = { about: '', style: '' }; remaining = null; lastUser = null; };
  let convs = [], activeId = null, msgs = [], settings = { about: '', style: '' };
  let busy = false, rec = null, remaining = null, mdMod = null, built = false, lastUser = null;

  async function call(payload) {
    const res = await fetch('./chat.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Error ' + res.status); e.data = data; throw e; }
    return data;
  }
  async function toHtml(text) {
    try { mdMod = mdMod || await loadNotesRich(); return mdMod.renderNoteHtml(text); }
    catch (e) { return '<p>' + escapeHtml(text).replace(/\n/g, '<br>') + '</p>'; }
  }

  /* ---------- estructura ---------- */
  window.renderChat = function () {
    const root = $('chatMain'); if (!root) return;
    document.body.classList.remove('chat-typing');
    root.innerHTML = `
      <div class="chat-shell">
        <aside class="chat-side" id="chatSide">
          <div class="cs-head"><button class="cs-new" id="csNew" type="button">${ic.fresh}<span>Nueva conversación</span></button></div>
          <div class="cs-list" id="chatList"></div>
          <div class="cs-foot"><button class="cs-set" id="csSet" type="button">${ic.gear}<span>Instrucciones personales</span><i class="cs-dot" id="csDot"></i></button></div>
        </aside>
        <div class="chat-backdrop" id="chatBackdrop"></div>
        <div class="chat">
          <div class="chat-top">
            <div class="chat-id"><button class="chat-ghost icon only-sm" id="chatHist" type="button" aria-label="Historial">${ic.list}</button><span class="orb sm"></span>
              <div><b id="chatTitle">Nueva conversación</b><small id="chatSub">Recuerda lo que hablamos en cada chat</small></div></div>
            <div class="chat-actions"><button class="chat-ghost" id="chatSet" type="button" title="Instrucciones personales" aria-label="Instrucciones personales">${ic.gear}<span>Instrucciones</span></button></div>
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
        </div>
      </div>`;
    const input = $('chatInput');
    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 150) + 'px'; $('chatSend').disabled = busy || !input.value.trim(); };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !coarse.matches) { e.preventDefault(); submit(); } });
    let blurT = 0;   // en móvil se oculta la barra inferior al escribir; al tocar "Enviar" se espera un instante para que nada se mueva a mitad del toque
    input.addEventListener('focus', () => { clearTimeout(blurT); if (coarse.matches) document.body.classList.add('chat-typing'); });
    input.addEventListener('blur', () => { blurT = setTimeout(() => document.body.classList.remove('chat-typing'), 250); });
    ['chatSend', 'chatMic'].forEach(id => { const b = $(id); if (b) b.addEventListener('mousedown', e => e.preventDefault()); });
    $('chatSend').onclick = submit;
    if (SR && $('chatMic')) $('chatMic').onclick = toggleMic;
    $('csNew').onclick = () => { newChat(); closeSide(); };
    $('csSet').onclick = $('chatSet').onclick = () => { closeSide(); openSettings(); };
    $('chatHist').onclick = () => $('chatSide').classList.add('open') || $('chatBackdrop').classList.add('open');
    $('chatBackdrop').onclick = closeSide;
    function submit() { const t = input.value; if (!t.trim() || busy) return; input.value = ''; grow(); ask(t); }
    built = true;
    paintFoot(); paintList(); paintFeed();
    init();
  };
  const closeSide = () => { $('chatSide')?.classList.remove('open'); $('chatBackdrop')?.classList.remove('open'); };

  async function init() {
    try {
      const [l, s] = await Promise.all([call({ action: 'list' }), call({ action: 'settings_get' })]);
      convs = l.conversations; settings = { about: s.about || '', style: s.style || '' };
      paintList(); paintDot();
      const last = Number((() => { try { return localStorage.getItem(lastKey()); } catch (e) { return 0; } })());
      if (!activeId && last && convs.some(c => c.id === last)) await openConv(last);
    } catch (e) { paintFeed(); if (e.data && e.data.code) return; showToast(e.message); }
  }

  /* ---------- lista de conversaciones ---------- */
  function groupLabel(ts) {
    const d = new Date(String(ts).replace(' ', 'T')), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 864e5);
    return diff <= 0 ? 'Hoy' : diff === 1 ? 'Ayer' : diff < 7 ? 'Esta semana' : 'Antes';
  }
  function paintList() {
    const box = $('chatList'); if (!box) return;
    if (!convs.length) { box.innerHTML = '<div class="cs-empty">Aquí aparecerán tus conversaciones.</div>'; return; }
    box.innerHTML = '';
    let last = '';
    convs.forEach(c => {
      const g = groupLabel(c.updated_at);
      if (g !== last) { last = g; const h = document.createElement('div'); h.className = 'cs-group'; h.textContent = g; box.appendChild(h); }
      const it = document.createElement('div'); it.className = 'cs-item' + (c.id === activeId ? ' on' : '');
      it.innerHTML = `<button class="cs-title" type="button">${escapeHtml(c.title)}</button><span class="cs-acts"><button type="button" data-a="ren" aria-label="Renombrar">${ic.edit}</button><button type="button" data-a="del" aria-label="Borrar">${ic.trash}</button></span>`;
      it.querySelector('.cs-title').onclick = () => { openConv(c.id); closeSide(); };
      it.querySelector('[data-a=ren]').onclick = e => { e.stopPropagation(); rename(c, it); };
      it.querySelector('[data-a=del]').onclick = e => { e.stopPropagation(); confirmDelete(c, it); };
      box.appendChild(it);
    });
  }
  function rename(c, it) {
    it.innerHTML = '<input class="cs-edit" maxlength="120">';
    const inp = it.querySelector('input'); inp.value = c.title; inp.focus(); inp.select();
    let done = false;
    const finish = async save => {
      if (done) return; done = true;
      const t = inp.value.trim();
      if (save && t && t !== c.title) { try { await call({ action: 'rename', id: c.id, title: t }); c.title = t; if (c.id === activeId) $('chatTitle').textContent = t; } catch (e) { showToast(e.message); } }
      paintList();
    };
    inp.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
    inp.onblur = () => finish(true);
  }
  function confirmDelete(c, it) {
    it.classList.add('asking');
    it.innerHTML = `<span class="cs-ask">¿Borrar?</span><span class="cs-acts show"><button type="button" data-a="yes" class="yes">Sí</button><button type="button" data-a="no">No</button></span>`;
    it.querySelector('[data-a=no]').onclick = e => { e.stopPropagation(); paintList(); };
    it.querySelector('[data-a=yes]').onclick = async e => {
      e.stopPropagation();
      try { await call({ action: 'delete', id: c.id }); convs = convs.filter(x => x.id !== c.id); if (c.id === activeId) newChat(); paintList(); }
      catch (err) { showToast(err.message); paintList(); }
    };
  }

  /* ---------- conversación activa ---------- */
  async function openConv(id) {
    try {
      const d = await call({ action: 'get', id });
      activeId = id; msgs = d.messages; lastUser = null;
      try { localStorage.setItem(lastKey(), String(id)); } catch (e) {}
      $('chatTitle').textContent = d.conversation.title;
      paintList(); paintFeed();
    } catch (e) { showToast(e.message); try { localStorage.removeItem(lastKey()); } catch (er) {} }
  }
  function newChat() {
    activeId = null; msgs = []; lastUser = null;
    try { localStorage.removeItem(lastKey()); } catch (e) {}
    $('chatTitle').textContent = 'Nueva conversación';
    paintList(); paintFeed(); $('chatInput')?.focus();
  }
  function paintFoot() {
    const f = $('chatFoot'); if (!f) return;
    f.textContent = remaining != null && remaining <= 8 ? `Te quedan ${remaining} mensajes de IA hoy.` : 'La IA puede equivocarse. Tus mensajes se envían a Groq y se guardan en tu cuenta.';
  }
  function paintDot() { const d = $('csDot'); if (d) d.style.display = (settings.about || settings.style) ? '' : 'none'; }

  /* ---------- mensajes ---------- */
  function paintFeed() {
    const feed = $('chatFeed'); if (!feed) return;
    feed.innerHTML = '';
    if (!msgs.length) { feed.appendChild(emptyState()); return; }
    msgs.forEach(m => feed.appendChild(m.role === 'user' ? userEl(m.content) : aiEl(m.content, false)));
    scrollEnd(false);
  }
  function emptyState() {
    const d = document.createElement('div'); d.className = 'chat-empty';
    d.innerHTML = `<span class="orb lg"></span><h2>¿En qué te echo una mano?</h2><p>Recuerdo lo que hablamos en cada conversación. Puedes decirme cómo quieres que te responda en «Instrucciones».</p>
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
      scrollEnd(animate);
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
    el.querySelector('button').onclick = () => { el.remove(); request(lastUser); };
    return el;
  }
  function scrollEnd(smooth) { const sc = $('chatScroll'); if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); }

  /* ---------- enviar / recibir ---------- */
  function ask(text) {
    text = String(text).trim(); if (!text || busy) return;
    const feed = $('chatFeed');
    if (!msgs.length) feed.innerHTML = '';
    msgs.push({ role: 'user', content: text });
    feed.appendChild(userEl(text)); scrollEnd(true);
    lastUser = text;
    request(text);
  }
  async function request(text) {
    const feed = $('chatFeed'); if (!feed || !text) return;
    busy = true; $('chatSend').disabled = true; stopMic();
    const typing = typingEl(); feed.appendChild(typing); scrollEnd(true);
    try {
      const d = await call({ action: 'send', conversation_id: activeId, text, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      msgs.push({ role: 'assistant', content: d.reply });
      remaining = d.remaining; paintFoot();
      const isNew = activeId !== d.conversation.id;
      activeId = d.conversation.id;
      try { localStorage.setItem(lastKey(), String(activeId)); } catch (e) {}
      const i = convs.findIndex(c => c.id === activeId);
      if (i >= 0) convs.splice(i, 1);
      convs.unshift(d.conversation);
      $('chatTitle').textContent = d.conversation.title;
      if (isNew || true) paintList();
      typing.remove();
      feed.appendChild(aiEl(d.reply, true));
      lastUser = null;
      if (window.MobileX) MobileX.haptic(8);
    } catch (e) {
      typing.remove();
      feed.appendChild(errorEl(navigator.onLine ? e.message : 'Sin conexión: el chat necesita internet.'));
      scrollEnd(true);
    } finally {
      busy = false;
      const inp = $('chatInput'); if (inp) $('chatSend').disabled = !inp.value.trim();
    }
  }

  /* ---------- instrucciones personales ---------- */
  let sheet = null;
  function openSettings() {
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.innerHTML = `<div class="modal-backdrop" id="csBackdrop" style="z-index:140"></div>
        <div class="modal-sheet" id="csSheet" style="z-index:141;max-width:520px;"><div class="modal-handle"></div>
          <div class="modal-header"><h3>Instrucciones personales</h3><button class="modal-close" id="csClose">${xSvg()}</button></div>
          <div class="modal-body">
            <p class="cs-help">Se aplican a <b>todas</b> tus conversaciones. Escribe lo que quieras que el asistente tenga siempre en cuenta.</p>
            <div class="cs-field"><label for="csAbout">¿Qué quieres que sepa de ti?</label><textarea id="csAbout" rows="4" maxlength="1500" placeholder="Por ejemplo: Me llamo Jesús, soy desarrollador web, vivo en Madrid y trabajo con PHP y JavaScript."></textarea><small id="csAboutN"></small></div>
            <div class="cs-field"><label for="csStyle">¿Cómo quieres que responda?</label><textarea id="csStyle" rows="4" maxlength="1500" placeholder="Por ejemplo: Respuestas cortas y directas, con ejemplos. Tutéame y evita los rodeos."></textarea><small id="csStyleN"></small></div>
          </div>
          <div class="modal-footer"><button class="fin-save" id="csSave" style="width:100%;">Guardar instrucciones</button></div></div>`;
      document.body.append(...sheet.children);
      const close = () => { $('csBackdrop').classList.remove('open'); $('csSheet').classList.remove('open'); };
      $('csBackdrop').onclick = $('csClose').onclick = close;
      const cnt = () => { $('csAboutN').textContent = $('csAbout').value.length + ' / 1500'; $('csStyleN').textContent = $('csStyle').value.length + ' / 1500'; };
      $('csAbout').oninput = $('csStyle').oninput = cnt;
      $('csSave').onclick = async () => {
        try {
          const r = await call({ action: 'settings_save', about: $('csAbout').value, style: $('csStyle').value });
          settings = { about: r.about, style: r.style }; paintDot(); close(); showToast('Instrucciones guardadas.');
        } catch (e) { showToast(e.message); }
      };
      sheet.cnt = cnt;
    }
    $('csAbout').value = settings.about; $('csStyle').value = settings.style; sheet.cnt();
    $('csBackdrop').classList.add('open'); $('csSheet').classList.add('open');
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
