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
    forceFallback  : process.env.MAT_AI_FORCE_FALLBACK === "true",
    strictLiveMode : process.env.MAT_AI_STRICT_LIVE_MODE !== "false",
    firebaseUrl    : (process.env.MAT_AUTO_FIREBASE_DATABASE_URL || "https://automat-gm-default-rtdb.firebaseio.com").replace(/\/+$/, ""),
    requestTimeout : parseInt(process.env.MAT_AI_TIMEOUT_MS || "45000", 10),
    maxMessages    : 10,
    maxMessageChars: 2200,
    maxImageBytes  : 170 * 1024,
    knowledgeTtlMs : 3 * 60 * 1000,
};

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "MATADMIN2026";
const MAT_AI_RUNTIME = {
    settingsPath      : "matAutoSettings/matAiConfig",
    encryptionSecret  : process.env.MAT_AI_CONFIG_SECRET || "",
    setupKey          : process.env.MAT_AI_SETUP_KEY || "",
    cacheTtlMs        : parseInt(process.env.MAT_AI_CONFIG_CACHE_TTL_MS || "60000", 10),
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

const matAiRuntimeConfigCache = {
    ts    : 0,
    value : null,
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

function firebaseJsonUrl(dbPath = "") {
    const trimmedPath = String(dbPath || "").replace(/^\/+|\/+$/g, "");
    if (!MAT_AI.firebaseUrl) throw new Error("Firebase database URL is not configured on the server.");
    return `${MAT_AI.firebaseUrl}/${trimmedPath}.json`;
}

async function fetchFirebaseJson(dbPath = "") {
    const response = await fetch(firebaseJsonUrl(dbPath), {
        headers: { "Accept": "application/json" },
    });
    if (!response.ok) {
        throw new Error(`Firebase settings fetch failed (${response.status})`);
    }
    return response.json().catch(() => null);
}

async function writeFirebaseJson(dbPath = "", payload) {
    const response = await fetch(firebaseJsonUrl(dbPath), {
        method : "PUT",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify(payload ?? null),
    });
    if (!response.ok) {
        throw new Error(`Firebase settings save failed (${response.status})`);
    }
    return response.json().catch(() => ({ ok: true }));
}

function getMatAiEncryptionKey() {
    if (!MAT_AI_RUNTIME.encryptionSecret) {
        throw new Error("MAT_AI_CONFIG_SECRET is missing on the backend.");
    }
    return crypto.createHash("sha256").update(MAT_AI_RUNTIME.encryptionSecret).digest();
}

function encryptMatAiSecret(value = "") {
    const plainText = String(value || "").trim();
    if (!plainText) throw new Error("AI provider key cannot be empty.");

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", getMatAiEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        version    : 1,
        iv         : iv.toString("base64"),
        tag        : tag.toString("base64"),
        ciphertext : encrypted.toString("base64"),
    };
}

function decryptMatAiSecret(payload) {
    if (!payload || typeof payload !== "object") return "";
    const iv = Buffer.from(String(payload.iv || ""), "base64");
    const tag = Buffer.from(String(payload.tag || ""), "base64");
    const ciphertext = Buffer.from(String(payload.ciphertext || ""), "base64");
    if (!iv.length || !tag.length || !ciphertext.length) {
        throw new Error("Stored AI provider key is incomplete.");
    }

    const decipher = crypto.createDecipheriv("aes-256-gcm", getMatAiEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8").trim();
}

async function readStoredMatAiConfig(options = {}) {
    const force = options.force === true;
    if (!MAT_AI_RUNTIME.encryptionSecret || !MAT_AI.firebaseUrl) return null;

    if (!force && matAiRuntimeConfigCache.value && (Date.now() - matAiRuntimeConfigCache.ts) < MAT_AI_RUNTIME.cacheTtlMs) {
        return matAiRuntimeConfigCache.value;
    }

    const raw = await fetchFirebaseJson(MAT_AI_RUNTIME.settingsPath).catch(() => null);
    if (!raw?.encryptedApiKey) {
        matAiRuntimeConfigCache.ts = Date.now();
        matAiRuntimeConfigCache.value = null;
        return null;
    }

    const config = {
        apiKey    : decryptMatAiSecret(raw.encryptedApiKey),
        model     : cleanText(raw.model, 120),
        updatedAt : cleanText(raw.updatedAt, 80),
        updatedBy : cleanText(raw.updatedBy, 120),
    };

    matAiRuntimeConfigCache.ts = Date.now();
    matAiRuntimeConfigCache.value = config;
    return config;
}

async function saveStoredMatAiConfig({ apiKey = "", model = "", updatedBy = "" } = {}) {
    if (!MAT_AI_RUNTIME.encryptionSecret) {
        throw new Error("MAT_AI_CONFIG_SECRET must be set on the backend before saving an AI key.");
    }

    const trimmedKey = String(apiKey || "").trim();
    const payload = trimmedKey ? {
        encryptedApiKey : encryptMatAiSecret(trimmedKey),
        model           : cleanText(model, 120) || MAT_AI.model,
        updatedAt       : new Date().toISOString(),
        updatedBy       : cleanText(updatedBy, 120) || "admin",
    } : null;

    await writeFirebaseJson(MAT_AI_RUNTIME.settingsPath, payload);

    const cachedValue = payload ? {
        apiKey    : trimmedKey,
        model     : payload.model,
        updatedAt : payload.updatedAt,
        updatedBy : payload.updatedBy,
    } : null;

    matAiRuntimeConfigCache.ts = Date.now();
    matAiRuntimeConfigCache.value = cachedValue;
    return cachedValue;
}

async function resolveMatAiProviderConfig(options = {}) {
    const preferRuntime = options.preferRuntime !== false;

    if (preferRuntime) {
        const runtimeConfig = await readStoredMatAiConfig(options).catch(() => null);
        if (runtimeConfig?.apiKey) {
            return {
                apiKey       : runtimeConfig.apiKey,
                model        : runtimeConfig.model || MAT_AI.model,
                source       : "runtime",
                runtimeModel : runtimeConfig.model || "",
                updatedAt    : runtimeConfig.updatedAt || "",
                updatedBy    : runtimeConfig.updatedBy || "",
            };
        }
    }

    if (MAT_AI.apiKey) {
        return {
            apiKey       : MAT_AI.apiKey,
            model        : MAT_AI.model,
            source       : "env",
            runtimeModel : "",
            updatedAt    : "",
            updatedBy    : "",
        };
    }

    return {
        apiKey       : "",
        model        : MAT_AI.model,
        source       : "none",
        runtimeModel : "",
        updatedAt    : "",
        updatedBy    : "",
    };
}

function requireMatAiSetupKey(req) {
    const providedKey = String(req.get("x-mat-ai-setup-key") || req.body?.setupKey || "").trim();
    if (!MAT_AI_RUNTIME.setupKey) {
        throw Object.assign(new Error("MAT_AI_SETUP_KEY is not configured on the backend."), { statusCode: 503 });
    }
    if (!providedKey || providedKey !== MAT_AI_RUNTIME.setupKey) {
        throw Object.assign(new Error("Invalid MAT AI setup key."), { statusCode: 403 });
    }
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
    const compatibility = Array.isArray(raw.compatibility)
        ? raw.compatibility.map(item => cleanText(item, 120)).filter(Boolean).slice(0, 8)
        : cleanText(raw.compatibility, 480).split(/[\n,;|]+/).map(item => cleanText(item, 120)).filter(Boolean).slice(0, 8);
    return {
        id          : raw.id || `product-${index + 1}`,
        name        : cleanText(raw.name, 120) || `Product ${index + 1}`,
        category    : cleanText(raw.category, 48).toLowerCase() || "parts",
        price       : safeNumber(raw.price, 0),
        stock       : safeNumber(raw.stock, 0),
        rating      : safeNumber(raw.rating, 0),
        featured    : Boolean(raw.featured),
        sku         : cleanText(raw.sku, 80),
        brand       : cleanText(raw.brand, 80),
        condition   : cleanText(raw.condition, 40).toLowerCase(),
        description,
        specs,
        warranty    : cleanText(raw.warranty, 120),
        deliveryEta : cleanText(raw.deliveryEta, 120),
        compatibility,
        image       : cleanText(raw.image || (Array.isArray(raw.images) ? raw.images[0] : ""), 400),
        searchable  : [
            cleanText(raw.name, 180),
            cleanText(raw.category, 80),
            cleanText(raw.brand, 80),
            cleanText(raw.sku, 80),
            cleanText(raw.condition, 40),
            description,
            specs,
            compatibility.join(" "),
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
        `You are MAT AI, the live automotive website assistant for ${siteFacts.storeName || "Mat Auto"}.`,
        `Today's date is ${new Date().toISOString().slice(0, 10)}.`,
        "Identity and scope:",
        "- You are a professional automotive assistant focused on cars, engines, drivetrains, brakes, suspension, electrical faults, fitment follow-up, and parts buying advice.",
        "- You also know the Mat Auto website, ordering flow, quote flow, contact pages, and live catalog context provided below.",
        "- Sound calm, direct, and trustworthy. Do not sound playful, vague, or overly salesy.",
        "Primary goals:",
        "1. Answer website and catalog questions using the provided site context first.",
        "2. Help users troubleshoot vehicle problems with practical, workshop-style guidance.",
        "3. Recommend relevant Mat Auto products first when they truly match the issue.",
        "4. Clearly separate confirmed catalog facts from general automotive reasoning.",
        "5. Be honest about uncertainty. Never pretend to know exact fitment, exact trim, or exact internal specifications from a blurry image alone.",
        "Response rules:",
        "- Lead with the direct answer, then organize technical help clearly.",
        "- For diagnosis or repair help, prefer sections such as Likely Causes, What To Check First, Recommended Fix Path, Parts To Consider, and Safety.",
        "- For parts advice, mention what should be verified before buying, especially make, model, year, engine, VIN, engine code, or transmission when fitment matters.",
        "- For website questions, tell the user exactly which Mat Auto page or flow to use next.",
        "- Keep answers concise but professional. Avoid filler.",
        "Safety rules:",
        "- If symptoms suggest brake failure, steering loss, fuel leaks, overheating, smoke, fire risk, airbag or SRS faults, EV high-voltage issues, or severe engine knocking, advise the user to stop driving and seek qualified help.",
        "- Repair instructions must be practical, step-by-step, and mention tools, fluids, or parts when useful.",
        "- If critical context is missing for diagnosis, ask concise follow-up questions such as make, model, year, engine size, transmission, symptoms, warning lights, mileage, or recent repairs.",
        hasImage
            ? "- An image is attached in the latest user message. Use it for visual reasoning, but label image-based conclusions as inferred unless clearly visible."
            : "- No image is attached unless the user message includes one.",
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

function hasAnyTerm(text, terms = []) {
    return terms.some(term => text.includes(term));
}

function buildReplySection(title, items = []) {
    const cleaned = items.map(item => cleanText(item, 220)).filter(Boolean);
    if (!cleaned.length) return "";
    return `${title}:\n- ${cleaned.join("\n- ")}`;
}

function getPageUrl(fileName = "") {
    if (!fileName) return "";
    if (fileName === "index.html") return "index.html";
    return fileName;
}

function findRelevantPages(knowledge, query, limit = 4) {
    const terms = tokenizeSearch(query);
    return knowledge.pages
        .map(page => {
            const haystack = [
                page.fileName,
                page.title,
                page.description,
                ...(page.headings || []),
                page.snippet
            ].join(" ").toLowerCase();
            const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
            return { page, score };
        })
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.page.fileName.localeCompare(b.page.fileName))
        .slice(0, limit)
        .map(entry => entry.page);
}

function buildProductShortList(products = [], limit = 4) {
    return products.slice(0, limit).map(product =>
        `${product.name} (${product.category}, GMD ${product.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, ${stockLabel(product.stock)})`
    );
}

function stockLabel(stock = 0) {
    if (stock <= 0) return "out of stock";
    if (stock <= 3) return `only ${stock} left`;
    return `${stock} in stock`;
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
            followUp: ["Does the engine crank slowly, or is it only the battery light?", "What battery voltage do you see with the engine running?"]
        },
        {
            key: "starting-click",
            match: ["clicking", "click sound", "starter", "won't start", "wont start", "no start", "no crank", "crank"],
            likely: ["Low battery voltage", "Starter motor or starter solenoid fault", "Bad battery cable or engine ground"],
            checks: ["Check if headlights dim heavily while starting", "Test battery voltage before cranking", "Listen for a single click versus repeated rapid clicking", "Inspect starter and ground connections"],
            fixes: ["Charge or replace a weak battery", "Repair loose or corroded cables", "Replace the starter if voltage is healthy but the starter will not turn"],
            parts: ["Starter motor", "Battery", "Starter relay", "Ground strap"],
            followUp: ["Do you hear a single click or repeated rapid clicks?", "Do dashboard lights stay bright when you turn the key?"]
        },
        {
            key: "rough-idle",
            match: ["rough idle", "shakes", "shaking", "misfire", "stalling", "stalls", "idle problem"],
            likely: ["Ignition misfire from plugs or coils", "Dirty throttle body or airflow sensor", "Vacuum leak or fuel-delivery issue"],
            checks: ["Scan for fault codes if available", "Check spark plugs and ignition coils", "Inspect intake hoses for cracks or leaks", "Clean the throttle body and MAF sensor", "Check fuel pressure if the problem gets worse under load"],
            fixes: ["Replace worn spark plugs or weak coils", "Repair vacuum leaks", "Clean the intake and idle control path", "Service injectors or fuel filter if fuel delivery is weak"],
            parts: ["Spark plugs", "Ignition coils", "Air filter", "Fuel filter"],
            followUp: ["Is the check-engine light on?", "Does it shake only at idle or also while accelerating?"]
        },
        {
            key: "overheating",
            match: ["overheat", "overheating", "temperature", "coolant", "running hot", "hot in traffic"],
            urgent: true,
            likely: ["Low coolant or external leak", "Thermostat stuck closed", "Radiator fan not switching on", "Weak water pump or blocked radiator"],
            checks: ["Stop driving if the gauge is in the red", "Check coolant level only after the engine cools", "Look for leaks around hoses, radiator, and water pump", "Confirm radiator fans engage when hot or with AC on", "Check for pressure in the cooling system and thermostat operation"],
            fixes: ["Top up with the correct coolant only after cooling down", "Repair leaks before driving again", "Replace a stuck thermostat or failed fan motor", "Flush or replace a blocked radiator if flow is poor"],
            parts: ["Radiator", "Thermostat", "Water pump", "Coolant hose set", "Radiator fan"],
            followUp: ["Is coolant disappearing or leaking onto the ground?", "Does it overheat only in traffic, or also at highway speed?"]
        },
        {
            key: "brake",
            match: ["brake", "brakes", "grinding", "squeal", "soft pedal", "spongy pedal"],
            urgent: true,
            likely: ["Worn brake pads or damaged rotors", "Brake fluid leak or air in the system", "Caliper sticking or uneven wear"],
            checks: ["Do not keep driving if pedal feel is poor", "Inspect pad thickness and rotor surface", "Check brake fluid level and look for wet leaks at lines and calipers", "Listen for grinding or metal-on-metal noise"],
            fixes: ["Replace worn pads and machine or replace damaged rotors", "Repair fluid leaks and bleed the system", "Replace sticking calipers or seized slide pins"],
            parts: ["Brake pads", "Brake discs", "Brake caliper", "Brake fluid"],
            followUp: ["Is the pedal soft, or is the main problem noise?", "Do you feel pulling to one side while braking?"]
        },
        {
            key: "smoke-leak",
            match: ["smoke", "burning smell", "fuel leak", "oil leak", "knocking", "steam"],
            urgent: true,
            likely: ["Fluid leak contacting hot engine parts", "Internal engine issue if there is heavy smoke or knocking", "Cooling-system leak if steam is visible"],
            checks: ["Stop driving and inspect only when safe", "Identify whether the smoke is white steam, blue oil smoke, or black fuel-rich smoke", "Look for visible leaks under the car or around the engine bay", "Check warning lights and engine temperature immediately"],
            fixes: ["Do not continue driving until the leak source is found", "Repair leaking hoses, seals, or gaskets", "Arrange a tow if there is heavy smoke, severe knocking, or fire risk"],
            parts: ["Gasket set", "Coolant hose", "Oil seal", "PCV components"],
            followUp: ["What color is the smoke?", "Is the engine overheating, misfiring, or losing oil/coolant?"]
        },
        {
            key: "suspension",
            match: ["clunk", "rattle", "suspension", "shock", "strut", "bushing", "noise over bumps"],
            likely: ["Worn stabilizer links or bushings", "Weak shocks or struts", "Loose suspension hardware or control-arm wear"],
            checks: ["Check if the noise happens only on bumps or also while turning", "Inspect sway-bar links, bushings, and top mounts", "Look for leaking shocks or torn bushings", "Check wheel torque and suspension fasteners"],
            fixes: ["Replace worn links, bushes, or top mounts", "Replace leaking shocks or struts in axle pairs", "Torque loose components to specification"],
            parts: ["Shock absorber", "Strut mount", "Stabilizer link", "Suspension bushing"],
            followUp: ["Is the noise from the front or rear?", "Do you also feel vibration in the steering wheel?"]
        }
    ];

    return profiles.find(profile => hasAnyTerm(text, profile.match)) || null;
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
            "Contact the team on contact.html"
        ];

    return [
        `MAT AI can help you use the ${siteFacts.storeName || "Mat Auto"} website directly.`,
        buildReplySection("Best next steps", [
            "Browse in-stock items on index.html#products if you already know the part or engine you need.",
            "Use index.html#quote if you need sourcing help, bulk pricing, or fitment confirmation.",
            "Use track.html to follow an existing order or delivery update.",
            `For fast human support, message WhatsApp ${siteFacts.whatsappNumber || "via the contact page"}.`
        ]),
        buildReplySection("Relevant website pages", pageLines),
        buildReplySection("What to send for faster help", [
            "Vehicle make, model, year, engine size, and transmission if fitment matters.",
            "Part name or symptom, plus any warning lights or recent repairs.",
            "Order number if you are checking an existing purchase."
        ])
    ].filter(Boolean).join("\n\n");
}

function buildFallbackVehicleReply(knowledge, query, hasImage, advancedAiConfigured = false) {
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
                "If the symptom is severe or getting worse quickly, arrange hands-on inspection before driving further."
            ]));
        }
    } else {
        sections.push("I can still help, but I need a bit more vehicle detail to narrow it down.");
        sections.push(buildReplySection("Please send these details", [
            "Make, model, year, engine size, and transmission",
            "Exact symptom, when it happens, and whether warning lights are on",
            "Recent repairs, battery changes, overheating, leaks, or unusual noises"
        ]));
        if (matchedProducts.length) {
            sections.push(buildReplySection("Possible related parts from Mat Auto", matchedProducts));
        }
    }

    if (hasImage) {
        sections.push(buildReplySection("Photo note", [
            "Your photo was attached successfully.",
            advancedAiConfigured && !MAT_AI.forceFallback
                ? "Advanced visual analysis is temporarily unavailable, so describe what the image shows and I will guide you from there."
                : "This server is currently answering in smart local mode, so describe what the photo shows and I will guide you from there."
        ]));
    }

    return sections.filter(Boolean).join("\n\n");
}

function buildMatAiFallbackReply({ knowledge, latestUserMessage, imageDataUrl = "", advancedAiConfigured = false }) {
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
            : buildFallbackVehicleReply(knowledge, query, Boolean(imageDataUrl), advancedAiConfigured)
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

async function callNvidiaMatAi(messages, systemPrompt, providerConfig) {
    if (!providerConfig?.apiKey) {
        throw Object.assign(new Error("NVIDIA API key is not configured on the server."), { statusCode: 500 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAT_AI.requestTimeout);
    try {
        const response = await fetch(MAT_AI.apiUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${providerConfig.apiKey}`,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: providerConfig.model || MAT_AI.model,
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
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));

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
app.get("/api/health", async (_req, res) => {
    const providerConfig = await resolveMatAiProviderConfig().catch(() => ({
        apiKey : "",
        model  : MAT_AI.model,
        source : "none",
    }));
    const liveReady = !MAT_AI.forceFallback && Boolean(providerConfig.apiKey);
    res.json({
        status : "ok",
        ts     : Date.now(),
        env    : CONFIG.env,
        worker : process.pid,
        uptime : Math.round(process.uptime()),
        mem    : Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB",
        ai     : {
            providerConfigured: Boolean(providerConfig.apiKey),
            fallbackAvailable : !MAT_AI.strictLiveMode,
            mode              : liveReady ? "live" : "setup-required",
            source            : providerConfig.source || "none",
            model             : providerConfig.model || MAT_AI.model,
        },
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

function normalizeAdminProductPayload(raw = {}) {
    const imageList = Array.isArray(raw.images) ? raw.images : [];
    const images = imageList
        .filter(item => typeof item === "string" && /^(data:image\/|https?:\/\/)/i.test(item))
        .map(item => item.trim())
        .slice(0, 6);
    const compatibility = Array.isArray(raw.compatibility)
        ? raw.compatibility
        : String(raw.compatibility || "").split(/[\n,;|]+/);

    const id = Number(raw.id);
    const createdAt = cleanText(raw.createdAt, 64) || new Date().toISOString();
    const normalized = {
        id          : Number.isFinite(id) ? id : Date.now(),
        name        : cleanText(raw.name, 120),
        category    : cleanText(raw.category, 48).toLowerCase() || "parts",
        price       : Math.max(0, safeNumber(raw.price, 0)),
        stock       : Math.max(0, Math.round(safeNumber(raw.stock, 0))),
        sku         : cleanText(raw.sku, 80),
        brand       : cleanText(raw.brand, 80),
        condition   : cleanText(raw.condition, 40).toLowerCase(),
        description : cleanText(raw.description, 3000),
        specs       : cleanText(raw.specs, 1800),
        warranty    : cleanText(raw.warranty, 180),
        deliveryEta : cleanText(raw.deliveryEta, 120),
        compatibility: compatibility
            .map(item => cleanText(item, 120))
            .filter(Boolean)
            .slice(0, 8),
        installationAvailable     : Boolean(raw.installationAvailable),
        requestQuoteWhenOutOfStock: raw.requestQuoteWhenOutOfStock !== false,
        featured    : Boolean(raw.featured),
        images,
        image       : images[0] || "",
        rating      : Math.max(0, safeNumber(raw.rating, 5)),
        views       : Math.max(0, Math.round(safeNumber(raw.views, 0))),
        createdAt
    };

    return normalized;
}

app.post("/api/admin/products", async (req, res) => {
    const adminKey = String(req.get("x-admin-key") || req.body?.adminKey || "").trim();
    if (!adminKey || adminKey !== ADMIN_API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const product = normalizeAdminProductPayload(req.body?.product || req.body || {});
    if (!product.name || !product.description) {
        return res.status(400).json({ error: "Product name and description are required." });
    }

    const firebaseUrl = `${MAT_AI.firebaseUrl}/matAutoProducts/${encodeURIComponent(product.id)}.json`;

    try {
        const response = await fetch(firebaseUrl, {
            method  : "PUT",
            headers : { "Content-Type": "application/json" },
            body    : JSON.stringify(product)
        });

        if (!response.ok) {
            return res.status(502).json({ error: `Catalog save failed (${response.status})` });
        }

        res.status(201).json({ ok: true, id: product.id });
    } catch (err) {
        console.error("[Admin Products] Save failed:", err);
        res.status(500).json({ error: "Product upload failed", detail: err.message });
    }
});

app.get("/api/admin/mat-ai/config", async (req, res) => {
    try {
        const adminKey = String(req.get("x-admin-key") || "").trim();
        if (!adminKey || adminKey !== ADMIN_API_KEY) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        requireMatAiSetupKey(req);

        const providerConfig = await resolveMatAiProviderConfig({ force: true });
        const runtimeConfig = await readStoredMatAiConfig({ force: true }).catch(() => null);

        res.json({
            configured      : Boolean(providerConfig.apiKey),
            source          : providerConfig.source || "none",
            model           : providerConfig.model || MAT_AI.model,
            runtimeModel    : runtimeConfig?.model || "",
            updatedAt       : runtimeConfig?.updatedAt || "",
            updatedBy       : runtimeConfig?.updatedBy || "",
            envConfigured   : Boolean(MAT_AI.apiKey),
            runtimeConfigured: Boolean(runtimeConfig?.apiKey),
            setupReady      : Boolean(MAT_AI_RUNTIME.setupKey && MAT_AI_RUNTIME.encryptionSecret),
        });
    } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ error: err.message || "Could not load MAT AI config." });
    }
});

app.post("/api/admin/mat-ai/config", async (req, res) => {
    try {
        const adminKey = String(req.get("x-admin-key") || req.body?.adminKey || "").trim();
        if (!adminKey || adminKey !== ADMIN_API_KEY) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        requireMatAiSetupKey(req);

        const apiKey = String(req.body?.apiKey || "").trim();
        const model = cleanText(req.body?.model, 120) || MAT_AI.model;
        const updatedBy = cleanText(req.body?.updatedBy, 120) || "admin-panel";
        if (!apiKey) {
            return res.status(400).json({ error: "AI provider key is required." });
        }

        const savedConfig = await saveStoredMatAiConfig({ apiKey, model, updatedBy });
        res.status(201).json({
            ok              : true,
            configured      : Boolean(savedConfig?.apiKey),
            source          : "runtime",
            model           : savedConfig?.model || MAT_AI.model,
            updatedAt       : savedConfig?.updatedAt || "",
            updatedBy       : savedConfig?.updatedBy || "",
            runtimeConfigured: true,
        });
    } catch (err) {
        const status = err.statusCode || 500;
        console.error("[MAT AI] Config save error:", err.message);
        res.status(status).json({ error: err.message || "Could not save MAT AI config." });
    }
});

app.delete("/api/admin/mat-ai/config", async (req, res) => {
    try {
        const adminKey = String(req.get("x-admin-key") || req.body?.adminKey || "").trim();
        if (!adminKey || adminKey !== ADMIN_API_KEY) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        requireMatAiSetupKey(req);

        await saveStoredMatAiConfig({ apiKey: "", model: "", updatedBy: "admin-panel-clear" });
        res.json({
            ok              : true,
            configured      : Boolean(MAT_AI.apiKey),
            source          : MAT_AI.apiKey ? "env" : "none",
            model           : MAT_AI.model,
            runtimeConfigured: false,
        });
    } catch (err) {
        const status = err.statusCode || 500;
        console.error("[MAT AI] Config clear error:", err.message);
        res.status(status).json({ error: err.message || "Could not clear MAT AI config." });
    }
});

app.get("/api/mat-ai/context", async (_req, res) => {
    try {
        const knowledge = await getMatAiKnowledge("");
        const providerConfig = await resolveMatAiProviderConfig();
        const liveReady = !MAT_AI.forceFallback && Boolean(providerConfig.apiKey);
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
            capabilities: {
                mode         : liveReady ? "live" : "setup-required",
                imageAnalysis: liveReady,
                smartFallback: !MAT_AI.strictLiveMode,
                source       : providerConfig.source || "none",
            }
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
        const providerConfig = await resolveMatAiProviderConfig();
        if (MAT_AI.forceFallback) {
            return res.status(503).json({
                error: "Live MAT AI is disabled on this server. Turn off fallback mode to use the professional assistant.",
            });
        }
        if (!providerConfig.apiKey) {
            return res.status(503).json({
                error: "Live MAT AI is not configured yet. Add the NVIDIA API key in Vercel or through the admin AI settings.",
            });
        }
        let reply = "";
        let mode = "advanced";
        let warning = "";
        let providerError = "";

        try {
            reply = await callNvidiaMatAi(messages, systemPrompt, providerConfig);
        } catch (err) {
            if (MAT_AI.strictLiveMode) {
                const status = err.statusCode || 502;
                return res.status(status).json({
                    error: cleanText(err.message || "Live MAT AI is temporarily unavailable. Please try again.", 220),
                    status,
                });
            }
            mode = "fallback";
            providerError = cleanText(err.message || "Unknown MAT AI provider error.", 220);
            warning = "Advanced AI was temporarily unavailable, so MAT AI answered in smart local mode.";
            reply = buildMatAiFallbackReply({
                knowledge,
                latestUserMessage,
                imageDataUrl,
                advancedAiConfigured: true,
            });
        }
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
            mode,
            warning,
            providerError,
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
