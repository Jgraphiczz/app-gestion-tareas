/* Panel de administración: usuarios, roles (qué módulos ve y usa cada rol) y mensajes de permisos.
   Define renderAdmin(); usa las globales de la app (api, me, escapeHtml, showToast, xSvg…) solo al ejecutarse. */
(function () {
  const $ = id => document.getElementById(id);
  const STATE_LABEL = { allow: 'Permitido', locked: 'Bloqueado', hidden: 'Oculto' };
  const STATE_HELP = { allow: 'Se ve y se puede usar', locked: 'Se ve con candado y muestra el mensaje de permisos', hidden: 'No aparece' };
  let tab = 'users', users = [], bundle = null, schemaError = '', search = '';

  const css = document.createElement('style');
  css.textContent = `
    .adm{max-width:980px;margin:0 auto;}
    .adm-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:16px;}
    .adm-head h2{font-size:clamp(22px,3vw,28px);} .adm-head p{margin:4px 0 0;color:var(--ink-soft);font-size:13.5px;}
    .adm-tabs{display:inline-flex;gap:4px;padding:4px;background:var(--card);border-radius:14px;box-shadow:var(--shadow);margin-bottom:18px;max-width:100%;overflow-x:auto;}
    .adm-tabs button{border:none;background:none;color:var(--ink-soft);font-size:13.5px;font-weight:600;padding:9px 16px;border-radius:10px;cursor:pointer;white-space:nowrap;}
    .adm-tabs button.on{background:var(--primary-soft);color:var(--primary);}
    .adm-banner{background:var(--butter);color:var(--butter-ink);border-radius:var(--radius-sm);padding:12px 14px;font-size:13.5px;line-height:1.5;margin-bottom:16px;}
    .adm-banner code{background:rgba(0,0,0,.07);padding:1px 6px;border-radius:5px;}
    .adm-stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;}
    .adm-stat{background:var(--card);box-shadow:var(--shadow);border-radius:14px;padding:10px 16px;min-width:104px;}
    .adm-stat b{display:block;font-size:22px;font-family:var(--font-mono);letter-spacing:-.03em;} .adm-stat span{font-size:12px;color:var(--ink-soft);}
    .adm-bar{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;}
    .adm-search{flex:1;min-width:180px;padding:11px 14px;border:1.5px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font:inherit;font-size:15px;}
    .adm-list{display:flex;flex-direction:column;gap:8px;}
    .adm-user{display:flex;align-items:center;gap:13px;background:var(--card);box-shadow:var(--shadow);border-radius:16px;padding:12px 14px;cursor:pointer;transition:transform .15s;}
    .adm-user:hover{transform:translateY(-1px);}
    .adm-user.off{opacity:.55;}
    .adm-av{width:40px;height:40px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff;flex-shrink:0;}
    .adm-main{flex:1;min-width:0;} .adm-name{font-weight:600;font-size:15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
    .adm-sub{font-size:12.5px;color:var(--ink-soft);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .adm-badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:8px;background:var(--primary-soft);color:var(--primary);white-space:nowrap;}
    .adm-badge.admin{background:var(--rose);color:var(--rose-ink);} .adm-badge.you{background:var(--mint);color:var(--mint-ink);} .adm-badge.off{background:var(--line);color:var(--ink-soft);} .adm-badge.def{background:var(--butter);color:var(--butter-ink);}
    .adm-chev{color:var(--ink-soft);flex-shrink:0;} .adm-chev svg{width:16px;height:16px;display:block;}
    .adm-roles{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px;}
    .adm-role{background:var(--card);box-shadow:var(--shadow);border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:10px;}
    .adm-role h3{font-size:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
    .adm-role p{margin:0;color:var(--ink-soft);font-size:13px;line-height:1.45;min-height:18px;}
    .adm-dots{display:flex;gap:5px;flex-wrap:wrap;} .adm-dots i{width:22px;height:8px;border-radius:4px;display:block;}
    .st-allow{background:var(--mint-ink);} .st-locked{background:var(--butter-ink);} .st-hidden{background:var(--line);}
    .adm-meta{font-size:12px;color:var(--ink-soft);}
    .adm-actions{display:flex;gap:8px;margin-top:auto;}
    .adm-btn{border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:13px;font-weight:600;padding:9px 14px;border-radius:11px;cursor:pointer;}
    .adm-btn:hover{border-color:color-mix(in srgb,var(--primary) 45%,var(--line));color:var(--primary);}
    .adm-btn.primary{background:var(--grad);color:#fff;border-color:transparent;} .adm-btn.primary:hover{color:#fff;filter:brightness(1.06);}
    .adm-btn.danger{color:var(--rose-ink);} .adm-btn.danger:hover{border-color:var(--rose-ink);color:var(--rose-ink);}
    .adm-btn:disabled{opacity:.5;cursor:default;}
    .adm-new{border:1.5px dashed var(--line);background:transparent;box-shadow:none;align-items:center;justify-content:center;color:var(--ink-soft);cursor:pointer;min-height:140px;font-weight:600;font-size:14px;}
    .adm-new:hover{border-color:var(--primary);color:var(--primary);}
    /* hoja de edición */
    .adm-sheet{max-width:540px !important;}
    .adm-field{display:flex;flex-direction:column;gap:6px;} .adm-field label{font-size:12.5px;font-weight:600;color:var(--ink-soft);}
    .adm-field input,.adm-field select,.adm-field textarea{padding:11px 13px;border:1.5px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink);font:inherit;font-size:16px;}
    .adm-field textarea{resize:vertical;min-height:70px;line-height:1.45;}
    .adm-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0;font-size:14px;font-weight:600;}
    .adm-switch input{appearance:none;width:44px;height:26px;border-radius:13px;background:var(--line);position:relative;cursor:pointer;transition:background .15s;flex-shrink:0;border:none;padding:0;}
    .adm-switch input::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 3px rgba(0,0,0,.3);}
    .adm-switch input:checked{background:var(--primary);} .adm-switch input:checked::after{transform:translateX(18px);}
    .adm-switch input:disabled{opacity:.5;cursor:default;}
    .adm-mx{display:flex;flex-direction:column;gap:8px;}
    .adm-mrow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);} .adm-mrow:last-child{border:none;}
    .adm-mrow span{font-size:14px;font-weight:600;min-width:0;}
    .adm-seg{display:inline-flex;background:var(--bg);border-radius:10px;padding:3px;gap:2px;flex-shrink:0;}
    .adm-seg button{border:none;background:none;font-size:12px;font-weight:600;color:var(--ink-soft);padding:6px 10px;border-radius:8px;cursor:pointer;}
    .adm-seg button.on.allow{background:var(--mint);color:var(--mint-ink);} .adm-seg button.on.locked{background:var(--butter);color:var(--butter-ink);} .adm-seg button.on.hidden{background:var(--line);color:var(--ink);}
    .adm-quick{display:flex;gap:6px;flex-wrap:wrap;} .adm-quick button{border:none;background:var(--primary-soft);color:var(--primary);font-size:12px;font-weight:600;padding:6px 11px;border-radius:9px;cursor:pointer;}
    .adm-legend{font-size:12px;color:var(--ink-soft);line-height:1.6;}
    .adm-msg-row{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;}
    .adm-preview{background:var(--card);box-shadow:var(--shadow);border-radius:18px;padding:22px;display:flex;gap:14px;align-items:flex-start;margin:6px 0 18px;}
    .adm-preview .lock-orb{width:46px;height:46px;border-radius:16px;flex-shrink:0;} .adm-preview .lock-orb .lockic{width:20px;height:20px;}
    .adm-preview b{display:block;margin-bottom:4px;} .adm-preview p{margin:0;font-size:14px;color:var(--ink-soft);line-height:1.5;}
    @media (max-width:640px){ .adm-mrow{flex-direction:column;align-items:flex-start;} .adm-seg{width:100%;} .adm-seg button{flex:1;} .adm-user .adm-badge.hide-sm{display:none;} }
  `;
  document.head.appendChild(css);

  const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const avatar = n => `<span class="adm-av" style="background:linear-gradient(135deg,hsl(${hue(n)} 70% 58%),hsl(${(hue(n) + 40) % 360} 70% 48%))">${escapeHtml((n || '?').slice(0, 2).toUpperCase())}</span>`;
  const chev = '<span class="adm-chev"><svg viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  const modules = () => (bundle && bundle.modules) || { tareas: 'Tareas', calendario: 'Calendario', chat: 'Chat', notas: 'Notas', diagramas: 'Diagramas', gastos: 'Gastos', estadisticas: 'Estadísticas', tiempo: 'Tiempo', grupo: 'Grupos', asistente: 'Asistente ✨' };
  const roles = () => (bundle && bundle.roles) || [];

  /* ---------- hoja modal reutilizable ---------- */
  let sheet = null;
  function openSheet(title, bodyHtml, footerHtml) {
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.innerHTML = `<div class="modal-backdrop" id="admBackdrop" style="z-index:140"></div>
        <div class="modal-sheet adm-sheet" id="admSheet" style="z-index:141"><div class="modal-handle"></div>
          <div class="modal-header"><h3 id="admTitle"></h3><button class="modal-close" id="admClose">${xSvg()}</button></div>
          <div class="modal-body" id="admBody"></div><div class="modal-footer" id="admFoot" style="display:flex;gap:8px;"></div></div>`;
      document.body.append(...sheet.children);
      $('admBackdrop').onclick = $('admClose').onclick = closeSheet;
    }
    $('admTitle').textContent = title; $('admBody').innerHTML = bodyHtml; $('admFoot').innerHTML = footerHtml || '';
    $('admFoot').style.display = footerHtml ? 'flex' : 'none';
    $('admBackdrop').classList.add('open'); $('admSheet').classList.add('open');
  }
  function closeSheet() { $('admBackdrop')?.classList.remove('open'); $('admSheet')?.classList.remove('open'); }

  /* ---------- carga y esqueleto ---------- */
  window.renderAdmin = async function () {
    const el = $('adminMain'); if (!el) return;
    el.innerHTML = `<div class="adm"><div class="adm-head"><div><h2>Administración</h2><p>Usuarios, roles y qué módulos puede usar cada uno.</p></div></div>
      <div class="adm-tabs" id="admTabs"></div><div id="admBanner"></div><div id="admContent"><div class="empty">Cargando…</div></div></div>`;
    await load();
    paint();
  };
  async function load() {
    schemaError = '';
    try { users = await api('?resource=users'); } catch (e) { $('admContent').innerHTML = `<div class="empty">No se pudo cargar: ${escapeHtml(e.message)}</div>`; users = []; }
    try { bundle = await api('?resource=roles'); }
    catch (e) { bundle = null; schemaError = e.data && e.data.schema_ok === false ? e.message : (e.message || 'Error'); }
  }
  function paint() {
    $('admTabs').innerHTML = [['users', 'Usuarios'], ['roles', 'Roles y permisos'], ['messages', 'Mensajes']]
      .map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('');
    $('admTabs').querySelectorAll('button').forEach(b => { b.onclick = () => { tab = b.dataset.t; paint(); }; });
    $('admBanner').innerHTML = schemaError ? `<div class="adm-banner"><b>Los roles aún no están disponibles.</b> ${escapeHtml(schemaError)} Si el error continúa, ejecuta el archivo <code>schema.sql</code> en la base de datos (phpMyAdmin) y recarga esta página.</div>` : '';
    if (tab === 'users') paintUsers(); else if (tab === 'roles') paintRoles(); else paintMessages();
  }

  /* ---------- usuarios ---------- */
  function roleLabel(u) { return u.role === 'admin' ? 'Administrador' : (u.role_name || 'Usuario'); }
  function paintUsers() {
    const c = $('admContent');
    const admins = users.filter(u => u.role === 'admin').length, off = users.filter(u => !+u.active).length;
    c.innerHTML = `<div class="adm-stats"><div class="adm-stat"><b>${users.length}</b><span>Usuarios</span></div><div class="adm-stat"><b>${admins}</b><span>Administradores</span></div><div class="adm-stat"><b>${off}</b><span>Desactivados</span></div></div>
      <div class="adm-bar"><input class="adm-search" id="admSearch" placeholder="Buscar usuario…" value="${escapeHtml(search)}"><button class="adm-btn primary" id="admNewUser">+ Nuevo usuario</button></div>
      <div class="adm-list" id="admUsers"></div>`;
    const list = $('admUsers');
    const draw = () => {
      const q = search.trim().toLowerCase();
      const rows = users.filter(u => !q || u.username.toLowerCase().includes(q) || roleLabel(u).toLowerCase().includes(q));
      list.innerHTML = rows.length ? '' : '<div class="empty">Sin resultados.</div>';
      rows.forEach(u => {
        const d = document.createElement('div'); d.className = 'adm-user' + (+u.active ? '' : ' off');
        d.innerHTML = `${avatar(u.username)}<div class="adm-main"><div class="adm-name">${escapeHtml(u.username)}${u.id == me.id ? '<span class="adm-badge you">Tú</span>' : ''}${+u.active ? '' : '<span class="adm-badge off">Desactivado</span>'}</div>
          <div class="adm-sub">${u.group_id ? 'Grupo ' + escapeHtml(String(u.group_id)) + ' · ' : ''}Alta: ${escapeHtml(String(u.created_at || '').slice(0, 10))}</div></div>
          <span class="adm-badge ${u.role === 'admin' ? 'admin' : ''}">${escapeHtml(roleLabel(u))}</span>${chev}`;
        d.onclick = () => editUser(u);
        list.appendChild(d);
      });
    };
    draw();
    $('admSearch').oninput = e => { search = e.target.value; draw(); };
    $('admNewUser').onclick = newUser;
  }

  const roleOptions = (selected) => `<option value="admin" ${selected === 'admin' ? 'selected' : ''}>Administrador (acceso total)</option>` +
    roles().map(r => `<option value="${r.id}" ${String(selected) === String(r.id) ? 'selected' : ''}>${escapeHtml(r.name)}${r.is_default ? ' (por defecto)' : ''}</option>`).join('');

  function editUser(u) {
    const self = u.id == me.id;
    const sel = u.role === 'admin' ? 'admin' : (u.role_id || (roles().find(r => r.is_default) || {}).id || '');
    openSheet(u.username, `
      <div class="adm-field"><label>Rol</label><select id="auRole" ${self ? 'disabled' : ''}>${roleOptions(sel)}</select>${self ? '<div class="adm-legend">No puedes cambiar tu propio rol.</div>' : ''}</div>
      <div class="adm-field"><label>ID de grupo (opcional)</label><input type="number" id="auGroup" value="${u.group_id ?? ''}" placeholder="Sin grupo"></div>
      <label class="adm-switch"><span>Cuenta activa</span><input type="checkbox" id="auActive" ${+u.active ? 'checked' : ''} ${self ? 'disabled' : ''}></label>
      <div class="adm-field"><label>Nueva contraseña (déjalo vacío para no cambiarla)</label><input type="password" id="auPwd" autocomplete="new-password" placeholder="Mínimo 6 caracteres"></div>
      <div class="adm-legend">El administrador gestiona cuentas y permisos, pero no ve las tareas, gastos ni notas de nadie.</div>`,
      `${self ? '' : '<button class="adm-btn danger" id="auDel">Eliminar</button>'}<button class="adm-btn primary" id="auSave" style="flex:1;">Guardar</button>`);
    $('auSave').onclick = async () => {
      const v = $('auRole').value, payload = { group_id: $('auGroup').value || null };
      if (!self) {
        payload.active = $('auActive').checked ? 1 : 0;
        if (v === 'admin') { payload.role = 'admin'; payload.role_id = null; } else { payload.role = 'user'; payload.role_id = Number(v) || null; }
      }
      const pw = $('auPwd').value;
      if (pw) { if (pw.length < 6) { showToast('La contraseña debe tener al menos 6 caracteres.'); return; } payload.new_password = pw; }
      try { await api('?resource=users&id=' + u.id, { method: 'PATCH', body: JSON.stringify(payload) }); closeSheet(); showToast('Usuario actualizado.'); await load(); paint(); }
      catch (e) { showToast(e.message); }
    };
    if ($('auDel')) $('auDel').onclick = () => {
      const b = $('auDel');
      if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Pulsa otra vez para confirmar'; return; }
      api('?resource=users&id=' + u.id, { method: 'DELETE' }).then(async () => { closeSheet(); showToast('Usuario eliminado.'); await load(); paint(); }).catch(e => showToast(e.message));
    };
  }
  function newUser() {
    const def = (roles().find(r => r.is_default) || {}).id || 'admin';
    openSheet('Nuevo usuario', `
      <div class="adm-field"><label>Nombre de usuario</label><input id="nuName" autocomplete="off" placeholder="Mínimo 3 caracteres"></div>
      <div class="adm-field"><label>Contraseña</label><input type="password" id="nuPwd" autocomplete="new-password" placeholder="Mínimo 6 caracteres"></div>
      <div class="adm-field"><label>Rol</label><select id="nuRole">${roleOptions(def)}</select></div>`,
      '<button class="adm-btn primary" id="nuSave" style="flex:1;">Crear usuario</button>');
    $('nuSave').onclick = async () => {
      const v = $('nuRole').value, name = $('nuName').value.trim(), pwd = $('nuPwd').value;
      if (name.length < 3 || pwd.length < 6) { showToast('Usuario de 3+ letras y contraseña de 6+ caracteres.'); return; }
      const payload = { username: name, password: pwd, role: v === 'admin' ? 'admin' : 'user' };
      if (v !== 'admin') payload.role_id = Number(v) || null;
      try { await api('?resource=users', { method: 'POST', body: JSON.stringify(payload) }); closeSheet(); showToast('Usuario creado.'); await load(); paint(); }
      catch (e) { showToast(e.message.includes('Duplicate') ? 'Ese nombre de usuario ya existe.' : e.message); }
    };
  }

  /* ---------- roles ---------- */
  function paintRoles() {
    const c = $('admContent');
    if (!bundle) { c.innerHTML = '<div class="empty">Los roles no están disponibles todavía.</div>'; return; }
    const mods = modules();
    const dots = m => Object.keys(mods).map(k => `<i class="st-${m[k]}" title="${escapeHtml(mods[k])}: ${STATE_LABEL[m[k]]}"></i>`).join('');
    const sum = m => { const n = s => Object.keys(mods).filter(k => m[k] === s).length; return `${n('allow')} permitidos · ${n('locked')} bloqueados · ${n('hidden')} ocultos`; };
    c.innerHTML = `<div class="adm-roles" id="admRoles"></div>
      <p class="adm-legend" style="margin-top:14px;"><b>Permitido</b>: se ve y se usa · <b>Bloqueado</b>: se ve con candado y muestra tu mensaje · <b>Oculto</b>: no aparece. Los administradores siempre tienen todo.</p>`;
    const grid = $('admRoles');
    const adm = document.createElement('div'); adm.className = 'adm-role';
    adm.innerHTML = `<h3>Administrador <span class="adm-badge admin">Sistema</span></h3><p>Acceso total a todos los módulos, usuarios y roles. No se puede editar.</p>
      <div class="adm-dots">${Object.keys(mods).map(() => '<i class="st-allow"></i>').join('')}</div><div class="adm-meta">${users.filter(u => u.role === 'admin').length} usuario(s)</div>`;
    grid.appendChild(adm);
    roles().forEach(r => {
      const d = document.createElement('div'); d.className = 'adm-role';
      d.innerHTML = `<h3>${escapeHtml(r.name)}${r.is_default ? '<span class="adm-badge def">Por defecto</span>' : ''}</h3><p>${escapeHtml(r.description || 'Sin descripción')}</p>
        <div class="adm-dots">${dots(r.modules)}</div><div class="adm-meta">${sum(r.modules)} · ${r.users} usuario(s)</div>
        <div class="adm-actions"><button class="adm-btn" data-e>Editar permisos</button></div>`;
      d.querySelector('[data-e]').onclick = () => editRole(r);
      grid.appendChild(d);
    });
    const n = document.createElement('div'); n.className = 'adm-role adm-new'; n.textContent = '+ Nuevo rol';
    n.onclick = () => editRole(null);
    grid.appendChild(n);
  }

  function editRole(r) {
    const mods = modules();
    const state = {}; Object.keys(mods).forEach(k => { state[k] = r ? r.modules[k] : (k === 'chat' ? 'hidden' : 'allow'); });
    openSheet(r ? 'Editar rol' : 'Nuevo rol', `
      <div class="adm-field"><label>Nombre</label><input id="erName" maxlength="60" value="${escapeHtml(r ? r.name : '')}" placeholder="Por ejemplo: Familia, Invitado…"></div>
      <div class="adm-field"><label>Descripción (opcional)</label><input id="erDesc" maxlength="200" value="${escapeHtml(r ? r.description : '')}" placeholder="Para qué sirve este rol"></div>
      <label class="adm-switch"><span>Rol por defecto (se asigna a los usuarios sin rol)</span><input type="checkbox" id="erDef" ${r && r.is_default ? 'checked disabled' : ''}></label>
      <div class="adm-quick"><button data-all="allow">Permitir todo</button><button data-all="locked">Bloquear todo</button><button data-all="hidden">Ocultar todo</button></div>
      <div class="adm-mx" id="erMx"></div><div class="adm-legend">${Object.keys(STATE_HELP).map(k => `<b>${STATE_LABEL[k]}</b>: ${STATE_HELP[k]}`).join('<br>')}</div>`,
      `${r && !r.is_default ? '<button class="adm-btn danger" id="erDel">Borrar</button>' : ''}<button class="adm-btn primary" id="erSave" style="flex:1;">${r ? 'Guardar cambios' : 'Crear rol'}</button>`);
    const mx = $('erMx');
    const drawMx = () => {
      mx.innerHTML = '';
      Object.keys(mods).forEach(k => {
        const row = document.createElement('div'); row.className = 'adm-mrow';
        row.innerHTML = `<span>${escapeHtml(mods[k])}</span><div class="adm-seg">${['allow', 'locked', 'hidden'].map(s => `<button type="button" data-s="${s}" class="${state[k] === s ? 'on ' + s : ''}">${STATE_LABEL[s]}</button>`).join('')}</div>`;
        row.querySelectorAll('button').forEach(b => { b.onclick = () => { state[k] = b.dataset.s; drawMx(); }; });
        mx.appendChild(row);
      });
    };
    drawMx();
    $('admBody').querySelectorAll('[data-all]').forEach(b => { b.onclick = () => { Object.keys(state).forEach(k => { state[k] = b.dataset.all; }); drawMx(); }; });
    $('erSave').onclick = async () => {
      const name = $('erName').value.trim();
      if (name.length < 2) { showToast('Ponle un nombre al rol.'); return; }
      const payload = { name, description: $('erDesc').value.trim(), modules: state };
      if ($('erDef').checked && !(r && r.is_default)) payload.is_default = true;
      try {
        await api('?resource=roles' + (r ? '&id=' + r.id : ''), { method: r ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
        closeSheet(); showToast(r ? 'Rol actualizado.' : 'Rol creado.'); await load(); paint();
      } catch (e) { showToast(e.message); }
    };
    if ($('erDel')) $('erDel').onclick = () => {
      const b = $('erDel');
      if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = r.users ? `Pulsa otra vez (${r.users} usuario/s pasan al rol por defecto)` : 'Pulsa otra vez para confirmar'; return; }
      api('?resource=roles&id=' + r.id, { method: 'DELETE' }).then(async () => { closeSheet(); showToast('Rol borrado.'); await load(); paint(); }).catch(e => showToast(e.message));
    };
  }

  /* ---------- mensajes de permisos ---------- */
  function paintMessages() {
    const c = $('admContent');
    if (!bundle) { c.innerHTML = '<div class="empty">Los mensajes no están disponibles todavía.</div>'; return; }
    const mods = modules(), msgs = bundle.messages || {}, def = bundle.default_message;
    c.innerHTML = `<p class="adm-legend" style="margin-bottom:14px;">Este texto lo ve quien abre un módulo <b>bloqueado</b> o intenta usar algo sin permiso. Puedes poner uno general y otros específicos por módulo.</p>
      <div class="adm-preview"><div class="lock-orb">${lockIcon()}</div><div><b id="prT">Módulo no disponible</b><p id="prP"></p></div></div>
      <div class="adm-msg-row"><label class="adm-legend"><b>Mensaje general</b></label><textarea class="adm-search" id="msgDefault" maxlength="300" rows="2" style="resize:vertical;">${escapeHtml(msgs._default && msgs._default !== def ? msgs._default : '')}</textarea></div>
      ${Object.keys(mods).map(k => `<div class="adm-msg-row"><label class="adm-legend"><b>${escapeHtml(mods[k])}</b></label><input class="adm-search" data-k="${k}" maxlength="300" placeholder="Usa el mensaje general" value="${escapeHtml(msgs[k] || '')}"></div>`).join('')}
      <button class="adm-btn primary" id="msgSave">Guardar mensajes</button>`;
    const preview = () => { $('prP').textContent = $('msgDefault').value.trim() || def; };
    preview(); $('msgDefault').oninput = preview;
    $('msgSave').onclick = async () => {
      const messages = { _default: $('msgDefault').value.trim() };
      c.querySelectorAll('[data-k]').forEach(i => { if (i.value.trim()) messages[i.dataset.k] = i.value.trim(); });
      try { const r = await api('?resource=app_settings', { method: 'PATCH', body: JSON.stringify({ messages }) }); bundle.messages = r.messages; showToast('Mensajes guardados.'); }
      catch (e) { showToast(e.message); }
    };
  }
})();
