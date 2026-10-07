/* Apuntar, sin formularios: escribes (o dictas) una frase natural y la app entiende al instante qué es,
   cuándo y cuánto; lo ves en una tarjeta en vivo y lo ajustas con un toque. Opcionalmente "✨ IA" usa
   assistant.php para frases complejas (varias cosas a la vez). Sustituye a los modales de nueva tarea / nuevo
   movimiento y al antiguo asistente. Usa las globales de la app (tasks, movements, categories, api, render…) solo al ejecutarse. */
(function () {
  const $ = id => document.getElementById(id);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const KINDS = [['task', 'Tarea'], ['gasto', 'Gasto'], ['ingreso', 'Ingreso']];
  const PLACEHOLDERS = ['Llamar al dentista mañana a las 9', 'Gasolina 12', 'Reunión el viernes a las 16:30', 'Nómina 1.450 €', 'Comprar pan hoy', 'Cena con amigos 45 € el sábado'];
  const REMINDERS = [['Sin aviso', null], ['A la hora', 0], ['15 min antes', 15], ['1 hora antes', 60], ['1 día antes', 1440]];
  const ic = {
    cal: '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5.5" width="16" height="14.5" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M4 10h16M9 3.5v4M15 3.5v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none"><path d="M3.5 12.2V5.5a2 2 0 0 1 2-2h6.7l8.3 8.3a2 2 0 0 1 0 2.8l-5.9 5.9a2 2 0 0 1-2.8 0L3.5 12.2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8.3" cy="8.3" r="1.4" fill="currentColor"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 17h12l-1.4-2.2V10a4.6 4.6 0 0 0-9.2 0v4.8L6 17zM10 20a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    euro: '<svg viewBox="0 0 24 24" fill="none"><path d="M17.5 6.8A6.5 6.5 0 1 0 17.5 17.2M4.5 10.5h9M4.5 13.5h9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="9" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.2a3 3 0 0 1 0 5.6M17.5 14.2A5.2 5.2 0 0 1 20.5 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l1.9 5.4L19.5 10l-5.6 1.7L12 17l-1.9-5.3L4.5 10l5.6-1.6L12 3zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };

  const css = document.createElement('style');
  css.textContent = `
    html.cap-open,html.cap-open body{overflow:hidden;}
    .cap{position:fixed;inset:0;z-index:150;display:none;}
    .cap.open{display:block;}
    .cap-bg{position:absolute;inset:0;background:rgba(6,7,12,.5);backdrop-filter:blur(16px) saturate(1.2);animation:capFade .25s ease;}
    @keyframes capFade{from{opacity:0;}}
    .cap-panel{position:absolute;inset:0;display:flex;flex-direction:column;background:color-mix(in srgb,var(--bg) 92%,transparent);overflow:hidden;animation:capUp .38s cubic-bezier(.2,.8,.2,1);}
    @keyframes capUp{from{opacity:0;transform:translateY(24px) scale(.985);}}
    .cap-panel::before{content:'';position:absolute;left:-20%;right:-20%;top:-35%;height:75%;pointer-events:none;opacity:.75;filter:blur(34px);
      background:radial-gradient(40% 55% at 30% 50%,color-mix(in srgb,var(--primary) 38%,transparent),transparent 70%),radial-gradient(35% 50% at 72% 45%,rgba(34,211,238,.22),transparent 70%);animation:capAurora 14s ease-in-out infinite alternate;}
    @keyframes capAurora{to{transform:translateX(8%) scale(1.12);opacity:.55;}}
    .cap-top,.cap-body,.cap-foot{position:relative;}
    .cap-top{display:flex;align-items:center;gap:10px;padding:calc(14px + var(--safe-t)) 16px 6px;}
    .cap-x,.cap-ai{width:42px;height:42px;border-radius:14px;border:1px solid var(--line);background:color-mix(in srgb,var(--card) 80%,transparent);color:var(--ink-soft);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;}
    .cap-x svg,.cap-ai svg{width:19px;height:19px;display:block;}
    .cap-ai{width:auto;padding:0 14px;gap:7px;font-weight:600;font-size:13.5px;color:var(--primary);}
    .cap-ai.busy svg{animation:orbSpin 1s linear infinite;} .cap-ai:disabled{opacity:.5;}
    .cap-seg{flex:1;display:flex;position:relative;background:color-mix(in srgb,var(--card) 80%,transparent);border:1px solid var(--line);border-radius:15px;padding:3px;max-width:340px;margin:0 auto;}
    .cap-seg .thumb{position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px)/3);border-radius:12px;background:var(--grad);box-shadow:var(--glow);transition:transform .3s cubic-bezier(.3,.9,.3,1);}
    .cap-seg button{position:relative;flex:1;border:none;background:none;font:inherit;font-size:13.5px;font-weight:600;color:var(--ink-soft);padding:9px 4px;border-radius:12px;cursor:pointer;transition:color .2s;}
    .cap-seg button.on{color:#fff;}
    .cap-body{flex:1;min-height:0;overflow-y:auto;padding:18px 22px 10px;display:flex;flex-direction:column;gap:16px;-webkit-overflow-scrolling:touch;}
    .cap-input{width:100%;border:none;background:transparent;resize:none;outline:none !important;box-shadow:none !important;color:var(--ink);caret-color:var(--primary);
      font:inherit;font-size:clamp(25px,5vw,35px) !important;font-weight:560;letter-spacing:-.028em;line-height:1.22;padding:6px 0;min-height:44px;max-height:34vh;}
    .cap-input::placeholder{color:var(--ink-soft);opacity:.55;}
    .cap-hint{font-size:13px;color:var(--ink-soft);line-height:1.5;min-height:19px;margin-top:-6px;}
    .cap-hint.ai{color:var(--primary);}
    .cap-chips{display:flex;flex-wrap:wrap;gap:8px;}
    .cap-chip{display:inline-flex;align-items:center;gap:7px;height:40px;padding:0 14px;border-radius:13px;border:1px solid var(--line);background:color-mix(in srgb,var(--card) 82%,transparent);color:var(--ink-soft);font:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:transform .15s,border-color .15s,background .15s;}
    .cap-chip svg{width:17px;height:17px;display:block;flex-shrink:0;}
    .cap-chip.has{color:var(--ink);border-color:color-mix(in srgb,var(--primary) 35%,var(--line));background:color-mix(in srgb,var(--primary) 9%,var(--card));}
    .cap-chip.open{border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 16%,transparent);}
    .cap-chip.auto::after{content:'';width:6px;height:6px;border-radius:50%;background:var(--primary);margin-left:2px;animation:capPulse 1.6s ease-in-out infinite;}
    .cap-chip.pop{animation:capPop .35s cubic-bezier(.3,1.5,.4,1);}
    @keyframes capPop{from{transform:scale(.7);opacity:0;}} @keyframes capPulse{50%{opacity:.25;}}
    .cap-row{display:flex;flex-wrap:wrap;gap:7px;animation:capFade .2s ease;}
    .cap-row:empty{display:none;}
    .cap-pill{border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-size:13.5px;font-weight:550;padding:8px 14px;border-radius:11px;cursor:pointer;}
    .cap-pill.on{background:var(--primary-soft);border-color:var(--primary);color:var(--primary);}
    .cap-pill .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;}
    .cap-pill.field{padding:0;display:inline-flex;align-items:center;overflow:hidden;}
    .cap-pill.field input{border:none;background:transparent;color:var(--ink);font:inherit;font-size:16px !important;padding:8px 12px;outline:none;min-width:0;max-width:150px;}
    .cap-pill.field.amt input{max-width:130px;font-family:var(--font-mono);font-weight:600;} .cap-pill.field .suf{padding-right:12px;color:var(--ink-soft);font-weight:600;}
    .cap-card{display:flex;align-items:center;gap:14px;border-radius:20px;padding:15px 16px;background:color-mix(in srgb,var(--card) 88%,transparent);border:1px solid var(--line);box-shadow:var(--shadow);position:relative;overflow:hidden;animation:capPop .35s cubic-bezier(.3,1.4,.4,1);}
    .cap-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--grad);}
    .cap-card.gasto::before{background:linear-gradient(var(--rose-ink),color-mix(in srgb,var(--rose-ink) 55%,#fff));} .cap-card.ingreso::before{background:linear-gradient(var(--mint-ink),color-mix(in srgb,var(--mint-ink) 55%,#fff));}
    .cap-cico{width:42px;height:42px;border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--lav);color:var(--lav-ink);}
    .cap-card.gasto .cap-cico{background:var(--rose);color:var(--rose-ink);} .cap-card.ingreso .cap-cico{background:var(--mint);color:var(--mint-ink);} .cap-cico svg{width:21px;height:21px;display:block;}
    .cap-ct{flex:1;min-width:0;} .cap-ct b{display:block;font-size:16px;letter-spacing:-.01em;word-break:break-word;} .cap-ct b.empty{color:var(--ink-soft);font-weight:500;}
    .cap-ct span{display:block;font-size:13px;color:var(--ink-soft);margin-top:3px;}
    .cap-amt{font-family:var(--font-mono);font-weight:650;font-size:21px;letter-spacing:-.04em;white-space:nowrap;} .cap-card.gasto .cap-amt{color:var(--rose-ink);} .cap-card.ingreso .cap-amt{color:var(--mint-ink);}
    .cap-foot{display:flex;gap:10px;align-items:center;padding:10px 16px calc(14px + var(--safe-b));}
    .cap-mic{width:56px;height:56px;border-radius:19px;border:1px solid var(--line);background:color-mix(in srgb,var(--card) 82%,transparent);color:var(--ink-soft);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;}
    .cap-mic svg{width:23px;height:23px;display:block;} .cap-mic.rec{background:var(--rose-ink);color:#fff;border-color:transparent;animation:as-pulse 1.1s ease-in-out infinite;}
    .cap-go{flex:1;height:56px;border:none;border-radius:19px;background:var(--grad);color:#fff;font:inherit;font-size:16px;font-weight:650;letter-spacing:-.01em;cursor:pointer;box-shadow:var(--glow);transition:opacity .2s,transform .12s,filter .2s;display:flex;align-items:center;justify-content:center;gap:10px;}
    .cap-go kbd{font:inherit;font-size:11.5px;font-weight:600;background:rgba(255,255,255,.2);padding:2px 7px;border-radius:6px;display:none;}
    .cap-go:disabled{opacity:.35;box-shadow:none;cursor:default;} .cap-go:not(:disabled):hover{filter:brightness(1.07);}
    .cap-link{position:relative;text-align:center;font-size:12.5px;color:var(--ink-soft);padding:0 0 calc(10px + var(--safe-b));}
    .cap-link button{border:none;background:none;color:var(--ink-soft);font:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer;}
    .cap-multi{display:flex;flex-direction:column;gap:9px;}
    .cap-multi .cap-card{padding:12px 14px;} .cap-multi select{margin-top:7px;max-width:100%;padding:6px 8px;border:1.5px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);font-size:14px !important;}
    .cap-rm{border:none;background:none;color:var(--ink-soft);cursor:pointer;padding:4px;} .cap-rm svg{width:16px;height:16px;display:block;}
    .cap-done{position:absolute;inset:0;z-index:5;display:none;align-items:center;justify-content:center;flex-direction:column;gap:14px;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(10px);}
    .cap.ok .cap-done{display:flex;animation:capFade .2s ease;}
    .cap-done .ring{width:92px;height:92px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 0 0 0 color-mix(in srgb,var(--primary) 50%,transparent);animation:capBurst .7s ease-out;}
    .cap-done .ring svg{width:46px;height:46px;} .cap-done p{margin:0;font-weight:600;font-size:16px;text-align:center;padding:0 24px;}
    @keyframes capBurst{0%{transform:scale(.4);box-shadow:0 0 0 0 color-mix(in srgb,var(--primary) 55%,transparent);}55%{transform:scale(1.08);}100%{transform:scale(1);box-shadow:0 0 0 38px transparent;}}
    @media (min-width:861px){
      .cap-panel{inset:auto;left:50%;top:50%;width:min(700px,92vw);height:min(660px,90dvh);transform:translate(-50%,-50%);border-radius:30px;border:1px solid var(--line);box-shadow:0 40px 100px -30px rgba(0,0,0,.6);animation:capIn .35s cubic-bezier(.2,.8,.2,1);}
      @keyframes capIn{from{opacity:0;transform:translate(-50%,-47%) scale(.97);}}
      .cap-top{padding-top:16px;} .cap-body{padding:22px 30px 12px;} .cap-foot{padding:12px 24px 22px;} .cap-go kbd{display:inline-block;} .cap-link{padding-bottom:16px;}
    }
    @media (prefers-reduced-motion:reduce){.cap *{animation:none !important;transition:none !important;}}
  `;
  document.head.appendChild(css);

  /* ---------- estado ---------- */
  let st = null, built = false, rec = null, legacy = {}, phTimer = 0;
  const today = () => new Date();
  const canAI = () => typeof modState === 'function' ? modState('asistente') !== 'hidden' : true;

  function fresh(preset) {
    const p = preset || {};
    st = { kind: p.kind || 'task', lockedKind: !!p.kind, text: p.text || '', title: '', amount: null, date: p.date ? String(p.date).slice(0, 10) : null, time: null, catId: null, remind: null,
           scope: 'personal', touched: {}, row: null, multi: null, aiTitle: null, busy: false, hint: '' };
    if (p.date) st.touched.date = true;
  }

  /* ---------- construcción ---------- */
  function build() {
    if (built) return; built = true;
    const el = document.createElement('div'); el.className = 'cap'; el.id = 'cap';
    el.innerHTML = `<div class="cap-bg" id="capBg"></div>
      <div class="cap-panel" role="dialog" aria-modal="true" aria-label="Apuntar">
        <div class="cap-done"><div class="ring">${ic.check}</div><p id="capDoneTxt"></p></div>
        <div class="cap-top">
          <button class="cap-x" id="capX" type="button" aria-label="Cerrar">${ic.x}</button>
          <div class="cap-seg" id="capSeg"><i class="thumb"></i>${KINDS.map(k => `<button type="button" data-k="${k[0]}">${k[1]}</button>`).join('')}</div>
          <button class="cap-ai" id="capAI" type="button" title="Entender con IA (varias cosas a la vez, frases complejas)">${ic.spark}<span>IA</span></button>
        </div>
        <div class="cap-body" id="capBody">
          <textarea class="cap-input" id="capInput" rows="1" maxlength="400" enterkeyhint="done" autocomplete="off" autocapitalize="sentences" spellcheck="true" aria-label="Qué quieres apuntar"></textarea>
          <div class="cap-hint" id="capHint"></div>
          <div class="cap-chips" id="capChips"></div>
          <div class="cap-row" id="capRow"></div>
          <div id="capCard"></div>
          <div class="cap-multi" id="capMulti"></div>
        </div>
        <div class="cap-foot">
          ${SR ? `<button class="cap-mic" id="capMic" type="button" aria-label="Dictar">${ic.mic}</button>` : ''}
          <button class="cap-go" id="capGo" type="button"><span id="capGoTxt">Apuntar</span><kbd>↵</kbd></button>
        </div>
        <div class="cap-link"><button type="button" id="capLegacy">Usar el formulario completo</button></div>
      </div>`;
    document.body.appendChild(el);
    $('capBg').onclick = $('capX').onclick = close;
    $('capSeg').querySelectorAll('button').forEach(b => { b.onclick = () => setKind(b.dataset.k, true); });
    const input = $('capInput');
    input.addEventListener('input', () => { st.text = input.value; st.aiTitle = null; st.hint = ''; grow(); applyParse(); sync(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('cap')?.classList.contains('open')) close(); });
    ['capGo', 'capMic', 'capAI'].forEach(id => { const b = $(id); if (b) b.addEventListener('mousedown', e => e.preventDefault()); });   // el teclado no se cierra al tocar
    $('capGo').onclick = submit;
    $('capAI').onclick = askAI;
    if (SR && $('capMic')) $('capMic').onclick = toggleMic;
    $('capLegacy').onclick = () => { const k = st.kind; close(); (k === 'task' ? legacy.task : legacy.mov)?.(); };
  }
  function grow() { const i = $('capInput'); i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, window.innerHeight * 0.34) + 'px'; }

  function open(preset) {
    build(); fresh(preset);
    $('cap').classList.remove('ok'); $('cap').classList.add('open'); document.documentElement.classList.add('cap-open');
    const input = $('capInput'); input.value = st.text; grow();
    cycleHints(); applyParse(); sync();
    setTimeout(() => input.focus(), 120);
  }
  function close() {
    stopMic(); clearInterval(phTimer);
    $('cap')?.classList.remove('open', 'ok'); document.documentElement.classList.remove('cap-open');
  }
  function cycleHints() {
    clearInterval(phTimer); let i = Math.floor(Math.random() * PLACEHOLDERS.length);
    const set = () => { const inp = $('capInput'); if (inp) inp.placeholder = PLACEHOLDERS[i++ % PLACEHOLDERS.length]; };
    set(); phTimer = setInterval(set, 3200);
  }

  /* ---------- lógica ---------- */
  function setKind(k, manual) {
    st.kind = k; if (manual) { st.touched.kind = true; st.lockedKind = true; }
    if (k !== 'task') st.row = st.row === 'remind' ? null : st.row;
    st.catId = null; st.touched.cat = false; applyParse(); st.row = null; sync();
  }
  function autoCat(text) {
    const list = st.kind === 'task' ? categories : financeCategories;
    const t = String(text || '').toLowerCase();
    const hit = list.find(c => c.name && t.includes(String(c.name).toLowerCase()));
    return hit ? hit.id : null;
  }
  function applyParse() {
    const P = parseCapture(st.text, today());
    if (!st.lockedKind && !st.touched.kind) st.kind = P.kind;
    const T = st.kind === 'task' && P.amount != null ? parseCapture(st.text, today(), { noAmount: true }) : P;   // en una tarea el importe forma parte del texto
    if (!st.touched.date) st.date = T.date;
    if (!st.touched.time) st.time = T.time;
    if (!st.touched.remind) st.remind = T.remind;
    if (!st.touched.amount) st.amount = st.kind === 'task' ? null : P.amount;
    st.auto = { date: !st.touched.date && !!T.date, time: !st.touched.time && !!T.time, amount: !st.touched.amount && P.amount != null && st.kind !== 'task', remind: !st.touched.remind && T.remind != null };
    st.title = st.aiTitle != null ? st.aiTitle : (st.kind === 'task' ? T.title : P.title);
    if (!st.touched.cat) st.catId = autoCat(st.text) || null;
  }
  const catList = () => st.kind === 'task' ? categories : financeCategories;
  const effCat = () => { const l = catList(); const c = l.find(x => String(x.id) === String(st.catId)); if (c) return c; if (st.kind === 'task') return l.find(x => String(x.id) === String(typeof activeCat !== 'undefined' ? activeCat : '')) || l[0] || null; return null; };
  const dateLabel = ds => {
    if (!ds) return null;
    const d = new Date(ds + 'T12:00:00'), t0 = new Date(), diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(t0.getFullYear(), t0.getMonth(), t0.getDate())) / 864e5);
    if (diff === 0) return 'Hoy'; if (diff === 1) return 'Mañana'; if (diff === -1) return 'Ayer'; if (diff === 2) return 'Pasado mañana';
    return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
  };
  const money = n => (typeof window.money === 'function' ? window.money(n) : n.toFixed(2).replace('.', ',') + ' €');
  const valid = () => st.multi ? st.multi.some(Boolean) : (st.kind === 'task' ? !!(st.title || '').trim() : (st.amount > 0));

  /* ---------- pintado ---------- */
  function sync() {
    if (!built) return;
    const idx = KINDS.findIndex(k => k[0] === st.kind);
    $('capSeg').querySelector('.thumb').style.transform = `translateX(${idx * 100}%)`;
    $('capSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === st.kind));
    $('capHint').className = 'cap-hint' + (st.hint ? ' ai' : '');
    $('capHint').textContent = st.hint || (st.text.trim() ? '' : 'Escribe con naturalidad: lo entiendo al momento. Después ajusta con un toque.');
    $('capAI').style.display = canAI() ? '' : 'none';
    $('capChips').style.display = $('capCard').style.display = st.multi ? 'none' : '';
    $('capMulti').style.display = st.multi ? '' : 'none';
    if (!st.multi) { paintChips(); paintRow(); paintCard(); } else paintMulti();
    const go = $('capGo'); go.disabled = !valid() || st.busy;
    $('capGoTxt').textContent = st.multi ? `Añadir las ${st.multi.filter(Boolean).length}` : st.kind === 'task' ? 'Apuntar tarea' : st.kind === 'gasto' ? 'Apuntar gasto' : 'Apuntar ingreso';
  }
  let lastAuto = {};
  function chip(key, icon, label, has, auto) {
    const pop = auto && !lastAuto[key];
    return `<button type="button" class="cap-chip ${has ? 'has' : ''} ${auto ? 'auto' : ''} ${pop ? 'pop' : ''} ${st.row === key ? 'open' : ''}" data-c="${key}">${icon}<span>${label}</span></button>`;
  }
  function paintChips() {
    const cat = effCat(), A = st.auto || {};
    const chips = [];
    if (st.kind === 'task') {
      chips.push(chip('date', ic.cal, dateLabel(st.date) || 'Fecha', !!st.date, A.date));
      chips.push(chip('time', ic.clock, st.time || 'Hora', !!st.time, A.time));
      chips.push(chip('cat', ic.tag, cat ? cat.name : 'Categoría', !!cat, false));
      if (st.date) chips.push(chip('remind', ic.bell, (REMINDERS.find(r => r[1] === st.remind) || REMINDERS[0])[0], st.remind != null, A.remind));
    } else {
      chips.push(chip('amount', ic.euro, st.amount > 0 ? money(st.amount) : 'Importe', st.amount > 0, A.amount));
      chips.push(chip('date', ic.cal, dateLabel(st.date) || 'Hoy', true, A.date));
      chips.push(chip('cat', ic.tag, cat ? cat.name : 'Categoría', !!cat, false));
      if (typeof group !== 'undefined' && group) chips.push(chip('scope', ic.users, st.scope === 'grupo' ? group.name : 'Personal', st.scope === 'grupo', false));
    }
    $('capChips').innerHTML = chips.join('');
    lastAuto = { ...A };
    $('capChips').querySelectorAll('.cap-chip').forEach(b => { b.onclick = () => { st.row = st.row === b.dataset.c ? null : b.dataset.c; sync(); if (st.row === 'amount') setTimeout(() => $('capAmt')?.focus(), 40); }; });
  }
  function pill(label, on, fn, extra) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cap-pill' + (on ? ' on' : ''); b.innerHTML = (extra || '') + label; b.onclick = fn; return b;
  }
  function paintRow() {
    const row = $('capRow'); row.innerHTML = '';
    const set = (field, val) => { st[field] = val; st.touched[field] = true; if (field === 'date' || field === 'time') st.row = null; sync(); };
    if (st.row === 'date') {
      const t = today(), sat = addDays(t, (6 - t.getDay() + 7) % 7 || 7), mon = addDays(t, (8 - t.getDay()) % 7 || 7);
      [['Hoy', ymd(t)], ['Mañana', ymd(addDays(t, 1))], ['Sábado', ymd(sat)], ['Lunes', ymd(mon)]].forEach(([l, v]) => row.appendChild(pill(l, st.date === v, () => set('date', v))));
      if (st.kind === 'task') row.appendChild(pill('Sin fecha', !st.date, () => { st.date = null; st.time = null; st.remind = null; st.touched.date = st.touched.time = st.touched.remind = true; st.row = null; sync(); }));
      const f = document.createElement('label'); f.className = 'cap-pill field'; f.innerHTML = `<input type="date" value="${st.date || ''}" aria-label="Elegir fecha">`;
      f.querySelector('input').onchange = e => { if (e.target.value) set('date', e.target.value); };
      row.appendChild(f);
    } else if (st.row === 'time') {
      ['08:00', '09:00', '12:00', '15:00', '18:00', '21:00'].forEach(v => row.appendChild(pill(v, st.time === v, () => { if (!st.date) { st.date = ymd(today()); st.touched.date = true; } set('time', v); })));
      row.appendChild(pill('Sin hora', !st.time, () => set('time', null)));
      const f = document.createElement('label'); f.className = 'cap-pill field'; f.innerHTML = `<input type="time" value="${st.time || ''}" aria-label="Elegir hora">`;
      f.querySelector('input').onchange = e => { if (e.target.value) { if (!st.date) { st.date = ymd(today()); st.touched.date = true; } set('time', e.target.value); } };
      row.appendChild(f);
    } else if (st.row === 'cat') {
      const l = catList(), cur = effCat();
      if (st.kind !== 'task') row.appendChild(pill('Sin categoría', !cur, () => { st.catId = null; st.touched.cat = true; st.row = null; sync(); }));
      l.forEach((c, i) => row.appendChild(pill(escapeHtml(c.name), cur && String(cur.id) === String(c.id), () => { st.catId = c.id; st.touched.cat = true; st.row = null; sync(); },
        `<span class="dot" style="background:${(typeof PALETTE_INK !== 'undefined' ? PALETTE_INK : [])[i % 6] || 'var(--primary)'}"></span>`)));
      if (!l.length) row.innerHTML = '<span class="cap-hint">Aún no tienes categorías: se creará «General» automáticamente.</span>';
    } else if (st.row === 'remind') {
      REMINDERS.forEach(([l, v]) => row.appendChild(pill(l, st.remind === v, () => { st.remind = v; st.touched.remind = true; st.row = null; sync(); })));
    } else if (st.row === 'amount') {
      const f = document.createElement('label'); f.className = 'cap-pill field amt'; f.innerHTML = `<input id="capAmt" inputmode="decimal" placeholder="0,00" value="${st.amount > 0 ? String(st.amount).replace('.', ',') : ''}" aria-label="Importe"><span class="suf">€</span>`;
      f.querySelector('input').oninput = e => { const v = parseFloat(String(e.target.value).replace(',', '.')); st.amount = isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null; st.touched.amount = true; syncCard(); };
      f.querySelector('input').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); st.row = null; sync(); } };
      row.appendChild(f);
    } else if (st.row === 'scope') {
      row.appendChild(pill('Personal', st.scope === 'personal', () => { st.scope = 'personal'; st.row = null; sync(); }));
      row.appendChild(pill(escapeHtml(group.name), st.scope === 'grupo', () => { st.scope = 'grupo'; st.row = null; sync(); }));
    }
  }
  function syncCard() { paintChips(); paintCard(); $('capGo').disabled = !valid() || st.busy; }
  function paintCard() {
    const cat = effCat(), k = st.kind, due = st.date ? [dateLabel(st.date), st.time].filter(Boolean).join(' · ') : '';
    const meta = k === 'task' ? [due || 'Sin fecha', cat ? cat.name : null].filter(Boolean).join(' · ') : [dateLabel(st.date) || 'Hoy', cat ? cat.name : 'Sin categoría', st.scope === 'grupo' ? group.name : null].filter(Boolean).join(' · ');
    const title = (st.title || '').trim();
    $('capCard').innerHTML = `<div class="cap-card ${k}"><span class="cap-cico">${k === 'task' ? ic.check : k === 'gasto' ? '−' : '+'}</span>
      <div class="cap-ct"><b class="${title ? '' : 'empty'}">${escapeHtml(title || (k === 'task' ? '¿Qué hay que hacer?' : 'Añade una descripción (opcional)'))}</b><span>${escapeHtml(meta)}</span></div>
      ${k !== 'task' ? `<span class="cap-amt">${st.amount > 0 ? (k === 'gasto' ? '−' : '+') + money(st.amount) : '—'}</span>` : ''}</div>`;
  }

  /* ---------- guardar ---------- */
  async function ensureTaskCategory() {
    const c = effCat(); if (c) return c.id;
    const made = await api('?resource=categories', { method: 'POST', body: JSON.stringify({ name: 'General' }) });
    categories.push(made); return made.id;
  }
  async function create(a) {
    if (a.type === 'task') {
      const category_id = a.category_id || await ensureTaskCategory();
      const due_at = a.date ? new Date(a.date + 'T' + (a.time || '09:00')).toISOString() : null;
      const data = await api('?resource=tasks', { method: 'POST', body: JSON.stringify({ text: a.title, description: '', category_id, due_at, reminders: due_at && a.remind != null ? [a.remind] : [] }) });
      tasks.unshift({ reminders: [], notified: [], due_at: null, description: '', ...data, id: String(data.id) });
      if (currentSection === 'tareas') { activeCat = category_id; showUpcoming = false; showOverdue = false; }
      return 'Tarea apuntada' + (a.date ? ' · ' + [dateLabel(a.date), a.time].filter(Boolean).join(' ') : '');
    }
    const payload = { type: a.kind, amount: a.amount, category_id: a.category_id || null, date: a.date || ymd(today()), description: a.title || '' };
    if (a.scope === 'grupo' && typeof group !== 'undefined' && group) { payload.group_id = group.id; payload.paid_by = me.id; }
    const data = await api('?resource=movements', { method: 'POST', body: JSON.stringify(payload) });
    movements.unshift(data);
    return (a.kind === 'gasto' ? 'Gasto' : 'Ingreso') + ' apuntado · ' + money(a.amount);
  }
  async function submit() {
    if (st.busy || !valid()) return;
    st.busy = true; $('capGo').disabled = true; stopMic();
    try {
      let msg;
      if (st.multi) {
        const todo = st.multi.filter(Boolean); let ok = 0;
        for (const a of todo) { try { await create(a); ok++; } catch (e) {} }
        if (!ok) throw new Error('No se pudo guardar. Revisa que tengas una categoría de tareas.');
        msg = ok === 1 ? 'Apuntado' : `${ok} cosas apuntadas`;
      } else {
        msg = await create(st.kind === 'task'
          ? { type: 'task', title: st.title.trim(), date: st.date, time: st.time, remind: st.remind, category_id: (effCat() || {}).id || null }
          : { type: 'mov', kind: st.kind, title: st.title.trim(), amount: st.amount, date: st.date, category_id: (effCat() || {}).id || null, scope: st.scope });
      }
      $('capDoneTxt').textContent = msg; $('cap').classList.add('ok');
      if (window.MobileX) MobileX.haptic([14, 40, 14]);
      setTimeout(() => { close(); render(); }, 820);
    } catch (e) { showToast(e.message || 'No se pudo guardar.'); }
    finally { st.busy = false; if ($('capGo')) $('capGo').disabled = !valid(); }
  }

  /* ---------- IA (frases complejas, varias cosas a la vez) ---------- */
  async function askAI() {
    if (typeof modGate === 'function' && !modGate('asistente')) return;
    const text = $('capInput').value.trim(); if (!text) { $('capInput').focus(); return; }
    const b = $('capAI'); if (b.disabled) return;
    b.disabled = true; b.classList.add('busy'); st.hint = 'Pensando…'; sync();
    try {
      const res = await fetch('./assistant.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
      const acts = data.actions || [];
      if (!acts.length) { st.hint = data.message || 'No he entendido qué crear.'; }
      else if (acts.length === 1) { applyAction(acts[0]); st.hint = 'Entendido con IA ✓ Revísalo y apúntalo.'; }
      else { st.multi = acts.map(a => toItem(a)); st.hint = `He encontrado ${acts.length} cosas. Quita las que no quieras.`; }
    } catch (e) { st.hint = navigator.onLine ? e.message : 'Sin conexión: la IA necesita internet.'; }
    finally { b.disabled = false; b.classList.remove('busy'); sync(); }
  }
  function toItem(a) {
    if (a.type === 'task') {
      const d = a.due_at ? new Date(a.due_at) : null;
      return { type: 'task', title: a.text, date: d ? ymd(d) : null, time: d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : null, remind: a.reminders && a.reminders.length ? a.reminders[0] : null,
               category_id: a.category_id || (typeof activeCat !== 'undefined' && activeCat) || (categories[0] && categories[0].id) || null };
    }
    return { type: 'mov', kind: a.kind, title: a.description, amount: a.amount, date: a.date, category_id: a.category_id || null, scope: 'personal' };
  }
  function applyAction(a) {
    const it = toItem(a);
    st.kind = it.type === 'task' ? 'task' : it.kind; st.touched = { kind: true, date: true, time: true, amount: true, remind: true, cat: true }; st.lockedKind = true;
    st.title = st.aiTitle = it.title; st.date = it.date; st.time = it.time; st.remind = it.remind; st.amount = it.amount || null; st.catId = it.category_id;
    st.auto = {};
  }
  function paintMulti() {
    const box = $('capMulti'); box.innerHTML = '';
    st.multi.forEach((a, i) => {
      if (!a) return;
      const isT = a.type === 'task', list = isT ? categories : financeCategories;
      const card = document.createElement('div'); card.className = 'cap-card ' + (isT ? 'task' : a.kind);
      const meta = isT ? [a.date ? dateLabel(a.date) + (a.time ? ' · ' + a.time : '') : 'Sin fecha'].join('') : dateLabel(a.date);
      card.innerHTML = `<span class="cap-cico">${isT ? ic.check : a.kind === 'gasto' ? '−' : '+'}</span><div class="cap-ct"><b>${escapeHtml(a.title || (isT ? 'Tarea' : 'Movimiento'))}</b><span>${escapeHtml(isT ? 'Tarea · ' + meta : (a.kind === 'gasto' ? 'Gasto · ' : 'Ingreso · ') + meta)}</span>
        <select aria-label="Categoría">${isT ? '' : '<option value="">Sin categoría</option>'}${list.map(c => `<option value="${c.id}" ${String(c.id) === String(a.category_id) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
        ${isT ? '' : `<span class="cap-amt">${a.kind === 'gasto' ? '−' : '+'}${money(a.amount)}</span>`}<button class="cap-rm" type="button" aria-label="Quitar">${ic.x}</button>`;
      card.querySelector('select').onchange = e => { a.category_id = e.target.value || null; };
      card.querySelector('.cap-rm').onclick = () => { st.multi[i] = null; if (!st.multi.some(Boolean)) st.multi = null; sync(); };
      box.appendChild(card);
    });
  }

  /* ---------- dictado ---------- */
  function stopMic() { if (rec) { try { rec.stop(); } catch (e) {} } }
  function toggleMic() {
    if (rec) { stopMic(); return; }
    const input = $('capInput'), base = input.value.trim();
    rec = new SR(); rec.lang = 'es-ES'; rec.interimResults = true; rec.continuous = false;
    rec.onresult = e => { input.value = (base ? base + ' ' : '') + [...e.results].map(r => r[0].transcript).join(' '); input.dispatchEvent(new Event('input')); };
    rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') showToast('Permite el micrófono para dictar.'); };
    rec.onend = () => { rec = null; $('capMic')?.classList.remove('rec'); };
    $('capMic').classList.add('rec');
    try { rec.start(); } catch (e) { rec = null; $('capMic').classList.remove('rec'); }
  }

  /* ---------- puntos de entrada: botón ✨, botones "+" y calendario ---------- */
  document.addEventListener('click', e => { if (e.target.closest('[data-assist]')) { e.preventDefault(); open({}); } });
  document.addEventListener('DOMContentLoaded', () => {
    legacy.task = window.openTaskModal; legacy.mov = window.openMovModal;
    window.openTaskModal = function (date) { if (modGate('tareas')) open({ kind: 'task', date: date || null, fromFab: true }); };
    window.openMovModal = function (m) { if (m) return legacy.mov(m); if (modGate('gastos')) open({ kind: 'gasto', fromFab: true }); };
  });
  window.Capture = { open, close };
})();
