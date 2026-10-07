/* Presupuestos mensuales por categoría (y uno total). Pestaña "Presupuestos" dentro de Gastos.
   Expone window.Budgets para que "Hoy" y la captura puedan calcular el estado. Usa las globales de la app. */
(function () {
  const $ = id => document.getElementById(id);
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const css = document.createElement('style');
  css.textContent = `
    .bd-intro{color:var(--ink-soft);font-size:14px;line-height:1.55;margin:0 0 16px;}
    .bd-card{background:var(--card);box-shadow:var(--shadow);border-radius:20px;padding:18px 20px;margin-bottom:12px;}
    .bd-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;}
    .bd-name{font-weight:600;font-size:15px;display:flex;align-items:center;gap:8px;min-width:0;}
    .bd-name .dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
    .bd-big{font-family:var(--font-mono);font-weight:650;font-size:22px;letter-spacing:-.04em;}
    .bd-big small{font-size:13px;font-weight:500;color:var(--ink-soft);letter-spacing:0;}
    .bd-bar{height:10px;background:var(--bg);border-radius:6px;overflow:hidden;margin:12px 0 8px;}
    .bd-bar i{display:block;height:100%;border-radius:6px;background:var(--mint-ink);transition:width .5s cubic-bezier(.2,.8,.2,1);}
    .bd-bar.warn i{background:var(--butter-ink);} .bd-bar.over i{background:var(--rose-ink);}
    .bd-meta{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;color:var(--ink-soft);flex-wrap:wrap;align-items:center;}
    .bd-meta b{color:var(--ink);} .bd-meta .over{color:var(--rose-ink);font-weight:600;} .bd-meta .warn{color:var(--butter-ink);font-weight:600;}
    .bd-btn{border:1px solid var(--line);background:var(--card);color:var(--ink-soft);font:inherit;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:10px;cursor:pointer;}
    .bd-btn:hover{color:var(--primary);border-color:color-mix(in srgb,var(--primary) 45%,var(--line));}
    .bd-edit{display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap;}
    .bd-edit label{display:flex;align-items:center;background:var(--bg);border:1.5px solid var(--line);border-radius:12px;overflow:hidden;}
    .bd-edit input{border:none;background:transparent;color:var(--ink);font:inherit;font-family:var(--font-mono);font-weight:600;font-size:16px;padding:10px 4px 10px 12px;width:120px;outline:none;}
    .bd-edit .suf{padding-right:12px;color:var(--ink-soft);font-weight:600;}
    .bd-save{border:none;background:var(--grad);color:#fff;font:inherit;font-weight:600;font-size:14px;padding:10px 18px;border-radius:12px;cursor:pointer;}
    .bd-empty{border:1.5px dashed var(--line);border-radius:18px;padding:26px 18px;text-align:center;color:var(--ink-soft);font-size:14px;}
  `;
  document.head.appendChild(css);

  const monthKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const eur = n => (typeof money === 'function' ? money(n) : n.toFixed(2) + ' €');

  /** Gastado este mes: por categoría (id) o total (0). Solo cuenta lo que pagó el propio usuario. */
  function spent(catId, d) {
    const k = monthKey(d);
    return movements.filter(m => m.type === 'gasto' && String(m.date).startsWith(k) && (!m.group_id || String(m.paid_by) === String(me.id)) && (catId === 0 || String(m.category_id) === String(catId)))
      .reduce((s, m) => s + parseFloat(m.amount), 0);
  }
  function status() {
    const out = [];
    budgets.forEach(b => {
      const s = spent(b.category_id), cat = financeCategories.find(c => String(c.id) === String(b.category_id));
      if (b.category_id !== 0 && !cat) return;
      out.push({ id: b.id, category_id: b.category_id, name: b.category_id === 0 ? 'Total del mes' : cat.name, limit: b.amount, spent: s, pct: b.amount > 0 ? s / b.amount * 100 : 0 });
    });
    return out.sort((a, b) => (a.category_id === 0 ? -1 : b.category_id === 0 ? 1 : b.pct - a.pct));
  }
  /** Mensaje si el último gasto cruza el 80 % o el 100 % de un presupuesto (llamar tras guardar el movimiento). */
  function checkAfter(catId, amount) {
    const msgs = [];
    [catId, 0].forEach(id => {
      const b = budgets.find(x => String(x.category_id) === String(id || 0)); if (!b || (id === 0 && catId === 0)) return;
      const now = spent(id === 0 ? 0 : id), before = now - amount, lim = b.amount, name = id === 0 ? 'tu presupuesto total' : 'tu presupuesto de ' + ((financeCategories.find(c => String(c.id) === String(id)) || {}).name || 'esa categoría');
      if (before < lim && now >= lim) msgs.push(`⚠ Has superado ${name} (${eur(now)} de ${eur(lim)})`);
      else if (before < lim * 0.8 && now >= lim * 0.8) msgs.push(`Ojo: llevas el ${Math.round(now / lim * 100)} % de ${name}`);
    });
    return msgs.join(' · ');
  }

  async function save(catId, amount) {
    const r = await api('?resource=budgets', { method: 'POST', body: JSON.stringify({ category_id: catId, amount }) });
    const i = budgets.findIndex(b => b.category_id === r.category_id);
    if (i >= 0) budgets[i] = r; else budgets.push(r);
  }
  async function remove(b) { await api('?resource=budgets&id=' + b.id, { method: 'DELETE' }); budgets = budgets.filter(x => x.id !== b.id); }

  function row(item, catId, colorIdx) {
    const d = document.createElement('div'); d.className = 'bd-card';
    const cls = item && item.pct >= 100 ? 'over' : item && item.pct >= 80 ? 'warn' : '';
    const name = catId === 0 ? 'Total del mes' : (financeCategories.find(c => String(c.id) === String(catId)) || {}).name;
    const color = catId === 0 ? 'var(--primary)' : ((typeof PALETTE_INK !== 'undefined' ? PALETTE_INK : [])[colorIdx % 6] || 'var(--primary)');
    const sp = item ? item.spent : spent(catId);
    if (item) {
      d.innerHTML = `<div class="bd-top"><span class="bd-name"><i class="dot" style="background:${color}"></i>${escapeHtml(name)}</span><span class="bd-big">${eur(sp)} <small>de ${eur(item.limit)}</small></span></div>
        <div class="bd-bar ${cls}"><i style="width:${Math.min(100, item.pct)}%"></i></div>
        <div class="bd-meta"><span>${item.pct >= 100 ? `<span class="over">Superado por ${eur(sp - item.limit)}</span>` : `Quedan <b>${eur(item.limit - sp)}</b>`}${item.pct >= 80 && item.pct < 100 ? ' · <span class="warn">cerca del límite</span>' : ''}</span>
          <span><button class="bd-btn" data-e>Editar</button></span></div>`;
    } else {
      d.innerHTML = `<div class="bd-top"><span class="bd-name"><i class="dot" style="background:${color}"></i>${escapeHtml(name)}</span><span class="bd-meta">Este mes: <b>&nbsp;${eur(sp)}</b></span></div>
        <div class="bd-meta" style="margin-top:10px;"><span>Sin límite</span><button class="bd-btn" data-e>Poner límite</button></div>`;
    }
    d.querySelector('[data-e]').onclick = () => {
      if (d.querySelector('.bd-edit')) return;
      const ed = document.createElement('div'); ed.className = 'bd-edit';
      ed.innerHTML = `<label><input inputmode="decimal" placeholder="0" value="${item ? String(item.limit).replace('.', ',') : ''}" aria-label="Límite mensual"><span class="suf">€ / mes</span></label>
        <button class="bd-save" type="button">Guardar</button>${item ? '<button class="bd-btn" type="button" data-rm>Quitar límite</button>' : ''}<button class="bd-btn" type="button" data-c>Cancelar</button>`;
      d.appendChild(ed);
      const inp = ed.querySelector('input'); inp.focus(); inp.select();
      const go = async () => {
        const v = parseFloat(inp.value.replace(',', '.'));
        if (!isFinite(v) || v <= 0) { showToast('Pon un importe mayor que 0.'); return; }
        try { await save(catId, Math.round(v * 100) / 100); render_(); } catch (e) { showToast(e.message); }
      };
      ed.querySelector('.bd-save').onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') render_(); };
      ed.querySelector('[data-c]').onclick = () => render_();
      const rm = ed.querySelector('[data-rm]'); if (rm) rm.onclick = async () => { try { await remove(item); render_(); } catch (e) { showToast(e.message); } };
    };
    return d;
  }
  let render_ = () => {};

  window.renderPresupuestosTab = function () {
    const wrap = $('gastosTabContent'); if (!wrap) return;
    render_ = () => window.renderPresupuestosTab();
    const st = status(), byCat = Object.fromEntries(st.map(s => [s.category_id, s]));
    const now = new Date();
    wrap.innerHTML = `<p class="bd-intro">Pon un límite mensual y te aviso cuando te acerques. Este mes: <b>${MONTHS[now.getMonth()]} ${now.getFullYear()}</b>. Solo cuentan los gastos que has pagado tú.</p><div id="bdList"></div>`;
    const list = $('bdList');
    list.appendChild(row(byCat[0] || null, 0, 0));
    if (!financeCategories.length) { const e = document.createElement('div'); e.className = 'bd-empty'; e.textContent = 'Cuando tengas categorías de gastos podrás ponerles un límite a cada una.'; list.appendChild(e); return; }
    financeCategories.forEach((c, i) => list.appendChild(row(byCat[c.id] || null, c.id, i)));
  };

  window.Budgets = { spent, status, checkAfter, monthKey };
})();
