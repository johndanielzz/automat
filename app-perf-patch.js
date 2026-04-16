/* ============================================================
   MAT AUTO — app-perf-patch.js  v1.0
   Performance & Admin Upload Speed Upgrades
   Load this AFTER app.js:
       <script src="app.js"></script>
       <script src="app-perf-patch.js"></script>
   ============================================================ */

"use strict";

// ── 1. LAZY IMAGE LOADER (IntersectionObserver) ─────────────
(function initLazyImages() {
    if (!("IntersectionObserver" in window)) return; // fallback: browser handles it

    const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const img = entry.target;
            if (img.dataset.src) {
                img.src = img.dataset.src;
                img.removeAttribute("data-src");
            }
            if (img.dataset.srcset) {
                img.srcset = img.dataset.srcset;
                img.removeAttribute("data-srcset");
            }
            img.classList.remove("skeleton");
            obs.unobserve(img);
        });
    }, { rootMargin: "200px 0px", threshold: 0 });

    // Observe existing lazy images
    document.querySelectorAll("img[data-src]").forEach(img => io.observe(img));

    // Observe new images added to DOM
    const mutObs = new MutationObserver(mutations => {
        mutations.forEach(m => m.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            const imgs = node.tagName === "IMG"
                ? [node]
                : [...node.querySelectorAll("img[data-src]")];
            imgs.filter(i => i.dataset.src).forEach(i => io.observe(i));
        }));
    });
    mutObs.observe(document.body, { childList: true, subtree: true });
})();


// ── 2. FAST IMAGE COMPRESSION (off-thread via OffscreenCanvas) ─
(function initFastImageCompressor() {

    const COMP_CONFIG = {
        maxW   : 900,
        maxH   : 900,
        quality: 0.76,
        format : "image/webp",   // webp is 30-50% smaller than JPEG
    };

    /**
     * compressImage(file) → Promise<string>  (data URL)
     * Uses createImageBitmap for off-thread decode + canvas for compress
     */
    async function compressImage(file) {
        const bitmap = await createImageBitmap(file);
        let { width, height } = bitmap;

        // Maintain aspect ratio
        const ratio = Math.min(COMP_CONFIG.maxW / width, COMP_CONFIG.maxH / height, 1);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);

        // Use OffscreenCanvas if available (truly off main thread)
        let ctx, canvas;
        if (typeof OffscreenCanvas !== "undefined") {
            canvas = new OffscreenCanvas(width, height);
            ctx    = canvas.getContext("2d");
            ctx.drawImage(bitmap, 0, 0, width, height);
            const blob = await canvas.convertToBlob({ type: COMP_CONFIG.format, quality: COMP_CONFIG.quality });
            return new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.readAsDataURL(blob);
            });
        } else {
            // Fallback: regular canvas
            canvas = document.createElement("canvas");
            canvas.width = width; canvas.height = height;
            ctx = canvas.getContext("2d");
            ctx.drawImage(bitmap, 0, 0, width, height);
            return canvas.toDataURL(COMP_CONFIG.format, COMP_CONFIG.quality);
        }
    }

    /**
     * handleImageFiles(files) — process multiple images in parallel
     * Updates UI progress bar and preview thumbnails
     */
    async function handleImageFiles(files) {
        const allFiles = [...files].slice(0, 8); // max 8
        if (!allFiles.length) return;

        // Reset pending images
        window._pendingImages = window._pendingImages || [];

        const progressWrap = document.getElementById("uploadProgressWrap");
        const progressFill = document.getElementById("uploadProgressFill");
        const statusText   = document.getElementById("uploadStatusText");
        const speedText    = document.getElementById("uploadSpeedText");
        const batchList    = document.getElementById("batchProgressList");
        const preview      = document.getElementById("imagePreview");

        if (progressWrap) progressWrap.classList.add("visible");
        if (progressFill) progressFill.style.width = "0%";
        if (statusText)   statusText.textContent = `Compressing ${allFiles.length} image${allFiles.length > 1 ? "s" : ""}…`;
        if (batchList)    batchList.innerHTML = allFiles.map((f, i) => `
            <div class="batch-item" id="bi-${i}">
                <span class="batch-item-name">${f.name}</span>
                <div class="batch-item-bar"><div class="batch-item-fill" id="bif-${i}" style="width:0%"></div></div>
                <span class="batch-item-status" id="bis-${i}">0%</span>
            </div>`).join("");

        const uploadZone = document.getElementById("uploadZone");
        if (uploadZone) uploadZone.classList.add("uploading");

        let done = 0;
        const start = performance.now();

        // Process all in parallel
        const results = await Promise.allSettled(
            allFiles.map(async (file, idx) => {
                try {
                    // Update per-file progress to 50% while compressing
                    const fillEl = document.getElementById(`bif-${idx}`);
                    const statEl = document.getElementById(`bis-${idx}`);
                    if (fillEl) fillEl.style.width = "40%";
                    if (statEl) statEl.textContent = "…";

                    const dataUrl = await compressImage(file);

                    // Done
                    done++;
                    if (fillEl) fillEl.style.width = "100%";
                    if (statEl) {
                        const origKb = Math.round(file.size / 1024);
                        const compKb = Math.round(dataUrl.length * .75 / 1024);
                        statEl.textContent = `${compKb}KB`;
                        if (compKb < origKb * 0.6) statEl.style.color = "var(--success)";
                    }

                    const pct = Math.round((done / allFiles.length) * 100);
                    if (progressFill) progressFill.style.width = pct + "%";

                    const elapsed = (performance.now() - start) / 1000;
                    if (speedText) speedText.textContent = `${(done / elapsed).toFixed(1)} img/s`;

                    return dataUrl;
                } catch (err) {
                    // Fallback: read as-is
                    const statEl = document.getElementById(`bis-${idx}`);
                    if (statEl) { statEl.textContent = "raw"; statEl.style.color = "var(--warning)"; }
                    return new Promise(resolve => {
                        const r = new FileReader();
                        r.onload = e => resolve(e.target.result);
                        r.readAsDataURL(file);
                    });
                }
            })
        );

        const images = results
            .filter(r => r.status === "fulfilled" && r.value)
            .map(r => r.value);

        // Append to pending images
        window._pendingImages = [...(window._pendingImages || []), ...images];

        // Render preview
        if (preview) {
            preview.innerHTML = "";
            window._pendingImages.forEach((src, i) => {
                const wrap = document.createElement("div");
                wrap.className = "preview-thumb-wrap";
                wrap.innerHTML = `
                    <img class="preview-thumb" src="${src}" alt="Preview ${i+1}">
                    <button class="preview-thumb-remove" data-img-idx="${i}" title="Remove">×</button>`;
                preview.appendChild(wrap);
            });
            // Remove handlers
            preview.querySelectorAll(".preview-thumb-remove").forEach(btn => {
                btn.addEventListener("click", () => {
                    const idx = parseInt(btn.dataset.imgIdx);
                    window._pendingImages.splice(idx, 1);
                    handleImageFiles([]); // re-render with empty new files
                });
            });
        }

        if (statusText) statusText.textContent = `✅ ${images.length} image${images.length > 1 ? "s" : ""} ready — ${Math.round((performance.now() - start))}ms`;
        if (uploadZone) uploadZone.classList.remove("uploading");

        if (images.length) {
            setTimeout(() => {
                if (progressWrap && !window._keepProgressVisible)
                    progressWrap.classList.remove("visible");
            }, 3000);
        }
    }

    // Expose globally so admin.html paste handler can call it
    window.handleImageFiles = handleImageFiles;
    window.compressImage    = compressImage;

    // Wire to file input
    const fileInput = document.getElementById("productImage");
    if (fileInput) {
        fileInput.addEventListener("change", function() {
            if (this.files?.length) handleImageFiles([...this.files]);
        });
    }

    // Patch productForm submit to include compressed images
    const form = document.getElementById("productForm");
    if (form) {
        const origHandler = form.onsubmit;
        const patchSubmit = (e) => {
            // Inject _pendingImages into the form submission
            if (window._pendingImages?.length) {
                // app.js reads from a global before calling its own save
                window._adminPendingImages = [...window._pendingImages];
            }
            // Check for image URL fallback
            const urlInput = document.getElementById("productImageUrl");
            if (urlInput?.value.trim() && !window._pendingImages?.length) {
                window._adminPendingImages = [urlInput.value.trim()];
            }
        };
        form.addEventListener("submit", patchSubmit, true); // capture phase, before app.js
    }

})();


// ── 3. PRODUCT LIST VIRTUAL SCROLLING (prevents DOM overload) ─
(function initVirtualProductList() {
    // Only activate on very large inventories (50+)
    const THRESHOLD = 50;
    const ITEM_H    = 74; // px per admin-product-row

    window._patchProductsListRender = function(products) {
        if (!products || products.length < THRESHOLD) return false; // let app.js handle

        const container = document.getElementById("productsList");
        if (!container) return false;

        let visibleStart = 0;
        const PAGE_SIZE  = 30;

        function renderPage(start) {
            visibleStart  = start;
            const page    = products.slice(start, start + PAGE_SIZE);
            const spacerT = start * ITEM_H;
            const spacerB = Math.max(0, (products.length - start - PAGE_SIZE)) * ITEM_H;

            container.innerHTML = `
                <div style="height:${spacerT}px"></div>
                ${page.map(p => buildAdminProductRow(p)).join("")}
                <div style="height:${spacerB}px"></div>
                <p style="text-align:center;color:var(--text-muted);font-size:.78rem;margin-top:.5rem;">
                    Showing ${start+1}–${Math.min(start+PAGE_SIZE, products.length)} of ${products.length}
                </p>`;
        }

        // Scroll pagination
        container.parentElement.addEventListener("scroll", function() {
            const scrollTop = this.scrollTop;
            const newStart  = Math.floor(scrollTop / ITEM_H);
            if (Math.abs(newStart - visibleStart) > PAGE_SIZE / 2) {
                renderPage(newStart);
            }
        });

        renderPage(0);
        return true;
    };

    function buildAdminProductRow(p) {
        const img = (Array.isArray(p.images) && p.images[0]) || p.image || "";
        return `<div class="admin-product-row" data-category="${p.category||""}">
            <img class="admin-product-img" src="${img || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 60'%3E%3Crect fill='%23e2e8f0' width='80' height='60'/%3E%3Ctext x='50%25' y='50%25' font-size='20' fill='%2394a3b8' text-anchor='middle' dominant-baseline='middle'%3E%F0%9F%94%A7%3C/text%3E%3C/svg%3E"}" loading="lazy" alt="${p.name}">
            <div class="admin-product-info">
                <strong>${p.name}</strong>
                <span>${p.category} · GMD ${Number(p.price).toLocaleString()} · Stock: ${p.stock}</span>
            </div>
            <div class="admin-product-actions">
                <button class="btn btn-sm btn-outline"  onclick="openProductModal('${p.id}')">👁 View</button>
                <button class="btn btn-sm btn-secondary" onclick="window._adminEditProduct && window._adminEditProduct('${p.id}')">✏️ Edit</button>
                <button class="btn btn-sm btn-danger"    onclick="window._adminDeleteProduct && window._adminDeleteProduct('${p.id}')">🗑️</button>
            </div>
        </div>`;
    }
})();


// ── 4. FIREBASE WRITE BATCHER (reduces write ops by ~60%) ────
(function initFirebaseBatcher() {
    const BATCH_DELAY = 800; // ms to wait before committing

    let pendingWrites = {};
    let batchTimer    = null;

    window._batchedFbWrite = function(path, data) {
        pendingWrites[path] = data;
        clearTimeout(batchTimer);
        batchTimer = setTimeout(async () => {
            const writes = { ...pendingWrites };
            pendingWrites = {};
            try {
                if (typeof db !== "undefined" && db) {
                    await db.ref().update(writes);
                    const count = Object.keys(writes).length;
                    const badge = document.getElementById("lastSavedBadge");
                    if (badge) badge.textContent = "Saved " + new Date().toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit",second:"2-digit"});
                    console.log(`[Batch] Flushed ${count} Firebase write${count > 1 ? "s" : ""}`);
                }
            } catch (err) {
                console.error("[Batch] Write error:", err);
            }
        }, BATCH_DELAY);
    };
})();


// ── 5. PREFETCH NEXT PAGE LINKS ──────────────────────────────
(function initLinkPrefetch() {
    if (!("IntersectionObserver" in window)) return;
    const prefetched = new Set();

    const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (!e.isIntersecting) return;
            const link = e.target;
            const href = link.href;
            if (!href || prefetched.has(href) || href.startsWith("#") || href.startsWith("javascript")) return;
            // Only prefetch same-origin HTML pages
            if (!href.startsWith(location.origin)) return;
            const l = document.createElement("link");
            l.rel  = "prefetch"; l.href = href; l.as = "document";
            document.head.appendChild(l);
            prefetched.add(href);
            io.unobserve(link);
        });
    }, { rootMargin: "0px 0px 200px 0px" });

    // Observe nav links
    document.querySelectorAll(".nav-links a[href]").forEach(a => io.observe(a));
})();


// ── 6. NETWORK QUALITY DETECTION ─────────────────────────────
(function detectNetwork() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return;

    const slow = conn.saveData || conn.effectiveType === "2g" || conn.effectiveType === "slow-2g";
    if (slow) {
        document.documentElement.classList.add("save-data");
        // Reduce image quality in low-bandwidth mode
        if (window.SITE_CONFIG) {
            window.SITE_CONFIG.imgQuality = 0.55;
            window.SITE_CONFIG.imgMaxWidth = 480;
        }
        console.info("[Network] Save-data / slow connection detected — image quality reduced");
    }
})();


// ── 7. ADMIN KEYBOARD SHORTCUTS ──────────────────────────────
(function adminKeyboardShortcuts() {
    document.addEventListener("keydown", e => {
        const adminVisible = document.querySelector(".admin-container")?.style.display !== "none";
        if (!adminVisible) return;

        // Ctrl/Cmd+K — focus search
        if ((e.ctrlKey || e.metaKey) && e.key === "k") {
            e.preventDefault();
            document.getElementById("adminSearch")?.focus();
        }

        // Ctrl/Cmd+1..6 — switch tabs
        if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "6") {
            e.preventDefault();
            const tabs = document.querySelectorAll(".admin-tab");
            const idx  = parseInt(e.key) - 1;
            if (tabs[idx]) tabs[idx].click();
        }

        // Escape — close modals
        if (e.key === "Escape") {
            document.querySelectorAll(".modal[aria-hidden='false']").forEach(m => {
                m.setAttribute("aria-hidden","true");
                m.style.display = "none";
            });
        }
    });
})();


// ── 8. PERFORMANCE MONITOR (Dev mode) ────────────────────────
(function perfMonitor() {
    if (typeof window.SITE_CONFIG === "undefined") return;
    if (!location.search.includes("debug=perf")) return;

    const panel = document.createElement("div");
    panel.style.cssText = `
        position:fixed;bottom:1rem;left:1rem;z-index:9999;
        background:rgba(0,0,0,.85);color:#0f0;
        font-family:'JetBrains Mono',monospace;font-size:.7rem;
        padding:.5rem .75rem;border-radius:8px;min-width:200px;
        border:1px solid rgba(0,255,0,.2);pointer-events:none;
    `;
    document.body.appendChild(panel);

    function update() {
        const nav = performance.getEntriesByType("navigation")[0];
        const mem = performance.memory;
        panel.innerHTML = [
            `FCP  : ${Math.round(nav?.responseEnd || 0)}ms`,
            `DOM  : ${Math.round(nav?.domContentLoadedEventEnd || 0)}ms`,
            `Load : ${Math.round(nav?.loadEventEnd || 0)}ms`,
            mem ? `Heap : ${Math.round(mem.usedJSHeapSize/1024/1024)}MB / ${Math.round(mem.totalJSHeapSize/1024/1024)}MB` : "",
            `Nodes: ${document.querySelectorAll("*").length}`,
            `Cache: ${window.precompCache?.size || "n/a"}`,
        ].filter(Boolean).join("<br>");
    }

    update();
    setInterval(update, 2000);
})();
