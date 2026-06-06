// CentreBlock API helpers + utility functions
// Logic identical to Render version

const CB_API = process.env.CENTREBLOCK_API || "https://prod.centreblock.net/api/v1/";

function sanitizeTag(val) {
  return String(val).replace(/[^a-zA-Z0-9]/g, "");
}

function sanitizeVariableName(name) {
  let clean = String(name).toLowerCase().replace(/ /g, "_");
  clean = clean.replace(/[^a-z_]/g, "_");
  clean = clean.replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!clean || !/^[a-z]/.test(clean)) clean = "cb_" + clean;
  if (clean.length > 50) clean = clean.slice(0, 50).replace(/_$/, "");
  return clean;
}

function getClientIp(request) {
  // Azure Functions provides request.headers
  // X-Forwarded-For is the actual client IP behind Azure's front-end
  const xff = request.headers.get ? request.headers.get("x-forwarded-for") : request.headers["x-forwarded-for"];
  if (xff) {
    let ip = String(xff).split(",")[0].trim();
    // Strip port if present (X-Forwarded-For sometimes has IP:port)
    if (ip.includes(":") && !ip.includes("::")) ip = ip.split(":")[0];
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    return ip || "unknown";
  }
  return "unknown";
}

async function cbConsumer(secret, payload) {
  const fetch = (await import("node-fetch")).default;
  const res = await fetch(`${CB_API}consumer`, {
    method: "POST",
    headers: {
      "x-centreblock-token": secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function cbCreateVariable(secret, payload) {
  const fetch = (await import("node-fetch")).default;
  const res = await fetch(`${CB_API}variables/`, {
    method: "POST",
    headers: {
      "x-centreblock-token": secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function cbGetCsv(secret, customerId) {
  const fetch = (await import("node-fetch")).default;
  const res = await fetch(`${CB_API}csv/${customerId}`, {
    method: "GET",
    headers: { "x-centreblock-token": secret },
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

async function cbTrigger(consumerToken, variableName, body, isTest = false) {
  const fetch = (await import("node-fetch")).default;
  const url = isTest
    ? `${CB_API}trigger/test/${variableName}`
    : `${CB_API}trigger/${variableName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-centreblock-consumer-token": consumerToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

function parseCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const stripQuotes = (s) => {
    if (!s) return "";
    let v = String(s).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v.trim();
  };

  const headers = lines[0].split(",").map((h) => stripQuotes(h));
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = stripQuotes(cells[i] || "");
    });
    return obj;
  });
}

// CORS headers — applied via responseHeaders helper
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-cb-token, ngrok-skip-browser-warning",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(status, body) {
  return {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function textResponse(status, contentType, body) {
  return {
    status,
    headers: { ...corsHeaders(), "Content-Type": contentType },
    body,
  };
}

module.exports = {
  CB_API,
  sanitizeTag,
  sanitizeVariableName,
  getClientIp,
  cbConsumer,
  cbCreateVariable,
  cbGetCsv,
  cbTrigger,
  parseCsv,
  corsHeaders,
  jsonResponse,
  textResponse,
};
