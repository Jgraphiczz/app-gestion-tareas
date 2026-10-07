/* Asistente: escribes o dictas una frase, assistant.php propone tareas/gastos y tú confirmas.
   Usa las variables globales de la app (tasks, movements, categories, financeCategories, api, render…) solo al ejecutarse. */
(function () {
  const css = document.createElement('style');
  css.textContent = `
    #assistBtn{margin-right:8px;} #assistBtn svg{width:18px;height:18px;display:block;}
    .as-row{display:flex;gap:8px;align-items:flex-end;}
    .as-input{flex:1;min-height:76px;resize:none;padding:12px 14px;border:1.5px solid var(--line);border-radius:var(--radius-sm);background:var(--bg);color:var(--ink);font:inherit;font-size:16px;line-height:1.4;}
    .as-input:focus{outline:none;border-color:var(--primary);}
    .as-side{display:flex;flex-direction:column;gap:8px;}
    .as-btn{width:46px;height:46px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:var(--primary-soft);color:var(--primary);}
    .as-btn.primary{background:var(--primary);color:#fff;}
    .as-btn.rec{background:var(--rose-ink);color:#fff;animation:as-pulse 1.1s ease-in-out infinite;}
    .as-btn:disabled{opacity:.55;}
    .as-btn svg{width:20px;height:20px;display:block;}
    @keyframes as-pulse{50%{box-shadow:0 0 0 8px rgba(196,87,126,.22);}}
    .as-hint{font-size:12.5px;color:var(--ink-soft);line-height:1.5;}
    .as-msg{background:var(--bg);border-radius:var(--radius-sm);padding:12px 14px;font-size:14px;line-height:1.5;}
    .as-msg.err{background:var(--rose);color:var(--rose-ink);}
    .as-cards{display:flex;flex-direction:column;gap:9px;}
    .as-card{display:flex;gap:11px;align-items:flex-start;background:var(--bg);border-radius:var(--radius-sm);padding:12px 12px 12px 14px;}
    .as-ic{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:15px;font-weight:700;}
    .as-ic.task{background:var(--lav);color:var(--lav-ink);} .as-ic.gasto{background:var(--rose);color:var(--rose-ink);} .as-ic.ingreso{background:var(--mint);color:var(--mint-ink);}
    .as-body{flex:1;min-width:0;}
    .as-title{font-size:14.5px;font-weight:600;word-break:break-word;}
    .as-meta{margin-top:4px;font-size:12.5px;color:var(--ink-soft);}
    .as-card select{margin-top:7px;max-width:100%;padding:6px 8px;border:1.5px solid var(--line);border-radius:8px;font-size:13px !important;background:var(--card);color:var(--ink);}
    .as-x{background:none;border:none;color:var(--ink-soft);cursor:pointer;padding:4px;}
    .as-x svg{width:14px;height:14px;display:block;}
  `;
  document.head.appendChild(css);

  const micSvg = '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const sendSvg = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let built = false, items = [], busy = false, rec = null;
  const $ = id => document.getElementById(id);

  function build() {
    if (built) return; built = true;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="modal-backdrop" id="asBackdrop"></div>
      <div class="modal-sheet" id="asModal">
        <div class="modal-handle"></div>
        <div class="modal-header"><h3>Asistente</h3><button class="modal-close" id="asClose">${xSvg()}</button></div>
        <div class="modal-body">
          <div class="as-row">
            <textarea class="as-input" id="asInput" maxlength="600" placeholder="Dime qué apuntar…"></textarea>
            <div class="as-side">
              ${SR ? `<button class="as-btn" id="asMic" type="button" title="Dictar" aria-label="Dictar">${micSvg}</button>` : ''}
              <button class="as-btn primary" id="asSend" type="button" title="Enviar" aria-label="Enviar">${sendSvg}</button>
            </div>
          </div>
          <div class="as-hint" id="asHint">Ejemplos: «gasto de 12 € en gasolina» · «recuérdame mañana a las 9 llamar al dentista» · «me ingresaron la nómina, 1450».</div>
          <div id="asResults"></div>
        </div>
        <div class="modal-footer" id="asFooter" style="display:none;"><button class="fin-save" id="asAccept" style="width:100%;">Añadir</button></div>
      </div>`;
    document.body.append(...wrap.children);
    $('asClose').onclick = $('asBackdrop').onclick = close;
    $('asSend').onclick = send;
    $('asAccept').onclick = accept;
    $('asInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    if (SR && $('asMic')) $('asMic').onclick = toggleMic;
  }
  function open() {
    build(); clearResults();
    $('asBackdrop').classList.add('open'); $('asModal').classList.add('open');
    setTimeout(() => $('asInput').focus(), 80);
  }
  function close() {
    stopMic();
    $('asBackdrop').classList.remove('open'); $('asModal').classList.remove('open');
  }
  function clearResults() { items = []; $('asResults').innerHTML = ''; $('asFooter').style.display = 'none'; $('asHint').style.display = ''; }

  /* ---------- dictado ---------- */
  function stopMic() { if (rec) { try { rec.stop(); } catch (e) {} } }
  function toggleMic() {
    if (rec) { stopMic(); return; }
    const base = $('asInput').value.trim();
    rec = new SR(); rec.lang = 'es-ES'; rec.interimResults = true; rec.continuous = false;
    rec.onresult = e => { const t = [...e.results].map(r => r[0].transcript).join(' '); $('asInput').value = (base ? base + ' ' : '') + t; };
    rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') showToast('Permite el micrófono para dictar.'); };
    rec.onend = () => { rec = null; $('asMic')?.classList.remove('rec'); };
    $('asMic').classList.add('rec');
    try { rec.start(); } catch (e) { rec = null; $('asMic').classList.remove('rec'); }
  }

  /* ---------- enviar ---------- */
  async function send() {
    if (busy) return;
    const text = $('asInput').value.trim(); if (!text) { $('asInput').focus(); return; }
    stopMic(); busy = true; $('asSend').disabled = true;
    $('asResults').innerHTML = '<div class="as-msg">Pensando…</div>'; $('asFooter').style.display = 'none'; $('asHint').style.display = 'none';
    try {
      const res = await fetch('./assistant.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
      items = (data.actions || []).map(a => ({ ...a }));
      renderResults(data.message, data.remaining);
    } catch (e) {
      $('asResults').innerHTML = `<div class="as-msg err">${escapeHtml(navigator.onLine ? e.message : 'Sin conexión: el asistente necesita internet.')}</div>`;
    } finally { busy = false; $('asSend').disabled = false; }
  }

  const catOptions = (list, selected, empty) => (empty ? `<option value="">${empty}</option>` : '') +
    list.map(c => `<option value="${c.id}" ${String(c.id) === String(selected) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  const fmtDue = iso => new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });

  function renderResults(message, remaining) {
    const box = $('asResults');
    if (!items.length) { box.innerHTML = `<div class="as-msg">${escapeHtml(message || 'No he entendido qué crear.')}</div>`; return; }
    box.innerHTML = '<div class="as-cards"></div>' + (remaining != null && remaining <= 5 ? `<div class="as-hint" style="margin-top:8px;">Te quedan ${remaining} mensajes hoy.</div>` : '');
    const list = box.firstChild;
    items.forEach((a, i) => {
      const card = document.createElement('div'); card.className = 'as-card';
      if (a.type === 'task') {
        if (!a.category_id) a.category_id = (typeof activeCat !== 'undefined' && activeCat) || (categories[0] && categories[0].id) || null;
        const meta = a.due_at ? fmtDue(a.due_at) + (a.reminders.length ? ' · con aviso' : '') : 'Sin fecha';
        card.innerHTML = `<span class="as-ic task">✓</span><div class="as-body"><div class="as-title">${escapeHtml(a.text)}</div><div class="as-meta">Tarea · ${escapeHtml(meta)}</div>
          <select aria-label="Categoría">${catOptions(categories, a.category_id)}</select></div><button class="as-x" aria-label="Quitar">${xSvg()}</button>`;
        card.querySelector('select').onchange = e => { a.category_id = e.target.value; };
      } else {
        const sign = a.kind === 'ingreso' ? '+' : '−';
        card.innerHTML = `<span class="as-ic ${a.kind}">${sign}</span><div class="as-body"><div class="as-title">${money(a.amount)}${a.description ? ' · ' + escapeHtml(a.description) : ''}</div><div class="as-meta">${a.kind === 'ingreso' ? 'Ingreso' : 'Gasto'} · ${escapeHtml(fmtDate(a.date))}</div>
          <select aria-label="Categoría">${catOptions(financeCategories, a.category_id, 'Sin categoría')}</select></div><button class="as-x" aria-label="Quitar">${xSvg()}</button>`;
        card.querySelector('select').onchange = e => { a.category_id = e.target.value || null; };
      }
      card.querySelector('.as-x').onclick = () => { items[i] = null; card.remove(); syncFooter(); };
      list.appendChild(card);
    });
    syncFooter();
  }
  function syncFooter() {
    const n = items.filter(Boolean).length;
    $('asFooter').style.display = n ? '' : 'none';
    $('asAccept').textContent = n === 1 ? 'Añadir' : `Añadir las ${n}`;
  }

  /* ---------- aceptar: se crean con los endpoints de siempre ---------- */
  async function accept() {
    const todo = items.filter(Boolean); if (!todo.length) return;
    const btn = $('asAccept'); btn.disabled = true;
    let ok = 0, fail = 0;
    for (const a of todo) {
      try {
        if (a.type === 'task') {
          if (!a.category_id) throw new Error('sin categoría');
          const data = await api('?resource=tasks', { method: 'POST', body: JSON.stringify({ text: a.text, description: a.description, category_id: a.category_id, due_at: a.due_at, reminders: a.reminders }) });
          tasks.unshift({ reminders: [], notified: [], due_at: null, description: '', ...data, id: String(data.id) });
        } else {
          const data = await api('?resource=movements', { method: 'POST', body: JSON.stringify({ type: a.kind, amount: a.amount, category_id: a.category_id, date: a.date, description: a.description }) });
          movements.unshift(data);
        }
        ok++;
      } catch (e) { fail++; }
    }
    btn.disabled = false;
    if (ok) { $('asInput').value = ''; close(); render(); if (window.MobileX) MobileX.haptic(18); }
    showToast(fail ? `Añadido ${ok}, pero ${fail} no se pudo guardar${!ok ? '. Crea primero una categoría de tareas.' : '.'}` : (ok === 1 ? 'Añadido.' : `Añadidas ${ok} cosas.`));
  }

  document.addEventListener('click', e => { if (e.target.closest('[data-assist]')) open(); });
})();
