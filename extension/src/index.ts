// ============================================================
// CentreBlock Designer Extension (v8)
// ------------------------------------------------------------
// Changes vs v7:
//   1. Environment field in Settings (for scoped cookie name)
//   2. Validate Integration button (full health check)
//   3. Scan mode: detect untracked clickable elements
// ============================================================

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function showStatus(elId: string, msg: string, ok = true) {
  const el = $(elId);
  el.textContent = msg;
  el.className = "status show " + (ok ? "ok" : "err");
  setTimeout(() => el.classList.remove("show"), 6000);
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================
// TAB SWITCHING
// ============================================================
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = (tab as HTMLElement).dataset.tab;
    document
      .querySelectorAll(".tab")
      .forEach((t) => t.classList.remove("active"));
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $("tab-" + name).classList.add("active");
    if (name === "variables") refreshSelection();
  });
});

// ============================================================
// MODE SWITCHING (Create / Attach / Scan)
// ============================================================
document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = (btn as HTMLElement).dataset.mode;
    document
      .querySelectorAll(".mode-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    $("createMode").style.display = mode === "create" ? "block" : "none";
    $("attachMode").style.display = mode === "attach" ? "block" : "none";
    $("scanMode").style.display = mode === "scan" ? "block" : "none";
    if (mode === "attach") {
      refreshSelectionForAttach();
      loadExistingVariables();
    }
  });
});

// ============================================================
// SETTINGS TAB
// ============================================================

async function loadSiteInfo() {
  try {
    const siteInfo = await webflow.getSiteInfo();
    $("siteInfo").innerHTML =
      "<div><b>Name:</b> " +
      siteInfo.siteName +
      "</div>" +
      "<div><b>Site ID:</b> <code>" +
      siteInfo.siteId +
      "</code></div>" +
      "<div><b>Short name:</b> " +
      (siteInfo.shortName || "—") +
      "</div>";

    const saved = JSON.parse(
      localStorage.getItem("cb_" + siteInfo.siteId) || "{}",
    );
    if (saved.brokerUrl)
      ($("brokerUrl") as HTMLInputElement).value = saved.brokerUrl;
    if (saved.customerId)
      ($("customerId") as HTMLInputElement).value = saved.customerId;
    if (saved.environment)
      ($("environment") as HTMLSelectElement).value = saved.environment;
    if (saved.audience)
      ($("audience") as HTMLSelectElement).value = saved.audience;
    if (saved.debug !== undefined)
      ($("debug") as HTMLSelectElement).value = String(saved.debug);
  } catch (err: any) {
    $("siteInfo").textContent = "Error: " + err.message;
  }
}

$("testBtn").addEventListener("click", async () => {
  const brokerUrl = ($("brokerUrl") as HTMLInputElement).value
    .trim()
    .replace(/\/$/, "");
  if (!brokerUrl) {
    showStatus("status", "Enter broker URL first", false);
    return;
  }
  try {
    const res = await fetch(brokerUrl + "/health", {
      headers: { "ngrok-skip-browser-warning": "true" },
    });
    const data = await res.json();
    if (data.ok) showStatus("status", "✓ Broker reachable (" + data.time + ")");
    else showStatus("status", "Broker responded but not OK", false);
  } catch (err: any) {
    showStatus("status", "Cannot reach broker: " + err.message, false);
  }
});

// ============================================================
// VALIDATE INTEGRATION (NEW)
// ============================================================
$("validateBtn").addEventListener("click", async () => {
  const brokerUrl = ($("brokerUrl") as HTMLInputElement).value
    .trim()
    .replace(/\/$/, "");
  if (!brokerUrl) {
    showStatus("status", "Enter broker URL first", false);
    return;
  }

  const siteInfo = await webflow.getSiteInfo();

  // Show pending state immediately
  $("validateResults").style.display = "block";
  $("validateList").innerHTML = `
    <div class="check pending">Broker reachable…</div>
    <div class="check pending">Site registered…</div>
    <div class="check pending">Secret decryptable…</div>
    <div class="check pending">Consumer token mint…</div>
    <div class="check pending">Test trigger fires…</div>
  `;

  ($("validateBtn") as HTMLButtonElement).disabled = true;
  $("validateBtn").textContent = "Validating…";

  try {
    const res = await fetch(brokerUrl + "/validate/" + siteInfo.siteId, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({}),
    });
    const data = await res.json();

    const checks = [
      { ok: data.broker_ok, label: "Broker reachable" },
      { ok: data.site_registered, label: "Site registered with broker" },
      { ok: data.secret_decryptable, label: "Customer secret decryptable" },
      {
        ok: data.consumer_token_minted,
        label: "Consumer token mint (CentreBlock /consumer)",
      },
      {
        ok: data.test_trigger_fired,
        label: "Test trigger fires (CentreBlock /trigger/test/)",
      },
    ];

    let html = "";
    for (const c of checks) {
      html += `<div class="check ${c.ok ? "ok" : "fail"}">${c.label}</div>`;
    }

    if (data.errors && data.errors.length > 0) {
      html +=
        '<div class="errors">' +
        data.errors.map((e: string) => escapeHtml(e)).join("<br>") +
        "</div>";
    }

    $("validateList").innerHTML = html;

    if (data.success) {
      showStatus("status", "✓ All validation checks passed");
    } else {
      showStatus("status", "Some checks failed — see details below", false);
    }
  } catch (err: any) {
    $("validateList").innerHTML =
      `<div class="check fail">Validation request failed</div>
      <div class="errors">${escapeHtml(err.message)}</div>`;
    showStatus("status", "Validation failed: " + err.message, false);
  } finally {
    ($("validateBtn") as HTMLButtonElement).disabled = false;
    $("validateBtn").textContent = "🔍 Validate Integration";
  }
});

// ============================================================
// SAVE & GENERATE SNIPPET (now includes environment + customerId in config)
// ============================================================
$("saveBtn").addEventListener("click", async () => {
  const brokerUrl = ($("brokerUrl") as HTMLInputElement).value
    .trim()
    .replace(/\/$/, "");
  const customerId = ($("customerId") as HTMLInputElement).value.trim();
  const environment = ($("environment") as HTMLSelectElement).value;
  const secret = ($("secret") as HTMLInputElement).value.trim();
  const audience = ($("audience") as HTMLSelectElement).value;
  const debug = ($("debug") as HTMLSelectElement).value === "true";

  if (!brokerUrl || !customerId || !secret) {
    showStatus(
      "status",
      "Broker URL, Customer ID and Secret are all required",
      false,
    );
    return;
  }

  ($("saveBtn") as HTMLButtonElement).disabled = true;
  $("saveBtn").textContent = "Working…";

  try {
    const siteInfo = await webflow.getSiteInfo();

    const regRes = await fetch(brokerUrl + "/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({
        site_id: siteInfo.siteId,
        secret: secret,
        customer_id: customerId,
        domain: siteInfo.shortName || siteInfo.siteName,
        default_audience: audience,
        debug: debug,
        environment: environment,
      }),
    });

    if (!regRes.ok) {
      const err = await regRes.json().catch(() => ({}));
      throw new Error(err.error || "Broker registration failed");
    }

    // Generate snippet — now includes customerId + environment for scoped cookie
    const snippet =
      "<script>\n" +
      "window.__CENTREBLOCK_CONFIG__ = {\n" +
      '  siteId: "' +
      siteInfo.siteId +
      '",\n' +
      '  brokerUrl: "' +
      brokerUrl +
      '",\n' +
      '  customerId: "' +
      customerId +
      '",\n' +
      '  environment: "' +
      environment +
      '",\n' +
      '  audience: "' +
      audience +
      '",\n' +
      "  debug: " +
      debug +
      ",\n" +
      '  webname: "' +
      (siteInfo.shortName || "site").toLowerCase() +
      '"\n' +
      "};\n" +
      "</" +
      "script>\n" +
      '<script src="' +
      brokerUrl +
      '/tracker.js" defer></' +
      "script>";

    localStorage.setItem(
      "cb_" + siteInfo.siteId,
      JSON.stringify({
        brokerUrl,
        customerId,
        environment,
        audience,
        debug,
      }),
    );

    ($("snippet") as HTMLTextAreaElement).value = snippet;
    $("snippetBox").style.display = "block";

    try {
      await navigator.clipboard.writeText(snippet);
      showStatus("status", "✓ Saved! Snippet copied to clipboard.");
    } catch {
      showStatus("status", "✓ Saved! Copy the snippet below.");
    }

    ($("secret") as HTMLInputElement).value = "";
  } catch (err: any) {
    showStatus("status", "Failed: " + err.message, false);
  } finally {
    ($("saveBtn") as HTMLButtonElement).disabled = false;
    $("saveBtn").textContent = "Save & Generate Snippet";
  }
});

$("copyBtn").addEventListener("click", async () => {
  const text = ($("snippet") as HTMLTextAreaElement).value;
  try {
    await navigator.clipboard.writeText(text);
    showStatus("status", "Copied to clipboard");
  } catch {
    ($("snippet") as HTMLTextAreaElement).select();
    showStatus("status", "Select all + Ctrl/Cmd+C", false);
  }
});

// ============================================================
// VARIABLES TAB - SELECTED ELEMENT
// ============================================================

let selectedElement: any = null;

async function readElementText(el: any): Promise<string> {
  try {
    if (typeof el.getTextContent === "function") {
      const t = await el.getTextContent();
      if (t && typeof t === "string") return t.trim();
    }
  } catch {}

  try {
    if (typeof el.getChildren === "function") {
      const children = await el.getChildren();
      for (const child of children || []) {
        const c: any = child;
        if (c && c.type === "String" && typeof c.getText === "function") {
          const t = await c.getText();
          if (t) return String(t).trim();
        }
        if (c && typeof c.getChildren === "function") {
          try {
            const grandkids = await c.getChildren();
            for (const gk of grandkids || []) {
              const g: any = gk;
              if (g && g.type === "String" && typeof g.getText === "function") {
                const t = await g.getText();
                if (t) return String(t).trim();
              }
            }
          } catch {}
        }
      }
    }
  } catch {}

  try {
    if (typeof el.getAllText === "function") {
      const t = await el.getAllText();
      if (t) return String(t).trim();
    }
  } catch {}

  return "";
}

function slugify(s: string, maxLen = 30): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLen);
}

async function buildVariableName(label: string, tag: string): Promise<string> {
  try {
    const siteInfo = await webflow.getSiteInfo();
    const webname = slugify(siteInfo.shortName || "site", 15);
    const labelSlug = slugify(label || "el", 25);
    const tagSlug = slugify(tag || "el", 12);
    let name =
      labelSlug && labelSlug !== "el"
        ? `${webname}_${labelSlug}`
        : `${webname}_${labelSlug}_${tagSlug}`;
    name = name.replace(/_+/g, "_").replace(/^_|_$/g, "");
    if (name.length > 50) name = name.slice(0, 50).replace(/_$/, "");
    if (!name) name = "cb_var";
    return name;
  } catch {
    return slugify(label || "cb_var", 40);
  }
}

async function refreshSelection() {
  try {
    const elRaw = await webflow.getSelectedElement();
    if (!elRaw) {
      selectedElement = null;
      $("selectionBox").className = "selection-box empty";
      $("selectionBox").innerHTML =
        '<div class="sel-label">No element selected</div>' +
        '<div class="sel-hint">Click an element on the canvas.</div>';
      $("createForm").style.display = "none";
      return;
    }

    const el: any = elRaw;
    selectedElement = el;
    const elType = el.type || "Element";
    const elText = await readElementText(el);

    $("selectionBox").className = "selection-box has-selection";
    $("selectionBox").innerHTML =
      '<div class="sel-label">✓ Element selected</div>' +
      '<div class="sel-meta">Type: ' +
      elType +
      (elText ? '<br>Text: "' + escapeHtml(elText.slice(0, 60)) + '"' : "") +
      "</div>";
    $("createForm").style.display = "block";

    const labelInput = $("varLabel") as HTMLInputElement;
    const nameInput = $("varName") as HTMLInputElement;

    if (elText) {
      labelInput.value = elText.slice(0, 80);
      nameInput.value = await buildVariableName(elText, elType);
      nameManuallyEdited = false;
    } else {
      labelInput.value = "";
      nameInput.value = "";
    }

    await displayExistingAttrs(el);
  } catch (err: any) {
    showStatus("varStatus", "Selection error: " + err.message, false);
  }
}

async function refreshSelectionForAttach() {
  try {
    const elRaw = await webflow.getSelectedElement();
    if (!elRaw) {
      $("selectionBoxAttach").className = "selection-box empty";
      $("selectionBoxAttach").innerHTML =
        '<div class="sel-label">No element selected</div>' +
        '<div class="sel-hint">Click an element first.</div>';
      return;
    }
    const el: any = elRaw;
    selectedElement = el;
    const elText = await readElementText(el);
    $("selectionBoxAttach").className = "selection-box has-selection";
    $("selectionBoxAttach").innerHTML =
      '<div class="sel-label">✓ Element selected</div>' +
      '<div class="sel-meta">Type: ' +
      (el.type || "Element") +
      (elText ? '<br>Text: "' + escapeHtml(elText.slice(0, 60)) + '"' : "") +
      "</div>";
  } catch {}
}

async function displayExistingAttrs(el: any) {
  try {
    const trigger =
      typeof el.getCustomAttribute === "function"
        ? await el.getCustomAttribute("data-cbtrigger")
        : null;
    const tags =
      typeof el.getCustomAttribute === "function"
        ? await el.getCustomAttribute("data-cbtags")
        : null;
    if (trigger || tags) {
      $("existingTriggers").className = "existing has";
      $("existingTriggers").innerHTML =
        (trigger ? "<b>trigger:</b> " + escapeHtml(trigger) + "<br>" : "") +
        (tags ? "<b>tags:</b> " + escapeHtml(tags) : "");
      $("removeAttrBtn").style.display = "block";
    } else {
      $("existingTriggers").className = "existing";
      $("existingTriggers").textContent = "none";
      $("removeAttrBtn").style.display = "none";
    }
  } catch {
    $("existingTriggers").className = "existing";
    $("existingTriggers").textContent = "none";
    $("removeAttrBtn").style.display = "none";
  }
}

let nameManuallyEdited = false;
$("varName").addEventListener("input", () => {
  nameManuallyEdited = true;
});
$("varLabel").addEventListener("input", async () => {
  if (nameManuallyEdited) return;
  const label = ($("varLabel") as HTMLInputElement).value;
  const tag = selectedElement?.type || "el";
  ($("varName") as HTMLInputElement).value = await buildVariableName(
    label,
    tag,
  );
});

$("refreshSelBtn").addEventListener("click", () => {
  nameManuallyEdited = false;
  refreshSelection();
});

try {
  webflow.subscribe?.("selectedelement", () => {
    if ($("tab-variables").classList.contains("active")) {
      nameManuallyEdited = false;
      refreshSelection();
      if ($("attachMode").style.display === "block") {
        refreshSelectionForAttach();
      }
    }
  });
} catch {}

// ============================================================
// CREATE VARIABLE
// ============================================================
$("createVarBtn").addEventListener("click", async () => {
  if (!selectedElement) {
    showStatus("varStatus", "Select an element first", false);
    return;
  }

  const name = ($("varName") as HTMLInputElement).value.trim();
  const label = ($("varLabel") as HTMLInputElement).value.trim();
  const weightCustomer = Number(
    ($("weightCustomer") as HTMLInputElement).value || 50,
  );
  const weightDefault = Number(
    ($("weightDefault") as HTMLInputElement).value || 50,
  );
  const direction = ($("varDirection") as HTMLSelectElement).value;
  const leavingLink = ($("leavingLink") as HTMLInputElement).value.trim();

  if (!name) {
    showStatus("varStatus", "Variable name required", false);
    return;
  }
  if (!label) {
    showStatus("varStatus", "Label required", false);
    return;
  }

  const siteInfo = await webflow.getSiteInfo();
  const saved = JSON.parse(
    localStorage.getItem("cb_" + siteInfo.siteId) || "{}",
  );
  const brokerUrl = saved.brokerUrl;
  if (!brokerUrl) {
    showStatus(
      "varStatus",
      "Configure broker URL in Settings tab first",
      false,
    );
    return;
  }

  ($("createVarBtn") as HTMLButtonElement).disabled = true;
  $("createVarBtn").textContent = "Creating…";

  try {
    const resp = await fetch(brokerUrl + "/variable", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({
        site_id: siteInfo.siteId,
        name: name,
        label: label,
        weight_for_customer: weightCustomer,
        weight_for_default: weightDefault,
        leaving_link: leavingLink,
        skip_if_exists: true,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || "Broker rejected request");
    }

    const finalName = data.name || name;
    const msg = data.skipped
      ? `"${finalName}" already exists — attaching`
      : `"${finalName}" created`;

    await attachAttributes(finalName, direction, siteInfo.shortName);
    await displayExistingAttrs(selectedElement);
    showStatus("varStatus", "✓ " + msg + " · attributes attached");
  } catch (err: any) {
    showStatus("varStatus", "Failed: " + err.message, false);
  } finally {
    ($("createVarBtn") as HTMLButtonElement).disabled = false;
    $("createVarBtn").textContent = "Create Variable & Attach";
  }
});

// ============================================================
// ATTACH EXISTING
// ============================================================
async function loadExistingVariables() {
  const select = $("existingVarSelect") as HTMLSelectElement;
  select.innerHTML = '<option value="">Loading…</option>';

  try {
    const siteInfo = await webflow.getSiteInfo();
    const saved = JSON.parse(
      localStorage.getItem("cb_" + siteInfo.siteId) || "{}",
    );
    const brokerUrl = saved.brokerUrl;
    if (!brokerUrl) {
      select.innerHTML = '<option value="">Configure broker URL first</option>';
      return;
    }

    const resp = await fetch(brokerUrl + "/variables/" + siteInfo.siteId, {
      headers: { "ngrok-skip-browser-warning": "true" },
    });
    const data = await resp.json();

    if (!resp.ok) {
      select.innerHTML =
        '<option value="">Error: ' +
        (data.error || "fetch failed") +
        "</option>";
      return;
    }

    const variables = data.variables || [];
    if (variables.length === 0) {
      select.innerHTML = '<option value="">No variables yet</option>';
      return;
    }

    const seen: { [k: string]: boolean } = {};
    const unique: any[] = [];

    // Helper to strip wrapping quotes
    const strip = (s: any): string => {
      if (s === undefined || s === null) return "";
      let v = String(s).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return v.trim();
    };

    for (const v of variables) {
      // Try multiple key variations: "name", '"name"', "variableName", BOM-prefixed
      let n = strip(
        v.name ||
          v["name"] ||
          v['"name"'] ||
          v.variableName ||
          v["﻿name"] ||
          "",
      );

      // Fallback: pick the first non-numeric string value if no name found
      if (!n) {
        for (const key in v) {
          const val = strip(v[key]);
          if (
            val &&
            isNaN(Number(val)) &&
            val.length > 2 &&
            !val.includes(":")
          ) {
            n = val;
            break;
          }
        }
      }

      if (n && !seen[n]) {
        seen[n] = true;
        unique.push({ name: n });
      }
    }

    // Sort alphabetically for usability
    unique.sort((a, b) => a.name.localeCompare(b.name));

    select.innerHTML =
      '<option value="">— Select a variable —</option>' +
      unique
        .map(
          (v) =>
            `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`,
        )
        .join("");
  } catch (err: any) {
    select.innerHTML = '<option value="">Error: ' + err.message + "</option>";
  }
}

$("reloadVarsBtn").addEventListener("click", loadExistingVariables);

$("attachVarBtn").addEventListener("click", async () => {
  if (!selectedElement) {
    showStatus("varStatus", "Select an element first", false);
    return;
  }

  const varName = ($("existingVarSelect") as HTMLSelectElement).value;
  const direction = ($("attachDirection") as HTMLSelectElement).value;

  if (!varName) {
    showStatus("varStatus", "Select a variable from the list", false);
    return;
  }

  ($("attachVarBtn") as HTMLButtonElement).disabled = true;
  $("attachVarBtn").textContent = "Attaching…";

  try {
    const siteInfo = await webflow.getSiteInfo();
    await attachAttributes(varName, direction, siteInfo.shortName);
    showStatus("varStatus", `✓ "${varName}" attached to element`);
  } catch (err: any) {
    showStatus("varStatus", "Failed: " + err.message, false);
  } finally {
    ($("attachVarBtn") as HTMLButtonElement).disabled = false;
    $("attachVarBtn").textContent = "Attach to Selected Element";
  }
});

// ============================================================
// REMOVE
// ============================================================
$("removeAttrBtn").addEventListener("click", async () => {
  if (!selectedElement) return;

  ($("removeAttrBtn") as HTMLButtonElement).disabled = true;
  $("removeAttrBtn").textContent = "Removing…";

  try {
    if (typeof selectedElement.removeCustomAttribute === "function") {
      await selectedElement.removeCustomAttribute("data-cbtrigger");
      await selectedElement.removeCustomAttribute("data-cbtags");
    } else if (typeof selectedElement.setCustomAttribute === "function") {
      await selectedElement.setCustomAttribute("data-cbtrigger", "");
      await selectedElement.setCustomAttribute("data-cbtags", "");
    } else {
      throw new Error("Element doesn't support attribute removal");
    }
    await displayExistingAttrs(selectedElement);
    showStatus("varStatus", "✓ CB attributes removed");
  } catch (err: any) {
    showStatus("varStatus", "Failed: " + err.message, false);
  } finally {
    ($("removeAttrBtn") as HTMLButtonElement).disabled = false;
    $("removeAttrBtn").textContent = "🗑 Remove CB attributes";
  }
});

async function attachAttributes(
  varName: string,
  direction: string,
  webname: string,
) {
  if (!selectedElement) throw new Error("No element selected");
  if (typeof selectedElement.setCustomAttribute !== "function") {
    throw new Error("This element type doesn't support custom attributes");
  }
  const cbtags = "page:" + (webname || "site") + ",direction:" + direction;
  await selectedElement.setCustomAttribute("data-cbtrigger", varName);
  await selectedElement.setCustomAttribute("data-cbtags", cbtags);
}

// ============================================================
// SCAN MODE (NEW) - find untracked clickable elements
// ============================================================
$("scanPageBtn").addEventListener("click", async () => {
  ($("scanPageBtn") as HTMLButtonElement).disabled = true;
  $("scanPageBtn").textContent = "Scanning…";

  try {
    const root = await webflow.getRootElement();
    if (!root) throw new Error("Could not access page root");

    const findings: {
      el: any;
      text: string;
      type: string;
      hasTrigger: boolean;
    }[] = [];

    // Recursive walk
    async function walk(el: any, depth = 0) {
      if (depth > 20) return; // safety
      const elType = (el && el.type) || "";

      // Identify clickable types
      const clickableTypes = [
        "Link",
        "LinkBlock",
        "Button",
        "NavbarLink",
        "NavbarBrand",
        "DropdownToggle",
        "FormSubmitButton",
        "DOM",
      ];
      const isClickable = clickableTypes.indexOf(elType) >= 0;

      // For DOM elements check tag
      let isDomClickable = false;
      if (elType === "DOM" && typeof el.getTag === "function") {
        try {
          const tag = ((await el.getTag()) || "").toLowerCase();
          if (["a", "button"].indexOf(tag) >= 0) isDomClickable = true;
        } catch {}
      }

      if (isClickable || isDomClickable) {
        let hasTrigger = false;
        try {
          if (typeof el.getCustomAttribute === "function") {
            const trig = await el.getCustomAttribute("data-cbtrigger");
            hasTrigger = !!trig;
          }
        } catch {}

        let txt = "";
        try {
          txt = await readElementText(el);
        } catch {}

        findings.push({
          el: el,
          text: (txt || "(no text)").slice(0, 60),
          type: elType,
          hasTrigger: hasTrigger,
        });
      }

      // Recurse children
      try {
        if (typeof el.getChildren === "function") {
          const kids = await el.getChildren();
          for (const k of kids || []) {
            await walk(k, depth + 1);
          }
        }
      } catch {}
    }

    await walk(root, 0);

    const total = findings.length;
    const tracked = findings.filter((f) => f.hasTrigger).length;
    const untracked = findings.filter((f) => !f.hasTrigger);

    $("statTotal").textContent = String(total);
    $("statTracked").textContent = String(tracked);
    $("statUntracked").textContent = String(untracked.length);
    $("scanResults").style.display = "block";

    if (untracked.length === 0) {
      $("untrackedList").innerHTML =
        '<div style="padding:8px; color:#8be88b;">✓ All clickable elements are tracked.</div>';
    } else {
      $("untrackedList").innerHTML = untracked
        .map(
          (f, idx) => `
        <div class="untracked-item">
          <div class="untracked-text" title="${escapeHtml(f.text)}">${escapeHtml(f.text)}</div>
          <div class="untracked-tag">${escapeHtml(f.type)}</div>
          <button class="untracked-select-btn" data-idx="${idx}">Select</button>
        </div>
      `,
        )
        .join("");

      // Attach select handlers
      document.querySelectorAll(".untracked-select-btn").forEach((btn) => {
        btn.addEventListener("click", async (ev) => {
          const idx = Number((ev.target as HTMLElement).dataset.idx);
          const f = untracked[idx];
          if (!f) return;
          try {
            if (typeof webflow.setSelectedElement === "function") {
              await webflow.setSelectedElement(f.el);
            }
            // Switch to Create mode
            document
              .querySelectorAll(".mode-btn")
              .forEach((b) => b.classList.remove("active"));
            const createBtn = document.querySelector(
              '.mode-btn[data-mode="create"]',
            ) as HTMLElement;
            if (createBtn) createBtn.classList.add("active");
            $("createMode").style.display = "block";
            $("attachMode").style.display = "none";
            $("scanMode").style.display = "none";
            await refreshSelection();
          } catch (err: any) {
            showStatus(
              "varStatus",
              "Could not select element: " + err.message,
              false,
            );
          }
        });
      });
    }

    showStatus(
      "varStatus",
      `✓ Scan complete: ${tracked}/${total} tracked, ${untracked.length} untracked`,
    );
  } catch (err: any) {
    showStatus("varStatus", "Scan failed: " + err.message, false);
  } finally {
    ($("scanPageBtn") as HTMLButtonElement).disabled = false;
    $("scanPageBtn").textContent = "🔎 Scan This Page";
  }
});

// ============================================================
// BOOT
// ============================================================
loadSiteInfo();
