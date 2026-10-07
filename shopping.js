/* Lista de la compra: personal y compartida con cada grupo (los miembros ven los cambios casi al momento).
   Añadir con Enter o con las sugerencias (lo que más compras), marcar al comprar, limpiar lo comprado.
   Expone window.Shopping para "Hoy" y la captura. Usa las globales de la app (api, me, escapeHtml…) solo al ejecutarse. */
(function () {
  const $ = id => document.getElementById(id);
  let data = { items: [], groups: [], suggestions: {} }, loadedAt = 0, scope = '0', timer = 0, inflight = null;

  const css = document.createElement('style');
  css.textContent = `
    .sp{max-width:720px;margin:0 auto;padding:22px 18px 40px;display:flex;flex-direction:column;gap:14px;}
    .sp-head h2{font-size:clamp(22px,3.2vw,28px);} .sp-head p{margin:4px 0 0;color:var(--ink-soft);font-size:13.5px;}
    .sp-scopes{display:flex;gap:8px;overflow-x:auto;padding:2px 0;} .sp-scopes::-webkit-scrollbar{display:none;}
    .sp-sc{flex-shrink:0;border:1px solid var(--line);background:var(--card);color:var(--ink-soft);font:inherit;font-size:13.5px;font-weight:600;padding:9px 14px;border-radius:13px;cursor:pointer;display:flex;gap:8px;align-items:center;}
    .sp-sc.on{background:var(--grad);color:#fff;border-color:transparent;box-shadow:var(--glow);} .sp-sc i{font-style:normal;font-size:11.5px;font-weight:700;background:rgba(127,127,127,.18);border-radius:8px;padding:1px 7px;} .sp-sc.on i{background:rgba(255,255,255,.25);}
    .sp-add{display:flex;gap:8px;background:var(--card);box-shadow:var(--shadow);border-radius:18px;padding:6px 6px 6px 16px;align-items:center;}
    .sp-add:focus-within{box-shadow:0 0 0 1.5px var(--primary),0 0 0 5px color-mix(in srgb,var(--primary) 14%,transparent);}
    .sp-add input{flex:1;min-width:0;border:none;background:transparent;color:var(--ink);font:inherit;font-size:16px;padding:11px 0;outline:none;}
    .sp-add button{border:none;background:var(--grad);color:#fff;width:44px;height:44px;border-radius:14px;font-size:22px;line-height:1;cursor:pointer;flex-shrink:0;}
    .sp-sug{display:flex;gap:7px;flex-wrap:wrap;} .sp-sug button{border:1px dashed color-mix(in srgb,var(--primary) 45%,var(--line));background:transparent;color:var(--primary);font:inherit;font-size:13px;font-weight:600;padding:7px 12px;border-radius:11px;cursor:pointer;}
    .sp-sug button:hover{background:var(--primary-soft);} .sp-sugl{font-size:12px;color:var(--ink-soft);width:100%;}
    .sp-card{background:var(--card);box-shadow:var(--shadow);border-radius:20px;padding:6px 14px;}
    .sp-it{display:flex;align-items:center;gap:13px;padding:12px 0;border-top:1px solid var(--line);animation:spIn .25s ease;} .sp-it:first-child{border-top:none;}
    @keyframes spIn{from{opacity:0;transform:translateY(-4px);}}
    .sp-ck{width:30px;height:30px;border-radius:10px;border:2px solid var(--line);background:none;flex-shrink:0;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;color:#fff;transition:background .15s,border-color .15s,transform .15s;}
    .sp-ck:hover{border-color:var(--mint-ink);} .sp-ck svg{width:14px;height:14px;display:none;} .sp-it.done .sp-ck{background:var(--mint-ink);border-color:var(--mint-ink);} .sp-it.done .sp-ck svg{display:block;}
    .sp-nm{flex:1;min-width:0;word-break:break-word;font-size:16px;} .sp-nm small{display:block;color:var(--ink-soft);font-size:12px;margin-top:2px;}
    .sp-qty{background:var(--primary-soft);color:var(--primary);font-size:12px;font-weight:700;border-radius:8px;padding:2px 8px;margin-left:6px;white-space:nowrap;}
    .sp-it.done .sp-nm{color:var(--ink-soft);text-decoration:line-through;}
    .sp-x{border:none;background:none;color:var(--ink-soft);cursor:pointer;padding:9px 12px;border-radius:9px;font-size:15px;opacity:.55;} .sp-x:hover{opacity:1;color:var(--rose-ink);background:var(--rose);}
    .sp-sech{display:flex;justify-content:space-between;align-items:center;padding:14px 4px 4px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-soft);}
    .sp-clear{border:none;background:none;color:var(--primary);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;text-transform:none;letter-spacing:0;}
    .sp-empty{text-align:center;color:var(--ink-soft);padding:34px 16px;line-height:1.6;font-size:14.5px;} .sp-empty b{display:block;color:var(--ink);font-size:17px;margin-bottom:4px;}
    .sp-live{font-size:11.5px;color:var(--ink-soft);display:flex;align-items:center;gap:6px;justify-content:center;} .sp-live i{width:7px;height:7px;border-radius:50%;background:var(--mint-ink);animation:capPulse 2s ease-in-out infinite;}
  `;
  document.head.appendChild(css);
  const check = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.2 11.5L13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  async function load(force) {
    if (!force && Date.now() - loadedAt < 4000 && data) return data;
    if (inflight) return inflight;
    inflight = api('?resource=shopping').then(d => { data = d; loadedAt = Date.now(); return d; }).finally(() => { inflight = null; });
    return inflight;
  }
  const gidOf = s => (s === '0' ? null : Number(s));
  const inScope = it => (it.group_id === null ? '0' : String(it.group_id)) === scope;
  async function toggle(it) {
    const prev = it.done; it.done = !prev;
    try { const r = await api('?resource=shopping&id=' + it.id, { method: 'PATCH', body: JSON.stringify({ done: it.done }) }); Object.assign(it, r); }
    catch (e) { it.done = prev; throw e; }
  }
  /** "2 leche", "1,5 kg manzanas" → { name, qty } */
  function parseItem(txt) {
    const t = txt.trim().replace(/\s+/g, ' ');
    const m = /^(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|ud|uds|x|botellas?|paquetes?|latas?|cajas?|bolsas?)?\s+(?:de\s+)?(.+)$/i.exec(t);
    return m ? { name: m[3], qty: (m[1] + (m[2] ? ' ' + m[2].toLowerCase() : '')).trim() } : { name: t, qty: null };
  }
  /** Añade uno o varios (separados por comas) a la lista indicada. Devuelve los creados. */
  async function add(texts, groupId) {
    const names = texts.map(parseItem).filter(x => x.name);
    if (!names.length) return [];
    const r = await api('?resource=shopping', { method: 'POST', body: JSON.stringify({ names, group_id: groupId }) });
    r.items.forEach(n => { if (!data.items.some(x => x.id === n.id)) data.items.unshift(n); });
    loadedAt = 0;
    return r.items;
  }

  function paint() {
    const el = $('compraMain'); if (!el) return;
    if (scope !== '0' && !data.groups.some(g => String(g.id) === scope)) scope = '0';
    const mine = data.items.filter(inScope), pending = mine.filter(i => !i.done), done = mine.filter(i => i.done);
    const count = s => data.items.filter(i => !i.done && (i.group_id === null ? '0' : String(i.group_id)) === s).length;
    const pendNames = new Set(pending.map(i => i.name.toLowerCase()));
    const sugg = (data.suggestions[scope] || []).filter(n => !pendNames.has(n.toLowerCase())).slice(0, 8);
    const grp = scope === '0' ? null : data.groups.find(g => String(g.id) === scope);
    el.innerHTML = `<div class="sp">
      <div class="sp-head"><h2>Lista de la compra</h2><p>${grp ? `Compartida con el grupo «${escapeHtml(grp.name)}». Todos ven los cambios.` : 'Tu lista personal. Compártela creando o uniéndote a un grupo.'}</p></div>
      ${data.groups.length ? `<div class="sp-scopes"><button class="sp-sc ${scope === '0' ? 'on' : ''}" data-s="0">Personal <i>${count('0')}</i></button>${data.groups.map(g => `<button class="sp-sc ${String(g.id) === scope ? 'on' : ''}" data-s="${g.id}">${escapeHtml(g.name)} <i>${count(String(g.id))}</i></button>`).join('')}</div>` : ''}
      <form class="sp-add" id="spForm" autocomplete="off"><input id="spInput" placeholder="Añade algo… (leche, 2 huevos)" enterkeyhint="done" aria-label="Producto"><button type="submit" aria-label="Añadir">+</button></form>
      ${sugg.length ? `<div class="sp-sug"><span class="sp-sugl">Lo que sueles comprar</span>${sugg.map(n => `<button type="button" data-n="${escapeHtml(n)}">+ ${escapeHtml(n)}</button>`).join('')}</div>` : ''}
      <div id="spList"></div>
      ${data.groups.length ? '<div class="sp-live"><i></i>En directo: se actualiza sola</div>' : ''}</div>`;
    el.querySelectorAll('.sp-sc').forEach(b => { b.onclick = () => { scope = b.dataset.s; paint(); }; });
    const input = $('spInput');
    $('spForm').onsubmit = async e => {
      e.preventDefault();
      const parts = input.value.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean); if (!parts.length) return;
      input.value = '';
      try { await add(parts, gidOf(scope)); paint(); $('spInput')?.focus(); if (window.MobileX) MobileX.haptic(8); } catch (err) { showToast(err.message); input.value = parts.join(', '); }
    };
    el.querySelectorAll('.sp-sug button').forEach(b => { b.onclick = async () => { try { await add([b.dataset.n], gidOf(scope)); paint(); } catch (err) { showToast(err.message); } }; });

    const list = $('spList');
    if (!mine.length) { list.innerHTML = '<div class="sp-card"><div class="sp-empty"><b>Lista vacía</b>Escribe arriba lo que necesitas o toca una sugerencia.</div></div>'; return; }
    const row = it => {
      const d = document.createElement('div'); d.className = 'sp-it' + (it.done ? ' done' : '');
      const who = grp ? (it.done && it.done_by ? 'Comprado por ' + it.done_by : 'Añadido por ' + it.added_by) : '';
      d.innerHTML = `<button class="sp-ck" aria-label="Marcar comprado">${check}</button><div class="sp-nm">${escapeHtml(it.name)}${it.qty ? `<span class="sp-qty">${escapeHtml(it.qty)}</span>` : ''}${who ? `<small>${escapeHtml(who)}</small>` : ''}</div><button class="sp-x" aria-label="Quitar">✕</button>`;
      d.querySelector('.sp-ck').onclick = async () => { try { await toggle(it); if (window.MobileX) MobileX.haptic(it.done ? 14 : 6); paint(); } catch (e) { showToast(e.message); paint(); } };
      d.querySelector('.sp-x').onclick = async () => { try { await api('?resource=shopping&id=' + it.id, { method: 'DELETE' }); data.items = data.items.filter(x => x.id !== it.id); paint(); } catch (e) { showToast(e.message); } };
      return d;
    };
    if (pending.length) { const c = document.createElement('div'); c.className = 'sp-card'; pending.forEach(i => c.appendChild(row(i))); list.appendChild(c); }
    else { list.innerHTML = '<div class="sp-card"><div class="sp-empty"><b>¡Todo comprado! 🛒</b>No queda nada pendiente.</div></div>'; }
    if (done.length) {
      const h = document.createElement('div'); h.className = 'sp-sech'; h.innerHTML = `<span>Comprado (${done.length})</span><button class="sp-clear">Limpiar</button>`;
      h.querySelector('button').onclick = async () => { try { await api('?resource=shopping&action=clear', { method: 'POST', body: JSON.stringify({ group_id: gidOf(scope) }) }); data.items = data.items.filter(i => !(i.done && inScope(i))); loadedAt = 0; paint(); load(true).then(() => currentSection === 'compra' && paint()); } catch (e) { showToast(e.message); } };
      list.appendChild(h);
      const c = document.createElement('div'); c.className = 'sp-card'; done.forEach(i => c.appendChild(row(i))); list.appendChild(c);
    }
  }

  window.renderCompra = function () {
    clearInterval(timer);
    const el = $('compraMain'); if (!el) return;
    if (!el.firstChild) el.innerHTML = '<div class="sp"><div class="sp-empty">Cargando…</div></div>';
    load(true).then(() => { if (currentSection === 'compra' && !(document.activeElement && document.activeElement.id === 'spInput' && document.activeElement.value)) paint(); })
      .catch(e => { el.innerHTML = `<div class="sp"><div class="sp-empty"><b>No se pudo cargar</b>${escapeHtml(e.message)}</div></div>`; });
    timer = setInterval(async () => {                                   // sincronización con el resto del grupo
      if (currentSection !== 'compra' || document.hidden) return;
      const input = $('spInput'); if (input && document.activeElement === input && input.value) return;     // no pisar lo que se está escribiendo
      try { const before = JSON.stringify(data.items); await load(true); if (JSON.stringify(data.items) !== before) paint(); } catch (e) {}
    }, 8000);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && currentSection === 'compra') load(true).then(paint).catch(() => {}); });

  window.Shopping = { load, toggle, add, parseItem, get scopeGroups() { return data.groups; } };
})();
