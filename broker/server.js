// ============================================================
// CentreBlock Broker
// ------------------------------------------------------------
// Jobs:
//   1. Store customer secrets encrypted, keyed by site_id
//   2. Mint consumer_tokens by calling CentreBlock /consumer
//   3. Forward trigger events to CentreBlock /trigger
//   4. Create / check / list CentreBlock variables
//
// Visitor browser NEVER sees the customer secret.
// ============================================================

import express from "express";
import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();

const PORT = process.env.PORT || 4000;
const CB_API =
  process.env.CENTREBLOCK_API || "https://prod.centreblock.net/api/v1/";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const DEBUG = process.env.DEBUG === "true";

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error("[FATAL] ENCRYPTION_KEY must be a 64-char hex string.");
  console.error("Generate one with: openssl rand -hex 32");
  process.exit(1);
}

const key = Buffer.from(ENCRYPTION_KEY, "hex");

// ----------- helpers -----------
function log(...args) {
  if (DEBUG) console.log("[BROKER]", new Date().toISOString(), ...args);
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

function decrypt(stored) {
  const [ivHex, tagHex, encHex] = stored.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf8",
  );
}

// Sanitize tags - CentreBlock only allows alphanumeric in keys and values
function sanitizeTag(val) {
  return String(val).replace(/[^a-zA-Z0-9]/g, "");
}

// Sanitize variable name - CB requires lowercase letters and underscores only,
// must start with a letter, and CB rejects names over ~60 chars
function sanitizeVariableName(name) {
  let clean = String(name).toLowerCase().replace(/ /g, "_");
  clean = clean.replace(/[^a-z_]/g, "_"); // only a-z and _
  clean = clean.replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!clean || !/^[a-z]/.test(clean)) {
    clean = "cb_" + clean;
  }
  // Cap length to avoid CB validation errors (CB limit ~60, we use 50 for safety)
  if (clean.length > 50) {
    clean = clean.slice(0, 50).replace(/_$/, "");
  }
  return clean;
}

// Extract real visitor IP (works through ngrok / cloudflare / direct)
function getClientIp(req) {
  let ip =
    req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") ip = "127.0.0.1";
  return ip;
}

// ----------- simple JSON file store -----------
const DB_FILE = path.join(__dirname, "broker-data.json");

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { sites: {} };
  }
}
function saveDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const db = {
  upsertSite(site_id, row) {
    const data = loadDb();
    data.sites[site_id] = { ...data.sites[site_id], ...row, site_id };
    saveDb(data);
  },
  getSite(site_id) {
    return loadDb().sites[site_id] || null;
  },
  listSites() {
    return Object.values(loadDb().sites).map((s) => ({
      site_id: s.site_id,
      customer_id: s.customer_id,
      domain: s.domain,
      default_audience: s.default_audience,
      debug: s.debug,
      created_at: s.created_at,
    }));
  },
};

// ----------- express setup -----------
const app = express();
app.set("trust proxy", true);
app.use(express.json());

app.use(
  cors({
    origin: true,
    credentials: false,
    allowedHeaders: [
      "Content-Type",
      "x-cb-token",
      "ngrok-skip-browser-warning",
    ],
    methods: ["GET", "POST", "OPTIONS"],
  }),
);

app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});

app.use((req, res, next) => {
  log(
    `→ ${req.method} ${req.path}`,
    req.body && Object.keys(req.body).length ? req.body : "",
  );
  next();
});

// Serve tracker.js from the tracker/ folder
app.get("/tracker.js", (req, res) => {
  const trackerPath = path.join(__dirname, "..", "tracker", "tracker.js");
  log(`tracker.js request → looking for: ${trackerPath}`);

  if (!fs.existsSync(trackerPath)) {
    log(`✗ tracker.js NOT FOUND at ${trackerPath}`);
    return res
      .status(404)
      .type("text/plain")
      .send("// tracker.js not found at: " + trackerPath);
  }

  const stats = fs.statSync(trackerPath);
  log(`✓ tracker.js found, size: ${stats.size} bytes`);

  res.type("application/javascript");
  res.sendFile(trackerPath);
});

// ============================================================
// ROUTE 1: Health check
// ============================================================
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ============================================================
// ROUTE 2: Register a site
// POST /register
// Body: { site_id, secret, customer_id, domain, default_audience, debug }
// ============================================================
app.post("/register", (req, res) => {
  const {
    site_id,
    secret,
    customer_id,
    domain,
    default_audience = "default",
    debug = false,
  } = req.body;

  if (!site_id || !secret || !customer_id) {
    return res.status(400).json({
      error: "site_id, secret and customer_id are required",
    });
  }

  try {
    const encrypted = encrypt(secret);
    db.upsertSite(site_id, {
      encrypted_secret: encrypted,
      customer_id,
      domain: domain || "",
      default_audience,
      debug: !!debug,
      created_at: new Date().toISOString(),
    });
    log(
      `✓ registered site: ${site_id} (customer: ${customer_id}, domain: ${domain})`,
    );
    res.json({ ok: true, site_id });
  } catch (err) {
    log("✗ register failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTE 3: Mint a consumer token
// POST /token  Body: { site_id, audiences, tags, token_ttl }
// ============================================================
app.post("/token", async (req, res) => {
  const { site_id, audiences, tags, token_ttl } = req.body;
  if (!site_id) return res.status(400).json({ error: "site_id required" });

  const row = db.getSite(site_id);
  if (!row) return res.status(404).json({ error: "site_id not registered" });

  const visitorIp = getClientIp(req);
  log(`visitor IP detected: ${visitorIp}`);

  try {
    const secret = decrypt(row.encrypted_secret);
    const useAudiences =
      Array.isArray(audiences) && audiences.length
        ? audiences
        : [row.default_audience || "default"];

    const rawTags = tags || {};
    const cleanTags = {};
    for (const [k, v] of Object.entries(rawTags)) {
      const ck = sanitizeTag(k);
      const cv = sanitizeTag(v);
      if (ck && cv) cleanTags[ck] = cv;
    }

    const payload = {
      uuid: visitorIp,
      customerId: row.customer_id,
      createdAt: new Date().toISOString(),
      audiences: useAudiences,
      tokenTimeToLive: token_ttl || 10,
      tags: cleanTags,
    };

    log(`→ CB /consumer payload`, payload);

    const cbRes = await fetch(`${CB_API}consumer`, {
      method: "POST",
      headers: {
        "x-centreblock-token": secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await cbRes.json().catch(() => ({}));
    log(`← CB /consumer ${cbRes.status}`, data);

    if (!cbRes.ok) {
      return res.status(cbRes.status).json({
        error: "CentreBlock rejected",
        detail: data,
      });
    }

    res.json({
      token: data.data,
      audiences: useAudiences,
      uuid: visitorIp,
    });
  } catch (err) {
    log("✗ token mint failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTE 4: Forward a trigger
// POST /trigger/:variableName
// Headers: x-cb-token: <consumer_token>
// Body: { tags: {...} }
// ============================================================
app.post("/trigger/:variableName", async (req, res) => {
  const { variableName } = req.params;
  const token = req.headers["x-cb-token"];
  const body = req.body || {};

  if (!token)
    return res.status(400).json({ error: "x-cb-token header required" });

  try {
    const cbRes = await fetch(`${CB_API}trigger/${variableName}`, {
      method: "POST",
      headers: {
        "x-centreblock-consumer-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await cbRes.text();
    log(`trigger ${variableName}: ${cbRes.status} ${text.slice(0, 200)}`);
    res.status(cbRes.status).send(text);
  } catch (err) {
    log("✗ trigger forward failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTE 5: List sites (admin/debug)
// ============================================================
app.get("/sites", (req, res) => {
  res.json(db.listSites());
});

// ============================================================
// ROUTE 6: Check if a variable already exists in CentreBlock
// GET /variable/exists/:site_id/:variableName
// ============================================================
app.get("/variable/exists/:site_id/:variableName", async (req, res) => {
  const { site_id, variableName } = req.params;

  const row = db.getSite(site_id);
  if (!row) return res.status(404).json({ error: "site_id not registered" });

  try {
    const secret = decrypt(row.encrypted_secret);
    const cleanName = sanitizeVariableName(variableName);

    // GET /csv/<customer_id> returns CSV of all variables
    const cbRes = await fetch(`${CB_API}csv/${row.customer_id}`, {
      method: "GET",
      headers: {
        "x-centreblock-token": secret,
      },
    });

    if (!cbRes.ok) {
      const errText = await cbRes.text();
      log(`✗ csv fetch failed: ${cbRes.status} ${errText.slice(0, 200)}`);
      return res.status(cbRes.status).json({
        error: "CentreBlock csv fetch failed",
        detail: errText,
      });
    }

    const csvText = await cbRes.text();
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // Skip header (first line), check first column (variable name)
    const exists = lines
      .slice(1)
      .some((line) => line.split(",")[0].trim().toLowerCase() === cleanName);

    log(`variable.exists(${cleanName}) → ${exists}`);
    res.json({ exists, name: cleanName });
  } catch (err) {
    log("✗ variable.exists failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTE 7: Create a CentreBlock variable
// POST /variable
// Body: {
//   site_id,                 // required
//   name,                    // required, e.g. "signup_button"
//   weight_for_customer,     // default 15
//   weight_for_default,      // default 15
//   label,                   // human readable label (becomes tags.label in CB)
//   leaving_link,            // optional outbound URL
//   skip_if_exists           // default true
// }
//
// Final payload sent to CentreBlock (matches Python exactly):
//   {
//     "name":       "<cleanName>",
//     "categories": { "customer": N, "default": N },
//     "tags":       { "label": "<sanitized>" }   // empty {} if no label
//     "leavingLink":"<url>"                       // only if provided
//   }
// ============================================================
app.post("/variable", async (req, res) => {
  const {
    site_id,
    name,
    weight_for_customer = 15,
    weight_for_default = 15,
    label = "",
    leaving_link = "",
    skip_if_exists = true,
  } = req.body;

  if (!site_id || !name) {
    return res.status(400).json({ error: "site_id and name are required" });
  }

  const row = db.getSite(site_id);
  if (!row) return res.status(404).json({ error: "site_id not registered" });

  const cleanName = sanitizeVariableName(name);
  log(`variable name "${name}" → cleaned: "${cleanName}"`);

  try {
    const secret = decrypt(row.encrypted_secret);

    // STEP 1: Check if already exists (optional)
    if (skip_if_exists) {
      try {
        const csvRes = await fetch(`${CB_API}csv/${row.customer_id}`, {
          method: "GET",
          headers: { "x-centreblock-token": secret },
        });
        if (csvRes.ok) {
          const csvText = await csvRes.text();
          const lines = csvText
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          const exists = lines
            .slice(1)
            .some(
              (line) => line.split(",")[0].trim().toLowerCase() === cleanName,
            );
          if (exists) {
            log(`✓ variable "${cleanName}" already exists — skipping`);
            return res.json({
              skipped: true,
              name: cleanName,
              message: "Variable already exists",
            });
          }
        } else {
          log(`csv check returned ${csvRes.status} — proceeding to create`);
        }
      } catch (e) {
        log(`csv check failed: ${e.message} — proceeding to create`);
      }
    }

    // STEP 2: Build the payload (exact same shape as Python)
    const variableTags = {};
    if (label) variableTags.label = sanitizeTag(label);

    const payload = {
      name: cleanName,
      categories: {
        customer: Number(weight_for_customer),
        default: Number(weight_for_default),
      },
      tags: variableTags,
    };

    // leavingLink — top level, full URL allowed
    if (leaving_link) {
      payload.leavingLink = leaving_link;
    }

    log(`→ CB /variables payload`, payload);

    // STEP 3: Create the variable
    const cbRes = await fetch(`${CB_API}variables/`, {
      method: "POST",
      headers: {
        "x-centreblock-token": secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await cbRes.json().catch(() => ({}));
    log(`← CB /variables ${cbRes.status}`, data);

    if (!cbRes.ok) {
      return res.status(cbRes.status).json({
        error: "CentreBlock rejected variable creation",
        detail: data,
      });
    }

    res.json({
      created: true,
      name: cleanName,
      cb_response: data,
    });
  } catch (err) {
    log("✗ variable create failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTE 8: List all variables for a site (proxies CB /csv/:customer_id)
// GET /variables/:site_id
// Returns: { variables: [{ name, ... }] }
// ============================================================
app.get("/variables/:site_id", async (req, res) => {
  const { site_id } = req.params;

  const row = db.getSite(site_id);
  if (!row) return res.status(404).json({ error: "site_id not registered" });

  try {
    const secret = decrypt(row.encrypted_secret);

    const cbRes = await fetch(`${CB_API}csv/${row.customer_id}`, {
      method: "GET",
      headers: { "x-centreblock-token": secret },
    });

    if (!cbRes.ok) {
      const errText = await cbRes.text();
      return res
        .status(cbRes.status)
        .json({ error: "CentreBlock csv fetch failed", detail: errText });
    }

    const csvText = await cbRes.text();
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) return res.json({ variables: [] });

    const headers = lines[0].split(",").map((h) => h.trim());
    const variables = lines.slice(1).map((line) => {
      const cells = line.split(",");
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = (cells[i] || "").trim();
      });
      return obj;
    });

    log(`✓ listed ${variables.length} variables for site ${site_id}`);
    res.json({ variables });
  } catch (err) {
    log("✗ variables list failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║  CentreBlock Broker running on port ${PORT}     ║
║  Debug:    ${DEBUG ? "ON " : "OFF"}                                ║
║  CB API:   ${CB_API.padEnd(34)}║
╚══════════════════════════════════════════════╝
`);
});
