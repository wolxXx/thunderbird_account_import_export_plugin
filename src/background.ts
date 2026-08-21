/**
 * Background event page.
 *
 * The popup drives all user interaction and calls into this page via
 * `runtime.sendMessage`. Keeping the heavy lifting here lets us reuse a
 * single `WebExtensionThunderbirdAdapter` and share cached state between
 * multiple popup open/close cycles.
 */

import { WebExtensionThunderbirdAdapter } from "./adapter/webext.js";
import { exportAccounts, serialize } from "./core/export.js";
import {
  executeImport,
  planImport,
  type ItemDecision,
} from "./core/import.js";
import { validatePortable } from "./io/validate.js";
import type { ImportPlan } from "./core/import.js";
import type { PortableAccountConfig } from "./model/portable.js";
import {
  checkOnce,
  getSettings,
  getState,
  installWatcher,
  isOnboarded,
  markOnboarded,
  updateSettings,
  type WatchSettings,
} from "./watcher/watch.js";
import { installAutoExport } from "./watcher/autoExport.js";

declare const browser: any;

const adapter = new WebExtensionThunderbirdAdapter();
let currentPlan: ImportPlan | null = null;
let currentConfig: PortableAccountConfig | null = null;

type Message =
  | { kind: "listAccounts" }
  | { kind: "export"; nativeIds?: string[] }
  | { kind: "openPlan"; json: string }
  | { kind: "openPlanFromWatched" }
  | { kind: "runImport"; decisions: Array<[number, ItemDecision]> }
  | { kind: "getSettings" }
  | { kind: "updateSettings"; patch: Partial<WatchSettings> }
  | { kind: "checkNow" }
  | { kind: "getState" }
  | { kind: "isOnboarded" }
  | { kind: "markOnboarded" };

async function handle(msg: Message): Promise<unknown> {
  switch (msg.kind) {
    case "listAccounts": {
      return adapter.listAccounts();
    }
    case "export": {
      const cfg = await exportAccounts(adapter, { onlyNativeIds: msg.nativeIds });
      const json = serialize(cfg);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = cfg.exportedAt.replace(/[:.]/g, "-");
      await browser.downloads.download({
        url,
        filename: `thunderbird-accounts-${stamp}.tbaccount`,
        saveAs: true,
      });
      return { ok: true, count: cfg.accounts.length };
    }
    case "openPlan": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(msg.json);
      } catch (e) {
        return { ok: false, error: "invalid_json" };
      }
      const v = validatePortable(parsed);
      if (!v.ok) return { ok: false, error: v.message ?? "invalid" };
      currentConfig = parsed as PortableAccountConfig;
      currentPlan = await planImport(adapter, currentConfig);
      return {
        ok: true,
        summary: currentPlan.summary,
        items: currentPlan.items.map((i) => ({
          index: i.index,
          status: i.status,
          incomingName: i.incoming.name,
          incomingEmail: i.incoming.identities.find((x) => x.default)?.email
            ?? i.incoming.identities[0]?.email ?? "",
          differences: i.differences,
          reason: i.reason,
        })),
      };
    }
    case "openPlanFromWatched": {
      const settings = await getSettings();
      if (!settings.path) return { ok: false, error: "watch_disabled" };
      let file: any = null;
      try {
        file = await browser.portableAccountConfig.readWatchedFile(settings.path);
      } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
      }
      if (!file) return { ok: false, error: "not_found" };
      return await handle({ kind: "openPlan", json: file.text });
    }
    case "runImport": {
      if (!currentPlan) return { ok: false, error: "no_plan" };
      const decisions = new Map<number, ItemDecision>(msg.decisions);
      const result = await executeImport(adapter, currentPlan, decisions);
      return { ok: true, result };
    }
    case "getSettings":
      return { ok: true, settings: await getSettings() };
    case "updateSettings":
      return { ok: true, settings: await updateSettings(msg.patch) };
    case "checkNow":
      return await checkOnce(adapter);
    case "getState":
      return { ok: true, state: await getState(), settings: await getSettings() };
    case "isOnboarded":
      return { ok: true, onboarded: await isOnboarded() };
    case "markOnboarded":
      await markOnboarded();
      return { ok: true };
  }
}

browser.runtime.onMessage.addListener((msg: unknown) => handle(msg as Message));

// Bootstrap: install watcher alarm + notification handlers, and wire up
// (optional) auto-export listeners. Both are inert unless the user enables
// them via the settings UI.
installWatcher(adapter);
installAutoExport(adapter);
