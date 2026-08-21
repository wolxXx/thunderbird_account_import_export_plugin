/**
 * Auto-export skeleton (v3, opt-in).
 *
 * Listens to `messenger.accounts.onCreated/onUpdated/onDeleted` and, after a
 * debounce, re-exports the full portable config into the watched file. This
 * is riskier than one-way pull (race conditions with Nextcloud sync) and is
 * therefore gated behind `WatchSettings.autoExport` and kept intentionally
 * conservative: it writes the entire file atomically, never partial diffs.
 *
 * NOTE: writing to arbitrary filesystem paths currently requires a small
 * `writeWatchedFile` companion in the WebExtension experiment (mirror of
 * `readWatchedFile`, using `IOUtils.write`). It is NOT yet added — this
 * module wires up the event plumbing and debounce so the write path is the
 * only missing puzzle piece.
 */
import type { ThunderbirdAdapter } from "../adapter/thunderbird.js";
import { exportAccounts, serialize } from "../core/export.js";
import { getSettings } from "./watch.js";

declare const browser: any;

const DEBOUNCE_MS = 5_000;
let pending: ReturnType<typeof setTimeout> | null = null;

async function doExport(adapter: ThunderbirdAdapter): Promise<void> {
  const settings = await getSettings();
  if (!settings.enabled || !settings.autoExport || !settings.path) return;

  const cfg = await exportAccounts(adapter);
  const json = serialize(cfg);

  const api = (browser as any).portableAccountConfig;
  if (!api || typeof api.writeWatchedFile !== "function") {
    // Write path not yet available in the experiment — surface once and
    // stop retrying until the user reconfigures.
    console.warn("[portable-account-config] autoExport: writeWatchedFile not implemented");
    return;
  }
  try {
    const res = await api.writeWatchedFile(settings.path, json);
    // Prime the watcher state so our own write does NOT come back as a
    // change notification on the next poll. We only overwrite lastHash /
    // lastMtime, keeping any lastError from a previous read intact.
    try {
      const bag = await browser.storage.local.get("watchState");
      const prev = bag?.watchState ?? {};
      await browser.storage.local.set({
        watchState: {
          ...prev,
          lastHash: (res && res.sha256) || prev.lastHash || "",
          lastMtime: Date.now(),
          lastCheckedAt: Date.now(),
        },
      });
    } catch (_) { /* non-fatal */ }
  } catch (e) {
    console.warn("[portable-account-config] autoExport failed:", e);
  }
}

function schedule(adapter: ThunderbirdAdapter): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void doExport(adapter);
  }, DEBOUNCE_MS);
}

export function installAutoExport(adapter: ThunderbirdAdapter): void {
  const accounts = (browser as any).accounts;
  if (!accounts) return;
  const wire = (evt: any) => {
    if (evt && typeof evt.addListener === "function") {
      evt.addListener(() => schedule(adapter));
    }
  };
  wire(accounts.onCreated);
  wire(accounts.onUpdated);
  wire(accounts.onDeleted);
}
