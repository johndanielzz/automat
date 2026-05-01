// ============================================================
// MAT AUTO — Service Worker v3.0  (Production)
// Strategy: Stale-While-Revalidate for HTML,
//           Cache-First for assets,
//           Network-Only for Firebase/API
// ============================================================

const CACHE_VERSION    = 'mat-auto-v6';
const STATIC_CACHE     = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE    = `${CACHE_VERSION}-dynamic`;
const IMAGE_CACHE      = `${CACHE_VERSION}-images`;
const FONT_CACHE       = `${CACHE_VERSION}-fonts`;
const MAX_DYNAMIC_ITEMS = 60;
const MAX_IMAGE_ITEMS   = 40;
const PRODUCT_UPLOAD_QUEUE_DB    = 'matAutoUploadQueue';
const PRODUCT_UPLOAD_QUEUE_STORE = 'productJobs';
const PRODUCT_UPLOAD_SYNC_TAG    = 'sync-product-uploads';

const STATIC_ASSETS = [
    './index.html', './about.html', './owner.html', './mat-ai.html', './admin.html', './checkout.html',
    './contact.html', './features.html', './orders.html', './offline.html',
    './promos.html', './reviews.html', './faq.html', './track.html', './warranty.html',
    './reciept.html', './receipt.html', './delivery-drivers.html',
    './styles.css', './mat-ai.css', './app.js', './mat-ai.js', './app-perf-patch.js', './manifest.json'
];

const FONT_ORIGINS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

function openProductUploadQueueDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(PRODUCT_UPLOAD_QUEUE_DB, 1);
        request.onupgradeneeded = () => {
            const queueDb = request.result;
            if (!queueDb.objectStoreNames.contains(PRODUCT_UPLOAD_QUEUE_STORE)) {
                queueDb.createObjectStore(PRODUCT_UPLOAD_QUEUE_STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror   = () => reject(request.error || new Error('Upload queue unavailable'));
    });
}

async function getQueuedProductUploadJobs() {
    const queueDb = await openProductUploadQueueDb();
    return new Promise((resolve, reject) => {
        const tx      = queueDb.transaction(PRODUCT_UPLOAD_QUEUE_STORE, 'readonly');
        const request = tx.objectStore(PRODUCT_UPLOAD_QUEUE_STORE).getAll();
        request.onsuccess = () => resolve((request.result || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')));
        request.onerror   = () => reject(request.error || new Error('Could not load queued uploads'));
        tx.oncomplete     = () => queueDb.close();
        tx.onerror = tx.onabort = () => {
            queueDb.close();
            reject(tx.error || new Error('Could not load queued uploads'));
        };
    });
}

async function deleteQueuedProductUploadJob(jobId) {
    const queueDb = await openProductUploadQueueDb();
    return new Promise((resolve, reject) => {
        const tx = queueDb.transaction(PRODUCT_UPLOAD_QUEUE_STORE, 'readwrite');
        tx.objectStore(PRODUCT_UPLOAD_QUEUE_STORE).delete(jobId);
        tx.oncomplete = () => {
            queueDb.close();
            resolve();
        };
        tx.onerror = tx.onabort = () => {
            queueDb.close();
            reject(tx.error || new Error('Could not delete queued upload'));
        };
    });
}

async function broadcastUploadEvent(message) {
    const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    await Promise.all(allClients.map(client => client.postMessage(message)));
}

async function postQueuedProductUpload(job) {
    const response = await fetch('/api/admin/products', {
        method  : 'POST',
        headers : {
            'Content-Type': 'application/json',
            'X-Admin-Key' : job.adminKey || ''
        },
        body: JSON.stringify({ product: job.product })
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${response.status})`);
    }
}

async function flushQueuedProductUploads() {
    const jobs = await getQueuedProductUploadJobs().catch(() => []);
    for (const job of jobs) {
        try {
            await postQueuedProductUpload(job);
            await deleteQueuedProductUploadJob(job.id);
            await broadcastUploadEvent({
                type    : 'PRODUCT_UPLOAD_COMPLETE',
                jobId   : job.id,
                product : job.product
            });
        } catch (err) {
            await broadcastUploadEvent({
                type    : 'PRODUCT_UPLOAD_FAILED',
                jobId   : job.id,
                product : job.product,
                error   : err.message || 'Upload failed'
            });
            throw err;
        }
    }
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => Promise.allSettled(
                STATIC_ASSETS.map(url =>
                    fetch(url, { cache: 'reload' })
                        .then(res => { if (res.ok) cache.put(url, res); })
                        .catch(() => {})
                )
            ))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    const CURRENT = [STATIC_CACHE, DYNAMIC_CACHE, IMAGE_CACHE, FONT_CACHE];
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(
                names.filter(n => n.startsWith('mat-auto-') && !CURRENT.includes(n))
                     .map(n => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

async function trimCache(cacheName, maxItems) {
    const cache = await caches.open(cacheName);
    const keys  = await cache.keys();
    if (keys.length > maxItems) await cache.delete(keys[0]);
}

function isExternal(url) {
    return ['firebasedatabase.app','firebaseio.com','googleapis.com','gstatic.com',
            'firebasestorage','google-analytics','anthropic.com']
        .some(h => url.hostname.includes(h)) || url.pathname.includes('/v1/messages');
}

function isFont(url)   { return FONT_ORIGINS.some(h => url.hostname.includes(h)); }
function isImage(url)  { return /\.(jpg|jpeg|png|webp|svg|gif|ico|avif)$/.test(url.pathname); }
function isStatic(url) { return /\.(css|js|json|webmanifest)$/.test(url.pathname); }
function isHTML(url, req) {
    return req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/';
}

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;
    let url; try { url = new URL(request.url); } catch { return; }

    if (isExternal(url)) {
        event.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
        return;
    }

    if (isFont(url)) {
        event.respondWith(caches.open(FONT_CACHE).then(async cache => {
            const cached = await cache.match(request);
            if (cached) return cached;
            const fresh = await fetch(request);
            if (fresh.ok) cache.put(request, fresh.clone());
            return fresh;
        }));
        return;
    }

    if (isImage(url)) {
        event.respondWith(caches.open(IMAGE_CACHE).then(async cache => {
            const cached = await cache.match(request);
            const networkFetch = fetch(request).then(res => {
                if (res.ok) { cache.put(request, res.clone()); trimCache(IMAGE_CACHE, MAX_IMAGE_ITEMS); }
                return res;
            }).catch(() => null);
            return cached || networkFetch || new Response('', { status: 404 });
        }));
        return;
    }

    if (isStatic(url)) {
        event.respondWith(caches.match(request).then(async cached => {
            if (cached) {
                fetch(request).then(res => {
                    if (res.ok) {
                        const resClone = res.clone();
                        caches.open(STATIC_CACHE).then(c => c.put(request, resClone));
                    }
                }).catch(() => {});
                return cached;
            }
            const fresh = await fetch(request);
            if (fresh.ok) {
                const freshClone = fresh.clone();
                caches.open(STATIC_CACHE).then(c => c.put(request, freshClone));
            }
            return fresh;
        }).catch(() => caches.match(request)));
        return;
    }

    if (isHTML(url, request)) {
        event.respondWith(caches.open(DYNAMIC_CACHE).then(async cache => {
            const cached = await cache.match(request);
            const networkFetch = fetch(request).then(res => {
                if (res.ok) { cache.put(request, res.clone()); trimCache(DYNAMIC_CACHE, MAX_DYNAMIC_ITEMS); }
                return res;
            }).catch(() => null);
            if (cached) { networkFetch.catch(() => {}); return cached; }
            const fresh = await networkFetch;
            if (fresh) return fresh;
            // Try to serve offline.html as fallback
            const offline = await caches.match('./offline.html');
            return offline || await caches.match('./index.html') || new Response('Check your connection', { status: 503 });
        }));
        return;
    }

    event.respondWith(
        fetch(request).then(res => {
            if (res.ok) caches.open(DYNAMIC_CACHE).then(c => c.put(request, res.clone()));
            return res;
        }).catch(() => caches.match(request))
    );
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
    if (event.data?.type === 'CLEAR_CACHE') caches.keys().then(n => n.forEach(k => caches.delete(k)));
    if (event.data?.type === 'FLUSH_PRODUCT_UPLOADS') event.waitUntil(flushQueuedProductUploads());
});

self.addEventListener('push', event => {
    if (!event.data) return;
    try {
        const d = event.data.json();
        event.waitUntil(self.registration.showNotification(d.title || 'Mat Auto', {
            body: d.body || 'New notification', icon: '/image.jpg', badge: '/image.jpg',
            data: { url: d.url || '/' }
        }));
    } catch(e) {}
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});

self.addEventListener('sync', event => {
    if (event.tag === 'sync-orders') console.log('[SW] Background sync: orders');
    if (event.tag === PRODUCT_UPLOAD_SYNC_TAG) event.waitUntil(flushQueuedProductUploads());
});
