"use strict";

(() => {
    const FIREBASE_URL = String(
        globalThis.__MAT_AUTO_FIREBASE_DATABASE_URL__ || "https://automat-gm-default-rtdb.firebaseio.com"
    ).replace(/\/+$/, "");
    const CONTEXT_CACHE_KEY = "maMatAiBrowserContextV1";
    const CONTEXT_TTL_MS = 5 * 60 * 1000;
    const PAGE_FILES = [
        "index.html",
        "products.html",
        "about.html",
        "owner.html",
        "promos.html",
        "reviews.html",
        "orders.html",
        "contact.html",
        "track.html",
        "faq.html",
        "features.html",
        "warranty.html",
        "delivery-drivers.html",
        "checkout.html",
    ];
    const SITE_FACTS = {
        storeName: "Mat Auto",
        currency: "GMD",
        whatsappNumber: "2206785316",
        whatsappNumberAlt: "2202328902",
        facebookUrl: "https://www.facebook.com/profile.php?id=61574154117727",
    };

    let knowledgePromise = null;

    globalThis.MatAiBrowserFallback = {
        loadContext,
        respond,
    };

    async function loadContext() {
        const knowledge = await getKnowledge("");
        return toContextPayload(knowledge);
    }

    async function respond({ messages = [], imageDataUrl = "" } = {}) {
        const safeMessages = Array.isArray(messages) ? messages : [];
        const latestUserMessage = [...safeMessages]
            .reverse()
            .find(message => message && message.role === "user" && message.content)?.content || "";
        const knowledge = await getKnowledge(latestUserMessage);
        const matchedProducts = (knowledge.matchedProducts || []).slice(0, 6).map(toPublicProduct);

        return {
            reply: buildMatAiFallbackReply({
                knowledge,
                latestUserMessage,
                imageDataUrl,
            }),
            mode: "browser-fallback",
            warning: imageDataUrl
                ? "Running in GitHub smart mode from browser data. Photo uploads are kept, but visual analysis needs a live backend."
                : "Running in GitHub smart mode from browser data. Website help, part suggestions, and practical diagnosis are available without a backend.",
            matchedProducts,
            context: {
                pageCount: knowledge.pages.length,
                productCount: knowledge.products.length,
                matchedCount: matchedProducts.length,
                categories: knowledge.categoryCounts,
            }
        };
    }

    async function getKnowledge(query = "") {
        const cached = readCachedKnowledge();
        if (cached) {
            return {
                ...cached,
                matchedProducts: selectRelevantProducts(cached.products, query),
            };
        }

        if (!knowledgePromise) {
            knowledgePromise = buildKnowledge().finally(() => {
                knowledgePromise = null;
            });
        }

        const summary = await knowledgePromise;
        return {
            ...summary,
            matchedProducts: selectRelevantProducts(summary.products, query),
        };
    }

    async function buildKnowledge() {
        const [products, pages] = await Promise.all([
            fetchCatalogProducts(),
            fetchKnownPages(),
        ]);

        const categoryCounts = products.reduce((acc, product) => {
            acc[product.category] = (acc[product.category] || 0) + 1;
            return acc;
        }, {});

        const summary = {
            siteFacts: { ...SITE_FACTS },
            products,
            pages,
            categoryCounts,
        };

        writeCachedKnowledge(summary);
        return summary;
    }

    function toContextPayload(knowledge) {
        return {
            store: knowledge.siteFacts,
            pageCount: knowledge.pages.length,
            productCount: knowledge.products.length,
            categoryCounts: knowledge.categoryCounts,
            featured: knowledge.products
                .filter(product => product.featured || product.stock > 0)
                .slice(0, 6)
                .map(toPublicProduct),
            pages: knowledge.pages.slice(0, 10).map(page => ({
                fileName: page.fileName,
                title: page.title,
                description: page.description,
                headings: page.headings,
            })),
            capabilities: {
                mode: "browser-fallback",
                imageAnalysis: false,
                smartFallback: true,
            }
        };
    }

    async function fetchCatalogProducts() {
        const url = `${FIREBASE_URL}/matAutoProducts.json`;
        try {
            const response = await fetch(url, { headers: { Accept: "application/json" } });
            if (!response.ok) throw new Error(`Catalog fetch failed (${response.status})`);
            const raw = await response.json();
            const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
            return list.filter(Boolean).map(normalizeCatalogProduct);
        } catch (error) {
            console.warn("[MAT AI Browser Fallback] Catalog fetch failed:", error.message);
            return [];
        }
    }

    async function fetchKnownPages() {
        const results = await Promise.all(PAGE_FILES.map(async fileName => {
            try {
                const response = await fetch(fileName, { headers: { Accept: "text/html" } });
                if (!response.ok) throw new Error(`Page fetch failed (${response.status})`);
                const html = await response.text();
                return extractPageKnowledgeFromHtml(fileName, html);
            } catch (error) {
                console.warn(`[MAT AI Browser Fallback] Page fetch failed for ${fileName}:`, error.message);
                return {
                    fileName,
                    title: fileName,
                    description: "",
                    headings: [],
                    snippet: "",
                };
            }
        }));

        return results.filter(Boolean);
    }

    function normalizeCatalogProduct(raw = {}) {
        const description = cleanText(raw.description, 420);
        const specs = cleanText(raw.specs, 260);
        const compatibility = Array.isArray(raw.compatibility)
            ? raw.compatibility.map(item => cleanText(item, 120)).filter(Boolean)
            : cleanText(raw.compatibility, 240).split(/[\n,;|]+/).map(item => cleanText(item, 120)).filter(Boolean);

        return {
            id: raw.id || raw.sku || raw.name || Date.now(),
            name: cleanText(raw.name, 180) || "Part",
            category: cleanText(raw.category, 80).toLowerCase() || "parts",
            price: safeNumber(raw.price, 0),
            stock: Math.max(0, Math.round(safeNumber(raw.stock, 0))),
            rating: safeNumber(raw.rating, 0),
            featured: Boolean(raw.featured),
            description,
            specs,
            warranty: cleanText(raw.warranty, 120),
            image: cleanText(raw.image || (Array.isArray(raw.images) ? raw.images[0] : ""), 400),
            searchable: [
                cleanText(raw.name, 180),
                cleanText(raw.category, 80),
                cleanText(raw.brand, 80),
                cleanText(raw.sku, 80),
                cleanText(raw.condition, 40),
                description,
                specs,
                compatibility.join(" "),
                cleanText(raw.make, 80),
                cleanText(raw.model, 80),
            ].join(" ").toLowerCase(),
        };
    }

    function toPublicProduct(product = {}) {
        return {
            id: product.id,
            name: product.name,
            category: product.category,
            price: product.price,
            stock: product.stock,
            rating: product.rating,
            description: product.description,
            specs: product.specs,
            warranty: product.warranty,
            image: product.image,
        };
    }

    function scoreProductMatch(product, terms = []) {
        if (!terms.length) return product.featured ? 1 : 0;
        let score = 0;
        const haystack = product.searchable || "";
        for (const term of terms) {
            if (!term || term.length < 2) continue;
            if (product.name.toLowerCase().includes(term)) score += 6;
            if (product.category.includes(term)) score += 4;
            if (haystack.includes(term)) score += 2;
        }
        if (product.stock > 0) score += 0.35;
        if (product.featured) score += 0.65;
        if (product.rating) score += Math.min(product.rating, 5) * 0.08;
        return score;
    }

    function selectRelevantProducts(products, query, limit = 8) {
        const terms = tokenizeSearch(query);
        return (Array.isArray(products) ? products : [])
            .map(product => ({ product, score: scoreProductMatch(product, terms) }))
            .filter(entry => entry.score > 0)
            .sort((a, b) => b.score - a.score || b.product.stock - a.product.stock || a.product.price - b.product.price)
            .slice(0, limit)
            .map(entry => entry.product);
    }

    function extractPageKnowledgeFromHtml(fileName, html) {
        const title = cleanText(extractMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i), 180) || fileName;
        const description = cleanText(
            extractMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"]+)["']/i),
            240
        );
        const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
            .map(match => cleanText(match[1], 120))
            .filter(Boolean)
            .slice(0, 8);
        const snippet = cleanText(stripHtml(html), 280);

        return {
            fileName,
            title,
            description,
            headings,
            snippet,
        };
    }

    function buildMatAiFallbackReply({ knowledge, latestUserMessage, imageDataUrl = "" }) {
        const query = String(latestUserMessage || "").toLowerCase();
        const websiteIntent = hasAnyTerm(query, [
            "website", "site", "page", "order", "orders", "track", "tracking", "quote", "quotes",
            "contact", "delivery", "payment", "pay", "return", "refund", "whatsapp", "facebook",
            "catalog", "stock", "shipping", "checkout"
        ]);
        const partIntent = hasAnyTerm(query, [
            "part", "parts", "buy", "price", "stock", "fit", "fits", "fitment", "recommend", "catalog"
        ]);

        const reply = [];
        reply.push(
            websiteIntent
                ? buildWebsiteHelpReply(knowledge, query)
                : buildFallbackVehicleReply(knowledge, query, Boolean(imageDataUrl))
        );

        if (partIntent && !websiteIntent && knowledge.matchedProducts?.length) {
            reply.push(buildReplySection("Matched Mat Auto parts", buildProductShortList(knowledge.matchedProducts, 5)));
        }

        const relevantPages = findRelevantPages(knowledge, query, 3);
        if (relevantPages.length) {
            reply.push(buildReplySection("Useful website pages", relevantPages.map(page =>
                `${page.title || page.fileName} (${getPageUrl(page.fileName)})`
            )));
        }

        return reply.filter(Boolean).join("\n\n");
    }

    function buildWebsiteHelpReply(knowledge, query) {
        const siteFacts = knowledge.siteFacts || {};
        const relevantPages = findRelevantPages(knowledge, query, 5);
        const pageLines = relevantPages.length
            ? relevantPages.map(page => `${page.title || page.fileName} (${getPageUrl(page.fileName)})`)
            : [
                "Browse the main catalog on index.html#products",
                "Request a fitment or bulk quote on index.html#quote",
                "Track existing orders on track.html",
                "Contact the team on contact.html",
            ];

        return [
            `MAT AI can help you use the ${siteFacts.storeName || "Mat Auto"} website directly.`,
            buildReplySection("Best next steps", [
                "Browse in-stock items on index.html#products if you already know the part or engine you need.",
                "Use index.html#quote if you need sourcing help, bulk pricing, or fitment confirmation.",
                "Use track.html to follow an existing order or delivery update.",
                `For fast human support, message WhatsApp ${siteFacts.whatsappNumber || "via the contact page"}.`,
            ]),
            buildReplySection("Relevant website pages", pageLines),
            buildReplySection("What to send for faster help", [
                "Vehicle make, model, year, engine size, and transmission if fitment matters.",
                "Part name or symptom, plus any warning lights or recent repairs.",
                "Order number if you are checking an existing purchase.",
            ]),
        ].filter(Boolean).join("\n\n");
    }

    function buildFallbackVehicleReply(knowledge, query, hasImage) {
        const profile = detectVehicleIntent(query);
        const matchedProducts = buildProductShortList(knowledge.matchedProducts || []);
        const sections = [];

        if (profile) {
            sections.push(`Here is a practical first-pass plan for your issue (${profile.key.replace(/-/g, " ")}).`);
            sections.push(buildReplySection("Likely causes", profile.likely));
            sections.push(buildReplySection("What to check first", profile.checks));
            sections.push(buildReplySection("Fix path", profile.fixes));
            sections.push(buildReplySection("Parts to consider", matchedProducts.length ? matchedProducts : profile.parts));
            sections.push(buildReplySection("Helpful follow-up details", profile.followUp));
            if (profile.urgent) {
                sections.push(buildReplySection("Safety", [
                    "This can become a stop-driving issue if braking, steering, heavy smoke, fuel leaks, or overheating are involved.",
                    "If the symptom is severe or getting worse quickly, arrange hands-on inspection before driving further.",
                ]));
            }
        } else {
            sections.push("I can still help, but I need a bit more vehicle detail to narrow it down.");
            sections.push(buildReplySection("Please send these details", [
                "Make, model, year, engine size, and transmission",
                "Exact symptom, when it happens, and whether warning lights are on",
                "Recent repairs, battery changes, overheating, leaks, or unusual noises",
            ]));
            if (matchedProducts.length) {
                sections.push(buildReplySection("Possible related parts from Mat Auto", matchedProducts));
            }
        }

        if (hasImage) {
            sections.push(buildReplySection("Photo note", [
                "Your photo was attached successfully.",
                "GitHub smart mode cannot do true visual analysis by itself, so describe what the photo shows and MAT AI will guide you from there.",
            ]));
        }

        return sections.filter(Boolean).join("\n\n");
    }

    function buildProductShortList(products = [], limit = 4) {
        return products.slice(0, limit).map(product =>
            `${product.name} (${product.category}, ${formatCurrency(product.price)}, ${stockLabel(product.stock)})`
        );
    }

    function detectVehicleIntent(query) {
        const text = String(query || "").toLowerCase();
        const profiles = [
            {
                key: "battery-charging",
                match: ["battery light", "alternator", "not charging", "dead battery", "jump start", "jump-start", "dim lights"],
                likely: ["Weak battery or failing alternator output", "Loose, corroded, or slipping battery and charging connections", "Drive belt issue reducing alternator speed"],
                checks: ["Measure battery voltage with engine off and while idling", "Inspect battery terminals for corrosion and looseness", "Check alternator belt condition and tension", "Look for charging-system warnings or flickering lights"],
                fixes: ["Clean and tighten battery terminals first", "Replace the battery if it fails a load test", "Replace or test the alternator if voltage stays low while running", "Repair any loose ground or charging cables"],
                parts: ["Battery", "Alternator", "Drive belt", "Battery terminal set"],
                followUp: ["Does the engine crank slowly, or is it only the battery light?", "What battery voltage do you see with the engine running?"],
            },
            {
                key: "starting-click",
                match: ["clicking", "click sound", "starter", "won't start", "wont start", "no start", "no crank", "crank"],
                likely: ["Low battery voltage", "Starter motor or starter solenoid fault", "Bad battery cable or engine ground"],
                checks: ["Check if headlights dim heavily while starting", "Test battery voltage before cranking", "Listen for a single click versus repeated rapid clicking", "Inspect starter and ground connections"],
                fixes: ["Charge or replace a weak battery", "Repair loose or corroded cables", "Replace the starter if voltage is healthy but the starter will not turn"],
                parts: ["Starter motor", "Battery", "Starter relay", "Ground strap"],
                followUp: ["Do you hear a single click or repeated rapid clicks?", "Do dashboard lights stay bright when you turn the key?"],
            },
            {
                key: "rough-idle",
                match: ["rough idle", "shakes", "shaking", "misfire", "stalling", "stalls", "idle problem"],
                likely: ["Ignition misfire from plugs or coils", "Dirty throttle body or airflow sensor", "Vacuum leak or fuel-delivery issue"],
                checks: ["Scan for fault codes if available", "Check spark plugs and ignition coils", "Inspect intake hoses for cracks or leaks", "Clean the throttle body and MAF sensor", "Check fuel pressure if the problem gets worse under load"],
                fixes: ["Replace worn spark plugs or weak coils", "Repair vacuum leaks", "Clean the intake and idle control path", "Service injectors or fuel filter if fuel delivery is weak"],
                parts: ["Spark plugs", "Ignition coils", "Air filter", "Fuel filter"],
                followUp: ["Is the check-engine light on?", "Does it shake only at idle or also while accelerating?"],
            },
            {
                key: "overheating",
                match: ["overheat", "overheating", "temperature", "coolant", "running hot", "hot in traffic"],
                urgent: true,
                likely: ["Low coolant or external leak", "Thermostat stuck closed", "Radiator fan not switching on", "Weak water pump or blocked radiator"],
                checks: ["Stop driving if the gauge is in the red", "Check coolant level only after the engine cools", "Look for leaks around hoses, radiator, and water pump", "Confirm radiator fans engage when hot or with AC on", "Check for pressure in the cooling system and thermostat operation"],
                fixes: ["Top up with the correct coolant only after cooling down", "Repair leaks before driving again", "Replace a stuck thermostat or failed fan motor", "Flush or replace a blocked radiator if flow is poor"],
                parts: ["Radiator", "Thermostat", "Water pump", "Coolant hose set", "Radiator fan"],
                followUp: ["Is coolant disappearing or leaking onto the ground?", "Does it overheat only in traffic, or also at highway speed?"],
            },
            {
                key: "brake",
                match: ["brake", "brakes", "grinding", "squeal", "soft pedal", "spongy pedal"],
                urgent: true,
                likely: ["Worn brake pads or damaged rotors", "Brake fluid leak or air in the system", "Caliper sticking or uneven wear"],
                checks: ["Do not keep driving if pedal feel is poor", "Inspect pad thickness and rotor surface", "Check brake fluid level and look for wet leaks at lines and calipers", "Listen for grinding or metal-on-metal noise"],
                fixes: ["Replace worn pads and machine or replace damaged rotors", "Repair fluid leaks and bleed the system", "Replace sticking calipers or seized slide pins"],
                parts: ["Brake pads", "Brake discs", "Brake caliper", "Brake fluid"],
                followUp: ["Is the pedal soft, or is the main problem noise?", "Do you feel pulling to one side while braking?"],
            },
            {
                key: "smoke-leak",
                match: ["smoke", "burning smell", "fuel leak", "oil leak", "knocking", "steam"],
                urgent: true,
                likely: ["Fluid leak contacting hot engine parts", "Internal engine issue if there is heavy smoke or knocking", "Cooling-system leak if steam is visible"],
                checks: ["Stop driving and inspect only when safe", "Identify whether the smoke is white steam, blue oil smoke, or black fuel-rich smoke", "Look for visible leaks under the car or around the engine bay", "Check warning lights and engine temperature immediately"],
                fixes: ["Do not continue driving until the leak source is found", "Repair leaking hoses, seals, or gaskets", "Arrange a tow if there is heavy smoke, severe knocking, or fire risk"],
                parts: ["Gasket set", "Coolant hose", "Oil seal", "PCV components"],
                followUp: ["What color is the smoke?", "Is the engine overheating, misfiring, or losing oil/coolant?"],
            },
            {
                key: "suspension",
                match: ["clunk", "rattle", "suspension", "shock", "strut", "bushing", "noise over bumps"],
                likely: ["Worn stabilizer links or bushings", "Weak shocks or struts", "Loose suspension hardware or control-arm wear"],
                checks: ["Check if the noise happens only on bumps or also while turning", "Inspect sway-bar links, bushings, and top mounts", "Look for leaking shocks or torn bushings", "Check wheel torque and suspension fasteners"],
                fixes: ["Replace worn links, bushes, or top mounts", "Replace leaking shocks or struts in axle pairs", "Torque loose components to specification"],
                parts: ["Shock absorber", "Strut mount", "Stabilizer link", "Suspension bushing"],
                followUp: ["Is the noise from the front or rear?", "Do you also feel vibration in the steering wheel?"],
            },
        ];

        return profiles.find(profile => hasAnyTerm(text, profile.match)) || null;
    }

    function findRelevantPages(knowledge, query, limit = 4) {
        const terms = tokenizeSearch(query);
        return (knowledge.pages || [])
            .map(page => {
                const haystack = [
                    page.fileName,
                    page.title,
                    page.description,
                    ...(page.headings || []),
                    page.snippet,
                ].join(" ").toLowerCase();
                const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
                return { page, score };
            })
            .filter(entry => entry.score > 0)
            .sort((a, b) => b.score - a.score || a.page.fileName.localeCompare(b.page.fileName))
            .slice(0, limit)
            .map(entry => entry.page);
    }

    function getPageUrl(fileName = "") {
        return fileName || "index.html";
    }

    function hasAnyTerm(text, terms = []) {
        return terms.some(term => text.includes(term));
    }

    function buildReplySection(title, items = []) {
        const cleaned = items.map(item => cleanText(item, 220)).filter(Boolean);
        if (!cleaned.length) return "";
        return `${title}:\n- ${cleaned.join("\n- ")}`;
    }

    function stockLabel(stock = 0) {
        if (stock <= 0) return "out of stock";
        if (stock <= 3) return `only ${stock} left`;
        return `${stock} in stock`;
    }

    function formatCurrency(value) {
        const num = safeNumber(value, 0);
        return `GMD ${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function decodeHtmlEntities(str = "") {
        return String(str)
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, "\"")
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");
    }

    function stripHtml(html = "") {
        return decodeHtmlEntities(
            String(html)
                .replace(/<script[\s\S]*?<\/script>/gi, " ")
                .replace(/<style[\s\S]*?<\/style>/gi, " ")
                .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
                .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
                .replace(/<[^>]+>/g, " ")
        ).replace(/\s+/g, " ").trim();
    }

    function cleanText(value, max = 600) {
        return stripHtml(value || "").replace(/\s+/g, " ").trim().slice(0, max);
    }

    function safeNumber(value, fallback = 0) {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    function tokenizeSearch(text = "") {
        return Array.from(new Set(
            String(text).toLowerCase().match(/[a-z0-9][a-z0-9.+/-]{1,}/g) || []
        ));
    }

    function extractMatch(text, regex) {
        return String(text || "").match(regex)?.[1]?.trim() || "";
    }

    function readCachedKnowledge() {
        try {
            const raw = localStorage.getItem(CONTEXT_CACHE_KEY);
            if (!raw) return null;
            const cached = JSON.parse(raw);
            if (!cached?.ts || !cached?.data) return null;
            if ((Date.now() - cached.ts) > CONTEXT_TTL_MS) return null;
            return cached.data;
        } catch {
            return null;
        }
    }

    function writeCachedKnowledge(data) {
        try {
            localStorage.setItem(CONTEXT_CACHE_KEY, JSON.stringify({
                ts: Date.now(),
                data,
            }));
        } catch {
            // Ignore storage failures so fallback mode keeps working.
        }
    }
})();
