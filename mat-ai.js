"use strict";

(() => {
    const STANDALONE_PAGE = document.body.classList.contains("mat-ai-page");
    const MAT_AI_THEME_KEY = "maDarkMode";
    const MAT_AI_SESSION_KEY = "maMatAiSessionV4";
    const MAT_AI_API_BASE_KEY = "maMatAiApiBase";
    const MAX_HISTORY_MESSAGES = 12;
    const REQUEST_TIMEOUT_MS = 18000;

    const state = {
        messages: [],
        imageDataUrl: "",
        imageName: "",
        imageBytes: 0,
        busy: false,
        backendReady: false,
        context: null,
        apiBase: "",
        dragDepth: 0,
        lastAssistantReply: "",
        lastProducts: [],
    };

    const els = {
        chatForm: document.getElementById("chatForm"),
        input: document.getElementById("matAiInput"),
        chatMessages: document.getElementById("chatMessages"),
        chatDropZone: document.getElementById("chatDropZone"),
        status: document.getElementById("assistantStatus"),
        sendBtn: document.getElementById("sendBtn"),
        clearChatBtn: document.getElementById("clearChatBtn"),
        copyLastReplyBtn: document.getElementById("copyLastReplyBtn"),
        whatsappSummaryBtn: document.getElementById("whatsappSummaryBtn"),
        uploadImageBtn: document.getElementById("uploadImageBtn"),
        takePhotoBtn: document.getElementById("takePhotoBtn"),
        scanPartPromptBtn: document.getElementById("scanPartPromptBtn"),
        imageInput: document.getElementById("matAiImage"),
        cameraInput: document.getElementById("matAiCamera"),
        imagePreviewCard: document.getElementById("imagePreviewCard"),
        imagePreview: document.getElementById("imagePreview"),
        imagePreviewName: document.getElementById("imagePreviewName"),
        imagePreviewSize: document.getElementById("imagePreviewSize"),
        removeImageBtn: document.getElementById("removeImageBtn"),
        buildVehiclePromptBtn: document.getElementById("buildVehiclePromptBtn"),
        vehicleMake: document.getElementById("matVehicleMake"),
        vehicleModel: document.getElementById("matVehicleModel"),
        vehicleYear: document.getElementById("matVehicleYear"),
        vehicleConcern: document.getElementById("matVehicleConcern"),
        siteProducts: document.getElementById("siteProducts"),
        sitePages: document.getElementById("sitePages"),
        storeCurrency: document.getElementById("storeCurrency"),
        storeWhatsapp: document.getElementById("storeWhatsapp"),
        catalogSummary: document.getElementById("catalogSummary"),
        knownPages: document.getElementById("knownPages"),
        featuredPartsGallery: document.getElementById("featuredPartsGallery"),
        relatedProducts: document.getElementById("relatedProducts"),
        connectionState: document.getElementById("matConnectionState"),
        connectionHost: document.getElementById("matConnectionHost"),
        darkModeBtn: document.getElementById("darkModeBtn"),
        hamburger: document.getElementById("hamburger"),
        navLinks: document.getElementById("navLinks"),
    };

    if (!els.chatForm || !els.chatMessages || !els.input) return;

    const MAT_AI_API_CANDIDATES = buildApiCandidates();
    init();

    function init() {
        if (STANDALONE_PAGE) {
            setupTheme();
            setupNav();
            ensureLatestServiceWorker();
        }
        bindUi();
        const restored = restoreSession();
        if (!restored) renderWelcomeMessage();
        syncActionButtons();
        syncChatLogState();
        setInteractionAvailability(false);
        loadContext();
    }

    function bindUi() {
        els.chatForm?.addEventListener("submit", handleSubmit);
        els.clearChatBtn?.addEventListener("click", clearChat);
        els.copyLastReplyBtn?.addEventListener("click", copyLastReply);
        els.whatsappSummaryBtn?.addEventListener("click", openWhatsappSummary);
        els.uploadImageBtn?.addEventListener("click", () => els.imageInput?.click());
        els.takePhotoBtn?.addEventListener("click", () => els.cameraInput?.click());
        els.scanPartPromptBtn?.addEventListener("click", applyScanPartPrompt);
        els.imageInput?.addEventListener("change", event => handleImageSelection(event, "upload"));
        els.cameraInput?.addEventListener("change", event => handleImageSelection(event, "camera"));
        els.removeImageBtn?.addEventListener("click", clearImageSelection);
        els.buildVehiclePromptBtn?.addEventListener("click", buildVehiclePrompt);
        els.input?.addEventListener("keydown", event => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                els.chatForm?.requestSubmit();
            }
        });
        els.input?.addEventListener("paste", handlePaste);
        bindDropZone();

        document.querySelectorAll("[data-prompt]").forEach(button => {
            button.addEventListener("click", () => {
                els.input.value = button.getAttribute("data-prompt") || "";
                els.input.focus();
            });
        });
    }

    function bindDropZone() {
        if (!els.chatDropZone) return;

        ["dragenter", "dragover"].forEach(type => {
            els.chatDropZone.addEventListener(type, event => {
                event.preventDefault();
                if (!hasFileTransfer(event)) return;
                state.dragDepth += 1;
                els.chatDropZone.classList.add("is-dragging");
            });
        });

        ["dragleave", "dragend"].forEach(type => {
            els.chatDropZone.addEventListener(type, event => {
                event.preventDefault();
                if (!hasFileTransfer(event)) return;
                state.dragDepth = Math.max(0, state.dragDepth - 1);
                if (state.dragDepth === 0) {
                    els.chatDropZone.classList.remove("is-dragging");
                }
            });
        });

        els.chatDropZone.addEventListener("drop", async event => {
            event.preventDefault();
            state.dragDepth = 0;
            els.chatDropZone.classList.remove("is-dragging");
            const file = event.dataTransfer?.files?.[0];
            if (!file) return;
            await processIncomingFile(file, "drag and drop");
        });
    }

    function hasFileTransfer(event) {
        return Array.from(event.dataTransfer?.types || []).includes("Files");
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
        if (!els.darkModeBtn) return;
        els.darkModeBtn.textContent = document.body.classList.contains("dark-mode") ? "☀ Light" : "🌙 Dark";
    }

    async function ensureLatestServiceWorker() {
        if (!("serviceWorker" in navigator)) return;
        try {
            const registration = await navigator.serviceWorker.register("/service-worker.js?v=2026-05-06-1", {
                updateViaCache: "none",
            });
            registration.update().catch(() => {});
            if (registration.waiting) {
                registration.waiting.postMessage({ type: "SKIP_WAITING" });
            }
        } catch {
            // Ignore service worker refresh issues on this page.
        }
    }

    async function loadContext() {
        try {
            const data = await apiRequest("/api/mat-ai/context");
            state.context = data;
            hydrateContext(data);

            const liveMode = data.capabilities?.mode === "live" || data.capabilities?.mode === "hybrid";
            if (!liveMode) {
                state.backendReady = false;
                setInteractionAvailability(false);
                setStatus("Live MAT AI is not configured on the backend yet. Add the provider key in Vercel and redeploy.", "error");
                updateConnectionUi("Setup required", state.apiBase || "The backend responded, but the live AI provider is not ready.", "error");
                return;
            }

            state.backendReady = true;
            setInteractionAvailability(true);
            setStatus("Live MAT AI is online. Upload a part photo or ask a question to begin.", "ready");
            updateConnectionUi("Live AI online", state.apiBase || "Connected to the deployed backend.", "ok");
        } catch (error) {
            state.backendReady = false;
            setInteractionAvailability(false);
            const message = error.message || "MAT AI could not connect to the live backend.";
            setStatus(message, "error");
            updateConnectionUi("Backend offline", message, "error");
        }
    }

    function hydrateContext(data) {
        if (els.siteProducts) els.siteProducts.textContent = numberOrDash(data.productCount);
        if (els.sitePages) els.sitePages.textContent = numberOrDash(data.pageCount);
        if (els.storeCurrency) els.storeCurrency.textContent = data.store?.currency || "GMD";
        if (els.storeWhatsapp) els.storeWhatsapp.textContent = data.store?.whatsappNumber || "Available on site";

        const categoryCount = Object.keys(data.categoryCounts || {}).length;
        if (els.catalogSummary) {
            els.catalogSummary.textContent = `${numberOrDash(data.productCount)} items / ${numberOrDash(categoryCount)} categories`;
        }

        if (els.knownPages) {
            els.knownPages.innerHTML = (data.pages || []).slice(0, 8).map(page => `
                <article class="mat-page-pill">
                    <strong>${escapeHtml(page.title || page.fileName || "Page")}</strong>
                    <span>${escapeHtml(page.fileName || "")}</span>
                </article>
            `).join("");
        }

        renderFeaturedParts(data.featured || []);
        if (!state.messages.length && !state.lastProducts.length) {
            renderRelatedProducts(data.featured || [], true);
        }
    }

    function renderFeaturedParts(products) {
        if (!els.featuredPartsGallery) return;
        const list = Array.isArray(products) ? products.slice(0, 4) : [];
        if (!list.length) {
            els.featuredPartsGallery.innerHTML = `<p class="mat-empty-copy">Featured part images will appear here when catalog images are available.</p>`;
            return;
        }

        els.featuredPartsGallery.innerHTML = list.map(product => {
            const image = sanitizeAssetUrl(product.image);
            return `
                <article class="mat-featured-card">
                    ${image ? `<img class="mat-featured-thumb" src="${image}" alt="${escapeHtml(product.name || "Car part")}">` : ""}
                    <div class="mat-featured-body">
                        <strong>${escapeHtml(product.name || "Featured part")}</strong>
                        <span class="mat-featured-meta">${escapeHtml(product.category || "parts")} · ${formatCurrency(product.price)}</span>
                        <div class="mat-featured-actions">
                            <button class="btn btn-ghost btn-sm" type="button" data-featured-part="${encodeURIComponent(product.name || "")}">
                                Ask About This
                            </button>
                        </div>
                    </div>
                </article>
            `;
        }).join("");

        els.featuredPartsGallery.querySelectorAll("[data-featured-part]").forEach(button => {
            button.addEventListener("click", () => {
                const name = decodeURIComponent(button.getAttribute("data-featured-part") || "");
                els.input.value = `Tell me what to check before buying or replacing ${name}, and which vehicles or symptoms it is usually related to.`;
                els.input.focus();
            });
        });
    }

    function renderWelcomeMessage() {
        appendMessage("assistant", [
            "I am MAT AI, your live automotive website assistant.",
            "",
            "I can help with:",
            "- identifying car parts from photos",
            "- engine symptoms, warning signs, and repair guidance",
            "- parts recommendations and fitment follow-up questions",
            "- quotes, ordering, contact, and website support",
            "- what to inspect before replacing or buying a part"
        ].join("\n"), { persist: false });
    }

    function restoreSession() {
        try {
            const raw = localStorage.getItem(MAT_AI_SESSION_KEY);
            if (!raw) return false;

            const session = JSON.parse(raw);
            state.messages = Array.isArray(session?.messages)
                ? session.messages
                    .filter(entry => entry && (entry.role === "user" || entry.role === "assistant") && entry.content)
                    .slice(-MAX_HISTORY_MESSAGES)
                : [];
            state.lastAssistantReply = String(session?.lastAssistantReply || "");
            state.lastProducts = Array.isArray(session?.lastProducts) ? session.lastProducts : [];

            if (!state.messages.length) return false;

            els.chatMessages.innerHTML = "";
            state.messages.forEach(message => appendMessage(message.role, message.content, { persist: false }));
            if (state.lastProducts.length) {
                renderRelatedProducts(state.lastProducts, true);
            }
            return true;
        } catch {
            return false;
        }
    }

    function persistSession() {
        try {
            localStorage.setItem(MAT_AI_SESSION_KEY, JSON.stringify({
                messages: state.messages.slice(-MAX_HISTORY_MESSAGES),
                lastAssistantReply: state.lastAssistantReply,
                lastProducts: state.lastProducts.slice(0, 6),
            }));
        } catch {
            // Ignore storage failures.
        }
    }

    function clearChat() {
        state.messages = [];
        state.lastAssistantReply = "";
        state.lastProducts = [];
        els.chatMessages.innerHTML = "";
        renderWelcomeMessage();
        clearImageSelection();
        renderRelatedProducts(state.context?.featured || [], true);
        setStatus(
            state.backendReady
                ? "Chat cleared. Live MAT AI is ready for a new question."
                : "Chat cleared. Connect the live backend to continue.",
            state.backendReady ? "ready" : "error"
        );
        persistSession();
        syncActionButtons();
        syncChatLogState();
    }

    async function handleSubmit(event) {
        event.preventDefault();

        if (!state.backendReady) {
            setStatus("The live MAT AI backend is not ready yet. Finish the Vercel AI setup first.", "error");
            return;
        }

        const prompt = els.input.value.trim();
        if (!prompt && !state.imageDataUrl) {
            setStatus("Type a question or upload a car-part photo first.", "error");
            return;
        }
        if (state.busy) return;

        const attachedImage = state.imageDataUrl || "";
        const attachedImageName = state.imageName || "Attached image";
        const userText = prompt || "Identify this car part or vehicle area from the image, explain what it does, what goes wrong when it fails, and what I should verify before replacing it.";
        const payloadMessages = [...state.messages, { role: "user", content: userText }].slice(-MAX_HISTORY_MESSAGES);

        appendMessage("user", userText, {
            persist: false,
            imageDataUrl: attachedImage,
            imageName: attachedImageName,
        });
        els.input.value = "";
        setBusy(true);
        setStatus(attachedImage ? "Sending your message and image to live MAT AI…" : "MAT AI is thinking…", "pending");

        try {
            const data = await requestMatAiReply(payloadMessages, attachedImage);
            const reply = data.reply || "I could not generate a reply.";

            appendMessage("assistant", reply, { persist: false });
            state.messages = [...payloadMessages, { role: "assistant", content: reply }].slice(-MAX_HISTORY_MESSAGES);
            state.lastAssistantReply = reply;
            state.lastProducts = Array.isArray(data.matchedProducts) ? data.matchedProducts : [];
            renderRelatedProducts(state.lastProducts);
            clearImageSelection();

            if (data.mode && data.mode !== "advanced") {
                setStatus(data.warning || "MAT AI responded, but the backend reported a degraded mode.", "pending");
                updateConnectionUi("Check AI provider", data.warning || "The backend did not report full live mode.", "warn");
            } else {
                setStatus("Live MAT AI is ready for your next question.", "ready");
                updateConnectionUi("Live AI online", state.apiBase || "Connected to the deployed backend.", "ok");
            }

            persistSession();
            syncActionButtons();
        } catch (error) {
            const failureReply = `I hit a live backend problem: ${error.message}`;
            appendMessage("assistant", failureReply, { persist: false });
            state.messages = [...payloadMessages, { role: "assistant", content: failureReply }].slice(-MAX_HISTORY_MESSAGES);
            state.lastAssistantReply = failureReply;
            setStatus(error.message || "MAT AI request failed.", "error");
            updateConnectionUi("Connection error", error.message || "Backend request failed.", "error");
            persistSession();
            syncActionButtons();
        } finally {
            setBusy(false);
        }
    }

    function setBusy(next) {
        state.busy = next;
        if (els.sendBtn) els.sendBtn.disabled = next || !state.backendReady;
        if (els.uploadImageBtn) els.uploadImageBtn.disabled = next || !state.backendReady;
        if (els.takePhotoBtn) els.takePhotoBtn.disabled = next || !state.backendReady;
        if (els.imageInput) els.imageInput.disabled = next || !state.backendReady;
        if (els.cameraInput) els.cameraInput.disabled = next || !state.backendReady;
        if (els.input) els.input.disabled = next || !state.backendReady;
        if (els.clearChatBtn) els.clearChatBtn.disabled = next;
        if (els.copyLastReplyBtn) els.copyLastReplyBtn.disabled = next || !state.lastAssistantReply;
        if (els.whatsappSummaryBtn) els.whatsappSummaryBtn.disabled = next || !state.lastAssistantReply;
    }

    function setInteractionAvailability(enabled) {
        if (els.input) {
            els.input.disabled = !enabled;
            els.input.placeholder = enabled
                ? "Message MAT AI about a car issue, engine, part, fitment concern, order, or this website."
                : "Connect the live MAT AI backend to start chatting.";
        }
        if (els.sendBtn) els.sendBtn.disabled = !enabled || state.busy;
        if (els.uploadImageBtn) els.uploadImageBtn.disabled = !enabled || state.busy;
        if (els.takePhotoBtn) els.takePhotoBtn.disabled = !enabled || state.busy;
        if (els.imageInput) els.imageInput.disabled = !enabled || state.busy;
        if (els.cameraInput) els.cameraInput.disabled = !enabled || state.busy;
    }

    async function handleImageSelection(event, sourceLabel) {
        if (!state.backendReady) {
            setStatus("The live backend must be ready before image uploads can be used.", "error");
            return;
        }

        const file = event.target.files?.[0];
        if (!file) return;
        await processIncomingFile(file, sourceLabel);
        event.target.value = "";
    }

    async function handlePaste(event) {
        if (!state.backendReady) return;
        const items = Array.from(event.clipboardData?.items || []);
        const imageItem = items.find(item => item.type && item.type.startsWith("image/"));
        if (!imageItem) return;
        const file = imageItem.getAsFile();
        if (!file) return;
        event.preventDefault();
        await processIncomingFile(file, "paste");
    }

    async function processIncomingFile(file, sourceLabel) {
        try {
            setStatus(`Preparing your ${sourceLabel} image for live AI analysis…`, "pending");
            const compressed = await compressImage(file);
            state.imageDataUrl = compressed.dataUrl;
            state.imageName = file.name || "car-part-photo.jpg";
            state.imageBytes = compressed.bytes;
            if (els.imagePreview) els.imagePreview.src = compressed.dataUrl;
            if (els.imagePreviewName) els.imagePreviewName.textContent = state.imageName;
            if (els.imagePreviewSize) {
                els.imagePreviewSize.textContent = `${formatBytes(compressed.bytes)} after compression · ready for part analysis`;
            }
            if (els.imagePreviewCard) els.imagePreviewCard.hidden = false;
            setStatus("Photo attached. Ask MAT AI to identify the part, explain its function, or suggest replacement checks.", "ready");
        } catch (error) {
            clearImageSelection();
            setStatus(error.message || "This image could not be prepared for analysis.", "error");
        }
    }

    function clearImageSelection() {
        state.imageDataUrl = "";
        state.imageName = "";
        state.imageBytes = 0;
        if (els.imagePreviewCard) els.imagePreviewCard.hidden = true;
        if (els.imagePreview) els.imagePreview.removeAttribute("src");
    }

    function buildVehiclePrompt() {
        const make = (els.vehicleMake?.value || "").trim();
        const model = (els.vehicleModel?.value || "").trim();
        const year = (els.vehicleYear?.value || "").trim();
        const concern = (els.vehicleConcern?.value || "").trim();

        if (!make && !model && !year && !concern) {
            setStatus("Add at least one vehicle detail or the main symptom first.", "error");
            els.vehicleConcern?.focus();
            return;
        }

        const vehicle = [year, make, model].filter(Boolean).join(" ");
        const promptParts = [];
        if (vehicle) promptParts.push(`I need professional help with a ${vehicle}.`);
        if (concern) promptParts.push(`The main issue is: ${concern}.`);
        promptParts.push("Please explain the likely causes, what I should inspect first, the safety risk, and which Mat Auto parts may help.");
        els.input.value = promptParts.join(" ");
        els.input.focus();
        setStatus("Vehicle details added to the prompt. Review it and send when ready.", "ready");
    }

    function applyScanPartPrompt() {
        els.input.value = "Identify this car part from the photo, explain what it does, common failure signs, and what I should verify before replacing or buying it.";
        els.input.focus();
        setStatus("Part scan prompt added. Attach a photo if you have one, then send.", "ready");
    }

    async function copyLastReply() {
        if (!state.lastAssistantReply) {
            setStatus("There is no MAT AI reply to copy yet.", "error");
            return;
        }

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(state.lastAssistantReply);
            } else {
                const helper = document.createElement("textarea");
                helper.value = state.lastAssistantReply;
                helper.setAttribute("readonly", "readonly");
                helper.style.position = "fixed";
                helper.style.opacity = "0";
                document.body.appendChild(helper);
                helper.select();
                document.execCommand("copy");
                helper.remove();
            }
            setStatus("MAT AI reply copied to your clipboard.", "ready");
        } catch {
            setStatus("Copy failed on this device. Try selecting the message manually.", "error");
        }
    }

    function openWhatsappSummary() {
        if (!state.lastAssistantReply) {
            setStatus("Ask MAT AI something first so I can build a WhatsApp summary.", "error");
            return;
        }

        const number = String(state.context?.store?.whatsappNumber || "").replace(/[^\d]/g, "");
        if (!number) {
            setStatus("WhatsApp contact is not available yet. Use the contact page instead.", "error");
            return;
        }

        const lastUserMessage = [...state.messages].reverse().find(message => message.role === "user")?.content || "Vehicle help";
        const text = [
            "Hello Mat Auto,",
            "",
            "I used MAT AI on the website and want help with this:",
            lastUserMessage,
            "",
            "MAT AI summary:",
            truncateText(state.lastAssistantReply, 900),
        ].join("\n");

        window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
        setStatus("Opening WhatsApp with your MAT AI summary…", "ready");
    }

    function syncActionButtons() {
        const disabled = !state.lastAssistantReply;
        if (els.copyLastReplyBtn) els.copyLastReplyBtn.disabled = disabled || state.busy;
        if (els.whatsappSummaryBtn) els.whatsappSummaryBtn.disabled = disabled || state.busy;
    }

    function appendMessage(role, text, options = {}) {
        const article = document.createElement("article");
        article.className = `mat-message mat-message-${role}`;
        article.innerHTML = `
            <span class="mat-message-meta">${role === "assistant" ? "MAT AI" : "You"}</span>
            <div class="mat-message-content">${renderRichText(text)}</div>
            ${options.imageDataUrl ? `
                <div class="mat-message-image">
                    <img src="${options.imageDataUrl}" alt="${escapeHtml(options.imageName || "Attached image")}">
                </div>
            ` : ""}
        `;
        els.chatMessages.appendChild(article);
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;

        if (options.persist) {
            state.messages.push({ role, content: text });
            state.messages = state.messages.slice(-MAX_HISTORY_MESSAGES);
        }

        syncChatLogState();
    }

    function syncChatLogState() {
        if (!els.chatMessages) return;
        const hasMessages = els.chatMessages.querySelectorAll(".mat-message").length > 0;
        els.chatMessages.classList.toggle("has-messages", hasMessages);
    }

    function renderRichText(text) {
        const lines = String(text || "").replace(/\r/g, "").split("\n");
        let html = "";
        let openList = false;

        const closeList = () => {
            if (!openList) return;
            html += "</ul>";
            openList = false;
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
                ? `<p class="mat-empty-copy">Relevant Mat Auto parts will appear here after you ask a question.</p>`
                : `<p class="mat-empty-copy">No strong catalog match yet. Add the part name, symptom, make, model, or engine details.</p>`;
            return;
        }

        els.relatedProducts.innerHTML = list.map(product => {
            const productImage = sanitizeAssetUrl(product.image);
            return `
                <article class="mat-related-card">
                    ${productImage ? `<img class="mat-related-thumb" src="${productImage}" alt="${escapeHtml(product.name || "Part")}">` : ""}
                    <div class="mat-related-card-body">
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
                    </div>
                </article>
            `;
        }).join("");

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
        const maxSide = 1400;
        const ratio = Math.min(maxSide / width, maxSide / height, 1);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, width, height);

        const qualitySteps = [0.86, 0.78, 0.7, 0.62, 0.54, 0.48];
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

    function updateConnectionUi(label, detail, stateName) {
        if (els.connectionState) {
            els.connectionState.textContent = label;
            els.connectionState.dataset.state = stateName || "warn";
        }
        if (els.connectionHost) {
            els.connectionHost.textContent = detail;
        }
    }

    async function apiRequest(path, options = {}) {
        const base = await discoverApiBase();
        updateConnectionUi("Connected", base, "ok");
        const response = await fetchWithTimeout(joinApiUrl(base, path), {
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

    async function requestMatAiReply(messages, imageDataUrl) {
        return await apiRequest("/api/mat-ai/chat", {
            method: "POST",
            body: JSON.stringify({
                messages,
                imageDataUrl,
            }),
        });
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
                    try {
                        localStorage.setItem(MAT_AI_API_BASE_KEY, candidate);
                    } catch {
                        // Ignore storage failures.
                    }
                    return candidate;
                }
            } catch {
                continue;
            }
        }

        if (window.location.hostname.endsWith(".github.io")) {
            throw new Error("This page could not reach the live MAT AI backend. Point `mat-ai-config.js` to your Vercel domain first.");
        }

        throw new Error("MAT AI could not find a live backend for this website. On Vercel, confirm `/api/health` works. Locally, start the server first.");
    }

    function buildApiCandidates() {
        const candidates = [];
        const queryBase = new URLSearchParams(window.location.search).get("matAiApiBase");
        if (queryBase) candidates.push(String(queryBase).trim());

        try {
            const savedBase = localStorage.getItem(MAT_AI_API_BASE_KEY);
            if (savedBase) candidates.push(String(savedBase).trim());
        } catch {
            // Ignore storage failures.
        }

        const metaBase = document.querySelector('meta[name="mat-ai-api-base"]')?.getAttribute("content");
        if (metaBase) candidates.push(String(metaBase).trim());

        const configured = globalThis.__MAT_AI_API_BASE__;
        if (configured) candidates.push(String(configured).trim());

        const { protocol, origin, hostname, port } = window.location;
        if (protocol === "http:" || protocol === "https:") candidates.push(origin);

        const isPreviewPort = port === "3000" || port === "4173" || port === "5500" || port === "5501" || port === "8080";
        if (hostname && isPreviewPort) {
            candidates.push(`${protocol}//${hostname}:4010`);
        }

        candidates.push("http://127.0.0.1:4010");
        candidates.push("http://localhost:4010");
        candidates.push("http://127.0.0.1:3000");
        candidates.push("http://localhost:3000");

        return Array.from(new Set(candidates.map(normalizeApiCandidate).filter(Boolean)));
    }

    function normalizeApiCandidate(value) {
        return String(value || "").trim().replace(/\/+$/, "");
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
            if (error.name === "AbortError") throw new Error("MAT AI backend request timed out.");
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
            throw new Error("MAT AI reached an HTML page instead of the backend API. Confirm the site is running on Vercel with `/api/health` available.");
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

    function truncateText(value, max = 280) {
        const text = String(value || "").trim();
        if (text.length <= max) return text;
        return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function sanitizeAssetUrl(value) {
        const url = String(value || "").trim();
        if (!url) return "";
        if (/^(https?:\/\/|data:image\/|\.{0,2}\/)/i.test(url)) return escapeHtml(url);
        if (/^[a-z0-9/_-]+\.(?:png|jpe?g|webp|gif|svg)$/i.test(url)) return escapeHtml(url);
        return "";
    }

    function linkify(text) {
        let output = text.replace(
            /(https?:\/\/[^\s<]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
        );
        output = output.replace(
            /\b([a-z0-9-]+\.html(?:#[a-z0-9_-]+)?)\b/gi,
            '<a href="$1">$1</a>'
        );
        return output;
    }
})();
