"use strict";

const MAT_AI_THEME_KEY = "maDarkMode";
const MAX_HISTORY_MESSAGES = 10;
const REQUEST_TIMEOUT_MS = 12000;
const MAT_AI_API_CANDIDATES = buildApiCandidates();

const state = {
    messages: [],
    imageDataUrl: "",
    imageName: "",
    imageBytes: 0,
    busy: false,
    context: null,
    apiBase: "",
};

const els = {
    chatForm: document.getElementById("chatForm"),
    input: document.getElementById("matAiInput"),
    chatMessages: document.getElementById("chatMessages"),
    status: document.getElementById("assistantStatus"),
    sendBtn: document.getElementById("sendBtn"),
    clearChatBtn: document.getElementById("clearChatBtn"),
    uploadImageBtn: document.getElementById("uploadImageBtn"),
    imageInput: document.getElementById("matAiImage"),
    imagePreviewCard: document.getElementById("imagePreviewCard"),
    imagePreview: document.getElementById("imagePreview"),
    imagePreviewName: document.getElementById("imagePreviewName"),
    imagePreviewSize: document.getElementById("imagePreviewSize"),
    removeImageBtn: document.getElementById("removeImageBtn"),
    siteProducts: document.getElementById("siteProducts"),
    sitePages: document.getElementById("sitePages"),
    storeCurrency: document.getElementById("storeCurrency"),
    storeWhatsapp: document.getElementById("storeWhatsapp"),
    catalogSummary: document.getElementById("catalogSummary"),
    knownPages: document.getElementById("knownPages"),
    relatedProducts: document.getElementById("relatedProducts"),
    darkModeBtn: document.getElementById("darkModeBtn"),
    hamburger: document.getElementById("hamburger"),
    navLinks: document.getElementById("navLinks"),
};

init();

function init() {
    setupTheme();
    setupNav();
    bindUi();
    renderWelcomeMessage();
    loadContext();
}

function bindUi() {
    els.chatForm?.addEventListener("submit", handleSubmit);
    els.clearChatBtn?.addEventListener("click", clearChat);
    els.uploadImageBtn?.addEventListener("click", () => els.imageInput?.click());
    els.imageInput?.addEventListener("change", handleImageSelection);
    els.removeImageBtn?.addEventListener("click", clearImageSelection);
    els.input?.addEventListener("keydown", event => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            els.chatForm?.requestSubmit();
        }
    });

    document.querySelectorAll("[data-prompt]").forEach(button => {
        button.addEventListener("click", () => {
            els.input.value = button.getAttribute("data-prompt") || "";
            els.input.focus();
        });
    });
}

function setupNav() {
    if (!els.hamburger || !els.navLinks) return;
    els.hamburger.addEventListener("click", () => {
        const active = els.hamburger.classList.toggle("active");
        els.navLinks.classList.toggle("active", active);
        els.hamburger.setAttribute("aria-expanded", String(active));
    });
    els.navLinks.querySelectorAll("a, button").forEach(node => {
        node.addEventListener("click", () => {
            els.hamburger.classList.remove("active");
            els.navLinks.classList.remove("active");
            els.hamburger.setAttribute("aria-expanded", "false");
        });
    });
}

function setupTheme() {
    const isDark = localStorage.getItem(MAT_AI_THEME_KEY) === "true";
    document.body.classList.toggle("dark-mode", isDark);
    syncThemeButton();
    els.darkModeBtn?.addEventListener("click", () => {
        const next = !document.body.classList.contains("dark-mode");
        document.body.classList.toggle("dark-mode", next);
        localStorage.setItem(MAT_AI_THEME_KEY, String(next));
        syncThemeButton();
    });
}

function syncThemeButton() {
    if (els.darkModeBtn) {
        els.darkModeBtn.textContent = document.body.classList.contains("dark-mode") ? "☀ Light" : "🌙 Dark";
    }
}

async function loadContext() {
    try {
        const data = await apiRequest("/api/mat-ai/context");
        state.context = data;
        hydrateContext(data);
        setStatus("MAT AI is ready. Ask about the site, your car issue, parts, or upload a photo.", "ready");
    } catch (error) {
        setStatus(error.message || "MAT AI context could not load right now.", "error");
    }
}

function hydrateContext(data) {
    els.siteProducts.textContent = numberOrDash(data.productCount);
    els.sitePages.textContent = numberOrDash(data.pageCount);
    els.storeCurrency.textContent = data.store?.currency || "GMD";
    els.storeWhatsapp.textContent = data.store?.whatsappNumber || "Available on site";
    const categoryCount = Object.keys(data.categoryCounts || {}).length;
    els.catalogSummary.textContent = `${numberOrDash(data.productCount)} items / ${numberOrDash(categoryCount)} categories`;

    if (els.knownPages) {
        els.knownPages.innerHTML = (data.pages || []).slice(0, 8).map(page => `
            <article class="mat-page-pill">
                <strong>${escapeHtml(page.title || page.fileName || "Page")}</strong>
                <span>${escapeHtml(page.fileName || "")}</span>
            </article>
        `).join("");
    }

    if (!state.messages.length) {
        renderRelatedProducts(data.featured || [], true);
    }
}

function renderWelcomeMessage() {
    appendMessage("assistant", [
        "I’m MAT AI. I can help with:",
        "- Car symptoms and likely causes",
        "- Step-by-step repair guidance",
        "- Part recommendations from Mat Auto when relevant",
        "- Questions about this website, orders, quotes, and catalog pages",
        "- Vehicle photo analysis for visible specs or parts"
    ].join("\n"), false);
}

function clearChat() {
    state.messages = [];
    els.chatMessages.innerHTML = "";
    renderWelcomeMessage();
    clearImageSelection();
    if (state.context?.featured) renderRelatedProducts(state.context.featured, true);
    setStatus("Chat cleared. MAT AI is ready for a new question.", "ready");
}

async function handleSubmit(event) {
    event.preventDefault();
    const prompt = els.input.value.trim();
    if (!prompt && !state.imageDataUrl) {
        setStatus("Type a question or upload a car photo first.", "error");
        return;
    }
    if (state.busy) return;

    const userText = prompt || "Analyze this vehicle image and tell me what you can identify.";
    const payloadMessages = [...state.messages, { role: "user", content: userText }].slice(-MAX_HISTORY_MESSAGES);

    appendMessage("user", userText, false);
    els.input.value = "";
    setBusy(true);
    setStatus(state.imageDataUrl ? "Analyzing your message and photo…" : "Thinking through your question…", "pending");

    try {
        const data = await apiRequest("/api/mat-ai/chat", {
            method: "POST",
            body: JSON.stringify({
                messages: payloadMessages,
                imageDataUrl: state.imageDataUrl || "",
            }),
        });

        appendMessage("assistant", data.reply || "I could not generate a reply.", false);
        state.messages = [...payloadMessages, { role: "assistant", content: data.reply || "" }].slice(-MAX_HISTORY_MESSAGES);
        renderRelatedProducts(data.matchedProducts || []);
        clearImageSelection();
        setStatus("MAT AI is ready for your next question.", "ready");
    } catch (error) {
        const failureReply = `I hit a problem: ${error.message}`;
        appendMessage("assistant", failureReply, false);
        state.messages = [...payloadMessages, { role: "assistant", content: failureReply }].slice(-MAX_HISTORY_MESSAGES);
        setStatus(error.message || "MAT AI request failed.", "error");
    } finally {
        setBusy(false);
    }
}

function setBusy(next) {
    state.busy = next;
    if (els.sendBtn) els.sendBtn.disabled = next;
    if (els.uploadImageBtn) els.uploadImageBtn.disabled = next;
    if (els.clearChatBtn) els.clearChatBtn.disabled = next;
}

async function handleImageSelection(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
        setStatus("Compressing your photo for visual analysis…", "pending");
        const compressed = await compressImage(file);
        state.imageDataUrl = compressed.dataUrl;
        state.imageName = file.name;
        state.imageBytes = compressed.bytes;
        if (els.imagePreview) els.imagePreview.src = compressed.dataUrl;
        if (els.imagePreviewName) els.imagePreviewName.textContent = file.name;
        if (els.imagePreviewSize) els.imagePreviewSize.textContent = `${formatBytes(compressed.bytes)} after compression`;
        if (els.imagePreviewCard) els.imagePreviewCard.hidden = false;
        setStatus("Photo attached. Ask MAT AI what you want to know about this vehicle.", "ready");
    } catch (error) {
        clearImageSelection();
        setStatus(error.message || "This image could not be prepared for analysis.", "error");
    } finally {
        if (els.imageInput) els.imageInput.value = "";
    }
}

function clearImageSelection() {
    state.imageDataUrl = "";
    state.imageName = "";
    state.imageBytes = 0;
    if (els.imagePreviewCard) els.imagePreviewCard.hidden = true;
    if (els.imagePreview) els.imagePreview.removeAttribute("src");
}

function appendMessage(role, text, persist) {
    const article = document.createElement("article");
    article.className = `mat-message mat-message-${role}`;
    article.innerHTML = `
        <span class="mat-message-meta">${role === "assistant" ? "MAT AI" : "You"}</span>
        <div class="mat-message-content">${renderRichText(text)}</div>
    `;
    els.chatMessages.appendChild(article);
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;

    if (persist) {
        state.messages.push({ role, content: text });
        state.messages = state.messages.slice(-MAX_HISTORY_MESSAGES);
    }
}

function renderRichText(text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    let html = "";
    let openList = false;

    const closeList = () => {
        if (openList) {
            html += "</ul>";
            openList = false;
        }
    };

    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) {
            closeList();
            return;
        }

        const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
        if (bullet) {
            if (!openList) {
                html += "<ul>";
                openList = true;
            }
            html += `<li>${linkify(escapeHtml(bullet[1]))}</li>`;
            return;
        }

        closeList();
        html += `<p>${linkify(escapeHtml(trimmed))}</p>`;
    });

    closeList();
    return html || "<p>No response.</p>";
}

function renderRelatedProducts(products, showFallbackText = false) {
    if (!els.relatedProducts) return;
    const list = Array.isArray(products) ? products : [];
    if (!list.length) {
        els.relatedProducts.innerHTML = showFallbackText
            ? `<p class="mat-empty-copy">MAT AI will surface relevant catalog items here when your question matches a part or repair need.</p>`
            : `<p class="mat-empty-copy">No strong catalog match yet. Try including the part name, make, model, or symptom.</p>`;
        return;
    }

    els.relatedProducts.innerHTML = list.map(product => `
        <article class="mat-related-card">
            <h3>${escapeHtml(product.name || "Part")}</h3>
            <div class="mat-related-meta">
                <span>${escapeHtml((product.category || "parts").toUpperCase())}</span>
                <span>${formatCurrency(product.price)}</span>
                <span>${stockLabel(product.stock)}</span>
            </div>
            <p>${escapeHtml(product.description || product.specs || "Ask MAT AI if this part fits your issue.")}</p>
            <button class="btn btn-primary btn-sm" type="button" data-ask-product="${encodeURIComponent(product.name || "")}">
                Ask About This Part
            </button>
        </article>
    `).join("");

    els.relatedProducts.querySelectorAll("[data-ask-product]").forEach(button => {
        button.addEventListener("click", () => {
            const name = decodeURIComponent(button.getAttribute("data-ask-product") || "this%20part");
            els.input.value = `Tell me if ${name} is the right part for my issue and what I should verify before buying.`;
            els.input.focus();
        });
    });
}

async function compressImage(file) {
    if (!/^image\/(png|jpeg|jpg)$/i.test(file.type)) {
        throw new Error("Please upload a PNG or JPG image.");
    }

    const image = await loadImage(file);
    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;
    const maxSide = 1200;
    const ratio = Math.min(maxSide / width, maxSide / height, 1);
    width = Math.max(1, Math.round(width * ratio));
    height = Math.max(1, Math.round(height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, width, height);

    const qualitySteps = [0.82, 0.74, 0.68, 0.6, 0.54, 0.48];
    let bestBlob = null;
    for (const quality of qualitySteps) {
        const blob = await canvasToBlob(canvas, "image/jpeg", quality);
        if (!blob) continue;
        bestBlob = blob;
        if (blob.size <= 170 * 1024) break;
    }

    if (!bestBlob) throw new Error("The image could not be compressed.");
    if (bestBlob.size > 170 * 1024) {
        throw new Error("That photo is still too large after compression. Try a closer crop or smaller image.");
    }

    return {
        bytes: bestBlob.size,
        dataUrl: await blobToDataUrl(bestBlob),
    };
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("The selected image could not be read."));
        };
        image.src = objectUrl;
    });
}

function canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Failed to prepare the image."));
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsDataURL(blob);
    });
}

function setStatus(message, tone) {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.dataset.tone = tone || "info";
}

async function apiRequest(path, options = {}) {
    const base = await discoverApiBase();
    const url = joinApiUrl(base, path);
    const response = await fetchWithTimeout(url, {
        method: options.method || "GET",
        headers: {
            "Accept": "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {}),
        },
        body: options.body,
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(data?.error || `MAT AI request failed (${response.status}).`);
    }
    return data;
}

async function discoverApiBase() {
    if (state.apiBase) return state.apiBase;

    for (const candidate of MAT_AI_API_CANDIDATES) {
        try {
            const response = await fetchWithTimeout(joinApiUrl(candidate, "/api/health"), {
                method: "GET",
                headers: { "Accept": "application/json" },
            }, 3500);
            const data = await parseJsonResponse(response);
            if (response.ok && data?.status === "ok") {
                state.apiBase = candidate;
                return candidate;
            }
        } catch {
            continue;
        }
    }

    throw new Error("MAT AI could not find its backend API. If this site is deployed on Vercel, confirm the `/api/health` endpoint works and the Vercel environment variables are set. If you are previewing locally, open the Node-hosted site instead of a static preview.");
}

function buildApiCandidates() {
    const candidates = [];
    const configured = globalThis.__MAT_AI_API_BASE__;
    if (configured) candidates.push(String(configured).trim());

    const { protocol, origin, hostname, port } = window.location;
    if (protocol === "http:" || protocol === "https:") {
        candidates.push(origin);
    }

    const isPreviewPort = port === "3000" || port === "5500" || port === "5501" || port === "4173" || port === "8080";
    if (hostname && isPreviewPort) {
        candidates.push(`${protocol}//${hostname}:4010`);
    }

    candidates.push("http://127.0.0.1:4010");
    candidates.push("http://localhost:4010");
    candidates.push("http://127.0.0.1:3000");
    candidates.push("http://localhost:3000");

    return Array.from(new Set(
        candidates
            .map(value => String(value || "").trim().replace(/\/+$/, ""))
            .filter(Boolean)
    ));
}

function joinApiUrl(base, path) {
    return `${String(base || "").replace(/\/+$/, "")}${path}`;
}

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, mode: "cors", signal: controller.signal });
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("MAT AI backend request timed out.");
        }
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}

async function parseJsonResponse(response) {
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const text = await response.text();
    if (!text) return {};
    if (contentType.includes("application/json")) {
        try {
            return JSON.parse(text);
        } catch {
            throw new Error("MAT AI returned invalid JSON.");
        }
    }

    const sample = text.trim().slice(0, 120).toLowerCase();
    if (sample.startsWith("<!doctype") || sample.startsWith("<html") || sample.includes("<body")) {
        throw new Error("MAT AI reached an HTML page instead of the backend API. On Vercel, check that the API function deployed correctly. In local preview mode, this page must be opened through the Node-hosted site rather than a static HTML preview.");
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new Error("MAT AI returned a non-JSON response.");
    }
}

function numberOrDash(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString("en-US") : "--";
}

function formatCurrency(value) {
    const num = Number(value) || 0;
    return `GMD ${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function stockLabel(value) {
    const stock = Number(value) || 0;
    if (stock <= 0) return "Out of stock";
    if (stock <= 3) return `Only ${stock} left`;
    return `${stock} in stock`;
}

function formatBytes(bytes) {
    if (!bytes) return "0 KB";
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function linkify(text) {
    return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}
