/* ============================================================
   CentreBlock Tracker for Webflow
   ------------------------------------------------------------
   Implements:
     - Server-side token broker (secret never in browser)
     - Cookie-based token caching (10 days)
     - Scoped cookie name: cb_token_{environment}_{customerId}
     - Secure attribute on HTTPS sites
     - sendBeacon for navigation-safe trigger firing
     - data-cbtrigger / data-cbtags attribute-driven events
   ============================================================ */

(function () {
  "use strict";

  const CONFIG = window.__CENTREBLOCK_CONFIG__ || {
    siteId: "REPLACE_WITH_SITE_ID",
    brokerUrl: "REPLACE_WITH_BROKER_URL",
    audience: "default",
    debug: false,
    customerId: "default",      // for cookie scoping
    environment: "prod",        // for cookie scoping (prod / test / staging)
  };

  const TOKEN_TTL_DAYS = 10;

  const log = function () {
    if (CONFIG.debug)
      console.log.apply(
        console,
        ["[CB-Tracker]"].concat([].slice.call(arguments))
      );
  };

  log("booting with config", CONFIG);

  let consumerToken = null;
  let tokenPromise = null;

  // ============================================================
  // Cookie helpers — scoped name: cb_token_{env}_{customerId}
  // ============================================================
  function getCookieName() {
    const env = (CONFIG.environment || "prod").toString().replace(/[^a-z0-9]/gi, "");
    const cid = (CONFIG.customerId || "default").toString().replace(/[^a-z0-9]/gi, "");
    return "cb_token_" + env + "_" + cid;
  }

  function readCookie(name) {
    const all = document.cookie || "";
    const parts = all.split(";");
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].trim();
      if (p.indexOf(name + "=") === 0) {
        try {
          return decodeURIComponent(p.substring(name.length + 1));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  function writeCookie(name, value, days) {
    const exp = new Date();
    exp.setTime(exp.getTime() + days * 24 * 60 * 60 * 1000);
    const isHttps = location.protocol === "https:";
    let cookie =
      name +
      "=" +
      encodeURIComponent(value) +
      "; expires=" +
      exp.toUTCString() +
      "; path=/; SameSite=Lax";
    if (isHttps) cookie += "; Secure";
    document.cookie = cookie;
    log("cookie set:", name, "(Secure:", isHttps + ")");
  }

  function deleteCookie(name) {
    document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  }

  // ============================================================
  // Token management — tries cookie first, falls back to broker
  // ============================================================
  function getToken() {
    if (consumerToken) return Promise.resolve(consumerToken);
    if (tokenPromise) return tokenPromise;

    // Try cookie first
    const cookieName = getCookieName();
    const cached = readCookie(cookieName);
    if (cached) {
      consumerToken = cached;
      log("✓ token loaded from cookie", cookieName, consumerToken.slice(0, 12) + "...");
      return Promise.resolve(consumerToken);
    }

    log("no cached token — requesting from broker...");

    tokenPromise = fetch(CONFIG.brokerUrl + "/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({
        site_id: CONFIG.siteId,
        audiences: Array.isArray(CONFIG.audience)
          ? CONFIG.audience
          : [CONFIG.audience || "default"],
        token_ttl: TOKEN_TTL_DAYS,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.token) {
          throw new Error("No token in response: " + JSON.stringify(data));
        }
        consumerToken = data.token;
        // Cache in cookie for 10 days
        writeCookie(cookieName, consumerToken, TOKEN_TTL_DAYS);
        log("✓ got fresh token", consumerToken.slice(0, 12) + "...", "uuid:", data.uuid);
        return consumerToken;
      })
      .catch((err) => {
        log("✗ token fetch failed", err);
        tokenPromise = null;
        throw err;
      });

    return tokenPromise;
  }

  // ============================================================
  // Parse data-cbtags="page:home,direction:Positive,key:value"
  // ============================================================
  function parseCbTags(tagString) {
    const result = {};
    if (!tagString) return result;
    const pairs = String(tagString).split(",");
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i].trim();
      if (!pair) continue;
      const idx = pair.indexOf(":");
      if (idx === -1) continue;
      const key = pair.substring(0, idx).trim();
      const val = pair.substring(idx + 1).trim();
      if (key && val) result[key] = val;
    }
    return result;
  }

  function getUtmTags() {
    const p = new URLSearchParams(location.search);
    const tags = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((k) => {
      if (p.get(k)) tags["url_" + k] = p.get(k);
    });
    return tags;
  }

  // ============================================================
  // Fire trigger — sendBeacon with text/plain (CORS-safe)
  // ============================================================
  function fireTrigger(variableName, tags) {
    tags = tags || {};

    if (!consumerToken) {
      log("⚠ no token yet, fetching first", variableName);
      getToken()
        .then(() => sendTrigger(variableName, tags))
        .catch((err) => log("trigger " + variableName + " failed", err));
      return;
    }

    sendTrigger(variableName, tags);
  }

  function sendTrigger(variableName, tags) {
    const url = CONFIG.brokerUrl + "/trigger/" + encodeURIComponent(variableName);
    const payload = JSON.stringify({
      token: consumerToken,
      tags: tags,
    });

    // Strategy 1: sendBeacon with text/plain (no preflight, survives navigation)
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "text/plain" });
      const ok = navigator.sendBeacon(url, blob);
      if (ok) {
        log("trigger " + variableName + " → sendBeacon ✓", tags);
        return;
      }
      log("sendBeacon returned false, falling back to fetch", variableName);
    }

    // Strategy 2: fetch with keepalive
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "ngrok-skip-browser-warning": "true",
      },
      body: payload,
      keepalive: true,
    })
      .then((res) => {
        log("trigger " + variableName + " → fetch " + res.status, tags);
        // If broker says token expired/invalid, clear cookie and retry once
        if (res.status === 401 || res.status === 403) {
          log("token rejected, clearing cookie for retry on next event");
          consumerToken = null;
          tokenPromise = null;
          deleteCookie(getCookieName());
        }
      })
      .catch((err) => {
        log("trigger " + variableName + " failed", err);
      });
  }

  // ============================================================
  // PAGE trigger — fires once on load
  // ============================================================
  function firePageTrigger() {
    const pageEl =
      document.body.getAttribute("data-cbtrigger")
        ? document.body
        : document.documentElement.getAttribute("data-cbtrigger")
        ? document.documentElement
        : null;

    if (!pageEl) {
      log("no page-level data-cbtrigger found — skipping page trigger");
      return;
    }

    const triggerName = pageEl.getAttribute("data-cbtrigger");
    const cbTags = parseCbTags(pageEl.getAttribute("data-cbtags"));

    const tags = Object.assign(
      {
        page: cbTags.page || document.title,
        direction: cbTags.direction || "Neutral",
      },
      cbTags,
      getUtmTags()
    );

    fireTrigger(triggerName, tags);
  }

  // ============================================================
  // CLICK tracking
  // ============================================================
  function attachClickTracking() {
    document.addEventListener(
      "click",
      function (ev) {
        const target =
          ev.target.closest && ev.target.closest("[data-cbtrigger]");
        if (!target) return;

        const triggerName = target.getAttribute("data-cbtrigger");
        if (!triggerName) return;

        const cbTags = parseCbTags(target.getAttribute("data-cbtags"));

        const tags = Object.assign(
          {
            page: cbTags.page || document.title,
            direction: cbTags.direction || "Positive",
            elementText: (target.textContent || "").trim().slice(0, 80),
          },
          cbTags,
          getUtmTags()
        );

        fireTrigger(triggerName, tags);
      },
      true
    );
    log("click tracking attached");
  }

  // ============================================================
  // Boot
  // ============================================================
  function boot() {
    if (CONFIG.siteId === "REPLACE_WITH_SITE_ID") {
      console.warn("[CB-Tracker] not configured — siteId missing");
      return;
    }

    // Eager token fetch (from cookie or broker)
    getToken().catch(() => {});

    firePageTrigger();
    attachClickTracking();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // ============================================================
  // Debug helpers
  // ============================================================
  window.CentreBlock = {
    config: CONFIG,
    fireTrigger: fireTrigger,
    getToken: getToken,
    parseCbTags: parseCbTags,
    hasToken: function () {
      return !!consumerToken;
    },
    clearToken: function () {
      consumerToken = null;
      tokenPromise = null;
      deleteCookie(getCookieName());
      log("token cleared from memory and cookie");
    },
    cookieName: getCookieName,
  };
})();
