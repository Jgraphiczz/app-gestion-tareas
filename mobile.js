/* Extras de móvil: tema claro/oscuro, gestos en tareas, pull-to-refresh, vibración, badge,
   atajos de la app instalada, banner sin conexión e instalación. Se carga antes del script principal
   y usa sus variables/funciones globales (tasks, loadAll, render…) solo cuando se ejecuta. */
(function () {
  const root = document.documentElement;
  const coarse = matchMedia('(pointer:coarse)');

  const css = document.createElement('style');
  css.textContent = `
    .task-swipe{position:relative;border-radius:var(--radius);overflow:hidden;}
    .task-swipe > .task{position:relative;z-index:1;touch-action:pan-y;will-change:transform;}
    .swipe-bg{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding:0 20px;font-size:13px;font-weight:700;border-radius:var(--radius);}
    .swipe-bg span{opacity:0;transition:opacity .1s;}
    .task-swipe[data-dir="r"] .swipe-bg{background:var(--mint);color:var(--mint-ink);}
    .task-swipe[data-dir="l"] .swipe-bg{background:var(--rose);color:var(--rose-ink);}
    .task-swipe[data-dir="r"] .sw-done,.task-swipe[data-dir="l"] .sw-del{opacity:1;}
    .ptr{position:fixed;left:50%;top:calc(var(--safe-t) + 56px);z-index:120;width:36px;height:36px;margin-left:-18px;border-radius:50%;background:var(--card);box-shadow:var(--shadow);display:flex;align-items:center;justify-content:center;color:var(--primary);opacity:0;transform:translateY(-40px);pointer-events:none;}
    .ptr svg{width:18px;height:18px;}
    .ptr.spin svg{animation:spin .7s linear infinite;}
    .offline-banner{position:fixed;left:0;right:0;bottom:0;z-index:48;padding:6px 12px calc(6px + var(--safe-b));text-align:center;font-size:12.5px;font-weight:600;background:var(--butter);color:var(--butter-ink);}
    @media (max-width:860px){.offline-banner{bottom:calc(98px + var(--safe-b));left:12px;right:12px;border-radius:14px;padding-bottom:6px;}}
  `;
  document.head.appendChild(css);

  /* ---------- tema: auto / claro / oscuro ---------- */
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const THEME_NAMES = { auto: 'Automático', light: 'Claro', dark: 'Oscuro' };
  const getPref = () => { try { return localStorage.getItem('theme') || 'auto'; } catch (e) { return 'auto'; } };
  function applyTheme(p) {
    root.dataset.themePref = p;
    if (p === 'auto') delete root.dataset.theme; else root.dataset.theme = p;
    const dark = p === 'dark' || (p === 'auto' && mq.matches);
    document.querySelectorAll('meta[name=theme-color]').forEach(m => { m.content = dark ? '#08090D' : '#F5F6F9'; });
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-theme-toggle]')) return;
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(getPref()) + 1) % order.length];
    try { localStorage.setItem('theme', next); } catch (err) {}
    applyTheme(next);
    if (window.showToast) showToast('Tema: ' + THEME_NAMES[next]);
  });
  if (mq.addEventListener) mq.addEventListener('change', () => applyTheme(getPref()));
  applyTheme(getPref());

  /* ---------- vibración ---------- */
  const haptic = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

  /* ---------- borrar con opción de deshacer ---------- */
  const pendingDeletes = new Map();
  function flushDeletes() {
    pendingDeletes.forEach(({ timer, id }) => { clearTimeout(timer); api('?resource=tasks&id=' + id, { method: 'DELETE' }).catch(() => {}); });
    pendingDeletes.clear();
  }
  function softDelete(task) {
    const idx = tasks.findIndex(t => t.id == task.id); if (idx < 0) return;
    tasks.splice(idx, 1); refreshTaskViews(); haptic(25);
    const timer = setTimeout(() => {
      pendingDeletes.delete(task.id);
      api('?resource=tasks&id=' + task.id, { method: 'DELETE' }).catch(() => {
        tasks.splice(Math.min(idx, tasks.length), 0, task); refreshTaskViews();
        showToast('No se pudo eliminar la tarea');
      });
    }, 5000);
    pendingDeletes.set(task.id, { timer, id: task.id });
    showToast('Tarea eliminada', { label: 'Deshacer', fn: () => {
      clearTimeout(timer); pendingDeletes.delete(task.id);
      tasks.splice(Math.min(idx, tasks.length), 0, task); refreshTaskViews();
    } });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDeletes(); });

  /* ---------- deslizar tareas: → completar, ← borrar ---------- */
  const THRESHOLD = 90;
  function swipeable(row, task) {
    if (!coarse.matches) return row;
    const wrap = document.createElement('div');
    wrap.className = 'task-swipe';
    wrap.innerHTML = `<div class="swipe-bg"><span class="sw-done">${task.done ? '↺ Reabrir' : '✓ Completar'}</span><span class="sw-del">Borrar</span></div>`;
    wrap.appendChild(row);
    let x0 = 0, y0 = 0, dx = 0, mode = null;       // mode: null (sin decidir) | 'h' | 'v'
    row.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; mode = null;
      row.style.transition = 'none';
    }, { passive: true });
    row.addEventListener('touchmove', e => {
      if (mode === 'v' || e.touches.length !== 1) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (!mode) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        mode = Math.abs(mx) > Math.abs(my) * 1.3 ? 'h' : 'v';
        if (mode === 'v') return;
      }
      e.preventDefault();                                 // ya es un gesto horizontal: que no haga scroll
      dx = mx > 0 ? Math.min(mx, 140) : Math.max(mx, -140);
      wrap.dataset.dir = dx > 0 ? 'r' : 'l';
      row.style.transform = `translateX(${dx}px)`;
      if (Math.abs(dx) >= THRESHOLD && !row._armed) { row._armed = true; haptic(10); }
      if (Math.abs(dx) < THRESHOLD) row._armed = false;
    }, { passive: false });
    const end = () => {
      if (mode !== 'h') return;
      const commit = Math.abs(dx) >= THRESHOLD, dir = dx > 0 ? 'r' : 'l';
      row._armed = false;
      row.style.transition = 'transform .18s ease';
      row.style.transform = commit ? `translateX(${dir === 'r' ? 100 : -100}%)` : '';
      if (!commit) return;
      setTimeout(() => { if (dir === 'r') toggleTask(task.id, !task.done); else softDelete(task); }, 150);
    };
    row.addEventListener('touchend', end);
    row.addEventListener('touchcancel', () => { row.style.transition = 'transform .18s ease'; row.style.transform = ''; });
    return wrap;
  }

  /* ---------- tirar hacia abajo para refrescar ---------- */
  const ptr = document.createElement('div');
  ptr.className = 'ptr';
  ptr.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(ptr));
  const PTR_BLOCK = '.modal-sheet,.drawer,.notes-editor-pane,.diagram-overlay,textarea,input,select,[contenteditable],.tabs,.task-swipe';
  let py0 = 0, pdist = 0, pulling = false, refreshing = false;
  document.addEventListener('touchstart', e => {
    pulling = false;
    if (refreshing || e.touches.length !== 1 || window.scrollY > 0 || typeof me === 'undefined' || !me) return;
    if (e.target.closest && e.target.closest(PTR_BLOCK)) return;
    if (document.querySelector('.modal-sheet.open,.drawer.open')) return;
    py0 = e.touches[0].clientY; pdist = 0; pulling = true;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - py0;
    if (dy <= 0 || window.scrollY > 0) { pulling = false; ptr.style.opacity = 0; return; }
    pdist = Math.min(dy * 0.5, 80);
    ptr.style.opacity = Math.min(pdist / 50, 1);
    ptr.style.transform = `translateY(${pdist - 40}px) rotate(${pdist * 4}deg)`;
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    if (pdist < 60) { ptr.style.opacity = 0; ptr.style.transform = 'translateY(-40px)'; return; }
    refreshing = true; ptr.classList.add('spin'); ptr.style.transform = 'translateY(24px)'; haptic(10);
    try { await loadAll(); render(); } catch (e) { showToast('No se pudo actualizar'); }
    ptr.classList.remove('spin'); ptr.style.opacity = 0; ptr.style.transform = 'translateY(-40px)'; refreshing = false;
  });

  /* ---------- banner sin conexión ---------- */
  let banner = null;
  function syncOnline() {
    const off = !navigator.onLine || window.offlineMode;
    if (off && !banner) { banner = document.createElement('div'); banner.className = 'offline-banner'; banner.textContent = 'Sin conexión · mostrando los últimos datos guardados'; document.body.appendChild(banner); }
    if (!off && banner) { banner.remove(); banner = null; }
  }
  addEventListener('offline', syncOnline);
  addEventListener('online', () => { window.offlineMode = false; syncOnline(); if (typeof me !== 'undefined' && me) loadAll().then(render).catch(() => {}); });

  /* ---------- instalar la app ---------- */
  let installEvt = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; syncInstall(); });
  addEventListener('appinstalled', () => { installEvt = null; syncInstall(); });
  function syncInstall() {
    const b = document.getElementById('installBtnDrawer'); if (!b) return;
    b.style.display = installEvt ? '' : 'none';
    b.onclick = async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; syncInstall(); };
  }

  /* ---------- badge con las tareas de hoy y vencidas + atajos ---------- */
  function updateBadge() {
    if (!navigator.setAppBadge || typeof tasks === 'undefined') return;
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const n = tasks.filter(t => !t.done && t.due_at && new Date(t.due_at.replace(' ', 'T') + 'Z') <= end).length;
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }
  let shortcutDone = false;
  function runShortcut() {
    if (shortcutDone) return; shortcutDone = true;
    const a = new URLSearchParams(location.search).get('action'); if (!a) return;
    history.replaceState(null, '', location.pathname);
    if (a === 'nueva-tarea') setTimeout(() => document.getElementById('newTaskFab')?.click(), 50);
    if (a === 'nuevo-gasto') { currentSection = 'gastos'; render(); setTimeout(() => document.getElementById('newMovFab')?.click(), 50); }
  }
  function onRender() { if (typeof currentSection !== 'undefined' && currentSection !== 'chat') document.body.classList.remove('chat-typing'); syncInstall(); syncOnline(); updateBadge(); runShortcut(); }

  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

  window.MobileX = { swipeable, haptic, onRender };
})();
