/* global browser */
/**
 * Import page controller.
 *
 * Runs in a full Thunderbird tab (opened by the popup's "Import" button),
 * not inside the popup — otherwise the OS file-picker would steal focus and
 * close the popup, dropping the `change` event before we ever see it.
 */
"use strict";

const $ = (sel) => document.querySelector(sel);

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

function show(view) {
  $("#view-import").hidden = view !== "import";
  $("#view-result").hidden = view !== "result";
}

$("#file-input").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const text = await file.text();
  const res = await browser.runtime.sendMessage({ kind: "openPlan", json: text });
  if (!res || !res.ok) {
    $("#import-summary").textContent = t(`error_${res && res.error}`) || (res && res.error) || "error";
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
    const diffHtml = item.differences && item.differences.length
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
  if (!res || !res.ok) {
    $("#result-body").textContent = t(`error_${res && res.error}`) || (res && res.error) || "error";
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

applyI18n();
show("import");

// If opened via a notification, prefill the plan directly from the watched
// file so the user does not have to re-select it.
(async () => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("source") !== "watched") return;
    const res = await browser.runtime.sendMessage({ kind: "openPlanFromWatched" });
    if (!res || !res.ok) {
      $("#import-summary").textContent = t(`error_${res && res.error}`) || (res && res.error) || "error";
      return;
    }
    // Reuse the same rendering path as the file-picker branch by simulating
    // its inner block: this keeps the DOM in one place.
    const s = res.summary;
    $("#import-summary").textContent =
      `${s.total} · ${s.new} ${t("statusNew")} · ${s.identical} ${t("statusIdentical")} · ` +
      `${s.conflict} ${t("statusConflict")} · ${s.unsupported} ${t("statusUnsupported")}`;
    const ul = $("#import-items");
    ul.innerHTML = "";
    for (const item of res.items) {
      const li = document.createElement("li");
      li.className = `status-${item.status}`;
      const diffHtml = item.differences && item.differences.length
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
  } catch (_) { /* stay on empty file-picker */ }
})();
