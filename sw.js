const CACHE_NAME = 'raujin-ql-v1';
const OFFLINE_URLS = ['/', '/index.html'];

// ── INSTALL: cache shell ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(OFFLINE_URLS))
  );
  self.skipWaiting();
});

// ── ACTIVATE: clean old caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: network-first, fallback to cache ──
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Supabase API — always network
  if (e.request.url.includes('supabase.co')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  const options = {
    body: data.body || 'Есть задачи на сегодня',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/?view=today' },
    actions: [
      { action: 'open', title: 'Открыть' },
      { action: 'dismiss', title: 'Закрыть' }
    ]
  };
  e.waitUntil(
    self.registration.showNotification(data.title || 'RAUJIN Quest Log', options)
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      const url = e.notification.data?.url || '/';
      for (const c of cls) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          c.postMessage({ type: 'NAVIGATE', url });
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// ── BACKGROUND SYNC: queue offline mutations ──
self.addEventListener('sync', e => {
  if (e.tag === 'sync-quests') {
    e.waitUntil(syncQueue());
  }
});

async function syncQueue() {
  const db = await openIDB();
  const queue = await getAll(db, 'sync_queue');
  for (const item of queue) {
    try {
      await fetch(item.url, { method: item.method, headers: item.headers, body: item.body });
      await deleteItem(db, 'sync_queue', item.id);
    } catch (err) {
      break; // still offline, stop
    }
  }
}

// Minimal IndexedDB helpers for sync queue
function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('raujin_sw', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = e => res(e.target.result);
    req.onerror = () => rej(req.error);
  });
}
function getAll(db, store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function deleteItem(db, store, id) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
