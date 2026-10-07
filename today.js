/* Pantalla "Hoy": lo que importa del día en un vistazo (tareas de hoy y vencidas, tiempo, dinero del mes, compra)
   y un acceso grande para apuntar algo. Solo muestra los módulos que el rol del usuario puede usar. */
(function () {
  const $ = id => document.getElementById(id);
  const eur = n => (typeof money === 'function' ? money(n) : n.toFixed(2) + ' €');
  const pad = n => String(n).padStart(2, '0');

  const css = document.createElement('style');
  css.textContent = `
    .hy{max-width:1040px;margin:0 auto;padding:22px 20px 40px;display:flex;flex-direction:column;gap:16px;}
    .hy-hero{position:relative;overflow:hidden;border-radius:26px;padding:24px 24px 22px;background:var(--card);box-shadow:var(--shadow);}
    .hy-hero::before{content:'';position:absolute;inset:-40% -10% auto auto;width:70%;height:140%;background:radial-gradient(closest-side,color-mix(in srgb,var(--primary) 30%,transparent),transparent 70%);filter:blur(24px);pointer-events:none;}
    .hy-row{position:relative;display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;}
    .hy-hello{font-size:clamp(24px,4.6vw,34px);font-weight:640;letter-spacing:-.035em;line-height:1.1;}
    .hy-date{color:var(--ink-soft);font-size:14px;margin-top:6px;} .hy-date::first-letter{text-transform:uppercase;}
    .hy-wx{display:flex;align-items:center;gap:8px;background:color-mix(in srgb,var(--bg) 70%,transparent);border:1px solid var(--line);border-radius:14px;padding:8px 12px;font-weight:600;font-size:14px;cursor:pointer;color:var(--ink);font-family:inherit;}
    .hy-wx svg{width:20px;height:20px;color:var(--sky-ink);} .hy-wx small{color:var(--ink-soft);font-weight:500;font-size:12px;}
    .hy-cap{position:relative;display:flex;align-items:center;gap:12px;width:100%;margin-top:18px;border:1.5px solid var(--line);background:color-mix(in srgb,var(--bg) 60%,var(--card));color:var(--ink-soft);font:inherit;font-size:16px;padding:15px 16px;border-radius:18px;cursor:text;text-align:left;transition:border-color .15s,box-shadow .15s;}
    .hy-cap:hover{border-color:color-mix(in srgb,var(--primary) 50%,var(--line));box-shadow:0 0 0 4px color-mix(in srgb,var(--primary) 10%,transparent);}
    .hy-cap svg{width:20px;height:20px;color:var(--primary);flex-shrink:0;} .hy-cap span{flex:1;}
    .hy-quick{position:relative;display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}
    .hy-q{border:1px solid var(--line);background:color-mix(in srgb,var(--card) 80%,transparent);color:var(--ink);font:inherit;font-size:13.5px;font-weight:600;padding:9px 14px;border-radius:12px;cursor:pointer;}
    .hy-q:hover{border-color:color-mix(in srgb,var(--primary) 50%,var(--line));color:var(--primary);}
    .hy-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:16px;align-items:start;}
    .hy-col{display:flex;flex-direction:column;gap:16px;min-width:0;}
    .hy-card{background:var(--card);box-shadow:var(--shadow);border-radius:22px;padding:18px 18px 14px;}
    .hy-h{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}
    .hy-h h3{font-size:15px;letter-spacing:-.01em;display:flex;align-items:center;gap:8px;} .hy-h .n{font-size:12px;font-weight:700;background:var(--primary-soft);color:var(--primary);border-radius:8px;padding:2px 8px;}
    .hy-h .n.red{background:var(--rose);color:var(--rose-ink);}
    .hy-more{border:none;background:none;color:var(--primary);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;padding:4px 2px;}
    .hy-list{display:flex;flex-direction:column;}
    .hy-t{display:flex;align-items:center;gap:12px;padding:10px 2px;border-top:1px solid var(--line);} .hy-t:first-child{border-top:none;}
    .hy-ck{width:30px;height:30px;border-radius:50%;border:2px solid var(--line);flex-shrink:0;background:none;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;color:#fff;}
    .hy-ck:hover{border-color:var(--mint-ink);} .hy-ck.on{background:var(--mint-ink);border-color:var(--mint-ink);} .hy-ck svg{width:14px;height:14px;display:none;} .hy-ck.on svg{display:block;}
    .hy-tt{flex:1;min-width:0;cursor:pointer;} .hy-tt b{display:block;font-weight:550;font-size:15px;word-break:break-word;} .hy-tt small{display:block;color:var(--ink-soft);font-size:12.5px;margin-top:2px;}
    .hy-t.late .hy-tt small{color:var(--rose-ink);font-weight:600;} .hy-t.done .hy-tt b{color:var(--ink-soft);text-decoration:line-through;}
    .hy-flag{width:8px;height:8px;border-radius:50%;flex-shrink:0;} .hy-flag.p3{background:var(--rose-ink);} .hy-flag.p2{background:var(--peach-ink);} .hy-flag.p1{background:var(--sky-ink);}
    .hy-empty{padding:18px 4px 12px;color:var(--ink-soft);font-size:14px;line-height:1.5;text-align:center;}
    .hy-sec{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-soft);margin:12px 0 2px;}
    .hy-ring{--p:0;width:54px;height:54px;border-radius:50%;background:conic-gradient(var(--mint-ink) calc(var(--p)*1%),var(--bg) 0);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .hy-ring span{width:42px;height:42px;border-radius:50%;background:var(--card);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;font-family:var(--font-mono);}
    .hy-money{display:flex;gap:18px;margin:2px 0 6px;flex-wrap:wrap;} .hy-money div small{display:block;color:var(--ink-soft);font-size:12px;}
    .hy-money div b{font-family:var(--font-mono);font-size:22px;letter-spacing:-.04em;font-weight:650;} .hy-money .g b{color:var(--rose-ink);} .hy-money .i b{color:var(--mint-ink);}
    .hy-bd{margin-top:10px;} .hy-bd .top{display:flex;justify-content:space-between;font-size:13px;font-weight:600;gap:8px;} .hy-bd .top span:last-child{font-family:var(--font-mono);color:var(--ink-soft);font-weight:500;font-size:12px;}
    .hy-bar{height:7px;background:var(--bg);border-radius:4px;overflow:hidden;margin-top:6px;} .hy-bar i{display:block;height:100%;background:var(--mint-ink);border-radius:4px;} .hy-bar.warn i{background:var(--butter-ink);} .hy-bar.over i{background:var(--rose-ink);}
    .hy-si{display:flex;align-items:center;gap:12px;padding:8px 2px;border-top:1px solid var(--line);font-size:15px;} .hy-si:first-child{border-top:none;} .hy-si span{flex:1;min-width:0;word-break:break-word;}
    @media (max-width:860px){ .hy{padding:14px 14px 30px;} .hy-hero{padding:20px 18px;border-radius:22px;} }
  `;
  document.head.appendChild(css);

  const check = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.2 11.5L13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const micIc = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l1.9 5.4L19.5 10l-5.6 1.7L12 17l-1.9-5.3L4.5 10l5.6-1.6L12 3z" fill="currentColor"/></svg>';
  const can = id => typeof modState !== 'function' || modState(id) === 'allow';
  const timeOf = t => new Date(t.due_at.replace(' ', 'T') + 'Z').toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const dayOf = t => new Date(t.due_at.replace(' ', 'T') + 'Z').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');

  function taskRow(t, late) {
    const d = document.createElement('div'); d.className = 'hy-t' + (late ? ' late' : '') + (t.done ? ' done' : '');
    const cat = categories.find(c => String(c.id) === String(t.category_id));
    const when = late ? 'Venció ' + dayOf(t) + ' · ' + timeOf(t) : t.due_at ? (new Date(t.due_at.replace(' ', 'T') + 'Z').toDateString() === new Date().toDateString() ? timeOf(t) : dayOf(t) + ' · ' + timeOf(t)) : '';
    d.innerHTML = `<button class="hy-ck ${t.done ? 'on' : ''}" aria-label="Completar">${check}</button><div class="hy-tt"><b>${escapeHtml(t.text)}</b><small>${escapeHtml([when, cat ? cat.name : ''].filter(Boolean).join(' · '))}</small></div>${t.priority ? `<span class="hy-flag p${t.priority}"></span>` : ''}`;
    d.querySelector('.hy-ck').onclick = () => toggleTask(t.id, !t.done);
    d.querySelector('.hy-tt').onclick = () => (window.TasksPlus ? TasksPlus.open(t.id) : null);
    return d;
  }

  window.renderHoy = function () {
    const el = $('hoyMain'); if (!el) return;
    const now = new Date(), h = now.getHours();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), end = start + 864e5;
    const open = tasks.filter(t => !t.done && t.due_at), ms = t => new Date(t.due_at.replace(' ', 'T') + 'Z').getTime();
    const late = open.filter(t => ms(t) < start).sort((a, b) => ms(a) - ms(b));
    const today = tasks.filter(t => t.due_at && ms(t) >= start && ms(t) < end).sort((a, b) => (a.done - b.done) || ms(a) - ms(b));
    const soon = open.filter(t => ms(t) >= end && ms(t) < end + 6 * 864e5).sort((a, b) => ms(a) - ms(b)).slice(0, 4);
    const doneToday = today.filter(t => t.done).length, pct = today.length ? Math.round(doneToday / today.length * 100) : 0;
    const hello = (h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches') + ', ' + me.username;
    const wx = (typeof weatherData !== 'undefined' && weatherData && weatherData.current && weatherLocation) ? weatherData.current : null;
    const wi = wx && typeof weatherInfo === 'function' ? weatherInfo(wx.weather_code) : null;

    el.innerHTML = `<div class="hy">
      <section class="hy-hero"><div class="hy-row"><div><div class="hy-hello">${escapeHtml(hello)}</div><div class="hy-date">${now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
        ${wi ? `<button class="hy-wx" id="hyWx">${wi.icon()}<span>${Math.round(wx.temperature_2m)}° <small>${escapeHtml(weatherLocation.name)}</small></span></button>` : ''}</div>
        <button class="hy-cap" id="hyCap">${micIc}<span>¿Qué quieres apuntar?</span></button>
        <div class="hy-quick"><button class="hy-q" data-k="task">+ Tarea</button>${can('gastos') ? '<button class="hy-q" data-k="gasto">+ Gasto</button>' : ''}${can('compra') ? '<button class="hy-q" data-k="compra">+ Compra</button>' : ''}</div></section>
      <div class="hy-grid"><div class="hy-col" id="hyLeft"></div><div class="hy-col" id="hyRight"></div></div></div>`;
    $('hyCap').onclick = () => Capture.open({});
    el.querySelectorAll('.hy-q').forEach(b => { b.onclick = () => Capture.open({ kind: b.dataset.k, text: '' }); });
    if ($('hyWx')) $('hyWx').onclick = () => { currentSection = 'tiempo'; render(); };

    const L = $('hyLeft'), R = $('hyRight');
    if (can('tareas') || can('calendario')) {
      const card = document.createElement('section'); card.className = 'hy-card';
      card.innerHTML = `<div class="hy-h"><h3>Hoy ${today.length ? `<span class="n">${doneToday}/${today.length}</span>` : ''}</h3>${today.length ? `<div class="hy-ring" style="--p:${pct}"><span>${pct}%</span></div>` : ''}</div><div class="hy-list" id="hyToday"></div>`;
      L.appendChild(card);
      const list = card.querySelector('#hyToday');
      if (late.length) {
        const s = document.createElement('div'); s.className = 'hy-sec'; s.textContent = `Vencidas (${late.length})`; s.style.color = 'var(--rose-ink)'; list.appendChild(s);
        late.slice(0, 5).forEach(t => list.appendChild(taskRow(t, true)));
        if (late.length > 5) { const m = document.createElement('button'); m.className = 'hy-more'; m.textContent = `Ver las ${late.length} vencidas`; m.onclick = () => { currentSection = 'tareas'; showOverdue = true; showUpcoming = false; render(); }; list.appendChild(m); }
      }
      if (today.length) { if (late.length) { const s = document.createElement('div'); s.className = 'hy-sec'; s.textContent = 'Para hoy'; list.appendChild(s); } today.forEach(t => list.appendChild(taskRow(t, false))); }
      if (!today.length && !late.length) list.innerHTML = '<div class="hy-empty">Nada con fecha para hoy 🎉<br>Un buen día para adelantar algo.</div>';
      if (soon.length) {
        const c2 = document.createElement('section'); c2.className = 'hy-card';
        c2.innerHTML = '<div class="hy-h"><h3>Próximos días</h3><button class="hy-more" id="hyAll">Ver tareas</button></div><div class="hy-list" id="hySoon"></div>';
        L.appendChild(c2); soon.forEach(t => c2.querySelector('#hySoon').appendChild(taskRow(t, false)));
        c2.querySelector('#hyAll').onclick = () => { currentSection = 'tareas'; render(); };
      }
    }

    if (can('gastos') || can('estadisticas')) {
      const k = (window.Budgets ? Budgets.monthKey() : now.toISOString().slice(0, 7));
      const mine = movements.filter(m => String(m.date).startsWith(k) && (!m.group_id || String(m.paid_by) === String(me.id)));
      const g = mine.filter(m => m.type === 'gasto').reduce((s, m) => s + parseFloat(m.amount), 0), i = mine.filter(m => m.type === 'ingreso').reduce((s, m) => s + parseFloat(m.amount), 0);
      const st = window.Budgets ? Budgets.status() : [], tot = st.find(x => x.category_id === 0), cats = st.filter(x => x.category_id !== 0 && x.pct >= 60).slice(0, 3);
      const card = document.createElement('section'); card.className = 'hy-card';
      const bar = x => `<div class="hy-bd"><div class="top"><span>${escapeHtml(x.name)}</span><span>${eur(x.spent)} / ${eur(x.limit)}</span></div><div class="hy-bar ${x.pct >= 100 ? 'over' : x.pct >= 80 ? 'warn' : ''}"><i style="width:${Math.min(100, x.pct)}%"></i></div></div>`;
      card.innerHTML = `<div class="hy-h"><h3>Este mes</h3><button class="hy-more" id="hyMoney">Ver gastos</button></div>
        <div class="hy-money"><div class="g"><small>Gastado</small><b>${eur(g)}</b></div><div class="i"><small>Ingresos</small><b>${eur(i)}</b></div></div>
        ${tot ? bar(tot) : ''}${cats.map(bar).join('')}${!st.length && can('gastos') ? '<div class="hy-empty" style="padding:8px 0 4px;text-align:left;">Pon un límite mensual en <b>Gastos → Presupuestos</b> y te aviso cuando te acerques.</div>' : ''}`;
      R.appendChild(card);
      card.querySelector('#hyMoney').onclick = () => { currentSection = 'gastos'; render(); };
    }

    if (can('compra') && window.Shopping) {
      const card = document.createElement('section'); card.className = 'hy-card'; card.innerHTML = '<div class="hy-h"><h3>Compra</h3><button class="hy-more" id="hyShop">Abrir lista</button></div><div class="hy-list" id="hyShopList"><div class="hy-empty">Cargando…</div></div>';
      R.appendChild(card);
      card.querySelector('#hyShop').onclick = () => { currentSection = 'compra'; render(); };
      Shopping.load().then(data => {
        const pending = data.items.filter(x => !x.done);
        card.querySelector('h3').innerHTML = 'Compra ' + (pending.length ? `<span class="n">${pending.length}</span>` : '');
        const list = card.querySelector('#hyShopList'); list.innerHTML = '';
        if (!pending.length) { list.innerHTML = '<div class="hy-empty">La lista está vacía. Dime «añade leche a la compra».</div>'; return; }
        pending.slice(0, 5).forEach(it => {
          const d = document.createElement('div'); d.className = 'hy-si';
          d.innerHTML = `<button class="hy-ck" aria-label="Comprado">${check}</button><span>${escapeHtml(it.name)}${it.qty ? ' <small style="color:var(--ink-soft)">· ' + escapeHtml(it.qty) + '</small>' : ''}</span>`;
          d.querySelector('button').onclick = async () => { d.querySelector('button').classList.add('on'); try { await Shopping.toggle(it); } catch (e) { showToast(e.message); } setTimeout(() => currentSection === 'hoy' && renderHoy(), 350); };
          list.appendChild(d);
        });
        if (pending.length > 5) { const m = document.createElement('button'); m.className = 'hy-more'; m.textContent = `y ${pending.length - 5} más…`; m.onclick = () => { currentSection = 'compra'; render(); }; list.appendChild(m); }
      }).catch(() => { card.querySelector('#hyShopList').innerHTML = '<div class="hy-empty">No se pudo cargar la lista.</div>'; });
    }
    if (!R.children.length) R.remove();
  };
})();
