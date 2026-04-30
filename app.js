"use strict";

const APP_BUILD = "2026-04-30-4";
console.info(`Mat Auto app.js build ${APP_BUILD} loaded.`);

// ===========================================================================
// MAT AUTO — app.js  v5.0  (Production — CORS-safe + Performance Upgrade)
// ===========================================================================

// ---------------------------------------------------------------------------
// SITE CONFIG
// ---------------------------------------------------------------------------
const SITE_CONFIG = {
    whatsappNumber      : "2206785316",
    whatsappNumberAlt   : "2202328902",
    whatsappLinkPrimary : "https://wa.me/message/BRC6GJHD6PHCC1",
    whatsappLinkAlt     : "https://wa.me/qr/FDKDUI5V625OE1",
    facebookUrl         : "https://www.facebook.com/profile.php?id=61574154117727",
    storeName           : "Mat Auto",
    currency            : "GMD",
    productsPerPage     : 12,
    lowStockThreshold   : 3,
    // ▼ Max dimensions for compressed base64 preview images (keeps DB size small)
    imgMaxWidth         : 800,
    imgMaxHeight        : 800,
    imgQuality          : 0.78   // JPEG quality 0–1
};

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------
const ADMIN_PASSWORD = "MATADMIN2026";
const ADMIN_AUTH_KEY = "matAutoAdminAuth";

// ---------------------------------------------------------------------------
// FIREBASE INIT
// ---------------------------------------------------------------------------
const firebaseConfig = {
    apiKey           : "AIzaSyDAsfnmdDBoveZtX3bfTbbBOHXfruVbmgY",
    authDomain       : "automat-gm.firebaseapp.com",
    databaseURL      : globalThis.__MAT_AUTO_FIREBASE_DATABASE_URL__ || "https://automat-gm-default-rtdb.firebaseio.com",
    projectId        : "automat-gm",
    // Prefer the legacy appspot alias for web uploads; the newer bucket alias
    // can fail preflight/CORS checks in some browser + local-dev setups.
    storageBucket    : "automat-gm.appspot.com",
    messagingSenderId: "952445013066",
    appId            : "1:952445013066:web:510e78724ba1c62ab56ab3",
    measurementId    : "G-WNX6LETM6G"
};

const firebaseLib = (typeof globalThis !== "undefined" && globalThis.firebase) ? globalThis.firebase : null;

let firebaseApp = null;
if (firebaseLib) {
    try {
        firebaseApp = firebaseLib.apps?.length
            ? firebaseLib.app()
            : firebaseLib.initializeApp(firebaseConfig);
    } catch (err) {
        console.error("Firebase init failed:", err);
    }
} else {
    console.error("Firebase SDK not loaded before app.js.");
}

const db = firebaseApp && firebaseConfig.databaseURL ? firebaseLib.database() : null;

if (firebaseApp && !firebaseConfig.databaseURL) {
    console.warn("Firebase databaseURL is not configured for automat-gm. Realtime Database features stay disabled until that URL is supplied.");
}

// Try both bucket formats so uploads keep working across Firebase bucket aliases.
let storage = null;
if (firebaseApp && typeof firebaseLib.storage === "function") {
    const storageBuckets = Array.from(new Set([
        firebaseConfig.storageBucket ? `gs://${firebaseConfig.storageBucket}` : null,
        firebaseConfig.projectId ? `gs://${firebaseConfig.projectId}.firebasestorage.app` : null
    ].filter(Boolean)));

    for (const bucket of storageBuckets) {
        try {
            storage = firebaseLib.app().storage(bucket);
            // Quick connectivity probe — if this throws, try next bucket
            storage.ref();
            break;
        } catch {
            storage = null;
        }
    }
}

const isLocalDevHost = typeof location !== "undefined"
    && /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
let storageUploadDisabled = isLocalDevHost;

if (isLocalDevHost) {
    console.info("Local development detected. Product images will use the base64 fallback instead of direct Firebase Storage uploads.");
}

// ---------------------------------------------------------------------------
// FIREBASE PATH KEYS
// ---------------------------------------------------------------------------
const FB = {
    products  : "matAutoProducts",
    orders    : "matAutoOrders",
    quotes    : "matAutoQuotes",
    promos    : "matAutoPromos",
    contacts  : "matAutoContacts",
    newsletter: "matAutoNewsletter",
    reviews   : "matAutoReviews",
    settings  : "matAutoSettings"
};

// ---------------------------------------------------------------------------
// LOCAL STORAGE KEYS
// ---------------------------------------------------------------------------
const LS = {
    cart        : "maCart",
    wishlist    : "maWishlist",
    recent      : "maRecent",
    theme       : "maDarkMode",
    activeOrder : "maActiveOrder",
    myOrderIds  : "maMyOrderIds",
    allOrders   : "maAllOrders",
    productsDev : "maDevProducts"
};

// ---------------------------------------------------------------------------
// PLACEHOLDER IMAGE
// ---------------------------------------------------------------------------
const PLACEHOLDER_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'%3E%3Crect fill='%23e2e8f0' width='400' height='300'/%3E%3Ctext x='50%25' y='50%25' font-size='40' fill='%2394a3b8' text-anchor='middle' dominant-baseline='middle'%3E%F0%9F%94%A7%3C/text%3E%3C/svg%3E";

// ---------------------------------------------------------------------------
// APPLICATION STATE
// ---------------------------------------------------------------------------
const state = {
    products      : [],
    orders        : [],
    quotes        : [],
    promos        : [],
    reviews       : [],
    cart          : [],
    wishlist      : [],
    recentlyViewed: [],
    compareList   : [],
    activeProduct : null,
    currentFilter : "all",
    currentSort   : "featured",
    currentQuery  : "",
    currentPage   : 1,
    modalGalleryImages: [],
    modalGalleryIndex : 0,
    modalTouchStartX  : 0,
    modalTouchStartY  : 0
};

// ---------------------------------------------------------------------------
// UTILITY
// ---------------------------------------------------------------------------
const qs  = (sel, scope = document) => scope.querySelector(sel);
const qsa = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));

function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function sanitizeImageSrc(src) {
    if (!src) return PLACEHOLDER_IMAGE;
    if (src.startsWith("data:image/") || /^https?:\/\//.test(src)) return src;
    return PLACEHOLDER_IMAGE;
}

function formatCurrency(amount) {
    const n = Number(amount) || 0;
    return `GMD ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function generateId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 9999).toString(36)}`;
}

function getStockLabel(p) {
    if (p.stock <= 0) return "Out of stock";
    if (p.stock <= SITE_CONFIG.lowStockThreshold) return "Low stock";
    return "In stock";
}

function getRatingStars(r) {
    const n = Math.max(1, Math.min(5, Math.round(r)));
    return "★".repeat(n) + "☆".repeat(5 - n);
}

function getPrimaryImage(p) {
    return sanitizeImageSrc((Array.isArray(p.images) && p.images[0]) || p.image || PLACEHOLDER_IMAGE);
}

function normalizeProduct(p) {
    const images = Array.isArray(p.images) && p.images.length
        ? p.images.map(sanitizeImageSrc)
        : p.image ? [sanitizeImageSrc(p.image)] : [PLACEHOLDER_IMAGE];
    return { ...p, images, image: images[0], views: p.views || 0 };
}

function debounce(fn, ms = 250) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function formatDate(isoStr) {
    if (!isoStr) return "";
    try {
        return new Date(isoStr).toLocaleString("en-GB", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit"
        });
    } catch { return isoStr; }
}

// ---------------------------------------------------------------------------
// ✅ NEW: IMAGE COMPRESSION
// Resizes & compresses a File/Blob to a JPEG data URL using an off-screen canvas.
// Keeps images under ~100–150 KB so the Realtime DB doesn't balloon.
// ---------------------------------------------------------------------------
function compressImage(file, maxW = SITE_CONFIG.imgMaxWidth, maxH = SITE_CONFIG.imgMaxHeight, quality = SITE_CONFIG.imgQuality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("File read failed"));
        reader.onload  = evt => {
            const img = new Image();
            img.onerror = () => reject(new Error("Image decode failed"));
            img.onload  = () => {
                let { width, height } = img;
                const ratio = Math.min(maxW / width, maxH / height, 1);
                width  = Math.round(width  * ratio);
                height = Math.round(height * ratio);
                const canvas  = document.createElement("canvas");
                canvas.width  = width;
                canvas.height = height;
                canvas.getContext("2d").drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL("image/jpeg", quality);
                resolve(dataUrl);
            };
            img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ---------------------------------------------------------------------------
// ✅ NEW: SMART IMAGE UPLOADER
// Strategy:
//   1. Try Firebase Storage (fast CDN URLs, no size limit)
//   2. On ANY failure (CORS, network, quota) → fall back to compressed base64
//      stored directly in the Realtime Database.
// The admin never sees a hard error; images always save one way or the other.
// ---------------------------------------------------------------------------
async function uploadImages(files) {
    if (!files || !files.length) return [];

    const fileArr = Array.from(files).slice(0, 6);
    const uploadSingleImage = async (file) => {
        let url = null;

        // ── Attempt 1: Firebase Storage ─────────────────────────────────
        if (storage && !storageUploadDisabled) {
            try {
                const safeName = `products/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
                const ref      = storage.ref().child(safeName);

                // Set cache-control so images load fast on repeat visits
                const metadata = { cacheControl: "public,max-age=31536000", contentType: file.type };
                await ref.put(file, metadata);
                url = await ref.getDownloadURL();
            } catch (storageErr) {
                // CORS / network error — log a clean warning and fall through
                console.warn("Firebase Storage upload failed (falling back to base64):", storageErr.code || storageErr.message);
                storageUploadDisabled = true;
                url = null;
            }
        }

        // ── Attempt 2: Compressed base64 in Realtime DB ─────────────────
        if (!url) {
            try {
                url = await compressImage(file);
            } catch (b64Err) {
                console.error("Base64 fallback also failed:", b64Err);
                url = PLACEHOLDER_IMAGE;
            }
        }

        return url;
    };

    return Promise.all(fileArr.map(uploadSingleImage));
}

// ---------------------------------------------------------------------------
// LOCAL STORAGE HELPERS
// ---------------------------------------------------------------------------
function lsGet(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { console.warn("localStorage write failed:", key); }
}

function loadLocalState() {
    state.cart           = lsGet(LS.cart,    []);
    state.wishlist       = lsGet(LS.wishlist, []);
    state.recentlyViewed = lsGet(LS.recent,   []);
    if (isLocalDevHost) {
        state.products = normalizeFirebaseList(lsGet(LS.productsDev, state.products)).map(normalizeProduct);
    }
}

function saveCart()     { lsSet(LS.cart,     state.cart); }
function saveWishlist() { lsSet(LS.wishlist,  state.wishlist); }
function saveRecent()   { lsSet(LS.recent,    state.recentlyViewed); }

// ---------------------------------------------------------------------------
// FIREBASE HELPERS
// ---------------------------------------------------------------------------
function normalizeOrder(order) {
    const items = Array.isArray(order?.items) ? order.items : [];
    const customer = order?.customer && typeof order.customer === "object" ? order.customer : {};
    const delivery = order?.delivery && typeof order.delivery === "object" ? order.delivery : {};
    const normalized = {
        ...order,
        items,
        customer,
        delivery: {
            address      : delivery.address      || "",
            landmark     : delivery.landmark     || "",
            area         : delivery.area         || "",
            city         : delivery.city         || "Banjul",
            country      : delivery.country      || "Gambia",
            mapUrl       : delivery.mapUrl       || "",
            fee          : Number(delivery.fee) || 0,
            driverName   : delivery.driverName   || "",
            driverPhone  : delivery.driverPhone  || "",
            driverPrice  : Number(delivery.driverPrice) || 0,
            notes        : delivery.notes        || "",
            receiptBody  : delivery.receiptBody  || "",
            assignedAt   : delivery.assignedAt   || "",
            updatedAt    : delivery.updatedAt    || ""
        }
    };
    normalized.status = normalized.status || "Pending";
    normalized.total = Number(normalized.total) || 0;
    normalized.subtotal = Number(normalized.subtotal) || normalized.total || 0;
    normalized.discount = Number(normalized.discount) || 0;
    return normalized;
}

function syncOrderCache() {
    lsSet(LS.allOrders, state.orders.map(normalizeOrder));
}

function getOrderById(orderId) {
    return state.orders.find(order => order.id === orderId) || null;
}

function isDbReady() {
    if (db) return true;
    console.warn("Firebase Database not initialized.");
    return false;
}

function normalizeFirebaseList(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val.filter(Boolean);
    if (typeof val === "object") return Object.values(val).filter(Boolean);
    return [];
}

async function fbRead(path, fallback = null) {
    if (!db) return fallback;
    try {
        const snap = await db.ref(path).get();
        return snap.exists() ? snap.val() : fallback;
    } catch (err) { console.warn(`Firebase read failed (${path}):`, err); return fallback; }
}

async function fbWrite(path, value) {
    if (!isDbReady()) throw new Error("Firebase Database not initialized");
    await db.ref(path).set(value);
}

async function fbPush(path, value) {
    if (!isDbReady()) throw new Error("Firebase Database not initialized");
    await db.ref(path).push(value);
}

async function fbUpdate(path, updates) {
    if (!isDbReady()) throw new Error("Firebase Database not initialized");
    await db.ref(path).update(updates);
}

// ---------------------------------------------------------------------------
// FIREBASE REALTIME LISTENER FOR PRODUCTS
// ---------------------------------------------------------------------------
let productsListenerAttached = false;

function attachProductsListener() {
    if (!isDbReady() || productsListenerAttached) return;
    productsListenerAttached = true;
    db.ref(FB.products).on("value", snap => {
        const raw = snap.exists() ? snap.val() : [];
        state.products = normalizeFirebaseList(raw).map(normalizeProduct);
        updateHeroStats();
        if (qs("#featuredGrid"))       renderFeatured();
        if (qs("#productsGrid"))       refreshCatalog();
        if (qs("#recentlyViewedGrid")) renderRecentlyViewed();
        if (typeof renderAdminStats === "function") renderAdminStats();
    });
}

// ---------------------------------------------------------------------------
// INITIAL DATA LOAD
// ---------------------------------------------------------------------------
async function loadFirebaseState() {
    const [rawProducts, rawOrders, rawQuotes, rawPromos, rawReviews] = await Promise.all([
        fbRead(FB.products, []),
        fbRead(FB.orders,   []),
        fbRead(FB.quotes,   []),
        fbRead(FB.promos,   []),
        fbRead(FB.reviews,  [])
    ]);
    state.products = normalizeFirebaseList(rawProducts).map(normalizeProduct);
    state.orders   = normalizeFirebaseList(rawOrders).map(normalizeOrder);
    state.quotes   = normalizeFirebaseList(rawQuotes);
    state.promos   = normalizeFirebaseList(rawPromos);
    state.reviews  = normalizeFirebaseList(rawReviews);

    if (isLocalDevHost && !state.products.length) {
        state.products = normalizeFirebaseList(lsGet(LS.productsDev, [])).map(normalizeProduct);
    }
    if (!state.orders.length) {
        state.orders = normalizeFirebaseList(lsGet(LS.allOrders, [])).map(normalizeOrder);
    }
    syncOrderCache();
}

async function saveProducts() {
    try {
        await fbWrite(FB.products, state.products);
        if (isLocalDevHost) lsSet(LS.productsDev, state.products);
    } catch (err) {
        if (isLocalDevHost) {
            lsSet(LS.productsDev, state.products);
            console.warn("Firebase product save failed in local dev; saved product catalog to local fallback instead.", err);
            return;
        }
        throw err;
    }
}
async function saveProductRecord(product) {
    if (db) {
        await db.ref(`${FB.products}/${product.id}`).set(product);
        if (isLocalDevHost) lsSet(LS.productsDev, state.products);
        return;
    }
    if (isLocalDevHost) {
        lsSet(LS.productsDev, state.products);
        return;
    }
    throw new Error("Firebase Database not initialized");
}
async function saveOrders() {
    state.orders = state.orders.map(normalizeOrder);
    try {
        await fbWrite(FB.orders, state.orders);
        syncOrderCache();
    } catch (err) {
        syncOrderCache();
        if (isLocalDevHost) {
            console.warn("Firebase order save failed in local dev; saved orders to local fallback instead.", err);
            return;
        }
        throw err;
    }
}
async function saveQuotes()   { await fbWrite(FB.quotes,   state.quotes);   }
async function savePromos()   { await fbWrite(FB.promos,   state.promos);   }

// ---------------------------------------------------------------------------
// LOADING OVERLAY
// ---------------------------------------------------------------------------
function showLoader(msg = "Loading…") {
    let el = qs("#pageLoader");
    if (!el) {
        el = document.createElement("div");
        el.id = "pageLoader";
        el.innerHTML = `<div class="loader-inner"><div class="loader-spinner"></div><p>${escapeHtml(msg)}</p></div>`;
        document.body.appendChild(el);
    }
    el.style.display = "flex";
}
function hideLoader() {
    const el = qs("#pageLoader");
    if (el) el.style.display = "none";
}

// ---------------------------------------------------------------------------
// TOAST NOTIFICATIONS
// ---------------------------------------------------------------------------
function showToast(type, message, duration = 3500) {
    const stack = qs("#toastStack");
    if (!stack) return;
    const t = document.createElement("div");
    t.className = `toast toast-${type}`;
    const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
    t.innerHTML = `<span class="toast-icon">${icons[type] || "ℹ️"}</span><span>${escapeHtml(message)}</span>`;
    stack.appendChild(t);
    requestAnimationFrame(() => t.classList.add("toast-in"));
    setTimeout(() => { t.classList.add("toast-out"); setTimeout(() => t.remove(), 400); }, duration);
}

// ---------------------------------------------------------------------------
// THEME
// ---------------------------------------------------------------------------
function loadTheme() {
    const isDark = localStorage.getItem(LS.theme) === "true";
    document.body.classList.toggle("dark-mode", isDark);
    updateThemeButton();
}
function updateThemeButton() {
    const btn = qs("#darkModeBtn");
    if (btn) btn.textContent = document.body.classList.contains("dark-mode") ? "☀ Light" : "🌙 Dark";
}
function toggleTheme() {
    const isDark = document.body.classList.toggle("dark-mode");
    localStorage.setItem(LS.theme, isDark);
    updateThemeButton();
}

// ---------------------------------------------------------------------------
// BADGE COUNTS
// ---------------------------------------------------------------------------
function updateBadgeCounts() {
    const set = (id, val) => { const el = qs(`#${id}`); if (el) el.textContent = String(val); };
    set("cartCount",     state.cart.length);
    set("wishlistCount", state.wishlist.length);
    set("compareCount",  state.compareList.length);
}

// ---------------------------------------------------------------------------
// MOBILE MENU
// ---------------------------------------------------------------------------
function setupMobileMenu() {
    const hamburger = qs("#hamburger");
    const navLinks  = qs("#navLinks");
    if (!hamburger || !navLinks) return;
    hamburger.addEventListener("click", () => {
        const active = hamburger.classList.toggle("active");
        navLinks.classList.toggle("active", active);
        hamburger.setAttribute("aria-expanded", String(active));
    });
    qsa("a, button", navLinks).forEach(el => el.addEventListener("click", () => {
        hamburger.classList.remove("active");
        navLinks.classList.remove("active");
        hamburger.setAttribute("aria-expanded", "false");
    }));
}

// ---------------------------------------------------------------------------
// MODAL HELPERS
// ---------------------------------------------------------------------------
function openModal(id) {
    const m = qs(`#${id}`);
    if (!m) return;
    m.style.display = "flex";
    m.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
}
function closeModal(modal) {
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
}
function bindModalClose() {
    qsa("[data-close-modal]").forEach(btn =>
        btn.addEventListener("click", () => closeModal(btn.closest(".modal")))
    );
    window.addEventListener("click", e => {
        if (e.target.classList.contains("modal")) closeModal(e.target);
    });
    window.addEventListener("keydown", e => {
        if (e.key === "Escape") { const m = qs(".modal[style*='flex']"); if (m) closeModal(m); }
    });
}

// ---------------------------------------------------------------------------
// PAGINATION
// ---------------------------------------------------------------------------
function renderPagination(total) {
    const bar = qs("#paginationBar");
    if (!bar) return;
    const pages = Math.ceil(total / SITE_CONFIG.productsPerPage);
    if (pages <= 1) { bar.innerHTML = ""; return; }
    const frag = document.createDocumentFragment();
    const mkBtn = (label, page, active = false, disabled = false) => {
        const b = document.createElement("button");
        b.className = `page-btn${active ? " active" : ""}`;
        b.textContent = label;
        b.disabled = disabled;
        if (!disabled) b.dataset.page = page;
        return b;
    };
    if (state.currentPage > 1) frag.appendChild(mkBtn("‹ Prev", state.currentPage - 1));
    for (let i = 1; i <= pages; i++) frag.appendChild(mkBtn(i, i, i === state.currentPage));
    if (state.currentPage < pages) frag.appendChild(mkBtn("Next ›", state.currentPage + 1));
    bar.innerHTML = "";
    bar.appendChild(frag);
    bar.addEventListener("click", e => {
        const btn = e.target.closest(".page-btn");
        if (!btn || !btn.dataset.page) return;
        state.currentPage = Number(btn.dataset.page);
        refreshCatalog();
        qs("#products")?.scrollIntoView({ behavior: "smooth" });
    });
}

// ---------------------------------------------------------------------------
// PRODUCT CARDS  (uses DocumentFragment for faster DOM insertion)
// ---------------------------------------------------------------------------
function renderProducts(list, targetId) {
    const grid = qs(`#${targetId}`);
    if (!grid) return;
    if (!list.length) {
        grid.innerHTML = `<div class="empty-state"><p>No products found.</p></div>`;
        return;
    }
    const frag = document.createDocumentFragment();
    list.forEach(product => {
        const inCompare  = state.compareList.includes(product.id);
        const inWishlist = state.wishlist.some(w => w.id === product.id);
        const card = document.createElement("article");
        card.className = "product-card";
        const stockClass = product.stock <= 0 ? "out" : product.stock <= SITE_CONFIG.lowStockThreshold ? "low" : "in";
        card.innerHTML = `
            <div class="product-media">
                <img src="${getPrimaryImage(product)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async">
                ${product.stock <= 0 ? `<span class="product-badge badge-out">Out of Stock</span>` : ""}
                ${product.stock > 0 && product.stock <= SITE_CONFIG.lowStockThreshold
                    ? `<span class="product-badge badge-low">Only ${product.stock} left</span>` : ""}
                ${product.featured ? `<span class="product-badge badge-featured">⭐ Featured</span>` : ""}
                <button class="card-wishlist-btn${inWishlist ? " active" : ""}" type="button"
                    data-quick-wishlist="${product.id}" aria-label="${inWishlist ? "Remove from wishlist" : "Add to wishlist"}">
                    ${inWishlist ? "♥" : "♡"}
                </button>
            </div>
            <div class="product-body">
                <div class="product-category">${escapeHtml(product.category.toUpperCase())}</div>
                <h3 class="product-name">${escapeHtml(product.name)}</h3>
                <div class="product-rating" title="${product.rating}/5">${getRatingStars(product.rating)}</div>
                <p class="product-price">${formatCurrency(product.price)}</p>
                <div class="product-stock-row">
                    <span class="stock-dot stock-${stockClass}"></span>
                    <span class="stock-label-sm">${getStockLabel(product)}</span>
                    ${product.views ? `<span class="view-count">👁 ${product.views}</span>` : ""}
                </div>
                <div class="product-actions">
                    <button class="btn btn-primary btn-sm" type="button" data-product-id="${product.id}">View Details</button>
                    <button class="btn btn-compare${inCompare ? " active" : ""} btn-sm" type="button"
                        data-compare-id="${product.id}" title="${inCompare ? "Remove from compare" : "Compare"}">
                        ${inCompare ? "✓" : "⇌"}
                    </button>
                </div>
            </div>`;
        frag.appendChild(card);
    });
    grid.innerHTML = "";
    grid.appendChild(frag);

    // Delegate events to grid (faster than per-card listeners)
    grid.addEventListener("click", e => {
        const viewBtn    = e.target.closest("[data-product-id]");
        const wishBtn    = e.target.closest("[data-quick-wishlist]");
        const compareBtn = e.target.closest("[data-compare-id]");
        if (viewBtn)    openProductModal(Number(viewBtn.dataset.productId));
        if (wishBtn)  { e.stopPropagation(); quickToggleWishlist(Number(wishBtn.dataset.quickWishlist), wishBtn); }
        if (compareBtn){ e.stopPropagation(); toggleCompare(Number(compareBtn.dataset.compareId)); }
    }, { once: false });
}

// ---------------------------------------------------------------------------
// FILTERING / SORTING
// ---------------------------------------------------------------------------
function filterAndSortProducts() {
    let list = [...state.products];
    if (state.currentFilter !== "all") list = list.filter(p => p.category === state.currentFilter);
    if (state.currentQuery) {
        const q = state.currentQuery.toLowerCase();
        list = list.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.description || "").toLowerCase().includes(q) ||
            (p.specs       || "").toLowerCase().includes(q)
        );
    }
    switch (state.currentSort) {
        case "price-low":  list.sort((a, b) => a.price - b.price); break;
        case "price-high": list.sort((a, b) => b.price - a.price); break;
        case "popular":    list.sort((a, b) => (b.views || 0) - (a.views || 0)); break;
        case "rating":     list.sort((a, b) => b.rating - a.rating); break;
        case "stock":      list.sort((a, b) => b.stock - a.stock); break;
        case "newest":     list.sort((a, b) => b.id - a.id); break;
        default: list.sort((a, b) => ((b.featured ? 10 : 0) + b.rating) - ((a.featured ? 10 : 0) + a.rating));
    }
    return list;
}

function refreshCatalog() {
    const all  = filterAndSortProducts();
    const from = (state.currentPage - 1) * SITE_CONFIG.productsPerPage;
    renderProducts(all.slice(from, from + SITE_CONFIG.productsPerPage), "productsGrid");
    const summary = qs("#resultsSummary");
    if (summary) summary.textContent = all.length
        ? `${all.length} product${all.length !== 1 ? "s" : ""} shown`
        : "No products match your search.";
    renderPagination(all.length);
}

function renderFeatured() {
    renderProducts(state.products.filter(p => p.featured).slice(0, 4), "featuredGrid");
}

function renderHeroPromos() {
    const list = qs("#heroPromoList");
    if (!list) return;
    list.innerHTML = state.promos.slice(0, 3).map(p =>
        `<div class="promo-mini"><strong>${escapeHtml(p.id)}</strong><span>${escapeHtml(p.details)}</span></div>`
    ).join("") || `<p style="color:#94a3b8;font-size:.85rem;">No active promos right now.</p>`;
}

function renderRecentlyViewed() {
    const grid = qs("#recentlyViewedGrid");
    if (!grid) return;
    const products = state.recentlyViewed.map(id => state.products.find(p => p.id === id)).filter(Boolean);
    if (!products.length) { grid.innerHTML = `<p class="empty-copy">Browse some products to see them here.</p>`; return; }
    renderProducts(products, "recentlyViewedGrid");
}

function updateHeroStats() {
    const set = (id, val) => { const el = qs(`#${id}`); if (el) el.textContent = val; };
    set("catalogCount", state.products.length);
    set("engineCount",  state.products.filter(p => p.category === "engine").length);
}

// ---------------------------------------------------------------------------
// CATALOG CONTROLS
// ---------------------------------------------------------------------------
function setupCatalogControls() {
    const filterBtns = qsa(".filter-btn");
    filterBtns.forEach(btn => btn.addEventListener("click", () => {
        filterBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.currentFilter = btn.dataset.filter;
        state.currentPage   = 1;
        refreshCatalog();
    }));

    qs("#sortSelect")?.addEventListener("change", e => {
        state.currentSort = e.target.value;
        state.currentPage = 1;
        refreshCatalog();
    });

    const secondary = qs("#secondarySearchInput");
    if (secondary) secondary.addEventListener("input", debounce(() => {
        state.currentQuery = secondary.value.trim();
        state.currentPage  = 1;
        refreshCatalog();
    }));

    qsa("[data-category-shortcut]").forEach(card => card.addEventListener("click", () => {
        state.currentFilter = card.dataset.categoryShortcut;
        state.currentPage   = 1;
        filterBtns.forEach(b => b.classList.toggle("active", b.dataset.filter === state.currentFilter));
        refreshCatalog();
        qs("#products")?.scrollIntoView({ behavior: "smooth" });
    }));
}

function setupHeroSearch() {
    qs("#heroSearchForm")?.addEventListener("submit", e => {
        e.preventDefault();
        const input = qs("#searchInput");
        if (!input) return;
        state.currentQuery = input.value.trim();
        state.currentPage  = 1;
        refreshCatalog();
        qs("#products")?.scrollIntoView({ behavior: "smooth" });
    });
}

// ---------------------------------------------------------------------------
// PRODUCT MODAL
// ---------------------------------------------------------------------------
function openProductModal(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    state.activeProduct = product;

    const set = (id, val) => { const el = qs(`#${id}`); if (el) el.textContent = val; };
    set("modalTitle",       product.name);
    set("modalRating",      getRatingStars(product.rating));
    set("modalPrice",       formatCurrency(product.price));
    set("modalCategory",    product.category.toUpperCase());
    set("modalDescription", product.description || "");
    set("modalSpecs",       product.specs || "");

    const modalImage  = qs("#modalImage");
    const stockStatus = qs("#stockStatus");
    const qtyInput    = qs("#quantityInput");
    const gallery     = qs("#modalGallery");
    const prevBtn     = qs("#modalPrevImage");
    const nextBtn     = qs("#modalNextImage");

    state.modalGalleryImages = product.images?.length
        ? product.images.map(sanitizeImageSrc)
        : [getPrimaryImage(product)];
    state.modalGalleryIndex = 0;

    if (stockStatus) {
        stockStatus.textContent = getStockLabel(product);
        stockStatus.className   = `stock-status ${product.stock <= 0 ? "out" : product.stock <= SITE_CONFIG.lowStockThreshold ? "low" : "in"}`;
    }
    if (qtyInput) { qtyInput.value = "1"; qtyInput.max = String(product.stock); }

    if (gallery) {
        gallery.innerHTML = state.modalGalleryImages.map((src, i) => `
            <button type="button" class="gallery-thumb${i === 0 ? " active" : ""}" data-gi="${i}">
                <img src="${sanitizeImageSrc(src)}" alt="${escapeHtml(product.name)} view ${i + 1}" loading="lazy">
            </button>`).join("");
    }
    if (prevBtn) prevBtn.hidden = state.modalGalleryImages.length <= 1;
    if (nextBtn) nextBtn.hidden = state.modalGalleryImages.length <= 1;
    updateModalGalleryImage();

    updateWishlistButton();
    updateModalButtons(product);
    trackRecentlyViewed(product.id);
    incrementProductViews(product.id);
    openModal("productModal");
}

function updateModalGalleryImage(index = state.modalGalleryIndex) {
    if (!state.activeProduct || !state.modalGalleryImages.length) return;
    const total = state.modalGalleryImages.length;
    state.modalGalleryIndex = ((Number(index) % total) + total) % total;

    const modalImage = qs("#modalImage");
    const gallery = qs("#modalGallery");
    const currentSrc = state.modalGalleryImages[state.modalGalleryIndex];

    if (modalImage) {
        modalImage.src = currentSrc;
        modalImage.alt = `${state.activeProduct.name} view ${state.modalGalleryIndex + 1}`;
    }
    if (gallery) {
        qsa(".gallery-thumb", gallery).forEach((thumb, i) => {
            thumb.classList.toggle("active", i === state.modalGalleryIndex);
            thumb.setAttribute("aria-current", i === state.modalGalleryIndex ? "true" : "false");
        });
    }
}

function stepModalGallery(delta) {
    if (state.modalGalleryImages.length <= 1) return;
    updateModalGalleryImage(state.modalGalleryIndex + delta);
}

function setupModalImageSwipe() {
    const modalImage = qs("#modalImage");
    if (!modalImage) return;

    modalImage.addEventListener("touchstart", e => {
        const touch = e.changedTouches?.[0];
        if (!touch) return;
        state.modalTouchStartX = touch.clientX;
        state.modalTouchStartY = touch.clientY;
    }, { passive: true });

    modalImage.addEventListener("touchend", e => {
        const touch = e.changedTouches?.[0];
        if (!touch || state.modalGalleryImages.length <= 1) return;

        const deltaX = touch.clientX - state.modalTouchStartX;
        const deltaY = touch.clientY - state.modalTouchStartY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (absX < 45 || absX <= absY) return;
        if (deltaX < 0) stepModalGallery(1);
        else stepModalGallery(-1);
    }, { passive: true });
}

function updateModalButtons(product) {
    const dis    = product.stock <= 0;
    const addBtn = qs("#modalAddToCart");
    const buyBtn = qs("#modalBuyNow");
    if (addBtn) { addBtn.disabled = dis; addBtn.textContent = dis ? "Out of Stock" : "Add to Cart"; }
    if (buyBtn) { buyBtn.disabled = dis; }
}

function getQtyFromModal() {
    const v = Number(qs("#quantityInput")?.value);
    return isNaN(v) || v < 1 ? 1 : v;
}
function updateModalQty(delta) {
    const input = qs("#quantityInput");
    if (!input || !state.activeProduct) return;
    input.value = Math.max(1, Math.min(Number(input.value) + delta, state.activeProduct.stock)).toString();
}

function setupModalActions() {
    qs("#modalAddToCart")?.addEventListener("click", () => { if (state.activeProduct) addToCart(state.activeProduct, getQtyFromModal()); });
    qs("#modalBuyNow")?.addEventListener("click",    buyNowActiveProduct);
    qs("#wishlistBtn")?.addEventListener("click",    toggleWishlistForActive);
    qs("#increaseQtyBtn")?.addEventListener("click", () => updateModalQty(1));
    qs("#decreaseQtyBtn")?.addEventListener("click", () => updateModalQty(-1));
    qs("#modalPrevImage")?.addEventListener("click", () => stepModalGallery(-1));
    qs("#modalNextImage")?.addEventListener("click", () => stepModalGallery(1));
    qs("#modalGallery")?.addEventListener("click", e => {
        const thumb = e.target.closest(".gallery-thumb");
        if (!thumb) return;
        updateModalGalleryImage(Number(thumb.dataset.gi));
    });
    window.addEventListener("keydown", e => {
        const modal = qs("#productModal");
        if (!modal || modal.getAttribute("aria-hidden") === "true") return;
        if (e.key === "ArrowLeft") stepModalGallery(-1);
        if (e.key === "ArrowRight") stepModalGallery(1);
    });
    setupModalImageSwipe();
}

function setupQuickAccess() {
    qs("#cartTrigger")?.addEventListener("click",     () => { renderCart();     openModal("cartModal"); });
    qs("#wishlistTrigger")?.addEventListener("click", () => { renderWishlist(); openModal("wishlistModal"); });
}

// ---------------------------------------------------------------------------
// PRODUCT VIEWS
// ---------------------------------------------------------------------------
const _viewDebounce = new Map();
async function incrementProductViews(productId) {
    if (!db) return;
    // Debounce: don't flood DB if the same product modal is opened repeatedly
    if (_viewDebounce.has(productId)) return;
    _viewDebounce.set(productId, true);
    setTimeout(() => _viewDebounce.delete(productId), 60_000);

    const idx = state.products.findIndex(p => p.id === productId);
    if (idx < 0) return;
    state.products[idx].views = (state.products[idx].views || 0) + 1;
    try { await db.ref(`${FB.products}/${idx}/views`).set(state.products[idx].views); } catch { /* silent */ }
}

// ---------------------------------------------------------------------------
// RECENTLY VIEWED
// ---------------------------------------------------------------------------
function trackRecentlyViewed(id) {
    state.recentlyViewed = [id, ...state.recentlyViewed.filter(x => x !== id)].slice(0, 8);
    saveRecent();
    if (qs("#recentlyViewedGrid")) renderRecentlyViewed();
}

// ---------------------------------------------------------------------------
// CART
// ---------------------------------------------------------------------------
function addToCart(product, quantity) {
    const existing = state.cart.find(i => i.id === product.id);
    if (existing) {
        existing.quantity = Math.min(existing.quantity + quantity, product.stock);
    } else {
        state.cart.push({ id: product.id, name: product.name, price: product.price,
            image: getPrimaryImage(product), quantity, category: product.category });
    }
    saveCart();
    updateBadgeCounts();
    showToast("success", `${product.name} added to cart`);
}

function updateCartQty(id, delta) {
    const item = state.cart.find(i => i.id === Number(id));
    if (!item) return;
    const p = state.products.find(p => p.id === Number(id));
    item.quantity = Math.min(Math.max(item.quantity + delta, 1), p ? p.stock : 99);
    saveCart();
    renderCart();
}

function removeFromCart(id) {
    const item = state.cart.find(i => i.id === Number(id));
    state.cart  = state.cart.filter(i => i.id !== Number(id));
    saveCart();
    updateBadgeCounts();
    renderCart();
    showToast("info", `${item?.name || "Item"} removed`);
}

function renderCart() {
    const container = qs("#cartItems");
    const summary   = qs("#cartSummaryText");
    if (!container) return;
    if (!state.cart.length) {
        container.innerHTML = `<p class="empty-copy">Your cart is empty. <a href="index.html#products">Browse products →</a></p>`;
        if (summary) summary.textContent = "Start adding products.";
    } else {
        container.innerHTML = state.cart.map(item => `
            <div class="cart-item">
                <img src="${sanitizeImageSrc(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">
                <div class="cart-item-info">
                    <strong>${escapeHtml(item.name)}</strong>
                    <span>${formatCurrency(item.price)}</span>
                    <div class="cart-qty">
                        <button type="button" data-cart-dec="${item.id}" aria-label="Decrease">−</button>
                        <span>${item.quantity}</span>
                        <button type="button" data-cart-inc="${item.id}" aria-label="Increase">+</button>
                    </div>
                </div>
                <div class="cart-item-total">
                    <span>${formatCurrency(item.price * item.quantity)}</span>
                    <button type="button" class="link-button" data-cart-remove="${item.id}">✕</button>
                </div>
            </div>`).join("");
    }
    const subtotal = state.cart.reduce((s, i) => s + i.price * i.quantity, 0);
    const set = (id, val) => { const el = qs(`#${id}`); if (el) el.textContent = val; };
    set("subtotal", formatCurrency(subtotal));
    set("total",    formatCurrency(subtotal));
    qsa("[data-cart-inc]",    container).forEach(b => b.addEventListener("click", () => updateCartQty(b.dataset.cartInc,    1)));
    qsa("[data-cart-dec]",    container).forEach(b => b.addEventListener("click", () => updateCartQty(b.dataset.cartDec,   -1)));
    qsa("[data-cart-remove]", container).forEach(b => b.addEventListener("click", () => removeFromCart(b.dataset.cartRemove)));
}

// ---------------------------------------------------------------------------
// WISHLIST
// ---------------------------------------------------------------------------
function quickToggleWishlist(id, btn) {
    const product = state.products.find(p => p.id === id);
    if (!product) return;
    const idx = state.wishlist.findIndex(w => w.id === id);
    if (idx >= 0) {
        state.wishlist.splice(idx, 1);
        btn.textContent = "♡"; btn.classList.remove("active");
        showToast("info", "Removed from wishlist");
    } else {
        state.wishlist.push({ id: product.id, name: product.name, price: product.price, image: getPrimaryImage(product) });
        btn.textContent = "♥"; btn.classList.add("active");
        showToast("success", "Saved to wishlist");
    }
    saveWishlist();
    updateBadgeCounts();
}

function updateWishlistButton() {
    const btn = qs("#wishlistBtn");
    if (!btn || !state.activeProduct) return;
    const has = state.wishlist.some(i => i.id === state.activeProduct.id);
    btn.textContent = has ? "♥ Saved to wishlist" : "♡ Save to wishlist";
    btn.classList.toggle("active", has);
}

function toggleWishlistForActive() {
    if (!state.activeProduct) return;
    const idx = state.wishlist.findIndex(i => i.id === state.activeProduct.id);
    if (idx >= 0) { state.wishlist.splice(idx, 1); showToast("info", "Removed from wishlist"); }
    else { state.wishlist.push({ id: state.activeProduct.id, name: state.activeProduct.name, price: state.activeProduct.price, image: getPrimaryImage(state.activeProduct) }); showToast("success", "Saved to wishlist"); }
    saveWishlist();
    updateBadgeCounts();
    updateWishlistButton();
}

function renderWishlist() {
    const container = qs("#wishlistItems");
    if (!container) return;
    if (!state.wishlist.length) { container.innerHTML = `<p class="empty-copy">Your wishlist is empty.</p>`; return; }
    container.innerHTML = state.wishlist.map(p => `
        <div class="wishlist-item">
            <img src="${sanitizeImageSrc(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy">
            <div class="wishlist-item-body"><strong>${escapeHtml(p.name)}</strong><span>${formatCurrency(p.price)}</span></div>
            <div class="wishlist-actions">
                <button class="btn btn-primary btn-sm" type="button" data-wv="${p.id}">View</button>
                <button class="btn btn-ghost btn-sm"   type="button" data-wr="${p.id}">Remove</button>
            </div>
        </div>`).join("");
    qsa("[data-wv]", container).forEach(b => b.addEventListener("click", () => { closeModal(qs("#wishlistModal")); openProductModal(Number(b.dataset.wv)); }));
    qsa("[data-wr]", container).forEach(b => b.addEventListener("click", () => { state.wishlist = state.wishlist.filter(i => i.id !== Number(b.dataset.wr)); saveWishlist(); updateBadgeCounts(); renderWishlist(); }));
}

// ---------------------------------------------------------------------------
// PRODUCT COMPARISON
// ---------------------------------------------------------------------------
function toggleCompare(id) {
    if (state.compareList.includes(id)) {
        state.compareList = state.compareList.filter(x => x !== id);
    } else {
        if (state.compareList.length >= 3) { showToast("warning", "Compare up to 3 products at a time"); return; }
        state.compareList.push(id);
    }
    updateBadgeCounts();
    renderCompareBar();
    refreshCatalog();
}

function renderCompareBar() {
    const bar = qs("#compareBar");
    if (!bar) return;
    if (!state.compareList.length) { bar.classList.remove("visible"); return; }
    bar.classList.add("visible");
    const products = state.compareList.map(id => state.products.find(p => p.id === id)).filter(Boolean);
    bar.innerHTML = `
        <div class="compare-bar-inner">
            <span class="compare-bar-label">Compare (${products.length}/3):</span>
            <div class="compare-tags">
                ${products.map(p => `<span class="compare-tag">${escapeHtml(p.name)}<button data-rc="${p.id}" aria-label="Remove">×</button></span>`).join("")}
            </div>
            <button class="btn btn-primary btn-sm" id="openCompareBtn" type="button" ${products.length < 2 ? "disabled" : ""}>Compare Now</button>
            <button class="btn btn-ghost btn-sm"   id="clearCompareBtn" type="button">Clear</button>
        </div>`;
    qsa("[data-rc]", bar).forEach(b => b.addEventListener("click", () => toggleCompare(Number(b.dataset.rc))));
    qs("#openCompareBtn",  bar)?.addEventListener("click", openCompareModal);
    qs("#clearCompareBtn", bar)?.addEventListener("click", () => { state.compareList = []; updateBadgeCounts(); renderCompareBar(); refreshCatalog(); });
}

function openCompareModal() {
    const products = state.compareList.map(id => state.products.find(p => p.id === id)).filter(Boolean);
    if (products.length < 2) return;
    const rows = [
        ["Image",    p => `<img src="${getPrimaryImage(p)}" alt="${escapeHtml(p.name)}" style="width:120px;height:90px;object-fit:cover;border-radius:8px;">`],
        ["Name",     p => `<strong>${escapeHtml(p.name)}</strong>`],
        ["Category", p => escapeHtml(p.category.toUpperCase())],
        ["Price",    p => `<strong class="price-highlight">${formatCurrency(p.price)}</strong>`],
        ["Rating",   p => getRatingStars(p.rating)],
        ["Stock",    p => getStockLabel(p)],
        ["Specs",    p => escapeHtml(p.specs || "—")],
        ["Views",    p => (p.views || 0).toString()],
        ["Action",   p => `<button class="btn btn-primary btn-sm" data-compare-open="${p.id}">View Details</button>`]
    ];
    const body = qs("#compareModalBody");
    if (body) {
        body.innerHTML = `<table class="compare-table">
            ${rows.map(([label, fn]) => `<tr><th>${label}</th>${products.map(p => `<td>${fn(p)}</td>`).join("")}</tr>`).join("")}
        </table>`;
        qsa("[data-compare-open]", body).forEach(b => b.addEventListener("click", () => { closeModal(qs("#compareModal")); openProductModal(Number(b.dataset.compareOpen)); }));
        openModal("compareModal");
    }
}

// ---------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------
function buildOrder(items, discountPercent = 0, customerInfo = {}) {
    const raw   = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const total = discountPercent > 0 ? raw * (1 - discountPercent / 100) : raw;
    return normalizeOrder({
        id      : generateId("order"),
        items   : items.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity, category: i.category || "" })),
        subtotal: raw,
        discount: discountPercent,
        total,
        status  : "Pending",
        customer: customerInfo,
        createdAt: new Date().toISOString()
    });
}

async function persistOrder(order) {
    state.orders.unshift(normalizeOrder(order));
    order.items.forEach(item => {
        const idx = state.products.findIndex(x => x.id === item.id);
        if (idx >= 0) state.products[idx].stock = Math.max(0, state.products[idx].stock - item.quantity);
    });
    sessionStorage.setItem(LS.activeOrder, order.id);
    const myIds = lsGet(LS.myOrderIds, []);
    myIds.unshift(order.id);
    lsSet(LS.myOrderIds, myIds.slice(0, 100));
    await Promise.all([saveOrders(), saveProducts()]);
}

function buildWhatsAppMessage(order) {
    const itemsList = order.items.map(i => `  • ${i.name} × ${i.quantity} = ${formatCurrency(i.price * i.quantity)}`).join("\n");
    const c = order.customer;
    return encodeURIComponent(
`Hello ${SITE_CONFIG.storeName} 👋

🛒 *NEW ORDER — ${order.id}*

*Items:*
${itemsList}
─────────────────
*Subtotal:* ${formatCurrency(order.subtotal)}${order.discount ? `\n*Discount:* -${order.discount}%` : ""}
*TOTAL:* ${formatCurrency(order.total)}

*Customer:*
Name:  ${c?.name  || "—"}
Phone: ${c?.phone || "—"}
Notes: ${c?.notes || "—"}

Date: ${formatDate(order.createdAt)}
─────────────────
Please confirm my order. Thank you!`);
}

// ---------------------------------------------------------------------------
// BUY NOW
// ---------------------------------------------------------------------------
function buyNowActiveProduct() {
    if (!state.activeProduct) return;
    const items = [{ ...state.activeProduct, quantity: getQtyFromModal() }];
    const order = buildOrder(items);
    persistOrder(order).then(() => { window.location.href = "checkout.html"; });
}

// ---------------------------------------------------------------------------
// PROMO VALIDATION
// ---------------------------------------------------------------------------
function validatePromoCode(code, orderTotal = 0) {
    const today = new Date().toISOString().slice(0, 10);
    const promo = state.promos.find(p => p.id === code.trim().toUpperCase());
    if (!promo)                              return { valid: false, message: "Promo code not found." };
    if (promo.expires && today > promo.expires) return { valid: false, message: "This promo code has expired." };
    if (promo.type === "shipping" && orderTotal < 500) return { valid: false, message: "Minimum GMD 500 required for free shipping." };
    return { valid: true, promo, message: `✓ ${promo.title} applied — ${promo.details}`, discount: promo.discount || 0 };
}

// ---------------------------------------------------------------------------
// CHECKOUT PAGE
// ---------------------------------------------------------------------------
async function setupCheckoutPage() {
    const container = qs(".checkout-container");
    if (!container) return;

    let activeId = sessionStorage.getItem(LS.activeOrder);
    let order    = activeId ? state.orders.find(o => o.id === activeId) : null;

    if (!order && state.cart.length) {
        order = buildOrder(state.cart.map(i => ({ ...i })));
        await persistOrder(order);
        state.cart = [];
        saveCart();
        updateBadgeCounts();
    }

    if (!order) { window.location.href = "index.html#products"; return; }

    const set = (id, val) => { const el = qs(`#${id}`); if (el) el.textContent = val; };
    set("productName", `Order ${order.id}`);
    const detailsEl = qs("#productDetails");
    if (detailsEl) {
        detailsEl.innerHTML = order.items.map(i =>
            `<div class="order-line"><span>${escapeHtml(i.name)}</span><span>${i.quantity} × ${formatCurrency(i.price)}</span><strong>${formatCurrency(i.price * i.quantity)}</strong></div>`
        ).join("") + (order.discount ? `<div class="order-line discount-line"><span>Discount (${order.discount}%)</span><strong>-${formatCurrency(order.subtotal * order.discount / 100)}</strong></div>` : "");
    }
    const costEl = qs("#productCost");
    if (costEl) costEl.textContent = formatCurrency(order.total);

    let appliedDiscount = 0;

    qs("#checkoutPromoApply")?.addEventListener("click", () => {
        const code   = qs("#checkoutPromoInput")?.value || "";
        const result = validatePromoCode(code, order.total);
        const msgEl  = qs("#checkoutPromoMessage");
        if (msgEl) { msgEl.textContent = result.message; msgEl.className = `promo-message ${result.valid ? "promo-ok" : "promo-fail"}`; }
        if (result.valid && result.discount > 0) {
            appliedDiscount = result.discount;
            if (costEl) costEl.textContent = `${formatCurrency(order.total * (1 - appliedDiscount / 100))} (${appliedDiscount}% off)`;
        }
    });

    const whatsappBtn = qs("#whatsappBtn");
    const facebookBtn = qs("#facebookBtn");

    if (whatsappBtn) {
        whatsappBtn.addEventListener("click", e => {
            e.preventDefault();
            const name  = qs("#customerName")?.value.trim()  || "";
            const phone = qs("#customerPhone")?.value.trim() || "";
            const notes = qs("#customerNotes")?.value.trim() || "";
            const finalOrder = { ...order, customer: { name, phone, notes }, discount: appliedDiscount };
            if (appliedDiscount > 0) finalOrder.total = order.total * (1 - appliedDiscount / 100);
            const idx = state.orders.findIndex(o => o.id === order.id);
            if (idx >= 0) {
                state.orders[idx].customer = { name, phone, notes };
                state.orders[idx].delivery.updatedAt = new Date().toISOString();
                saveOrders();
            }
            window.open(`https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${buildWhatsAppMessage(finalOrder)}`, "_blank");
        });
    }
    if (facebookBtn) facebookBtn.href = SITE_CONFIG.facebookUrl;
}

// ---------------------------------------------------------------------------
// ORDERS PAGE
// ---------------------------------------------------------------------------
function setupOrdersPage() {
    const container = qs("#ordersContainer");
    if (!container) return;
    const myOrderIds = lsGet(LS.myOrderIds, []);
    const myOrders   = state.orders.filter(o => myOrderIds.includes(o.id));

    if (!myOrders.length) {
        container.innerHTML = `<div class="empty-state"><p>No orders yet.</p><a href="index.html#products" class="btn btn-primary" style="margin-top:1rem;">Browse Products</a></div>`;
    } else {
        container.innerHTML = myOrders.map(o => `
            <div class="order-card">
                <div class="order-card-header">
                    <div>
                        <strong class="order-id">${escapeHtml(o.id)}</strong>
                        <span class="order-date">${formatDate(o.createdAt)}</span>
                    </div>
                    <span class="status-pill status-${(o.status || "pending").toLowerCase()}">${escapeHtml(o.status || "Pending")}</span>
                </div>
                <div class="order-card-body">${o.items.map(i => `<span>${escapeHtml(i.name)} ×${i.quantity}</span>`).join(" · ")}</div>
                <div class="order-card-footer"><strong>${formatCurrency(o.total)}</strong><span>${o.items.length} item${o.items.length !== 1 ? "s" : ""}</span></div>
            </div>`).join("");
    }

    const trackInput  = qs("#orderTrackingId");
    const trackBtn    = qs("#trackOrderBtn");
    const trackResult = qs("#orderTrackingResult");

    function doTrack() {
        if (!trackInput || !trackResult) return;
        const id = trackInput.value.trim();
        if (!id) { showToast("warning", "Please enter an order ID"); return; }
        const o  = state.orders.find(o => o.id === id);
        if (!o) {
            trackResult.innerHTML = `<div class="track-result track-fail"><strong>Order not found.</strong><p>Double-check the order ID or <a href="contact.html">contact support</a>.</p></div>`;
            return;
        }
        const steps    = ["Pending", "Processing", "Completed"];
        const curStep  = steps.indexOf(o.status);
        const cancelled = o.status === "Cancelled";
        trackResult.innerHTML = `
            <div class="track-result track-ok">
                <h4>Order ${escapeHtml(o.id)}</h4>
                <p class="order-date">${formatDate(o.createdAt)}</p>
                ${cancelled ? `<span class="status-pill status-cancelled">Cancelled</span>` : `
                    <div class="status-stepper">
                        ${steps.map((s, i) => `
                            <div class="stepper-step${i <= curStep ? " done" : ""}">
                                <div class="stepper-dot"></div><span>${s}</span>
                            </div>${i < steps.length - 1 ? '<div class="stepper-line"></div>' : ""}
                        `).join("")}
                    </div>`}
                <p><strong>Total:</strong> ${formatCurrency(o.total)}</p>
                <a href="https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(`Hello, I want an update on order ${o.id}`)}"
                   target="_blank" class="btn btn-whatsapp btn-sm" style="margin-top:.5rem;">💬 Get Update on WhatsApp</a>
            </div>`;
    }
    trackBtn?.addEventListener("click", doTrack);
    trackInput?.addEventListener("keydown", e => { if (e.key === "Enter") doTrack(); });
}

// ---------------------------------------------------------------------------
// QUOTE FORM
// ---------------------------------------------------------------------------
function setupQuoteForm() {
    const form = qs("#quoteForm");
    if (!form) return;
    form.addEventListener("submit", async e => {
        e.preventDefault();
        const phone = qs("#quotePhone")?.value.trim() || "";
        if (!/^\+?[\d\s\-]{7,15}$/.test(phone)) { showToast("error", "Please enter a valid phone number"); return; }
        const quote = {
            id      : generateId("quote"),
            name    : qs("#quoteName")?.value.trim()    || "",
            phone,
            vehicle : qs("#quoteVehicle")?.value.trim() || "",
            part    : qs("#quotePart")?.value.trim()    || "",
            budget  : qs("#quoteBudget")?.value.trim()  || "",
            urgency : qs("#quoteUrgency")?.value         || "",
            notes   : qs("#quoteNotes")?.value.trim()   || "",
            status  : "New",
            createdAt: new Date().toISOString()
        };
        try {
            state.quotes.unshift(quote);
            await saveQuotes();
            form.reset();
            showToast("success", "Quote submitted! We'll contact you shortly.");
            const msg = encodeURIComponent(`New Quote from ${quote.name} (${quote.phone}): ${quote.part} for ${quote.vehicle}. Budget: ${quote.budget || "not specified"}.`);
            setTimeout(() => window.open(`https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${msg}`, "_blank"), 800);
        } catch { showToast("error", "Could not submit. Please try WhatsApp directly."); }
    });
}

// ---------------------------------------------------------------------------
// NEWSLETTER
// ---------------------------------------------------------------------------
async function submitNewsletterSubscription(rawEmail, onSuccess) {
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email) { showToast("warning", "Please enter your email address"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast("error", "Please enter a valid email address"); return; }
    try {
        await fbPush(FB.newsletter, { email, createdAt: new Date().toISOString() });
        if (typeof onSuccess === "function") onSuccess();
        showToast("success", "Subscribed! Thanks for joining Mat Auto.");
    } catch { showToast("error", "Could not subscribe. Please try again."); }
}

function setupNewsletterForm() {
    qsa("[data-newsletter-form]").forEach(form => {
        if (form.dataset.newsBound === "true") return;
        form.dataset.newsBound = "true";
        form.addEventListener("submit", async e => {
            e.preventDefault();
            const email = qs("#newsletterEmail", form)?.value.trim() || qs("[name=email]", form)?.value.trim() || "";
            await submitNewsletterSubscription(email, () => form.reset());
        });
    });

    qsa(".footer-section").forEach(section => {
        const input  = qs(".newsletter-input", section);
        const button = qs("button", section);
        if (!input || !button || input.closest("[data-newsletter-form]") || button.dataset.newsBound === "true") return;
        button.dataset.newsBound = "true";
        const submit = async e => { e?.preventDefault?.(); await submitNewsletterSubscription(input.value, () => { input.value = ""; }); };
        button.addEventListener("click", submit);
        input.addEventListener("keydown", e => { if (e.key === "Enter") submit(e); });
    });
}

// ---------------------------------------------------------------------------
// CONTACT FORM
// ---------------------------------------------------------------------------
async function handleContactForm(event) {
    event.preventDefault();
    const name    = qs("#contactName")?.value.trim()    || "";
    const email   = qs("#contactEmail")?.value.trim()   || "";
    const phone   = qs("#contactPhone")?.value.trim()   || "";
    const subject = qs("#contactSubject")?.value.trim() || "";
    const message = qs("#contactMessage")?.value.trim() || "";
    try {
        await fbPush(FB.contacts, { name, email, phone, subject, message, createdAt: new Date().toISOString(), read: false });
        qs("#contactForm")?.reset();
        showToast("success", "Message sent! We'll reply within 30 minutes.");
        const msg = encodeURIComponent(`Hello ${SITE_CONFIG.storeName}\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\n\n${message}`);
        setTimeout(() => window.open(`https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${msg}`, "_blank"), 400);
    } catch { showToast("error", "Could not send. Please contact us on WhatsApp."); }
}

// ---------------------------------------------------------------------------
// REVIEWS PAGE
// ---------------------------------------------------------------------------
async function loadAndRenderPublicReviews() {
    const container = qs("#reviewsContainer");
    if (!container) return;
    const rawReviews = await fbRead(FB.reviews, []);
    state.reviews    = normalizeFirebaseList(rawReviews).filter(r => r.approved !== false);
    if (!state.reviews.length) {
        container.innerHTML = `
            <div class="empty-state" style="text-align:center;padding:2.5rem 1rem;color:var(--text-mid);">
                <p style="font-size:2rem;">⭐</p>
                <h3 style="margin:.5rem 0;">No reviews yet</h3>
                <p>Be the first to share your experience with Mat Auto!</p>
            </div>`;
        return;
    }
    container.innerHTML = state.reviews.map(r => `
        <div class="review-card">
            <h3>${"★".repeat(Number(r.rating) || 5)}${"☆".repeat(5 - (Number(r.rating) || 5))} ${escapeHtml(r.title || "")}</h3>
            <p style="color:#666;margin:.5rem 0"><strong>By:</strong> ${escapeHtml(r.name)} · <strong>Product:</strong> ${escapeHtml(r.product)} · ${formatDate(r.createdAt)}</p>
            <p>${escapeHtml(r.review)}</p>
        </div>`).join("");
}

async function submitReview(event) {
    event.preventDefault();
    const form   = event.target;
    const review = {
        product  : qs("#reviewProduct", form)?.value || "",
        name     : qs("#reviewName",    form)?.value.trim() || "",
        email    : qs("#reviewEmail",   form)?.value.trim() || "",
        rating   : qs("#reviewRating",  form)?.value || "5",
        title    : qs("#reviewTitle",   form)?.value.trim() || "",
        review   : qs("#reviewText",    form)?.value.trim() || "",
        approved : false,
        createdAt: new Date().toISOString()
    };
    if (!review.product || !review.name || !review.review) { showToast("error", "Please fill all required fields"); return; }
    try {
        await fbPush(FB.reviews, review);
        form.reset();
        showToast("success", "Review submitted! It will appear after approval. Thank you 🙏");
    } catch { showToast("error", "Could not submit review. Please try again."); }
}

// ---------------------------------------------------------------------------
// PROMOS PAGE
// ---------------------------------------------------------------------------
async function renderPromosPage() {
    const container = qs("#promosContainer");
    if (!container) return;
    const raw    = await fbRead(FB.promos, []);
    const promos = normalizeFirebaseList(raw);
    const today  = new Date().toISOString().slice(0, 10);
    const active = promos.filter(p => !p.expires || p.expires >= today);
    if (!active.length) { container.innerHTML = `<p class="empty-copy">No active promos right now. Check back soon!</p>`; return; }
    container.innerHTML = active.map(p => `
        <div class="promo-display-card">
            <div class="promo-display-icon">${p.discount ? `${p.discount}% OFF` : "🎁"}</div>
            <div class="promo-display-body">
                <h3>${escapeHtml(p.title)}</h3>
                <p>${escapeHtml(p.details)}</p>
                <div class="promo-code-box">
                    <code>${escapeHtml(p.id)}</code>
                    <button class="btn btn-sm btn-secondary"
                        onclick="navigator.clipboard.writeText('${escapeHtml(p.id)}').then(()=>showToast('success','Code copied!'))">Copy</button>
                </div>
                ${p.expires ? `<small>Expires ${p.expires}</small>` : ""}
            </div>
        </div>`).join("");
}

// ---------------------------------------------------------------------------
// ADMIN AUTH
// ---------------------------------------------------------------------------
function isAdminAuthed() { return sessionStorage.getItem(ADMIN_AUTH_KEY) === "true"; }

function requireAdminAuth() {
    const loginCard = qs("#adminLoginCard");
    const dash      = qs(".admin-container");
    if (isAdminAuthed()) {
        if (loginCard) loginCard.style.display = "none";
        if (dash)      dash.style.display      = "block";
    } else {
        if (loginCard) loginCard.style.display = "block";
        if (dash)      dash.style.display      = "none";
    }
}

function logoutAdmin() {
    sessionStorage.removeItem(ADMIN_AUTH_KEY);
    requireAdminAuth();
    showToast("info", "Logged out");
}

// ---------------------------------------------------------------------------
// ADMIN SETUP
// ---------------------------------------------------------------------------
async function setupAdminPage() {
    requireAdminAuth();
    qs("#adminLoginForm")?.addEventListener("submit", e => {
        e.preventDefault();
        const pw = qs("#adminPassword")?.value || "";
        if (pw === ADMIN_PASSWORD) {
            sessionStorage.setItem(ADMIN_AUTH_KEY, "true");
            requireAdminAuth();
            renderAdminDashboard();
            showToast("success", "Welcome back, Admin!");
        } else {
            showToast("error", "Incorrect password");
            if (qs("#adminPassword")) qs("#adminPassword").value = "";
        }
    });
    if (isAdminAuthed()) renderAdminDashboard();
}

function renderAdminDashboard() {
    renderAdminStats();
    renderAdminProducts();
    renderAdminOrders();
    renderAdminQuotes();
    renderAdminPromos();
    renderAdminReviews();
    renderAdminContacts();
    setupAdminProductForm();
    setupAdminEditModal();
    setupAdminPromoForm();
    setupAdminSearch();

    if (!db) return;
    db.ref(FB.orders).on("value", snap => {
        if (!isAdminAuthed()) return;
        state.orders = normalizeFirebaseList(snap.exists() ? snap.val() : []);
        renderAdminOrders();
        renderAdminStats();
    });
    db.ref(FB.quotes).on("value", snap => {
        if (!isAdminAuthed()) return;
        state.quotes = normalizeFirebaseList(snap.exists() ? snap.val() : []);
        renderAdminQuotes();
        renderAdminStats();
    });
}

function renderAdminStats() {
    const total     = state.products.length;
    const engines   = state.products.filter(p => p.category === "engine").length;
    const parts     = state.products.filter(p => p.category === "parts").length;
    const lowStock  = state.products.filter(p => p.stock > 0 && p.stock <= SITE_CONFIG.lowStockThreshold).length;
    const outStock  = state.products.filter(p => p.stock <= 0).length;
    const orders    = state.orders.length;
    const pending   = state.orders.filter(o => o.status === "Pending").length;
    const completed = state.orders.filter(o => o.status === "Completed").length;
    const revenue   = state.orders.filter(o => o.status !== "Cancelled").reduce((s, o) => s + (o.total || 0), 0);
    const quotes    = state.quotes.length;
    const newQuotes = state.quotes.filter(q => q.status === "New").length;

    const set = (id, val) => { const el = qs(`#${id}`); if (el) el.textContent = val; };
    set("totalProductsCount",   total);
    set("totalEnginesCount",    engines);
    set("totalPartsCount",      parts);
    set("lowStockCount",        lowStock + outStock);
    set("totalOrdersCount",     orders);
    set("totalQuotesCount",     quotes);
    set("pendingOrdersCount",   pending);
    set("completedOrdersCount", completed);
    set("newQuotesCount",       newQuotes);
    set("totalRevenue",         formatCurrency(revenue));
}

// ---------------------------------------------------------------------------
// ✅ UPGRADED ADMIN PRODUCT FORM
// Uses the new uploadImages() which auto-falls back to base64 if Storage
// has CORS issues — no more hard errors for the admin.
// ---------------------------------------------------------------------------
function setupAdminProductForm() {
    const form      = qs("#productForm");
    const preview   = qs("#imagePreview");
    const fileInput = qs("#productImage");
    if (!form) return;

    // Live preview with compression indicator
    fileInput?.addEventListener("change", () => {
        if (!preview) return;
        preview.innerHTML = `<p style="color:var(--text-mid);font-size:.8rem;">Loading previews…</p>`;
        const files = Array.from(fileInput.files || []).slice(0, 6);
        if (!files.length) { preview.innerHTML = ""; return; }
        Promise.all(files.map(f => compressImage(f, 200, 200, 0.7))).then(urls => {
            preview.innerHTML = urls.map(src =>
                `<img src="${src}" class="preview-thumb" style="width:80px;height:60px;object-fit:cover;border-radius:6px;margin:2px;">`
            ).join("");
        }).catch(() => { preview.innerHTML = `<p style="color:var(--accent-red);">Preview failed</p>`; });
    });

    form.addEventListener("submit", async e => {
        e.preventDefault();
        const name     = qs("#productName")?.value.trim();
        const category = qs("#productCategory")?.value;
        const price    = Number(qs("#productPrice")?.value);
        const stockRaw = Number(qs("#productStock")?.value);
        const stock    = Number.isFinite(stockRaw) && stockRaw >= 0 ? stockRaw : 0;
        const desc     = qs("#productDescription")?.value.trim();
        const specs    = qs("#productSpecs")?.value.trim() || "";
        const featured = qs("#productFeatured")?.checked   || false;
        const files    = fileInput?.files || [];

        if (!name || !category || !desc || !Number.isFinite(price) || price < 0) {
            showToast("error", "Please fill all required fields");
            return;
        }

        const submitBtn = form.querySelector("[type=submit]");
        const origLabel = submitBtn?.textContent || "Add Product";

        const setBtn = (disabled, label) => {
            if (!submitBtn) return;
            submitBtn.disabled    = disabled;
            submitBtn.textContent = label;
        };

        setBtn(true, "⏳ Saving…");
        showToast("info", files.length ? "Optimizing and uploading images…" : "Saving product…", 6000);

        try {
            // ✅ Smart upload — tries Storage, falls back to base64 automatically
            const images = files.length
                ? await uploadImages(files)
                : [PLACEHOLDER_IMAGE];

            const newProduct = {
                id          : Date.now(),
                name, category, price, stock,
                description : desc, specs, featured,
                images      : images.length ? images : [PLACEHOLDER_IMAGE],
                image       : images[0]     || PLACEHOLDER_IMAGE,
                rating      : 5,
                views       : 0,
                createdAt   : new Date().toISOString()
            };

            state.products.unshift(newProduct);
            await saveProductRecord(newProduct);
            renderAdminProducts();
            renderAdminStats();
            form.reset();
            if (preview) preview.innerHTML = "";
            showToast("success", `✅ "${name}" added to inventory`);
        } catch (err) {
            console.error("Product save failed:", err);
            showToast("error", "Could not save product. Check your connection and try again.");
        } finally {
            setBtn(false, origLabel);
        }
    });
}

function renderAdminProducts(filter = "") {
    const container = qs("#productsList");
    if (!container) return;
    const list = filter
        ? state.products.filter(p => p.name.toLowerCase().includes(filter) || p.category.toLowerCase().includes(filter))
        : state.products;
    if (!list.length) { container.innerHTML = `<p class="empty-copy">No products found.</p>`; return; }
    container.innerHTML = list.map(p => `
        <div class="admin-product-row">
            <img src="${getPrimaryImage(p)}" alt="${escapeHtml(p.name)}" class="admin-product-img" loading="lazy">
            <div class="admin-product-info">
                <strong>${escapeHtml(p.name)}</strong>
                <span>${escapeHtml(p.category)} · ${formatCurrency(p.price)} · Stock: ${p.stock} · 👁 ${p.views || 0}</span>
                ${p.stock <= 0                                       ? `<span class="badge badge-danger">Out of Stock</span>`  : ""}
                ${p.stock > 0 && p.stock <= SITE_CONFIG.lowStockThreshold ? `<span class="badge badge-warning">Low Stock</span>` : ""}
            </div>
            <div class="admin-product-actions">
                <button class="btn btn-sm btn-secondary" data-edit-id="${p.id}">✏️ Edit</button>
                <button class="btn btn-sm btn-danger"    data-delete-id="${p.id}">🗑 Delete</button>
                <button class="btn btn-sm btn-ghost"     data-toggle-featured="${p.id}">${p.featured ? "★ Unfeature" : "☆ Feature"}</button>
            </div>
        </div>`).join("");
    qsa("[data-edit-id]",        container).forEach(b => b.addEventListener("click", () => openAdminEditModal(Number(b.dataset.editId))));
    qsa("[data-delete-id]",      container).forEach(b => b.addEventListener("click", () => deleteProduct(Number(b.dataset.deleteId))));
    qsa("[data-toggle-featured]",container).forEach(b => b.addEventListener("click", () => toggleFeatured(Number(b.dataset.toggleFeatured))));
}

function setupAdminSearch() {
    qs("#adminSearch")?.addEventListener("input", debounce(e => renderAdminProducts(e.target.value.trim().toLowerCase())));
}

async function deleteProduct(id) {
    if (!confirm("Delete this product? This cannot be undone.")) return;
    state.products = state.products.filter(p => p.id !== id);
    await saveProducts();
    renderAdminProducts();
    renderAdminStats();
    showToast("success", "Product deleted");
}

async function toggleFeatured(id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
    p.featured = !p.featured;
    await saveProducts();
    renderAdminProducts();
    if (qs("#featuredGrid")) renderFeatured();
    showToast("info", `${p.name} ${p.featured ? "featured" : "unfeatured"}`);
}

// ---------------------------------------------------------------------------
// ADMIN EDIT MODAL
// ---------------------------------------------------------------------------
function setupAdminEditModal() {
    qs("#adminEditForm")?.addEventListener("submit", async e => {
        e.preventDefault();
        const id = Number(qs("#editProductId")?.value);
        const p  = state.products.find(x => x.id === id);
        if (!p) return;
        const parsedPrice = Number(qs("#editPrice")?.value);
        const parsedStock = Number(qs("#editStock")?.value);
        p.name        = qs("#editName")?.value.trim()        || p.name;
        p.category    = qs("#editCategory")?.value           || p.category;
        p.price       = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : p.price;
        p.stock       = Number.isFinite(parsedStock) && parsedStock >= 0 ? parsedStock : p.stock;
        p.description = qs("#editDescription")?.value.trim() || p.description;
        p.specs       = qs("#editSpecs")?.value.trim()       || p.specs;
        p.featured    = qs("#editFeatured")?.checked          || false;
        await saveProducts();
        renderAdminProducts();
        renderAdminStats();
        closeModal(qs("#adminEditModal"));
        showToast("success", "Product updated");
    });
}

function openAdminEditModal(id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
    const set = (sel, val) => { const el = qs(`#${sel}`); if (el) el.value = val; };
    set("editProductId",   p.id);
    set("editName",        p.name);
    set("editCategory",    p.category);
    set("editPrice",       p.price);
    set("editStock",       p.stock);
    set("editDescription", p.description || "");
    set("editSpecs",       p.specs       || "");
    const checked = qs("#editFeatured");
    if (checked) checked.checked = p.featured || false;
    openModal("adminEditModal");
}

// ---------------------------------------------------------------------------
// ADMIN ORDERS
// ---------------------------------------------------------------------------
function renderAdminOrders() {
    const container = qs("#adminOrders");
    if (!container) return;
    if (!state.orders.length) { container.innerHTML = `<p class="empty-copy">No orders yet.</p>`; return; }
    container.innerHTML = state.orders.slice(0, 50).map(o => `
        <div class="admin-order-card" data-status="${escapeHtml((o.status || "pending").toLowerCase())}">
            <div class="admin-order-header">
                <strong>${escapeHtml(o.id)}</strong>
                <span class="order-date">${formatDate(o.createdAt)}</span>
                <span class="status-pill status-${(o.status || "pending").toLowerCase()}">${escapeHtml(o.status || "Pending")}</span>
            </div>
            <div class="admin-order-body">
                ${o.items.map(i => `<span>${escapeHtml(i.name)} ×${i.quantity}</span>`).join(" · ")}
                ${o.customer?.name  ? `<br><strong>Customer:</strong> ${escapeHtml(o.customer.name)}` : ""}
                ${o.customer?.phone ? ` <a href="https://wa.me/${o.customer.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hello, about order ${o.id}`)}" target="_blank" class="btn btn-sm btn-whatsapp" style="margin-left:.5rem;">💬 WhatsApp</a>` : ""}
                ${o.delivery?.address ? `<br><strong>Delivery:</strong> ${escapeHtml(o.delivery.address)}` : ""}
                ${(o.delivery?.driverName || o.delivery?.fee) ? `<br><strong>Driver:</strong> ${escapeHtml(o.delivery.driverName || "Unassigned")} · <strong>Fee:</strong> ${formatCurrency(o.delivery.fee || 0)}` : ""}
            </div>
            <div class="admin-order-footer">
                <strong>${formatCurrency(o.total)}</strong>
                <select class="order-status-select" data-order-id="${escapeHtml(o.id)}">
                    <option ${o.status === "Pending"    ? "selected" : ""}>Pending</option>
                    <option ${o.status === "Processing" ? "selected" : ""}>Processing</option>
                    <option ${o.status === "Out for Delivery" ? "selected" : ""}>Out for Delivery</option>
                    <option ${o.status === "Completed"  ? "selected" : ""}>Completed</option>
                    <option ${o.status === "Cancelled"  ? "selected" : ""}>Cancelled</option>
                </select>
            </div>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.85rem;">
                <a class="btn btn-sm btn-secondary" href="reciept.html?id=${encodeURIComponent(o.id)}">🧾 Receipt</a>
                <a class="btn btn-sm btn-outline" href="delivery-drivers.html?id=${encodeURIComponent(o.id)}">🚚 Driver Sheet</a>
                <a class="btn btn-sm btn-ghost" href="track.html?id=${encodeURIComponent(o.id)}">📍 Track</a>
            </div>
        </div>`).join("");
    qsa(".order-status-select", container).forEach(sel =>
        sel.addEventListener("change", () => updateOrderStatus(sel.dataset.orderId, sel.value))
    );

    // CSV export button
    let exportBtn = qs("#exportOrdersBtn");
    if (!exportBtn) {
        exportBtn = document.createElement("button");
        exportBtn.id        = "exportOrdersBtn";
        exportBtn.className = "btn btn-secondary";
        exportBtn.style.marginTop = "1rem";
        exportBtn.textContent = "📥 Export Orders CSV";
        container.parentElement?.appendChild(exportBtn);
    }
    exportBtn.onclick = exportOrdersCSV;
}

async function updateOrderStatus(orderId, newStatus) {
    const o = state.orders.find(x => x.id === orderId);
    if (!o) return;
    o.status = newStatus;
    o.delivery.updatedAt = new Date().toISOString();
    await saveOrders();
    renderAdminOrders();
    renderAdminStats();
    showToast("success", `Order ${orderId} → ${newStatus}`);
}

function exportOrdersCSV() {
    if (!state.orders.length) { showToast("warning", "No orders to export"); return; }
    const header = ["Order ID", "Date", "Status", "Customer Name", "Customer Phone", "Delivery Address", "Driver", "Delivery Fee (GMD)", "Items", "Total (GMD)"];
    const rows   = state.orders.map(o => [
        o.id,
        o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "",
        o.status,
        o.customer?.name  || "",
        o.customer?.phone || "",
        o.delivery?.address || "",
        o.delivery?.driverName || "",
        (Number(o.delivery?.fee) || 0).toFixed(2),
        o.items.map(i => `${i.name} x${i.quantity}`).join("; "),
        o.total.toFixed(2)
    ]);
    const csv  = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `mat-auto-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("success", "Orders exported as CSV");
}

// ---------------------------------------------------------------------------
// ADMIN QUOTES
// ---------------------------------------------------------------------------
function renderAdminQuotes() {
    const container = qs("#adminQuotes");
    if (!container) return;
    if (!state.quotes.length) { container.innerHTML = `<p class="empty-copy">No quote requests yet.</p>`; return; }
    container.innerHTML = state.quotes.slice(0, 30).map(q => `
        <div class="quote-card">
            <div class="quote-card-header">
                <strong>${escapeHtml(q.name)}</strong>
                <span class="order-date">${formatDate(q.createdAt)}</span>
                <span class="status-pill status-${(q.status || "new").toLowerCase()}">${escapeHtml(q.status || "New")}</span>
            </div>
            <div class="quote-card-body">
                <span><b>Part:</b> ${escapeHtml(q.part)}</span>
                <span><b>Vehicle:</b> ${escapeHtml(q.vehicle)}</span>
                <span><b>Phone:</b> ${escapeHtml(q.phone)}</span>
                ${q.budget ? `<span><b>Budget:</b> ${escapeHtml(q.budget)}</span>` : ""}
                ${q.notes  ? `<span><b>Notes:</b> ${escapeHtml(q.notes)}</span>`  : ""}
            </div>
            <div class="quote-card-actions">
                <a class="btn btn-sm btn-whatsapp"
                   href="https://wa.me/${q.phone?.replace(/\D/g, "")}?text=${encodeURIComponent(`Hello ${q.name}, re your quote for ${q.part}`)}"
                   target="_blank">💬 WhatsApp</a>
                <button class="btn btn-sm btn-secondary" data-qa="${q.id}:Approved">✓ Approve</button>
                <button class="btn btn-sm btn-danger"    data-qa="${q.id}:Declined">✗ Decline</button>
            </div>
        </div>`).join("");
    qsa("[data-qa]", container).forEach(btn => btn.addEventListener("click", async () => {
        const [id, status] = btn.dataset.qa.split(":");
        const q = state.quotes.find(x => x.id === id);
        if (!q) return;
        q.status = status;
        await saveQuotes();
        renderAdminQuotes();
        renderAdminStats();
        showToast("success", `Quote ${status.toLowerCase()}`);
    }));
}

// ---------------------------------------------------------------------------
// ADMIN REVIEWS
// ---------------------------------------------------------------------------
async function renderAdminReviews() {
    const container = qs("#adminReviews");
    if (!container) return;
    const raw     = await fbRead(FB.reviews, []);
    const reviews = normalizeFirebaseList(raw);
    if (!reviews.length) { container.innerHTML = `<p class="empty-copy">No reviews yet.</p>`; return; }
    container.innerHTML = reviews.map((r, idx) => `
        <div class="review-admin-card${r.approved ? " approved" : " pending"}">
            <div class="review-admin-header">
                <strong>${escapeHtml(r.name)}</strong>
                <span>${escapeHtml(r.product)} · ${"★".repeat(Number(r.rating) || 5)}</span>
                <span class="status-pill ${r.approved ? "status-completed" : "status-pending"}">${r.approved ? "Approved" : "Pending"}</span>
            </div>
            <p>${escapeHtml(r.review)}</p>
            <div class="review-admin-actions">
                ${!r.approved ? `<button class="btn btn-sm btn-secondary" data-approve-review="${idx}">✓ Approve</button>` : ""}
                <button class="btn btn-sm btn-danger" data-delete-review="${idx}">Delete</button>
            </div>
        </div>`).join("");
    qsa("[data-approve-review]", container).forEach(b => b.addEventListener("click", async () => {
        reviews[Number(b.dataset.approveReview)].approved = true;
        await fbWrite(FB.reviews, reviews);
        renderAdminReviews();
        showToast("success", "Review approved");
    }));
    qsa("[data-delete-review]", container).forEach(b => b.addEventListener("click", async () => {
        reviews.splice(Number(b.dataset.deleteReview), 1);
        await fbWrite(FB.reviews, reviews);
        renderAdminReviews();
        showToast("success", "Review deleted");
    }));
}

// ---------------------------------------------------------------------------
// ADMIN CONTACTS INBOX
// ---------------------------------------------------------------------------
async function renderAdminContacts() {
    const container = qs("#adminContacts");
    if (!container) return;
    const raw      = await fbRead(FB.contacts, []);
    const contacts = normalizeFirebaseList(raw);
    if (!contacts.length) { container.innerHTML = `<p class="empty-copy">No contact messages yet.</p>`; return; }
    container.innerHTML = contacts.slice(0, 20).reverse().map(c => `
        <div class="contact-message-card${c.read ? "" : " unread"}">
            <div class="contact-msg-header">
                <strong>${escapeHtml(c.name)}</strong>
                <span>${escapeHtml(c.email)}</span>
                <span class="order-date">${formatDate(c.createdAt)}</span>
                ${!c.read ? `<span class="badge badge-warning">New</span>` : ""}
            </div>
            <p><strong>${escapeHtml(c.subject || "—")}</strong></p>
            <p>${escapeHtml(c.message)}</p>
            ${c.phone ? `<a href="https://wa.me/${c.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hello ${c.name}, re: ${c.subject}`)}" target="_blank" class="btn btn-sm btn-whatsapp">💬 Reply on WhatsApp</a>` : ""}
        </div>`).join("");
}

// ---------------------------------------------------------------------------
// ADMIN PROMOS
// ---------------------------------------------------------------------------
function setupAdminPromoForm() {
    qs("#promoForm")?.addEventListener("submit", async e => {
        e.preventDefault();
        const code    = qs("#promoCode")?.value.trim().toUpperCase();
        const title   = qs("#promoTitle")?.value.trim();
        const details = qs("#promoDetails")?.value.trim();
        const expires = qs("#promoExpires")?.value;
        const discount= Number(qs("#promoDiscount")?.value) || 0;
        if (!code || !title || !details || !expires) { showToast("error", "Please fill all promo fields"); return; }
        if (state.promos.find(p => p.id === code)) { showToast("error", "Code already exists"); return; }
        state.promos.unshift({ id: code, title, details, expires, discount, type: "general" });
        await savePromos();
        renderAdminPromos();
        qs("#promoForm")?.reset();
        showToast("success", `Promo "${code}" created`);
    });
}

function renderAdminPromos() {
    const container = qs("#adminPromos");
    if (!container) return;
    if (!state.promos.length) { container.innerHTML = `<p class="empty-copy">No promos yet.</p>`; return; }
    container.innerHTML = state.promos.map(p => `
        <div class="promo-card">
            <div class="promo-card-body">
                <strong>${escapeHtml(p.title)}</strong>
                <span>${escapeHtml(p.details)}</span>
                ${p.discount ? `<span class="promo-discount">-${p.discount}%</span>` : ""}
            </div>
            <div class="promo-card-footer">
                <span class="promo-code">${escapeHtml(p.id)}</span>
                <span>Expires ${escapeHtml(p.expires || "—")}</span>
                <button class="btn btn-sm btn-danger" data-promo-delete="${escapeHtml(p.id)}">Delete</button>
            </div>
        </div>`).join("");
    qsa("[data-promo-delete]", container).forEach(btn => btn.addEventListener("click", async () => {
        state.promos = state.promos.filter(p => p.id !== btn.dataset.promoDelete);
        await savePromos();
        renderAdminPromos();
        showToast("success", "Promo deleted");
    }));
}

// ---------------------------------------------------------------------------
// PAGE INIT
// ---------------------------------------------------------------------------
async function initPage() {
    showLoader("Loading Mat Auto…");
    loadLocalState();
    loadTheme();
    setupMobileMenu();
    bindModalClose();
    setupQuickAccess();
    qs("#darkModeBtn")?.addEventListener("click", toggleTheme);

    try {
        await loadFirebaseState();
        attachProductsListener();
    } catch (err) {
        console.error("Initial Firebase sync failed:", err);
        showToast("warning", "Live data sync is currently unavailable.");
    } finally {
        hideLoader();
    }

    updateBadgeCounts();
    setupModalActions();
    setupHeroSearch();
    setupCatalogControls();
    setupQuoteForm();
    setupNewsletterForm();

    if (qs("#featuredGrid"))               renderFeatured();
    if (qs("#productsGrid"))               refreshCatalog();
    if (qs("#heroPromoList"))              renderHeroPromos();
    if (qs("#recentlyViewedGrid"))         renderRecentlyViewed();
    if (qs("#catalogCount"))               updateHeroStats();
    if (qs("#compareBar"))                 renderCompareBar();
    if (qs(".checkout-container"))         await setupCheckoutPage();
    if (qs("#ordersContainer"))            setupOrdersPage();
    if (qs(".admin-container") || qs("#adminLoginCard")) await setupAdminPage();
    if (qs("#promosContainer"))            await renderPromosPage();
    if (qs("#reviewsContainer"))           await loadAndRenderPublicReviews();

    qs("#checkoutFromCartBtn")?.addEventListener("click", async () => {
        if (!state.cart.length) { showToast("warning", "Your cart is empty"); return; }
        const order = buildOrder(state.cart.map(i => ({ ...i })));
        await persistOrder(order);
        state.cart = [];
        saveCart();
        updateBadgeCounts();
        window.location.href = "checkout.html";
    });

    globalThis.db = db;
    globalThis.maApp = {
        state,
        lsGet,
        lsSet,
        LS,
        getOrderById,
        normalizeOrder,
        saveOrders,
        formatCurrency,
        formatDate,
        showToast
    };
    document.dispatchEvent(new CustomEvent("appReady"));
}

document.addEventListener("DOMContentLoaded", initPage);

// ---------------------------------------------------------------------------
// GLOBAL EXPORTS  (for inline onclick handlers in HTML)
// ---------------------------------------------------------------------------
window.toggleDarkMode    = toggleTheme;
window.openCart          = () => { renderCart();     openModal("cartModal"); };
window.openWishlist      = () => { renderWishlist(); openModal("wishlistModal"); };
window.handleContactForm = handleContactForm;
window.submitReview      = submitReview;
window.logoutAdmin       = logoutAdmin;
window.openProductModal  = openProductModal;
window.openCompareModal  = openCompareModal;
window.showToast         = showToast;
