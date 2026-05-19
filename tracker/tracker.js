/* ============================================================
   CentreBlock Tracker for Webflow
   ------------------------------------------------------------
   Injected into the customer's Webflow site as a script tag.
   Does NOT contain any secrets — only the site_id and broker URL.

   Flow:
     1. On page load, get a consumer_token from the broker
        (broker uses visitor's real IP as the CentreBlock uuid)
     2. Fire a "page" trigger for the current page
     3. Attach click listeners to clickable elements
     4. On click, fire a trigger via broker → CentreBlock
   ============================================================ */

(function () {
  "use strict";

  const CONFIG = window.__CENTREBLOCK_CONFIG__ || {
    siteId: "66fbd171291413aa1f7ebcd8",
    brokerUrl: "https://acrylic-down-desired-arena.trycloudflare.com",
    audience: "default",
    debug: true,
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
        if (!data.token)
          throw new Error("No token in response: " + JSON.stringify(data));
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
    } catch (err) {
      log("trigger " + variableName + " failed", err);
    }
  }

  // {webname_page_element_elementtype}
  function buildVariableName(el) {
    const webname = (
      CONFIG.webname || location.hostname.replace(/\./g, "_")
    ).toLowerCase();
    const page = (
      location.pathname.replace(/[^a-z0-9]/gi, "_") || "home"
    ).toLowerCase();
    const elementId = (
      el.id ||
      (el.getAttribute && el.getAttribute("data-cb-name")) ||
      el.textContent ||
      "unnamed"
    )
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 40);
    const tag = (el.tagName || "el").toLowerCase();
    return (webname + "_" + page + "_" + elementId + "_" + tag)
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
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

  function firePageTrigger() {
    const pageName = document.title || location.pathname;
    const pageVar = buildVariableName({
      id: "page",
      tagName: "PAGE",
      textContent: pageName,
    });
    const vname = "buy_now";
    fireTrigger(
      vname,
      Object.assign(
        {
          page: pageName,
          direction: "Neutral",
        },
        getUtmTags(),
      ),
    );
  }

  function attachClickTracking() {
    const selector = "a, button, [data-cb-track], input[type=submit]";
    document.addEventListener(
      "click",
      function (ev) {
        const target = ev.target.closest && ev.target.closest(selector);
        if (!target) return;
        const varName = buildVariableName(target);
        const direction =
          target.getAttribute("data-cb-direction") || "Positive";
        const tags = Object.assign(
          {
            page: document.title,
            direction: direction,
            elementText: (target.textContent || "").trim().slice(0, 80),
          },
          getUtmTags(),
        );
        fireTrigger(varName, tags);
      },
      true,
    );
    log("click tracking attached");
  }

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

  // For debugging in the browser console
  window.CentreBlock = {
    config: CONFIG,
    fireTrigger: fireTrigger,
    getToken: getToken,
  };
})();
