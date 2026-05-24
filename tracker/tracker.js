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

(function () {
  "use strict";

  const CONFIG = window.__CENTREBLOCK_CONFIG__ || {
    siteId: "REPLACE_WITH_SITE_ID",
    brokerUrl: "REPLACE_WITH_BROKER_URL",
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
  // Token management
  // ============================================================
  function getToken() {
    if (consumerToken) return Promise.resolve(consumerToken);
    if (tokenPromise) return tokenPromise;

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
  // into { page: "home", direction: "Positive", key: "value" }
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

  // ============================================================
  // Get UTM tags from URL
  // ============================================================
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
  // Fire a trigger via broker
  // ============================================================
  async function fireTrigger(variableName, tags) {
    tags = tags || {};
    try {
      const token = await getToken();
      const res = await fetch(
        CONFIG.brokerUrl + "/trigger/" + encodeURIComponent(variableName),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cb-token": token,
            "ngrok-skip-browser-warning": "true",
          },
          body: JSON.stringify({ tags: tags }),
        },
      );
      log("trigger " + variableName + " → " + res.status, tags);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        log("  ↳ error response:", text.slice(0, 200));
      }
    } catch (err) {
      log("trigger " + variableName + " failed", err);
    }
  }

  // ============================================================
  // PAGE trigger — fires once on load
  // Looks for data-cbtrigger on <body> or <html>
  // If not found, skips (no auto-generated page triggers anymore)
  // ============================================================
  function firePageTrigger() {
    // Check body first, then html
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
  // CLICK tracking — only fires on elements with data-cbtrigger
  // ============================================================
  function attachClickTracking() {
    document.addEventListener(
      "click",
      function (ev) {
        // Find nearest ancestor with data-cbtrigger attribute
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
    log("click tracking attached (only fires on elements with data-cbtrigger)");
  }

  // ============================================================
  // Boot
  // ============================================================
  function boot() {
    if (CONFIG.siteId === "REPLACE_WITH_SITE_ID") {
      console.warn("[CB-Tracker] not configured — siteId missing");
      return;
    }
    firePageTrigger();
    attachClickTracking();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // ============================================================
  // Debug helpers (available in browser console)
  // ============================================================
  window.CentreBlock = {
    config: CONFIG,
    fireTrigger: fireTrigger,
    getToken: getToken,
    parseCbTags: parseCbTags,
  };
})();
