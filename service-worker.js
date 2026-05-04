// ============================================================
// MAT AUTO — Service Worker v3.0  (Production)
// Strategy: Stale-While-Revalidate for HTML,
//           Cache-First for assets,
//           Network-Only for Firebase/API
// ============================================================

const CACHE_VERSION    = 'mat-auto-v18';
const STATIC_CACHE     = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE    = `${CACHE_VERSION}-dynamic`;
const IMAGE_CACHE      = `${CACHE_VERSION}-images`;
const FONT_CACHE       = `${CACHE_VERSION}-fonts`;
const MAX_DYNAMIC_ITEMS = 60;
const MAX_IMAGE_ITEMS   = 40;
const PRODUCT_UPLOAD_QUEUE_DB    = 'matAutoUploadQueue';
const PRODUCT_UPLOAD_QUEUE_STORE = 'productJobs';
const PRODUCT_UPLOAD_SYNC_TAG    = 'sync-product-uploads';
const PRODUCT_ALERT_SYNC_TAG     = 'sync-product-alerts';
const DEFAULT_PRODUCT_DATABASE_URL = 'https://automat-gm-default-rtdb.firebaseio.com';
const META_DB_NAME               = 'matAutoMeta';
const META_DB_STORE              = 'kv';
const PRODUCT_ALERT_STATE_KEY    = 'product-alert-state';
const PRODUCT_ALERT_NOTIFICATION_TAG = 'mat-auto-product-alerts';

const STATIC_ASSETS = [
    './index.html', './about.html', './owner.html', './products.html', './mat-ai.html', './admin.html', './checkout.html',
    './contact.html', './features.html', './orders.html', './offline.html',
    './promos.html', './reviews.html', './faq.html', './track.html', './warranty.html',
    './reciept.html', './receipt.html', './delivery-drivers.html',
    './styles.css', './mat-ai.css', './app.js', './mat-ai-config.js', './mat-ai-browser-fallback.js', './mat-ai.js', './app-perf-patch.js', './manifest.json',
    './app.js?v=2026-05-01-7',
    './mat-ai-config.js?v=2026-05-05-1', './mat-ai.js?v=2026-05-05-1'
];

const FONT_ORIGINS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
let productAlertSyncPromise = null;

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

function openMetaDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(META_DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(META_DB_STORE)) {
                db.createObjectStore(META_DB_STORE, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Meta store unavailable'));
    });
}

async function getMetaValue(key) {
    const db = await openMetaDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(META_DB_STORE, 'readonly');
        const request = tx.objectStore(META_DB_STORE).get(key);
        request.onsuccess = () => resolve(request.result?.value);
        request.onerror = () => reject(request.error || new Error('Could not load meta value'));
        tx.oncomplete = () => db.close();
        tx.onerror = tx.onabort = () => {
            db.close();
            reject(tx.error || new Error('Could not load meta value'));
        };
    });
}

async function setMetaValue(key, value) {
    const db = await openMetaDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(META_DB_STORE, 'readwrite');
        tx.objectStore(META_DB_STORE).put({ key, value });
        tx.oncomplete = () => {
            db.close();
            resolve(value);
        };
        tx.onerror = tx.onabort = () => {
            db.close();
            reject(tx.error || new Error('Could not save meta value'));
        };
    });
}

function normalizeProductAlertState(state) {
    return {
        enabled   : Boolean(state?.enabled),
        databaseUrl: String(state?.databaseUrl || DEFAULT_PRODUCT_DATABASE_URL).trim().replace(/\/+$/, ''),
        knownKeys : Array.isArray(state?.knownKeys) ? state.knownKeys.map(key => String(key || '')).filter(Boolean) : [],
        lastSyncAt: String(state?.lastSyncAt || ''),
        lastNotifiedAt: String(state?.lastNotifiedAt || ''),
    };
}

async function getProductAlertState() {
    return normalizeProductAlertState(await getMetaValue(PRODUCT_ALERT_STATE_KEY).catch(() => null));
}

async function saveProductAlertState(state) {
    return setMetaValue(PRODUCT_ALERT_STATE_KEY, normalizeProductAlertState(state));
}

function normalizeProductAlertProducts(raw) {
    const list = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object'
            ? Object.values(raw)
            : [];

    return list
        .filter(Boolean)
        .map((product, index) => {
            const id = product?.id ?? product?.sku ?? product?.name ?? `product-${index}`;
            const createdAt = String(product?.createdAt || '');
            const numericCreatedAt = createdAt ? Date.parse(createdAt) : NaN;
            return {
                key        : String(id),
                id         : String(id),
                name       : String(product?.name || 'New Product').trim(),
                category   : String(product?.category || 'parts').trim(),
                price      : Number(product?.price) || 0,
                stock      : Number(product?.stock) || 0,
                image      : String(product?.image || ''),
                createdAt,
                createdAtMs: Number.isFinite(numericCreatedAt) ? numericCreatedAt : 0,
            };
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs || b.id.localeCompare(a.id));
}

async function fetchLiveProducts(databaseUrl) {
    const base = String(databaseUrl || DEFAULT_PRODUCT_DATABASE_URL).trim().replace(/\/+$/, '');
    const response = await fetch(`${base}/matAutoProducts.json`, {
        headers: { 'Accept': 'application/json' },
        cache  : 'no-store',
    });
    if (!response.ok) {
        throw new Error(`Product notification sync failed (${response.status})`);
    }
    const raw = await response.json().catch(() => []);
    return normalizeProductAlertProducts(raw);
}

function buildProductAlertBody(products) {
    if (!products.length) return 'New parts are now live at Mat Auto.';
    if (products.length === 1) return `${products[0].name} just arrived. Tap to view it in the app.`;
    const names = products.slice(0, 3).map(product => product.name).join(', ');
    const remainder = products.length > 3 ? ` and ${products.length - 3} more` : '';
    return `${names}${remainder} just arrived at Mat Auto.`;
}

async function showNewProductsNotification(newProducts) {
    if (!newProducts.length || !self.registration?.showNotification) return;
    await self.registration.showNotification('New parts just arrived', {
        body : buildProductAlertBody(newProducts),
        icon : '/image.jpg',
        badge: '/image.jpg',
        tag  : PRODUCT_ALERT_NOTIFICATION_TAG,
        renotify: true,
        data : {
            url  : './products.html?new=1',
            type : 'new-products',
            ids  : newProducts.map(product => product.id),
        },
    });
}

async function broadcastProductAlertStatus(detail) {
    await broadcastUploadEvent({
        type: 'PRODUCT_ALERTS_STATUS',
        detail,
    });
}

async function syncProductAlerts(options = {}) {
    if (productAlertSyncPromise) return productAlertSyncPromise;

    productAlertSyncPromise = (async () => {
        const currentState = await getProductAlertState();
        const nextState = {
            ...currentState,
            databaseUrl: String(options.databaseUrl || currentState.databaseUrl || DEFAULT_PRODUCT_DATABASE_URL).trim().replace(/\/+$/, ''),
        };

        if (typeof options.enabled === 'boolean') {
            nextState.enabled = options.enabled;
        }

        const shouldFetchBaseline = options.forceBaseline === true || nextState.enabled;
        if (!shouldFetchBaseline) {
            await saveProductAlertState(nextState);
            return { status: 'disabled', state: nextState, newCount: 0 };
        }

        const liveProducts = await fetchLiveProducts(nextState.databaseUrl);
        const currentKeys = liveProducts.map(product => product.key);
        const knownKeys = new Set(nextState.knownKeys);

        let newProducts = [];
        const hasBaseline = nextState.knownKeys.length > 0;
        if (hasBaseline) {
            newProducts = liveProducts.filter(product => !knownKeys.has(product.key));
        }

        nextState.knownKeys = currentKeys;
        nextState.lastSyncAt = new Date().toISOString();

        const canNotify = nextState.enabled && Notification.permission === 'granted' && hasBaseline && newProducts.length > 0;
        if (canNotify) {
            await showNewProductsNotification(newProducts);
            nextState.lastNotifiedAt = new Date().toISOString();
        }

        await saveProductAlertState(nextState);
        await broadcastProductAlertStatus({
            status  : canNotify ? 'notified' : 'synced',
            reason  : String(options.reason || ''),
            newCount: newProducts.length,
            enabled : nextState.enabled,
            lastSyncAt: nextState.lastSyncAt,
        });

        return {
            status: canNotify ? 'notified' : 'synced',
            state: nextState,
            newCount: newProducts.length,
        };
    })().finally(() => {
        productAlertSyncPromise = null;
    });

    return productAlertSyncPromise;
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

function normalizeQueuedProductUploadJob(job) {
    if (!job || typeof job !== 'object') return job;
    return {
        ...job,
        databaseUrl: String(job.databaseUrl || DEFAULT_PRODUCT_DATABASE_URL || '').trim()
    };
}

async function broadcastUploadEvent(message) {
    const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    await Promise.all(allClients.map(client => client.postMessage(message)));
}

function buildProductUploadUrl(databaseUrl, productId) {
    const cleanBase = String(databaseUrl || '').trim().replace(/\/+$/, '');
    if (!cleanBase) return '';
    return `${cleanBase}/matAutoProducts/${encodeURIComponent(productId)}.json`;
}

async function postQueuedProductUploadToFirebase(job) {
    const uploadUrl = buildProductUploadUrl(job.databaseUrl || DEFAULT_PRODUCT_DATABASE_URL, job.product?.id);
    if (!uploadUrl) {
        throw new Error('Firebase Database URL is not configured for product uploads.');
    }

    const response = await fetch(uploadUrl, {
        method  : 'PUT',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify(job.product)
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Firebase upload failed (${response.status})`);
    }
}

async function postQueuedProductUploadToAdminApi(job) {
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

async function postQueuedProductUpload(job) {
    const errors = [];

    if (job?.databaseUrl) {
        try {
            return await postQueuedProductUploadToFirebase(job);
        } catch (err) {
            errors.push(err);
        }
    }

    try {
        return await postQueuedProductUploadToAdminApi(job);
    } catch (err) {
        errors.push(err);
    }

    throw errors[0] || new Error('Upload failed');
}

async function flushQueuedProductUploads() {
    const jobs = await getQueuedProductUploadJobs().catch(() => []);
    for (const rawJob of jobs) {
        const job = normalizeQueuedProductUploadJob(rawJob);
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
    if (event.data?.type === 'ENABLE_PRODUCT_ALERTS') {
        event.waitUntil(syncProductAlerts({
            enabled: true,
            databaseUrl: event.data?.databaseUrl,
            forceBaseline: event.data?.forceBaseline === true,
            reason: event.data?.reason || 'enable-alerts',
        }));
    }
    if (event.data?.type === 'DISABLE_PRODUCT_ALERTS') {
        event.waitUntil(syncProductAlerts({
            enabled: false,
            databaseUrl: event.data?.databaseUrl,
            reason: event.data?.reason || 'disable-alerts',
        }));
    }
    if (event.data?.type === 'SYNC_PRODUCT_ALERTS') {
        event.waitUntil(syncProductAlerts({
            databaseUrl: event.data?.databaseUrl,
            reason: event.data?.reason || 'manual-sync',
        }));
    }
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
    event.waitUntil((async () => {
        const targetUrl = new URL(event.notification.data?.url || './', self.location.origin).href;
        const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windowClients) {
            if ('focus' in client && client.url === targetUrl) {
                return client.focus();
            }
        }
        const reusable = windowClients.find(client => 'focus' in client);
        if (reusable) {
            reusable.navigate?.(targetUrl);
            return reusable.focus();
        }
        return clients.openWindow(targetUrl);
    })());
});

self.addEventListener('sync', event => {
    if (event.tag === 'sync-orders') console.log('[SW] Background sync: orders');
    if (event.tag === PRODUCT_UPLOAD_SYNC_TAG) event.waitUntil(flushQueuedProductUploads());
    if (event.tag === PRODUCT_ALERT_SYNC_TAG) event.waitUntil(syncProductAlerts({ reason: 'background-sync' }));
});
