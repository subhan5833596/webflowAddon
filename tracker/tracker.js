/* ============================================================
   CentreBlock Tracker for Webflow
   ------------------------------------------------------------
   Reads data-cbtrigger and data-cbtags attributes from elements
   (set by the CentreBlock Designer Extension) and fires triggers
   via the broker → CentreBlock.

   Behavior:
     1. On load: gets a consumer_token from broker (uses visitor IP)
     2. Fires a page-level trigger (if page has data-cbtrigger on body)
     3. Tracks clicks on ANY element that has data-cbtrigger attribute
     4. Reads data-cbtags for direction, page, custom tags
   ============================================================ */

/* ============================================================
   CentreBlock Tracker for Webflow
   ------------------------------------------------------------
   Reads data-cbtrigger and data-cbtags attributes from elements
   and fires triggers via broker → CentreBlock.

   KEY FIXES:
     1. Token is fetched EAGERLY on page load (not on first click)
     2. sendBeacon used for trigger fire (survives page navigation)
     3. Fallback to fetch with keepalive when sendBeacon not available
   ============================================================ */

/* ============================================================
   CentreBlock Tracker for Webflow
   ------------------------------------------------------------
   Reads data-cbtrigger and data-cbtags attributes from elements
   and fires triggers via broker → CentreBlock.

   CRITICAL FIX:
   sendBeacon with application/json triggers CORS preflight,
   which fails silently on Render. We send as text/plain (which
   is a "simple request" - no preflight) and parse JSON on server.
   ============================================================ */

(function () {
  "use strict";

  const CONFIG = window.__CENTREBLOCK_CONFIG__ || {
    siteId: "66fbd171291413aa1f7ebcd8",
    brokerUrl: "https://webflowaddon.onrender.com",
    audience: "default",
    debug: false,
  };

  const log = function () {
    if (CONFIG.debug)
      console.log.apply(
        console,
        ["[CB-Tracker]"].concat([].slice.call(arguments)),
      );
  };

  log("booting with config", CONFIG);

  let consumerToken = null;
  let tokenPromise = null;

  // ============================================================
  // Get token (fetched eagerly on page load)
  // ============================================================
  function getToken() {
    if (consumerToken) return Promise.resolve(consumerToken);
    if (tokenPromise) return tokenPromise;

    log("requesting token...");

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
        token_ttl: 10,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.token) {
          throw new Error("No token in response: " + JSON.stringify(data));
        }
        consumerToken = data.token;
        log(
          "✓ got token",
          consumerToken.slice(0, 12) + "...",
          "uuid:",
          data.uuid,
        );
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
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ].forEach((k) => {
      if (p.get(k)) tags["url_" + k] = p.get(k);
    });
    return tags;
  }

  // ============================================================
  // Fire a trigger - uses sendBeacon with text/plain to avoid CORS preflight
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
    const url =
      CONFIG.brokerUrl + "/trigger/" + encodeURIComponent(variableName);

    // Pack everything into the body (token + tags) as JSON-string-in-text
    // We send as text/plain Content-Type to avoid CORS preflight
    const payload = JSON.stringify({
      token: consumerToken,
      tags: tags,
    });

    // ----- Strategy 1: sendBeacon with text/plain (no preflight, survives navigation) -----
    if (navigator.sendBeacon) {
      // Blob with text/plain MIME type → simple request → no preflight
      const blob = new Blob([payload], { type: "text/plain" });
      const ok = navigator.sendBeacon(url, blob);
      if (ok) {
        log("trigger " + variableName + " → sendBeacon queued ✓", tags);
        return;
      }
      log("sendBeacon returned false, falling back to fetch", variableName);
    }

    // ----- Strategy 2: fetch with keepalive (fallback) -----
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
      })
      .catch((err) => {
        log("trigger " + variableName + " failed", err);
      });
  }

  // ============================================================
  // PAGE trigger — fires once on load
  // ============================================================
  function firePageTrigger() {
    const pageEl = document.body.getAttribute("data-cbtrigger")
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
      getUtmTags(),
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
          getUtmTags(),
        );

        fireTrigger(triggerName, tags);
      },
      true,
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

    // Eager token fetch
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
  };
})();
