/* global browser */
/**
 * Popup UI controller.
 *
 * Deliberately kept as plain JS (no bundler needed): it only talks to the
 * background page via `browser.runtime.sendMessage`. All account
 * inspection, JSON parsing, matching and mutation happens in the
 * background — the popup is a thin view.
 */
"use strict";

const $ = (sel) => document.querySelector(sel);
const views = ["home", "export", "import", "result"];

function show(view) {
  for (const v of views) {
    document.getElementById(`view-${v}`).hidden = v !== view;
  }
}

function t(key) {
  const s = browser.i18n.getMessage(key);
  return s || key;
}

function applyI18n() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.dataset.i18n;
    const translated = t(key);
    if (translated) el.textContent = translated;
  }
}

async function loadExportView() {
  const accounts = await browser.runtime.sendMessage({ kind: "listAccounts" });
  const ul = $("#account-list");
  ul.innerHTML = "";
  for (const a of accounts) {
    const li = document.createElement("li");
    const email = (a.identities.find((i) => i.default) || a.identities[0] || {}).email || "";
    li.innerHTML = `
      <label>
        <input type="checkbox" data-native-id="${a.nativeId}" checked />
        <strong>${a.name}</strong> — ${a.type} — ${email}
      </label>`;
    ul.appendChild(li);
  }
  show("export");
}

$("#btn-export").addEventListener("click", loadExportView);
$("#btn-select-all").addEventListener("click", () => {
  document.querySelectorAll("#account-list input").forEach((el) => (el.checked = true));
});
$("#btn-select-none").addEventListener("click", () => {
  document.querySelectorAll("#account-list input").forEach((el) => (el.checked = false));
});
$("#btn-export-do").addEventListener("click", async () => {
  const ids = [...document.querySelectorAll("#account-list input:checked")].map(
    (el) => el.dataset.nativeId,
  );
  const res = await browser.runtime.sendMessage({ kind: "export", nativeIds: ids });
  if (!res || !res.ok) alert(t("errorExport"));
});

$("#btn-import").addEventListener("click", async () => {
  // The OS file-picker closes the popup and drops the `change` event, so
  // the import flow lives in a full Thunderbird tab instead.
  await browser.tabs.create({ url: browser.runtime.getURL("ui/import.html") });
  window.close();
});

const _btnSettings = document.getElementById("btn-settings");
if (_btnSettings) _btnSettings.addEventListener("click", async () => {
  await browser.tabs.create({ url: browser.runtime.getURL("ui/settings.html") });
  window.close();
});

// Onboarding: on first popup open, jump straight to the settings tab so
// the user can configure a watched file. `markOnboarded` is set by the
// settings page when the user hits "Save".
(async () => {
  try {
    const res = await browser.runtime.sendMessage({ kind: "isOnboarded" });
    if (res && !res.onboarded) {
      await browser.tabs.create({ url: browser.runtime.getURL("ui/settings.html") });
      window.close();
    }
  } catch (_) { /* first-run check is best-effort */ }
})();

// Legacy in-popup import handler — kept only if the import view is ever
// re-enabled inline. Guarded so it does nothing when the elements are absent.
const _legacyFileInput = document.getElementById("file-input");
if (_legacyFileInput) _legacyFileInput.addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const text = await file.text();
  const res = await browser.runtime.sendMessage({ kind: "openPlan", json: text });
  if (!res.ok) {
    $("#import-summary").textContent = t(`error_${res.error}`) || res.error;
    return;
  }
  const s = res.summary;
  $("#import-summary").textContent =
    `${s.total} · ${s.new} ${t("statusNew")} · ${s.identical} ${t("statusIdentical")} · ` +
    `${s.conflict} ${t("statusConflict")} · ${s.unsupported} ${t("statusUnsupported")}`;
  const ul = $("#import-items");
  ul.innerHTML = "";
  for (const item of res.items) {
    const li = document.createElement("li");
    li.className = `status-${item.status}`;
    const diffHtml = item.differences.length
      ? `<div class="diff">${item.differences
          .map((d) => `${d.path}: ${JSON.stringify(d.existing)} → ${JSON.stringify(d.incoming)}`)
          .join("\n")}</div>`
      : "";
    const controls = item.status === "unsupported"
      ? `<em>${item.reason || ""}</em>`
      : `
        <div class="decision" data-index="${item.index}">
          <label><input type="radio" name="d-${item.index}" value="skip" ${item.status !== "new" ? "checked" : ""}> ${t("skip")}</label>
          ${item.status === "conflict" ? `<label><input type="radio" name="d-${item.index}" value="update"> ${t("update")}</label>` : ""}
          <label><input type="radio" name="d-${item.index}" value="create" ${item.status === "new" ? "checked" : ""}> ${item.status === "new" ? t("createNew") : t("importAsNew")}</label>
        </div>`;
    li.innerHTML = `<strong>${item.incomingName}</strong> — ${item.incomingEmail} — ${t(`status_${item.status}`)}${diffHtml}${controls}`;
    ul.appendChild(li);
  }
  $("#btn-import-do").disabled = false;
});

$("#btn-import-do").addEventListener("click", async () => {
  const decisions = [];
  for (const div of document.querySelectorAll(".decision")) {
    const idx = Number(div.dataset.index);
    const value = div.querySelector("input:checked")?.value ?? "skip";
    decisions.push([idx, { kind: value }]);
  }
  const res = await browser.runtime.sendMessage({ kind: "runImport", decisions });
  if (!res.ok) {
    $("#result-body").textContent = t(`error_${res.error}`) || res.error;
  } else {
    const r = res.result;
    $("#result-body").innerHTML =
      `${r.imported} ${t("imported")}<br>${r.updated} ${t("updated")}<br>` +
      `${r.skipped} ${t("skipped")}<br>${r.failed.length} ${t("failed")}` +
      (r.failed.length
        ? `<pre>${r.failed.map((f) => `#${f.index}: ${f.error}`).join("\n")}</pre>`
        : "");
  }
  show("result");
});

for (const el of document.querySelectorAll("[data-back]")) {
  el.addEventListener("click", () => show("home"));
}

applyI18n();
show("home");
