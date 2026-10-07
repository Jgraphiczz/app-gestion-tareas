/* Detalle de tarea: editar texto, fecha, categoría, prioridad, repetición y subtareas (checklist).
   Se abre tocando una tarea. Usa las globales de la app (tasks, categories, api, refreshTaskViews…) solo al ejecutarse. */
(function () {
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const REPEATS = [['', 'No se repite'], ['daily', 'Cada día'], ['weekdays', 'De lunes a viernes'], ['weekly', 'Cada semana'], ['monthly', 'Cada mes'], ['yearly', 'Cada año']];
  const SHORT = { daily: 'Cada día', weekdays: 'Laborables', weekly: 'Cada semana', monthly: 'Cada mes', yearly: 'Cada año' };
  const PRIOS = [[0, 'Normal'], [1, 'Baja'], [2, 'Media'], [3, 'Alta']];

  const css = document.createElement('style');
  css.textContent = `
    .task.prio-1{box-shadow:var(--shadow),inset 3px 0 0 var(--sky-ink);} .task.prio-2{box-shadow:var(--shadow),inset 3px 0 0 var(--peach-ink);} .task.prio-3{box-shadow:var(--shadow),inset 3px 0 0 var(--rose-ink);}
    .tp-sheet{max-width:520px !important;}
    .tp-f{display:flex;flex-direction:column;gap:6px;} .tp-f > label{font-size:12.5px;font-weight:600;color:var(--ink-soft);}
    .tp-f input,.tp-f select,.tp-f textarea{padding:11px 13px;border:1.5px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink);font:inherit;font-size:16px;min-width:0;}
    .tp-f textarea{resize:vertical;min-height:64px;line-height:1.45;}
    .tp-title{font-size:18px !important;font-weight:600;}
    .tp-two{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
    .tp-seg{display:flex;background:var(--bg);border-radius:12px;padding:3px;gap:2px;}
    .tp-seg button{flex:1;border:none;background:none;font:inherit;font-size:13px;font-weight:600;color:var(--ink-soft);padding:9px 4px;border-radius:9px;cursor:pointer;}
    .tp-seg button.on{background:var(--card);color:var(--ink);box-shadow:var(--shadow);}
    .tp-seg button.on.p1{color:var(--sky-ink);} .tp-seg button.on.p2{color:var(--peach-ink);} .tp-seg button.on.p3{color:var(--rose-ink);}
    .tp-ck{display:flex;flex-direction:column;gap:6px;}
    .tp-ci{display:flex;align-items:center;gap:10px;background:var(--bg);border-radius:12px;padding:4px 6px 4px 12px;}
    .tp-ci input[type=checkbox]{appearance:none;width:20px;height:20px;border-radius:7px;border:2px solid var(--line);flex-shrink:0;cursor:pointer;padding:0;position:relative;background:var(--card);}
    .tp-ci input[type=checkbox]:checked{background:var(--mint-ink);border-color:var(--mint-ink);}
    .tp-ci input[type=checkbox]:checked::after{content:'';position:absolute;left:5px;top:1px;width:5px;height:10px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg);}
    .tp-ci input[type=text]{flex:1;min-width:0;border:none;background:transparent;color:var(--ink);font:inherit;font-size:15px;padding:9px 0;outline:none;}
    .tp-ci.done input[type=text]{color:var(--ink-soft);text-decoration:line-through;}
    .tp-x{border:none;background:none;color:var(--ink-soft);cursor:pointer;padding:8px;border-radius:9px;font-size:16px;line-height:1;} .tp-x:hover{color:var(--rose-ink);background:var(--rose);}
    .tp-add{display:flex;gap:8px;} .tp-add input{flex:1;}
    .tp-hint{font-size:12px;color:var(--ink-soft);line-height:1.45;}
    .tp-link{border:none;background:none;color:var(--primary);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;padding:0;align-self:flex-start;}
    .tp-del{border:1px solid var(--line);background:var(--card);color:var(--rose-ink);font:inherit;font-size:14px;font-weight:600;padding:0 16px;border-radius:14px;cursor:pointer;height:50px;}
  `;
  document.head.appendChild(css);

  let sheet = null, cur = null, work = null;

  const toLocal = iso => { if (!iso) return { d: '', t: '' }; const x = new Date(iso.replace(' ', 'T') + 'Z'); return { d: x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()), t: pad(x.getHours()) + ':' + pad(x.getMinutes()) }; };

  function build() {
    if (sheet) return;
    sheet = document.createElement('div');
    sheet.innerHTML = `<div class="modal-backdrop" id="tpBackdrop" style="z-index:140"></div>
      <div class="modal-sheet tp-sheet" id="tpSheet" style="z-index:141"><div class="modal-handle"></div>
        <div class="modal-header"><h3>Tarea</h3><button class="modal-close" id="tpClose" aria-label="Cerrar">${xSvg()}</button></div>
        <div class="modal-body" id="tpBody"></div>
        <div class="modal-footer" style="display:flex;gap:10px;"><button class="tp-del" id="tpDel" type="button">Eliminar</button><button class="fin-save" id="tpSave" type="button" style="flex:1;">Guardar</button></div></div>`;
    document.body.append(...sheet.children);
    $('tpBackdrop').onclick = $('tpClose').onclick = close;
  }
  function close() { $('tpBackdrop')?.classList.remove('open'); $('tpSheet')?.classList.remove('open'); }

  function open(id) {
    const t = tasks.find(x => String(x.id) === String(id)); if (!t) return;
    build(); cur = t;
    const l = toLocal(t.due_at);
    work = { text: t.text, description: t.description || '', category_id: t.category_id, date: l.d, time: l.t, priority: t.priority || 0, repeat: t.repeat_rule || '', checklist: (t.checklist || []).map(x => ({ ...x })) };
    paint();
    $('tpBackdrop').classList.add('open'); $('tpSheet').classList.add('open');
  }

  function paint() {
    const w = work;
    $('tpBody').innerHTML = `
      <div class="tp-f"><input class="tp-title" id="tpText" maxlength="255" value="${escapeHtml(w.text)}" aria-label="Título"></div>
      <div class="tp-f"><label for="tpDesc">Notas</label><textarea id="tpDesc" rows="2" placeholder="Detalles, enlaces…">${escapeHtml(w.description)}</textarea></div>
      <div class="tp-two"><div class="tp-f"><label for="tpDate">Fecha</label><input type="date" id="tpDate" value="${w.date}"></div>
        <div class="tp-f"><label for="tpTime">Hora</label><input type="time" id="tpTime" value="${w.time}"></div></div>
      ${w.date ? '<button class="tp-link" id="tpNoDate" type="button">Quitar fecha</button>' : ''}
      <div class="tp-f"><label>Prioridad</label><div class="tp-seg" id="tpPrio">${PRIOS.map(([v, l]) => `<button type="button" data-v="${v}" class="${w.priority === v ? 'on p' + v : ''}">${l}</button>`).join('')}</div></div>
      <div class="tp-f"><label for="tpRep">Repetir</label><select id="tpRep" ${w.date ? '' : 'disabled'}>${REPEATS.map(([v, l]) => `<option value="${v}" ${w.repeat === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="tp-hint">${w.date ? 'Al completarla se crea la siguiente, a la misma hora.' : 'Ponle una fecha para poder repetirla.'}</div></div>
      <div class="tp-f"><label for="tpCat">Categoría</label><select id="tpCat">${categories.map(c => `<option value="${c.id}" ${String(c.id) === String(w.category_id) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
      <div class="tp-f"><label>Subtareas ${w.checklist.length ? '(' + w.checklist.filter(x => x.d).length + '/' + w.checklist.length + ')' : ''}</label>
        <div class="tp-ck" id="tpCk"></div>
        <div class="tp-add"><input id="tpNew" maxlength="120" placeholder="Añadir subtarea…" enterkeyhint="done"><button class="adm-btn" id="tpAdd" type="button" style="border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:12px;padding:0 16px;font-weight:600;cursor:pointer;">Añadir</button></div></div>`;
    const ck = $('tpCk');
    w.checklist.forEach((it, i) => {
      const row = document.createElement('div'); row.className = 'tp-ci' + (it.d ? ' done' : '');
      row.innerHTML = `<input type="checkbox" ${it.d ? 'checked' : ''} aria-label="Hecha"><input type="text" maxlength="120" value="${escapeHtml(it.t)}"><button class="tp-x" type="button" aria-label="Quitar">✕</button>`;
      row.querySelector('[type=checkbox]').onchange = e => { it.d = e.target.checked; row.classList.toggle('done', it.d); };
      row.querySelector('[type=text]').oninput = e => { it.t = e.target.value; };
      row.querySelector('.tp-x').onclick = () => { sync(); w.checklist.splice(i, 1); paint(); };
      ck.appendChild(row);
    });
    const add = () => { const v = $('tpNew').value.trim(); if (!v || w.checklist.length >= 30) return; sync(); w.checklist.push({ t: v, d: false }); paint(); $('tpNew').focus(); };
    $('tpAdd').onclick = add;
    $('tpNew').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    $('tpPrio').querySelectorAll('button').forEach(b => { b.onclick = () => { sync(); w.priority = +b.dataset.v; paint(); }; });
    $('tpDate').onchange = () => { sync(); if (w.date && !w.time) w.time = '09:00'; if (!w.date) { w.time = ''; w.repeat = ''; } paint(); };
    if ($('tpNoDate')) $('tpNoDate').onclick = () => { sync(); w.date = ''; w.time = ''; w.repeat = ''; paint(); };
    $('tpSave').onclick = save;
    const del = $('tpDel'); del.textContent = 'Eliminar'; delete del.dataset.sure;
    del.onclick = async () => {
      if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = '¿Seguro?'; return; }
      try { await api('?resource=tasks&id=' + cur.id, { method: 'DELETE' }); tasks = tasks.filter(x => x.id !== cur.id); close(); refreshTaskViews(); showToast('Tarea eliminada.'); }
      catch (e) { showToast(e.message); }
    };
  }
  function sync() {                                         // vuelca lo escrito a "work" antes de repintar
    const w = work; if (!$('tpText')) return;
    w.text = $('tpText').value; w.description = $('tpDesc').value; w.date = $('tpDate').value; w.time = $('tpTime').value; w.repeat = $('tpRep').value; w.category_id = $('tpCat').value;
  }

  async function save() {
    sync(); const w = work, t = cur;
    if (!w.text.trim()) { showToast('La tarea necesita un título.'); $('tpText').focus(); return; }
    const payload = { text: w.text.trim(), description: w.description.trim(), priority: w.priority, checklist: w.checklist.filter(x => x.t.trim()), repeat_rule: w.date && w.repeat ? w.repeat : null };
    if (String(w.category_id) !== String(t.category_id)) payload.category_id = w.category_id;
    const before = toLocal(t.due_at);
    if (w.date !== before.d || (w.time || '') !== before.t) {
      payload.due_at = w.date ? new Date(w.date + 'T' + (w.time || '09:00')).toISOString() : null;
      payload.notified = [];                                // la fecha cambió: los avisos vuelven a valer
    }
    const btn = $('tpSave'); btn.disabled = true;
    try {
      const r = await api('?resource=tasks&id=' + t.id, { method: 'PATCH', body: JSON.stringify(payload) });
      if (r && r.task) Object.assign(t, r.task, { id: t.id });
      close(); refreshTaskViews();
    } catch (e) { showToast(e.message); }
    finally { btn.disabled = false; }
  }

  window.TasksPlus = { open, repeatLabel: r => SHORT[r] || r, REPEATS, PRIOS };
})();
