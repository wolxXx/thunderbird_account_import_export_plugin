/* global browser */
/**
 * Settings page.
 *
 * Reads/writes `watchSettings` in storage via the background page. Also
 * flips the `onboarded` flag on first visit so the popup stops nagging.
 */
"use strict";

const $ = (sel) => document.querySelector(sel);

function t(key, fallback) {
  const s = browser.i18n.getMessage(key);
  return s || fallback || key;
}

function applyI18n() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const translated = t(el.dataset.i18n);
    if (translated) el.textContent = translated;
  }
}

async function loadSettings() {
  const res = await browser.runtime.sendMessage({ kind: "getSettings" });
  const s = (res && res.settings) || {};
  $("#enabled").checked = !!s.enabled;
  $("#path").value = s.path || "";
  $("#pollMinutes").value = s.pollMinutes || 15;
  $("#autoImportNew").checked = !!s.autoImportNew;
  $("#autoExport").checked = !!s.autoExport;
}

async function showStatus() {
  const res = await browser.runtime.sendMessage({ kind: "getState" });
  if (!res || !res.ok) return;
  const st = res.state || {};
  const parts = [];
  if (st.lastCheckedAt) {
    parts.push(`${t("lastChecked", "Last checked")}: ${new Date(st.lastCheckedAt).toLocaleString()}`);
  }
  if (st.lastError) {
    parts.push(`${t("lastError", "Last error")}: ${st.lastError}`);
  }
  if (parts.length) {
    $("#status").hidden = false;
    $("#status").textContent = parts.join("\n");
  }
}

$("#btn-save").addEventListener("click", async () => {
  const patch = {
    enabled: $("#enabled").checked,
    path: $("#path").value.trim(),
    pollMinutes: Number($("#pollMinutes").value) || 15,
    autoImportNew: $("#autoImportNew").checked,
    autoExport: $("#autoExport").checked,
  };
  await browser.runtime.sendMessage({ kind: "updateSettings", patch });
  await browser.runtime.sendMessage({ kind: "markOnboarded" });
  $("#status").hidden = false;
  $("#status").textContent = t("saved", "Saved.");
});

$("#btn-check").addEventListener("click", async () => {
  $("#status").hidden = false;
  $("#status").textContent = t("checking", "Checking…");
  const res = await browser.runtime.sendMessage({ kind: "checkNow" });
  if (!res) {
    $("#status").textContent = t("errorGeneric", "Error.");
    return;
  }
  if (!res.ok) {
    $("#status").textContent = `${t("errorGeneric", "Error")}: ${res.error || "?"}`;
    return;
  }
  if (!res.changed) {
    $("#status").textContent = t("noChanges", "No changes.");
    return;
  }
  const s = res.summary || {};
  const auto = res.autoImported ? ` · ${res.autoImported} ${t("imported", "imported")}` : "";
  $("#status").textContent =
    `${s.total} · ${s.new} ${t("statusNew", "new")} · ${s.identical} ${t("statusIdentical", "identical")} · ` +
    `${s.conflict} ${t("statusConflict", "conflict")}${auto}`;
});

(async () => {
  applyI18n();
  const ob = await browser.runtime.sendMessage({ kind: "isOnboarded" });
  if (ob && !ob.onboarded) {
    $("#onboarding").hidden = false;
  }
  await loadSettings();
  await showStatus();
})();
