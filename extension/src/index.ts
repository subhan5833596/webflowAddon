// ============================================================
// CentreBlock Designer Extension
// ============================================================

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function showStatus(elId: string, msg: string, ok = true) {
  const el = $(elId);
  el.textContent = msg;
  el.className = "status show " + (ok ? "ok" : "err");
  setTimeout(() => el.classList.remove("show"), 6000);
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

$("saveBtn").addEventListener("click", async () => {
  const brokerUrl = ($("brokerUrl") as HTMLInputElement).value
    .trim()
    .replace(/\/$/, "");
  const customerId = ($("customerId") as HTMLInputElement).value.trim();
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
      }),
    });

    if (!regRes.ok) {
      const err = await regRes.json().catch(() => ({}));
      throw new Error(err.error || "Broker registration failed");
    }

    const snippet =
      "<script>\n" +
      "window.__CENTREBLOCK_CONFIG__ = {\n" +
      '  siteId: "' +
      siteInfo.siteId +
      '",\n' +
      '  brokerUrl: "' +
      brokerUrl +
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
      showStatus("status", "✓ Saved! Copy the snippet below manually.");
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
// VARIABLES TAB
// ============================================================

let selectedElement: any = null;

// Read element's display text - tries multiple strategies
// because different element types have different APIs
async function readElementText(el: any): Promise<string> {
  // Strategy 1: direct getTextContent (regular elements)
  try {
    if (typeof el.getTextContent === "function") {
      const t = await el.getTextContent();
      if (t && typeof t === "string") return t.trim();
    }
  } catch {}

  // Strategy 2: child StringElement (the official way per Webflow docs)
  try {
    if (typeof el.getChildren === "function") {
      const children = await el.getChildren();
      for (const child of children || []) {
        const c: any = child;
        if (c && c.type === "String" && typeof c.getText === "function") {
          const t = await c.getText();
          if (t) return String(t).trim();
        }
        // Recurse one level for components
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

  // Strategy 3: getAllText (some elements)
  try {
    if (typeof el.getAllText === "function") {
      const t = await el.getAllText();
      if (t) return String(t).trim();
    }
  } catch {}

  return "";
}

// Clean a string into a snake_case slug (for variable name parts)
function slugify(s: string, maxLen = 30): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLen);
}

// Generate variable name from webname + user label
// Format: {webname}_{label}_{tag}    (max 50 chars total)
async function buildVariableName(label: string, tag: string): Promise<string> {
  try {
    const siteInfo = await webflow.getSiteInfo();
    const webname = slugify(siteInfo.shortName || "site", 15);
    const labelSlug = slugify(label || "el", 25);
    const tagSlug = slugify(tag || "el", 12);

    // Drop tag if labelSlug already meaningful (avoids "..._componentinstance" noise)
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
        '<div class="sel-hint">Click an element on the canvas — like a button or link.</div>';
      $("varForm").style.display = "none";
      return;
    }

    const el: any = elRaw;
    selectedElement = el;
    const elType = el.type || "Element";

    // Read text content (may be empty for components)
    const elText = await readElementText(el);

    $("selectionBox").className = "selection-box has-selection";
    $("selectionBox").innerHTML =
      '<div class="sel-label">✓ Element selected</div>' +
      '<div class="sel-meta">Type: ' +
      elType +
      (elText
        ? '<br>Text: "' + escapeHtml(elText.slice(0, 60)) + '"'
        : "<br><span style='color:#888'>no readable text — enter label manually</span>") +
      "</div>";
    $("varForm").style.display = "block";

    // Auto-fill label (only with actual text — not "ComponentInstance")
    const labelInput = $("varLabel") as HTMLInputElement;
    const nameInput = $("varName") as HTMLInputElement;

    if (elText) {
      labelInput.value = elText.slice(0, 80);
      nameInput.value = await buildVariableName(elText, elType);
    } else {
      labelInput.value = "";
      nameInput.value = "";
      labelInput.placeholder = "Type a label, e.g. Get Started Button";
      nameInput.placeholder = "Auto-fills when you type a label";
    }

    await displayExistingAttrs(el);
  } catch (err: any) {
    showStatus("varStatus", "Selection error: " + err.message, false);
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    } else {
      $("existingTriggers").className = "existing";
      $("existingTriggers").textContent = "none";
    }
  } catch {
    $("existingTriggers").className = "existing";
    $("existingTriggers").textContent = "none";
  }
}

// As user types in label, auto-update variable name (only if not manually edited)
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

// Listen for selection changes
try {
  webflow.subscribe?.("selectedelement", () => {
    if ($("tab-variables").classList.contains("active")) {
      nameManuallyEdited = false;
      refreshSelection();
    }
  });
} catch {}

// CREATE VARIABLE button
$("createVarBtn").addEventListener("click", async () => {
  if (!selectedElement) {
    showStatus("varStatus", "Select an element first", false);
    return;
  }

  const name = ($("varName") as HTMLInputElement).value.trim();
  const label = ($("varLabel") as HTMLInputElement).value.trim();
  const weightCustomer = Number(
    ($("weightCustomer") as HTMLInputElement).value || 15,
  );
  const weightDefault = Number(
    ($("weightDefault") as HTMLInputElement).value || 15,
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
  if (name.length > 60) {
    showStatus("varStatus", "Variable name too long (max 60 chars)", false);
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
      const detail = data.detail
        ? " — " + JSON.stringify(data.detail).slice(0, 200)
        : "";
      throw new Error((data.error || "Broker rejected request") + detail);
    }

    const finalName = data.name || name;
    const msg = data.skipped
      ? `"${finalName}" already exists — attaching`
      : `"${finalName}" created ✓`;

    // Attach attributes to element
    const cbtags =
      "page:" + (siteInfo.shortName || "site") + ",direction:" + direction;

    try {
      if (typeof selectedElement.setCustomAttribute !== "function") {
        throw new Error("Element doesn't support custom attributes");
      }
      await selectedElement.setCustomAttribute("data-cbtrigger", finalName);
      await selectedElement.setCustomAttribute("data-cbtags", cbtags);
      await displayExistingAttrs(selectedElement);
      showStatus("varStatus", "✓ " + msg + " · attributes attached");
    } catch (attrErr: any) {
      showStatus(
        "varStatus",
        "Variable saved in CB ✓ — but couldn't attach attributes to this element type. " +
          "Select a wrapper div around it instead. (" +
          attrErr.message +
          ")",
        false,
      );
    }
  } catch (err: any) {
    showStatus("varStatus", "Failed: " + err.message, false);
  } finally {
    ($("createVarBtn") as HTMLButtonElement).disabled = false;
    $("createVarBtn").textContent = "Create Variable & Attach";
  }
});

// ============================================================
// BOOT
// ============================================================
loadSiteInfo();
