#!/usr/bin/env node
// ============================================================
// MAT AUTO — server.js  v2.0  (Production-Grade)
// Express + Brotli/Gzip + Caching + Security + Image Opt
// ============================================================
"use strict";

const express      = require("express");
const path         = require("path");
const fs           = require("fs");
const http         = require("http");
const https        = require("https");
const crypto       = require("crypto");
const zlib         = require("zlib");
const { pipeline } = require("stream");
const { promisify }= require("util");
const pipelineAsync= promisify(pipeline);

loadEnvFile();

// ── Optional deps (gracefully degrade if not installed) ──
let compression, sharp, rateLimit, helmet, cors, cluster;
try { compression = require("compression"); }     catch {}
try { sharp        = require("sharp"); }           catch {}
try { rateLimit    = require("express-rate-limit");}catch {}
try { helmet       = require("helmet"); }          catch {}
try { cors         = require("cors"); }            catch {}
try { cluster      = require("cluster"); }         catch {}

function loadEnvFile() {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    try {
        const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;
            const eq = line.indexOf("=");
            if (eq === -1) continue;
            const key = line.slice(0, eq).trim();
            let value = line.slice(eq + 1).trim();
            if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (key && process.env[key] == null) process.env[key] = value;
        }
    } catch (err) {
        console.warn("[Env] Failed to load .env file:", err.message);
    }
}

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
    port       : process.env.PORT      || 4010,
    host       : process.env.HOST      || "0.0.0.0",
    staticDir  : process.env.STATIC_DIR|| path.join(__dirname),
    cacheDir   : path.join(__dirname, ".cache"),
    precompDir : path.join(__dirname, ".precomp"),
    env        : process.env.NODE_ENV  || "development",
    useCluster : process.env.CLUSTER   === "true",
    workers    : parseInt(process.env.WORKERS || "0") ||
                 Math.min(require("os").cpus().length, 4),

    // Cache TTLs (seconds)
    ttl: {
        images   : 60 * 60 * 24 * 30,  // 30 days
        scripts  : 60 * 60 * 24 * 7,   // 7 days
        styles   : 60 * 60 * 24 * 7,   // 7 days
        html     : 60 * 5,             // 5 minutes
        fonts    : 60 * 60 * 24 * 365, // 1 year
        json     : 60 * 60,            // 1 hour
        default  : 60 * 60 * 24,       // 1 day
    },

    // Image optimisation
    img: {
        enabled  : !!sharp,
        maxWidth : 1200,
        maxHeight: 1200,
        quality  : 82,
        thumbW   : 400,
        thumbH   : 300,
    },

    // Precompression (build .gz and .br alongside assets)
    precompress: true,

    // Rate limiting
    rateLimit: {
        windowMs   : 15 * 60 * 1000,  // 15 min
        max        : 300,              // requests per window per IP
        apiMax     : 60,               // stricter for /api
        skipStatics: true,
    },

    ssl: {
        enabled : process.env.SSL_CERT && process.env.SSL_KEY,
        cert    : process.env.SSL_CERT || "",
        key     : process.env.SSL_KEY  || "",
    },
};

const MAT_AI = {
    model          : process.env.MAT_AI_MODEL || "meta/llama-4-maverick-17b-128e-instruct",
    apiUrl         : process.env.NVIDIA_API_URL || "https://integrate.api.nvidia.com/v1/chat/completions",
    apiKey         : process.env.NVIDIA_API_KEY || process.env.NVAPI_KEY || "",
    firebaseUrl    : (process.env.MAT_AUTO_FIREBASE_DATABASE_URL || "https://automat-gm-default-rtdb.firebaseio.com").replace(/\/+$/, ""),
    requestTimeout : parseInt(process.env.MAT_AI_TIMEOUT_MS || "45000", 10),
    maxMessages    : 10,
    maxMessageChars: 2200,
    maxImageBytes  : 170 * 1024,
    knowledgeTtlMs : 3 * 60 * 1000,
};

// ============================================================
// CLUSTER SUPPORT
// ============================================================
if (CONFIG.useCluster && cluster?.isPrimary) {
    console.log(`[Cluster] Primary ${process.pid} forking ${CONFIG.workers} workers`);
    for (let i = 0; i < CONFIG.workers; i++) cluster.fork();
    cluster.on("exit", (w, code) => {
        if (code !== 0) { console.warn(`[Cluster] Worker ${w.process.pid} died — restarting`); cluster.fork(); }
    });
    return; // primary does not run the server
}

// ============================================================
// ETag / CACHE UTILITIES
// ============================================================
const etagCache = new Map(); // path → { mtime, etag }

function getEtag(filePath) {
    try {
        const stat = fs.statSync(filePath);
        const key  = `${stat.mtimeMs}-${stat.size}`;
        if (etagCache.has(filePath) && etagCache.get(filePath).key === key)
            return etagCache.get(filePath).etag;
        const etag = `"${crypto.createHash("md5").update(key).digest("hex").slice(0,16)}"`;
        etagCache.set(filePath, { key, etag });
        return etag;
    } catch { return null; }
}

function cacheHeader(ext) {
    const t = CONFIG.ttl;
    // simpler lookup
    const imgExts  = [".jpg",".jpeg",".png",".webp",".avif",".ico",".gif",".svg"];
    const fontExts = [".woff",".woff2",".ttf",".otf",".eot"];
    if (imgExts.includes(ext))  return `public, max-age=${t.images}, immutable`;
    if (fontExts.includes(ext)) return `public, max-age=${t.fonts}, immutable`;
    if (ext === ".js")  return `public, max-age=${t.scripts}, stale-while-revalidate=86400`;
    if (ext === ".css") return `public, max-age=${t.styles},  stale-while-revalidate=86400`;
    if (ext === ".json"|| ext === ".webmanifest") return `public, max-age=${t.json}`;
    if (ext === ".html"|| ext === ".htm") return `no-cache, must-revalidate`;
    return `public, max-age=${t.default}`;
}

// ============================================================
// PRECOMPRESSION
// ============================================================
const PRECOMP_EXTS = [".js",".css",".html",".json",".svg",".webmanifest",".xml",".txt"];
const precompCache = new Map(); // filePath → { br, gz } (compressed Buffer)

async function precompressFile(filePath) {
    if (!PRECOMP_EXTS.includes(path.extname(filePath).toLowerCase())) return;
    try {
        const buf = fs.readFileSync(filePath);
        const [br, gz] = await Promise.all([
            promisify(zlib.brotliCompress)(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }),
            promisify(zlib.gzip)(buf, { level: zlib.constants.Z_BEST_SPEED }),
        ]);
        precompCache.set(filePath, { br, gz, mtime: fs.statSync(filePath).mtimeMs });
        return true;
    } catch { return false; }
}

async function precompressDir(dir) {
    if (!CONFIG.precompress) return;
    let count = 0;
    const walk = (d) => {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.name.startsWith(".") || e.name === "node_modules") continue;
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.isFile()) { precompressFile(full).then(ok => ok && count++); }
        }
    };
    walk(dir);
    await new Promise(r => setTimeout(r, 500)); // allow async ops to queue
    console.log(`[Precomp] Queued ${count} files for compression`);
}

// ============================================================
// IN-MEMORY RESPONSE CACHE  (HTML / JSON only)
// ============================================================
const responseCache = new Map();
const RESPONSE_CACHE_MAX = 100;
const RESPONSE_CACHE_TTL = 60_000; // 1 minute

const matAiKnowledgeCache = {
    ts      : 0,
    summary : null,
};

function getCachedResponse(key) {
    const entry = responseCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > RESPONSE_CACHE_TTL) { responseCache.delete(key); return null; }
    return entry;
}
function setCachedResponse(key, data) {
    if (responseCache.size >= RESPONSE_CACHE_MAX) {
        const oldest = [...responseCache.keys()][0];
        responseCache.delete(oldest);
    }
    responseCache.set(key, { data, ts: Date.now() });
}

function decodeHtmlEntities(str = "") {
    return str
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

function cleanModelReply(value, max = 12000) {
    return String(value || "")
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, max);
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function tokenizeSearch(text = "") {
    return Array.from(new Set(
        String(text).toLowerCase().match(/[a-z0-9][a-z0-9.+/-]{1,}/g) || []
    ));
}

function extractMatch(text, regex) {
    return text.match(regex)?.[1]?.trim() || "";
}

function extractPageKnowledge(fileName) {
    try {
        const filePath = path.join(CONFIG.staticDir, fileName);
        const html = fs.readFileSync(filePath, "utf8");
        const title = cleanText(extractMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i), 180) || fileName;
        const description = cleanText(extractMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"]+)["']/i), 240);
        const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
            .map(match => cleanText(match[1], 140))
            .filter(Boolean)
            .slice(0, 8);
        const body = cleanText(html, 1800);
        return {
            fileName,
            title,
            description,
            headings,
            snippet: body,
        };
    } catch {
        return null;
    }
}

function extractSiteFacts() {
    try {
        const appJs = fs.readFileSync(path.join(CONFIG.staticDir, "app.js"), "utf8");
        return {
            storeName         : extractMatch(appJs, /storeName\s*:\s*"([^"]+)"/),
            currency          : extractMatch(appJs, /currency\s*:\s*"([^"]+)"/),
            whatsappNumber    : extractMatch(appJs, /whatsappNumber\s*:\s*"([^"]+)"/),
            whatsappNumberAlt : extractMatch(appJs, /whatsappNumberAlt\s*:\s*"([^"]+)"/),
            whatsappPrimary   : extractMatch(appJs, /whatsappLinkPrimary\s*:\s*"([^"]+)"/),
            whatsappAlt       : extractMatch(appJs, /whatsappLinkAlt\s*:\s*"([^"]+)"/),
            facebookUrl       : extractMatch(appJs, /facebookUrl\s*:\s*"([^"]+)"/),
        };
    } catch {
        return {};
    }
}

function normalizeCatalogProduct(raw = {}, index = 0) {
    const description = cleanText(raw.description, 280);
    const specs = cleanText(raw.specs, 240);
    return {
        id          : raw.id || `product-${index + 1}`,
        name        : cleanText(raw.name, 120) || `Product ${index + 1}`,
        category    : cleanText(raw.category, 48).toLowerCase() || "parts",
        price       : safeNumber(raw.price, 0),
        stock       : safeNumber(raw.stock, 0),
        rating      : safeNumber(raw.rating, 0),
        featured    : Boolean(raw.featured),
        description,
        specs,
        warranty    : cleanText(raw.warranty, 120),
        image       : cleanText(raw.image || (Array.isArray(raw.images) ? raw.images[0] : ""), 400),
        searchable  : [
            cleanText(raw.name, 180),
            cleanText(raw.category, 80),
            description,
            specs,
            cleanText(raw.make, 80),
            cleanText(raw.model, 80)
        ].join(" ").toLowerCase()
    };
}

async function fetchCatalogProducts() {
    const url = `${MAT_AI.firebaseUrl}/matAutoProducts.json`;
    try {
        const response = await fetch(url, { headers: { "Accept": "application/json" } });
        if (!response.ok) throw new Error(`Catalog fetch failed (${response.status})`);
        const raw = await response.json();
        const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
        return list.filter(Boolean).map(normalizeCatalogProduct);
    } catch (err) {
        console.warn("[MAT AI] Catalog fetch failed:", err.message);
        return [];
    }
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
    return products
        .map(product => ({ product, score: scoreProductMatch(product, terms) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.product.stock - a.product.stock || a.product.price - b.product.price)
        .slice(0, limit)
        .map(entry => entry.product);
}

function formatProductForPrompt(product) {
    const parts = [
        `${product.name} [${product.category}]`,
        `price: ${product.price}`,
        `stock: ${product.stock}`,
        product.rating ? `rating: ${product.rating}` : "",
        product.featured ? "featured" : "",
        product.description ? `description: ${product.description}` : "",
        product.specs ? `specs: ${product.specs}` : "",
        product.warranty ? `warranty: ${product.warranty}` : ""
    ].filter(Boolean);
    return `- ${parts.join(" | ")}`;
}

async function getMatAiKnowledge(query = "") {
    const now = Date.now();
    if (matAiKnowledgeCache.summary && (now - matAiKnowledgeCache.ts) < MAT_AI.knowledgeTtlMs) {
        return {
            ...matAiKnowledgeCache.summary,
            matchedProducts: selectRelevantProducts(matAiKnowledgeCache.summary.products, query),
        };
    }

    const pageFiles = fs.readdirSync(CONFIG.staticDir)
        .filter(name => name.toLowerCase().endsWith(".html"))
        .sort((a, b) => a.localeCompare(b));

    const pages = pageFiles
        .map(extractPageKnowledge)
        .filter(Boolean);

    const products = await fetchCatalogProducts();
    const categoryCounts = products.reduce((acc, product) => {
        acc[product.category] = (acc[product.category] || 0) + 1;
        return acc;
    }, {});

    const summary = {
        siteFacts: extractSiteFacts(),
        pages,
        products,
        pageFiles,
        categoryCounts,
    };
    matAiKnowledgeCache.ts = now;
    matAiKnowledgeCache.summary = summary;

    return {
        ...summary,
        matchedProducts: selectRelevantProducts(products, query),
    };
}

function formatPageForPrompt(page) {
    const headingText = page.headings.length ? `Headings: ${page.headings.join(" | ")}` : "";
    return [
        `Page: ${page.fileName}`,
        `Title: ${page.title}`,
        page.description ? `Description: ${page.description}` : "",
        headingText,
        page.snippet ? `Snippet: ${page.snippet}` : "",
    ].filter(Boolean).join("\n");
}

function buildMatAiSystemPrompt(knowledge, query, hasImage) {
    const siteFacts = knowledge.siteFacts || {};
    const productSummary = knowledge.matchedProducts.length
        ? knowledge.matchedProducts.map(formatProductForPrompt).join("\n")
        : knowledge.products.slice(0, 6).map(formatProductForPrompt).join("\n");
    const pageSummary = knowledge.pages
        .slice(0, 14)
        .map(formatPageForPrompt)
        .join("\n\n");
    const catalogFacts = Object.entries(knowledge.categoryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([category, count]) => `${category}: ${count}`)
        .join(", ");

    return [
        `You are MAT AI, the on-site automotive assistant for ${siteFacts.storeName || "Mat Auto"}.`,
        `Today's date is ${new Date().toISOString().slice(0, 10)}.`,
        "Primary goals:",
        "1. Answer questions about this website, its pages, buying flows, and the Mat Auto catalog using the provided site context.",
        "2. Help users diagnose car issues, identify visible car parts or vehicle details from images, explain likely causes, and suggest safe next steps.",
        "3. Recommend parts from the Mat Auto catalog first when they are relevant, and clearly say when a recommendation is based on general automotive knowledge instead of confirmed catalog data.",
        "4. Be honest about uncertainty. Never pretend to know exact fitment, exact trim, or exact internal specifications from a blurry image alone.",
        "Safety rules:",
        "- If symptoms suggest brake failure, steering loss, fuel leaks, overheating, smoke, fire risk, airbag/SRS faults, EV high-voltage issues, or severe engine knocking, advise the user to stop driving and seek qualified help.",
        "- Repair instructions must be practical, step-by-step, and mention the tools/parts needed when possible.",
        "- If critical context is missing for diagnosis, ask concise follow-up questions such as make, model, year, engine size, transmission, symptoms, warning lights, mileage, or recent repairs.",
        hasImage
            ? "- An image is attached in the latest user message. Use it for visual reasoning, but label image-based conclusions as inferred unless clearly visible."
            : "- No image is attached unless the user message includes one.",
        "Response style:",
        "- Be concise but useful.",
        "- For repair help, prefer sections like Likely Cause, What To Check, Fix Steps, Parts To Consider, and Safety when that fits the question.",
        "- For website questions, answer directly and mention relevant page names or flows when helpful.",
        "- When recommending products from Mat Auto, include product name, category, price, and stock if available.",
        "",
        `Store facts: currency=${siteFacts.currency || "GMD"}, WhatsApp primary=${siteFacts.whatsappNumber || "unknown"}, WhatsApp alt=${siteFacts.whatsappNumberAlt || "unknown"}, Facebook=${siteFacts.facebookUrl || "unknown"}.`,
        `Catalog overview: ${knowledge.products.length} products across ${Object.keys(knowledge.categoryCounts).length} categories. Top categories: ${catalogFacts || "unavailable"}.`,
        query ? `Current user topic keywords: ${tokenizeSearch(query).join(", ") || "none"}.` : "",
        "",
        "Relevant Mat Auto catalog products:",
        productSummary || "- No live catalog items were available.",
        "",
        "Website knowledge:",
        pageSummary
    ].filter(Boolean).join("\n");
}

function normalizeChatMessages(messages, imageDataUrl = "") {
    const safeMessages = Array.isArray(messages) ? messages.slice(-MAT_AI.maxMessages) : [];
    const normalized = safeMessages
        .map((message, index) => {
            const role = message?.role === "assistant" ? "assistant" : "user";
            let content = cleanText(message?.content, MAT_AI.maxMessageChars);
            if (!content) return null;
            if (imageDataUrl && index === safeMessages.length - 1 && role === "user") {
                content = `${content}\n\nAnalyze this image too:\n<img src="${imageDataUrl}" />`;
            }
            return { role, content };
        })
        .filter(Boolean);
    return normalized;
}

function validateImageDataUrl(imageDataUrl = "") {
    if (!imageDataUrl) return "";
    const match = String(imageDataUrl).match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) throw Object.assign(new Error("Image must be a PNG or JPEG data URL."), { statusCode: 400 });
    const bytes = Buffer.from(match[2], "base64").length;
    if (bytes > MAT_AI.maxImageBytes) {
        throw Object.assign(new Error("Image is too large after compression. Please upload a smaller photo."), { statusCode: 413 });
    }
    return imageDataUrl;
}

async function callNvidiaMatAi(messages, systemPrompt) {
    if (!MAT_AI.apiKey) {
        throw Object.assign(new Error("NVIDIA API key is not configured on the server."), { statusCode: 500 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAT_AI.requestTimeout);
    try {
        const response = await fetch(MAT_AI.apiUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${MAT_AI.apiKey}`,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: MAT_AI.model,
                messages: [{ role: "system", content: systemPrompt }, ...messages],
                max_tokens: 950,
                temperature: 0.3,
                top_p: 0.9,
                frequency_penalty: 0.15,
                presence_penalty: 0.05,
                stream: false,
            }),
            signal: controller.signal,
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = cleanText(
                data?.error?.message || data?.error || data?.detail || JSON.stringify(data),
                320
            );
            throw Object.assign(new Error(detail || `NVIDIA API request failed (${response.status})`), { statusCode: response.status });
        }

        const reply = data?.choices?.[0]?.message?.content;
        if (!reply) throw Object.assign(new Error("The NVIDIA model returned an empty response."), { statusCode: 502 });
        return cleanModelReply(reply, 12000);
    } catch (err) {
        if (err.name === "AbortError") {
            throw Object.assign(new Error("The AI request timed out. Please try again."), { statusCode: 504 });
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

// ============================================================
// IMAGE OPTIMISATION HANDLER
// ============================================================
async function serveOptimisedImage(req, res, filePath) {
    if (!sharp) return false; // degrade gracefully

    const { w, h, q, thumb, format } = req.query;
    const width   = Math.min(parseInt(w    || (thumb ? CONFIG.img.thumbW : CONFIG.img.maxWidth)),  2000);
    const height  = Math.min(parseInt(h    || (thumb ? CONFIG.img.thumbH : CONFIG.img.maxHeight)), 2000);
    const quality = Math.min(parseInt(q    || CONFIG.img.quality), 100);
    const fmt     = ["webp","avif","jpeg","jpg","png"].includes(format) ? format : "webp";
    const outFmt  = fmt === "jpg" ? "jpeg" : fmt;

    const cacheKey = `${filePath}|${width}|${height}|${quality}|${outFmt}`;
    const cached   = getCachedResponse(cacheKey);
    if (cached) {
        res.set("Content-Type", `image/${outFmt}`);
        res.set("Cache-Control", `public, max-age=${CONFIG.ttl.images}, immutable`);
        res.set("X-Cache", "HIT");
        return res.end(cached.data);
    }

    try {
        const img = sharp(filePath).rotate(); // auto-orient
        if (width || height) img.resize(width || null, height || null, { fit:"inside", withoutEnlargement:true });
        const buf = await img[outFmt]({ quality }).toBuffer();
        setCachedResponse(cacheKey, buf);
        res.set("Content-Type", `image/${outFmt}`);
        res.set("Cache-Control", `public, max-age=${CONFIG.ttl.images}, immutable`);
        res.set("X-Cache", "MISS");
        return res.end(buf);
    } catch (err) {
        console.error("[ImgOpt] Error:", err.message);
        return false;
    }
}

// ============================================================
// STATIC FILE MIDDLEWARE  (replaces express.static for speed)
// ============================================================
function fastStatic(root) {
    return async (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();

        // Strip query string for file lookup
        const urlPath  = req.path.replace(/\.\./g, "").replace(/\/+/g, "/");
        const filePath = path.join(root, urlPath);

        let stat;
        try { stat = fs.statSync(filePath); } catch { return next(); }
        if (!stat.isFile()) return next();

        const ext = path.extname(filePath).toLowerCase();

        // ── Image optimization via ?w= ?h= ?thumb=1 ?format=webp ──
        if (CONFIG.img.enabled && [".jpg",".jpeg",".png",".gif"].includes(ext)) {
            const hasOpts = req.query.w || req.query.h || req.query.thumb || req.query.format;
            if (hasOpts) {
                const served = await serveOptimisedImage(req, res, filePath);
                if (served !== false) return;
            }
        }

        // ── ETag / 304 ──
        const etag    = getEtag(filePath);
        const ifNone  = req.headers["if-none-match"];
        const ifMod   = req.headers["if-modified-since"];
        const lastMod = stat.mtime.toUTCString();

        if (etag && ifNone === etag) { res.status(304).end(); return; }
        if (ifMod && new Date(ifMod) >= stat.mtime) { res.status(304).end(); return; }

        // ── Headers ──
        res.set("Cache-Control", cacheHeader(ext));
        res.set("Last-Modified", lastMod);
        if (etag) res.set("ETag", etag);
        res.set("Vary", "Accept-Encoding");

        // MIME
        const mime = {
            ".html": "text/html; charset=utf-8",
            ".htm" : "text/html; charset=utf-8",
            ".css" : "text/css; charset=utf-8",
            ".js"  : "application/javascript; charset=utf-8",
            ".json": "application/json",
            ".webmanifest": "application/manifest+json",
            ".svg" : "image/svg+xml",
            ".jpg" : "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png" : "image/png",
            ".webp": "image/webp",
            ".avif": "image/avif",
            ".woff": "font/woff",
            ".woff2":"font/woff2",
            ".ico" : "image/x-icon",
            ".xml" : "application/xml",
            ".txt" : "text/plain; charset=utf-8",
        };
        const mimeType = mime[ext] || "application/octet-stream";
        res.set("Content-Type", mimeType);

        if (req.method === "HEAD") { res.set("Content-Length", stat.size); return res.end(); }

        // ── Precompressed response ──
        const ae = req.headers["accept-encoding"] || "";
        const cached = precompCache.get(filePath);
        if (cached) {
            if (ae.includes("br") && cached.br) {
                res.set("Content-Encoding", "br");
                res.set("X-Compressed", "br");
                return res.end(cached.br);
            }
            if (ae.includes("gzip") && cached.gz) {
                res.set("Content-Encoding", "gzip");
                res.set("X-Compressed", "gz");
                return res.end(cached.gz);
            }
        }

        // ── Stream raw file ──
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        stream.on("error", next);
    };
}

// ============================================================
// BUILD EXPRESS APP
// ============================================================
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

// ── Security headers ──
if (helmet) {
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc   : ["'self'"],
                scriptSrc    : ["'self'", "'unsafe-inline'", "https://www.gstatic.com", "https://cdn.firebase.com"],
                styleSrc     : ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc      : ["'self'", "https://fonts.gstatic.com", "data:"],
                imgSrc       : ["'self'", "data:", "blob:", "https://*.googleapis.com", "https://*.gstatic.com", "https://firebasestorage.googleapis.com"],
                connectSrc   : ["'self'", "https://*.firebaseio.com", "https://*.googleapis.com", "https://firebasestorage.googleapis.com", "wss://*.firebaseio.com"],
                frameSrc     : ["'none'"],
                objectSrc    : ["'none'"],
                upgradeInsecureRequests: [],
            }
        },
        hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
        referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }));
} else {
    // Manual minimal security headers
    app.use((_req, res, next) => {
        res.set("X-Content-Type-Options", "nosniff");
        res.set("X-Frame-Options", "SAMEORIGIN");
        res.set("X-XSS-Protection", "1; mode=block");
        res.set("Referrer-Policy", "strict-origin-when-cross-origin");
        if (CONFIG.ssl.enabled)
            res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
        next();
    });
}

// ── CORS (API routes) ──
if (cors) {
    app.use("/api", cors({
        origin : process.env.CORS_ORIGIN || "*",
        methods: ["GET","POST","PUT","DELETE","OPTIONS"],
        allowedHeaders: ["Content-Type","Authorization"],
    }));
}

// ── Body parsing ──
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "4mb" }));

// ── Compression (fallback if precompressed miss) ──
if (compression) {
    app.use(compression({
        level  : 6,
        threshold: 1024,
        filter : (req, res) => {
            if (req.path.match(/\.(jpg|jpeg|png|webp|avif|gif|ico|woff|woff2)$/i)) return false;
            return compression.filter(req, res);
        }
    }));
}

// ── Rate limiting ──
if (rateLimit) {
    const globalLimit = rateLimit({
        windowMs : CONFIG.rateLimit.windowMs,
        max      : CONFIG.rateLimit.max,
        standardHeaders: true,
        legacyHeaders  : false,
        skip: (req) => CONFIG.rateLimit.skipStatics && /\.(css|js|png|jpg|jpeg|webp|ico|woff2?)$/i.test(req.path),
        handler: (_req, res) => res.status(429).json({ error: "Too many requests — try again in a few minutes." }),
    });
    const apiLimit = rateLimit({
        windowMs: CONFIG.rateLimit.windowMs,
        max     : CONFIG.rateLimit.apiMax,
        standardHeaders: true,
        legacyHeaders  : false,
    });
    app.use(globalLimit);
    app.use("/api", apiLimit);
}

// ── Request logging (concise) ──
app.use((req, _res, next) => {
    if (CONFIG.env !== "production") {
        const ts = new Date().toISOString().slice(11,19);
        process.stdout.write(`\x1b[2m${ts}\x1b[0m ${req.method.padEnd(6)} ${req.path}\n`);
    }
    next();
});

// ============================================================
// HTTP/2 PUSH HINTS  (Link preload header)
// ============================================================
const PUSH_MAP = {
    "/index.html"   : ["</styles.css>; rel=preload; as=style", "</app.js>; rel=preload; as=script", "</image.jpg>; rel=preload; as=image"],
    "/admin.html"   : ["</styles.css>; rel=preload; as=style", "</app.js>; rel=preload; as=script"],
    "/checkout.html": ["</styles.css>; rel=preload; as=style", "</app.js>; rel=preload; as=script"],
    "/mat-ai.html"  : ["</styles.css>; rel=preload; as=style", "</mat-ai.css>; rel=preload; as=style", "</mat-ai.js>; rel=preload; as=script", "</image.jpg>; rel=preload; as=image"],
};
app.use((req, res, next) => {
    const hints = PUSH_MAP[req.path];
    if (hints) res.set("Link", hints.join(", "));
    next();
});

// ============================================================
// API ROUTES
// ============================================================

// ── Health check ──
app.get("/api/health", (_req, res) => {
    res.json({
        status : "ok",
        ts     : Date.now(),
        env    : CONFIG.env,
        worker : process.pid,
        uptime : Math.round(process.uptime()),
        mem    : Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB",
    });
});

// ── Image optimization proxy ──
// GET /api/img?url=<encoded>&w=400&h=300&format=webp&q=80
app.get("/api/img", async (req, res) => {
    if (!sharp) return res.status(501).json({ error: "sharp not installed" });
    const url = decodeURIComponent(req.query.url || "");
    if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: "Invalid url" });

    const width   = Math.min(parseInt(req.query.w  || "800"), 2000);
    const height  = Math.min(parseInt(req.query.h  || "800"), 2000);
    const quality = Math.min(parseInt(req.query.q  || "80"),  100);
    const format  = ["webp","avif","jpeg","png"].includes(req.query.format) ? req.query.format : "webp";

    const cacheKey = `${url}|${width}|${height}|${quality}|${format}`;
    const cached   = getCachedResponse(cacheKey);
    if (cached) {
        res.set("Content-Type", `image/${format}`);
        res.set("Cache-Control", `public, max-age=${CONFIG.ttl.images}, immutable`);
        res.set("X-Cache", "HIT");
        return res.end(cached.data);
    }

    try {
        const chunks = [];
        await new Promise((resolve, reject) => {
            const client = url.startsWith("https") ? https : http;
            const r = client.get(url, { timeout: 8000 }, (stream) => {
                stream.on("data", c => chunks.push(c));
                stream.on("end", resolve);
                stream.on("error", reject);
            });
            r.on("error", reject);
        });
        const input = Buffer.concat(chunks);
        const img   = sharp(input).rotate();
        if (width || height) img.resize(width || null, height || null, { fit:"inside", withoutEnlargement:true });
        const buf = await img[format]({ quality }).toBuffer();
        setCachedResponse(cacheKey, buf);
        res.set("Content-Type", `image/${format}`);
        res.set("Cache-Control", `public, max-age=${CONFIG.ttl.images}, immutable`);
        res.end(buf);
    } catch (err) {
        res.status(500).json({ error: "Image optimisation failed", detail: err.message });
    }
});

// ── Server-sent stats endpoint ──
app.get("/api/stats", (_req, res) => {
    res.json({
        cacheSize   : precompCache.size,
        responseCacheSize: responseCache.size,
        uptime      : process.uptime(),
        memory      : process.memoryUsage(),
        platform    : process.platform,
        nodeVersion : process.version,
    });
});

app.get("/api/mat-ai/context", async (_req, res) => {
    try {
        const knowledge = await getMatAiKnowledge("");
        res.json({
            store         : knowledge.siteFacts,
            pageCount     : knowledge.pages.length,
            productCount  : knowledge.products.length,
            categoryCounts: knowledge.categoryCounts,
            featured      : knowledge.products
                .filter(product => product.featured || product.stock > 0)
                .slice(0, 6)
                .map(product => ({
                    id         : product.id,
                    name       : product.name,
                    category   : product.category,
                    price      : product.price,
                    stock      : product.stock,
                    rating     : product.rating,
                    description: product.description,
                })),
            pages: knowledge.pages.slice(0, 10).map(page => ({
                fileName   : page.fileName,
                title      : page.title,
                description: page.description,
                headings   : page.headings,
            })),
        });
    } catch (err) {
        console.error("[MAT AI] Context error:", err.message);
        res.status(500).json({ error: "Failed to load MAT AI context." });
    }
});

app.post("/api/mat-ai/chat", async (req, res) => {
    try {
        const imageDataUrl = validateImageDataUrl(req.body?.imageDataUrl || "");
        const incomingMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
        const messages = normalizeChatMessages(incomingMessages, imageDataUrl);
        if (!messages.length) {
            return res.status(400).json({ error: "At least one user message is required." });
        }
        if (messages[messages.length - 1].role !== "user") {
            return res.status(400).json({ error: "The latest message must come from the user." });
        }

        const latestUserMessage = messages[messages.length - 1].content;
        const knowledge = await getMatAiKnowledge(latestUserMessage);
        const systemPrompt = buildMatAiSystemPrompt(knowledge, latestUserMessage, Boolean(imageDataUrl));
        const reply = await callNvidiaMatAi(messages, systemPrompt);
        const matchedProducts = knowledge.matchedProducts.slice(0, 6).map(product => ({
            id         : product.id,
            name       : product.name,
            category   : product.category,
            price      : product.price,
            stock      : product.stock,
            rating     : product.rating,
            description: product.description,
            specs      : product.specs,
            warranty   : product.warranty,
            image      : product.image,
        }));

        res.json({
            reply,
            matchedProducts,
            context: {
                pageCount    : knowledge.pages.length,
                productCount : knowledge.products.length,
                matchedCount : matchedProducts.length,
                categories   : knowledge.categoryCounts,
            }
        });
    } catch (err) {
        const status = err.statusCode || 500;
        console.error("[MAT AI] Chat error:", err.message);
        res.status(status).json({
            error : err.message || "MAT AI request failed.",
            status,
        });
    }
});

// ── 404 API handler ──
app.use("/api/*", (_req, res) => res.status(404).json({ error: "API route not found" }));

// ============================================================
// STATIC FILE SERVING
// ============================================================
app.use(fastStatic(CONFIG.staticDir));

// ── SPA Fallback: serve index.html for unknown routes ──
app.use((_req, res) => {
    const indexPath = path.join(CONFIG.staticDir, "index.html");
    if (fs.existsSync(indexPath)) {
        res.set("Cache-Control", "no-cache, must-revalidate");
        res.set("Content-Type", "text/html; charset=utf-8");
        res.sendFile(indexPath);
    } else {
        res.status(404).send("Not found");
    }
});

// ── Global error handler ──
app.use((err, _req, res, _next) => {
    console.error("[Error]", err.stack || err.message);
    res.status(500).json({ error: "Internal server error" });
});

// ============================================================
// START SERVER
// ============================================================
async function start() {
    // Pre-compress static assets in background
    precompressDir(CONFIG.staticDir).catch(console.error);

    // Ensure cache dir exists
    [CONFIG.cacheDir, CONFIG.precompDir].forEach(d => {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });

    let server;
    if (CONFIG.ssl.enabled) {
        const sslOpts = {
            cert: fs.readFileSync(CONFIG.ssl.cert),
            key : fs.readFileSync(CONFIG.ssl.key),
        };
        server = https.createServer(sslOpts, app);
        // HTTP → HTTPS redirect
        http.createServer((_req, res) => {
            res.writeHead(301, { Location: `https://${_req.headers.host}${_req.url}` });
            res.end();
        }).listen(80);
    } else {
        server = http.createServer(app);
    }

    // Tune keep-alive for faster repeat requests
    server.keepAliveTimeout    = 65_000;
    server.headersTimeout      = 66_000;
    server.maxConnections      = 1000;
    server.requestTimeout      = 30_000;

    server.listen(CONFIG.port, CONFIG.host, () => {
        const proto = CONFIG.ssl.enabled ? "https" : "http";
        console.log(`
╔══════════════════════════════════════════════════╗
║  🚗  MAT AUTO  Server v2.0                       ║
╠══════════════════════════════════════════════════╣
║  URL      : ${(proto + "://localhost:" + CONFIG.port).padEnd(35)}  ║
║  Root     : ${CONFIG.staticDir.slice(-35).padEnd(35)}  ║
║  Env      : ${CONFIG.env.padEnd(35)}  ║
║  PID      : ${String(process.pid).padEnd(35)}  ║
║  ImgOpt   : ${(CONFIG.img.enabled ? "✅ sharp ready" : "⚠️  install sharp for img opt").padEnd(35)}  ║
║  Compress : ${(compression ? "✅ brotli + gzip" : "⚠️  install compression pkg").padEnd(35)}  ║
║  RateLimit: ${(rateLimit ? "✅ enabled" : "⚠️  install express-rate-limit").padEnd(35)}  ║
╚══════════════════════════════════════════════════╝`);
    });

    // Graceful shutdown
    const shutdown = (sig) => {
        console.log(`\n[Server] ${sig} received — graceful shutdown`);
        server.close(() => { console.log("[Server] Closed."); process.exit(0); });
        setTimeout(() => process.exit(1), 10_000);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT",  () => shutdown("SIGINT"));
}

if (require.main === module) {
    start().catch(err => { console.error("[Fatal]", err); process.exit(1); });
}

module.exports = app;
module.exports.start = start;
