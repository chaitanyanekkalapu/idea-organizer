// Offline cache for the app shell. Bump VERSION whenever a file changes so
// phones pick up the new copy.
const VERSION = 'ideas-v8';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/config.js', 'js/db.js', 'js/drive.js', 'js/smart.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'share-inbox').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Share target: another app (NeoSapien, WhatsApp, Recorder…) shared text or
// files to Idea Organizer. Park them in a cache and open the app, which turns
// them into a memory.
const INBOX = 'share-inbox';
async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open(INBOX);
  const files = form.getAll('files').filter(f => f && f.size);
  const meta = {
    at: Date.now(),
    title: form.get('title') || '',
    text: form.get('text') || '',
    url: form.get('url') || '',
    files: files.map((f, i) => ({ key: `inbox/file-${i}`, name: f.name || `shared-${i}`, type: f.type || '' })),
  };
  for (const [i, f] of files.entries()) {
    await cache.put(`inbox/file-${i}`, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
  }
  await cache.put('inbox/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  return Response.redirect('./?shared=1', 303);
}

// Network first so updates show up straight away; cache when offline.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(e.request).catch(() => Response.redirect('./?shared=error', 303)));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // cache: 'no-cache' revalidates with the server, so the browser's HTTP cache
  // can't hand back an old index.html next to a new app.js.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const noteId = e.notification.data && e.notification.data.noteId;
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    const win = list[0];
    if (win) { win.focus(); if (noteId) win.postMessage({ open: noteId }); return; }
    return self.clients.openWindow('./');
  }));
});
