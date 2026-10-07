/* Perfil → "Resumen de la mañana" y "Sincronizar calendario". Cada usuario tiene sus propias preferencias y su propio enlace secreto. */
(function () {
  const css = document.createElement('style');
  css.textContent = `
    .pf2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:26px;} .pf2 h3{font-size:16px;margin-bottom:4px;}
    .pf2 .sub{color:var(--ink-soft);font-size:13.5px;line-height:1.5;margin:0 0 14px;}
    .pf-sw{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 14px;background:var(--bg);border-radius:14px;font-weight:600;font-size:14.5px;}
    .pf-sw input{appearance:none;width:46px;height:28px;border-radius:14px;background:var(--line);position:relative;cursor:pointer;transition:background .15s;flex-shrink:0;border:none;padding:0;}
    .pf-sw input::after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:transform .18s;box-shadow:0 1px 3px rgba(0,0,0,.3);}
    .pf-sw input:checked{background:var(--primary);} .pf-sw input:checked::after{transform:translateX(18px);}
    .pf-row{display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap;} .pf-row label{font-size:13.5px;color:var(--ink-soft);font-weight:600;}
    .pf-row input[type=time]{padding:10px 12px;border:1.5px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink);font:inherit;font-size:16px;font-family:var(--font-mono);}
    .pf-note{font-size:12.5px;line-height:1.5;margin-top:12px;padding:10px 12px;border-radius:12px;background:var(--butter);color:var(--butter-ink);}
    .pf-ok{background:var(--mint);color:var(--mint-ink);}
    .pf-url{display:flex;gap:8px;margin-bottom:10px;} .pf-url input{flex:1;min-width:0;padding:11px 13px;border:1.5px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink-soft);font:inherit;font-size:13px;font-family:var(--font-mono);}
    .pf-btns{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;}
    .pf-b{border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-size:13px;font-weight:600;padding:9px 14px;border-radius:12px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;}
    .pf-b:hover{border-color:color-mix(in srgb,var(--primary) 50%,var(--line));color:var(--primary);} .pf-b.p{background:var(--grad);color:#fff;border-color:transparent;} .pf-b.d{color:var(--rose-ink);}
    .pf-how{font-size:13px;color:var(--ink-soft);line-height:1.6;} .pf-how summary{cursor:pointer;font-weight:600;color:var(--ink);margin:6px 0;} .pf-how ol{margin:6px 0 10px 18px;padding:0;} .pf-how b{color:var(--ink);}
    @media (max-width:860px){ .pf2{grid-template-columns:minmax(0,1fr);gap:30px;} }
  `;
  document.head.appendChild(css);

  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return 'Europe/Madrid'; } };
  const calOk = () => typeof modState !== 'function' || modState('tareas') === 'allow' || modState('calendario') === 'allow';

  window.renderPerfilExtras = async function (el) {
    if (!el) return;
    el.innerHTML = '<div class="sub">Cargando preferencias…</div>';
    let p;
    try { p = await api('?resource=prefs'); } catch (e) { el.innerHTML = `<h3>Preferencias</h3><p class="sub">${escapeHtml(e.message)}</p>`; return; }
    const draw = () => {
      const pushOk = typeof pushSubscribed !== 'undefined' && pushSubscribed;
      const url = p.calendar_url, web = url ? url.replace(/^https?:/, 'webcal:') : '';
      el.innerHTML = `<div class="pf2">
        <div><h3>☀️ Resumen de la mañana</h3><p class="sub">Un aviso al día con tus tareas, el tiempo y cómo vas de gastos y compra.</p>
          <label class="pf-sw"><span>Recibir el resumen cada día</span><input type="checkbox" id="pfBrief" ${p.brief_enabled ? 'checked' : ''}></label>
          <div class="pf-row"><label for="pfBriefT">A las</label><input type="time" id="pfBriefT" value="${escapeHtml(p.brief_time)}" ${p.brief_enabled ? '' : 'disabled'}><span class="sub" style="margin:0;">(${escapeHtml(tz().replace('_', ' '))})</span></div>
          ${p.brief_enabled && !pushOk ? '<div class="pf-note">Para recibirlo, activa también «Avisos de tareas» en este dispositivo (tarjeta de arriba). Es un aviso push.</div>' : (p.brief_enabled ? '<div class="pf-note pf-ok">Activado. Lo recibirás en los dispositivos con avisos activados.</div>' : '')}</div>
        <div><h3>📅 Sincronizar calendario</h3><p class="sub">Tus tareas con fecha aparecen en Google Calendar, Apple Calendar u Outlook, con sus avisos. Es <b>tu</b> enlace privado, cada usuario tiene el suyo.</p>
          ${!calOk() ? '<div class="pf-note">Tu rol no incluye tareas ni calendario, así que no hay nada que sincronizar.</div>' : !url
            ? '<button class="pf-b p" id="pfCalOn">Crear mi enlace de calendario</button>'
            : `<div class="pf-url"><input readonly id="pfCalUrl" value="${escapeHtml(url)}" aria-label="Enlace del calendario"><button class="pf-b" id="pfCalCopy">Copiar</button></div>
               <div class="pf-btns"><a class="pf-b p" href="${escapeHtml(web)}">Apple Calendar</a><a class="pf-b p" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(web)}">Google Calendar</a></div>
               <details class="pf-how"><summary>Cómo añadirlo a mano</summary>
                 <b>Google Calendar</b> (en el ordenador): Otros calendarios → <b>+</b> → <b>Desde URL</b> → pega el enlace.<ol><li>Google actualiza los calendarios por URL cada pocas horas (puede tardar hasta un día en reflejar un cambio).</li></ol>
                 <b>iPhone / iPad</b>: Ajustes → Calendario → Cuentas → Añadir cuenta → Otra → <b>Añadir calendario suscrito</b>.<br>
                 <b>Mac</b>: Calendario → Archivo → <b>Nueva suscripción a calendario</b>.<br>
                 <b>Outlook</b>: Añadir calendario → <b>Suscribirse desde la web</b>.</details>
               <div class="pf-btns"><button class="pf-b" id="pfCalNew">Generar otro enlace</button><button class="pf-b d" id="pfCalOff">Desactivar</button></div>
               <div class="sub" style="margin:0;font-size:12.5px;">No compartas el enlace: quien lo tenga puede ver tus tareas con fecha. Si lo regeneras, el anterior deja de funcionar.</div>`}
        </div></div>`;
      const save = async () => {
        try { p = await api('?resource=prefs', { method: 'PATCH', body: JSON.stringify({ brief_enabled: $('pfBrief').checked, brief_time: $('pfBriefT').value || '08:00', tz: tz() }) }); showToast(p.brief_enabled ? 'Resumen activado.' : 'Resumen desactivado.'); draw(); }
        catch (e) { showToast(e.message); draw(); }
      };
      const $ = id => el.querySelector('#' + id);
      $('pfBrief').onchange = save; $('pfBriefT').onchange = save;
      const act = (id, fn) => { const b = $(id); if (b) b.onclick = async () => { try { p = await fn(); draw(); } catch (e) { showToast(e.message); } }; };
      act('pfCalOn', () => api('?resource=prefs&action=calendar_token', { method: 'POST', body: '{}' }));
      act('pfCalOff', () => api('?resource=prefs&action=calendar_token', { method: 'DELETE' }));
      const nw = $('pfCalNew'); if (nw) nw.onclick = async () => {
        if (!nw.dataset.sure) { nw.dataset.sure = 1; nw.textContent = 'Seguro: el anterior dejará de funcionar'; return; }
        try { p = await api('?resource=prefs&action=calendar_token', { method: 'POST', body: '{}' }); draw(); showToast('Enlace nuevo. Actualízalo en tu calendario.'); } catch (e) { showToast(e.message); }
      };
      const cp = $('pfCalCopy'); if (cp) cp.onclick = () => { const i = $('pfCalUrl'); i.select(); (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(() => showToast('Enlace copiado.'), () => { document.execCommand('copy'); showToast('Enlace copiado.'); }); };
    };
    draw();
  };
})();
