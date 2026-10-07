// Service Worker — caché de la app (funciona sin conexión) y avisos push.
const CACHE = 'gestion-v2';
const SHELL = ['./', './index.html', './mobile.js', './assistant.js', './notes-editor.js', './notes-rich.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))   // un fichero ausente no rompe la instalación
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la red (para ver siempre la última versión); si falla o tarda >4 s, la copia guardada.
function networkFirst(req, fallbackUrl) {
  return new Promise((resolve) => {
    let settled = false;
    const fromCache = () => caches.match(req).then((r) => r || (fallbackUrl && caches.match(fallbackUrl)));
    const timer = setTimeout(() => fromCache().then((r) => { if (r && !settled) { settled = true; resolve(r); } }), 4000);
    fetch(req).then((res) => {
      clearTimeout(timer);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      fromCache().then((r) => { if (!settled) { settled = true; resolve(r || Response.error()); } });
    });
  });
}

// Primero la copia (fuentes, imágenes, trozos con hash del editor de diagramas) y se refresca en segundo plano.
function staleWhileRevalidate(req) {
  return caches.open(CACHE).then((c) => c.match(req).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (/\/(api|auth|assistant|push|send-reminders)\.php$/.test(url.pathname) || url.pathname.endsWith('/sw.js')) return;   // datos: siempre a la red
    if (url.pathname.includes('/diagrams/')) { event.respondWith(staleWhileRevalidate(req)); return; }
    event.respondWith(networkFirst(req, req.mode === 'navigate' ? './index.html' : null));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

self.addEventListener('push', (event) => {
  let data = { title: 'Mis pendientes', body: 'Tienes un aviso.' };
  try { data = event.data.json(); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});