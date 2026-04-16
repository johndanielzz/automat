// ============================================================
// MAT AUTO — Service Worker v3.0  (Production)
// Strategy: Stale-While-Revalidate for HTML,
//           Cache-First for assets,
//           Network-Only for Firebase/API
// ============================================================

const CACHE_VERSION    = 'mat-auto-v3';
const STATIC_CACHE     = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE    = `${CACHE_VERSION}-dynamic`;
const IMAGE_CACHE      = `${CACHE_VERSION}-images`;
const FONT_CACHE       = `${CACHE_VERSION}-fonts`;
const MAX_DYNAMIC_ITEMS = 60;
const MAX_IMAGE_ITEMS   = 40;

const STATIC_ASSETS = [
    '/index.html', '/about.html', '/admin.html', '/checkout.html',
    '/contact.html', '/features.html', '/orders.html',
    '/promos.html', '/reviews.html', '/faq.html', '/track.html', '/warranty.html',
    '/styles.css', '/app.js', '/manifest.json'
];

const FONT_ORIGINS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

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
                    if (res.ok) caches.open(STATIC_CACHE).then(c => c.put(request, res));
                }).catch(() => {});
                return cached;
            }
            const fresh = await fetch(request);
            if (fresh.ok) caches.open(STATIC_CACHE).then(c => c.put(request, fresh.clone()));
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
            const fallback = await caches.match('/index.html');
            return fallback || new Response('<h1>Offline</h1><p>Check your connection.</p>', {
                headers: { 'Content-Type': 'text/html' }
            });
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
});
