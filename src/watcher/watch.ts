/**
 * Watch a portable-config file (typically a Nextcloud-synced .tbaccount) and
 * notify / auto-import when it changes.
 *
 * Design (see spec §—v2 extension):
 *   - Settings live in `storage.local` under `watchSettings`.
 *   - A single `browser.alarms` entry ("watch") polls at the configured
 *     interval and fires `checkOnce()`.
 *   - Changes are detected via SHA-256 of the file content, with mtime as
 *     a cheap fast-path. The last-seen hash is persisted so we survive
 *     restarts without spamming the user.
 *   - When new/conflict items appear we either fire a system notification
 *     (default) or auto-import the conflict-free `new` items only, per user
 *     setting. Conflicts NEVER auto-apply — they always require the user.
 */
import type { ThunderbirdAdapter } from "../adapter/thunderbird.js";
import { planImport, executeImport, defaultDecision, type ItemDecision } from "../core/import.js";
import { validatePortable } from "../io/validate.js";
import type { PortableAccountConfig } from "../model/portable.js";

export interface WatchSettings {
  enabled: boolean;
  path: string;
  pollMinutes: number;
  autoImportNew: boolean; // v2: import conflict-free "new" items silently
  autoExport: boolean; // v3 (opt-in): mirror local changes back to file
}

export const DEFAULT_SETTINGS: WatchSettings = {
  enabled: false,
  path: "",
  pollMinutes: 15,
  autoImportNew: false,
  autoExport: false,
};

interface WatchState {
  lastHash: string;
  lastMtime: number;
  lastCheckedAt: number;
  lastError?: string;
}

const ALARM_NAME = "portable-account-config.watch";
const STORAGE_SETTINGS = "watchSettings";
const STORAGE_STATE = "watchState";
const STORAGE_ONBOARDED = "onboarded";

declare const browser: any;

async function loadSettings(): Promise<WatchSettings> {
  const bag = await browser.storage.local.get(STORAGE_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(bag?.[STORAGE_SETTINGS] ?? {}) };
}

async function saveSettings(s: WatchSettings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_SETTINGS]: s });
}

async function loadState(): Promise<WatchState> {
  const bag = await browser.storage.local.get(STORAGE_STATE);
  return { lastHash: "", lastMtime: 0, lastCheckedAt: 0, ...(bag?.[STORAGE_STATE] ?? {}) };
}

async function saveState(s: WatchState): Promise<void> {
  await browser.storage.local.set({ [STORAGE_STATE]: s });
}

export async function getSettings(): Promise<WatchSettings> {
  return loadSettings();
}

export async function getState(): Promise<WatchState> {
  return loadState();
}

export async function isOnboarded(): Promise<boolean> {
  const bag = await browser.storage.local.get(STORAGE_ONBOARDED);
  return Boolean(bag?.[STORAGE_ONBOARDED]);
}

export async function markOnboarded(): Promise<void> {
  await browser.storage.local.set({ [STORAGE_ONBOARDED]: true });
}

/**
 * Persist new settings and re-schedule the alarm accordingly. Passing
 * `enabled:false` (or an empty path) removes the alarm entirely.
 */
export async function updateSettings(patch: Partial<WatchSettings>): Promise<WatchSettings> {
  const current = await loadSettings();
  const next: WatchSettings = { ...current, ...patch };
  await saveSettings(next);
  await rescheduleAlarm(next);
  return next;
}

async function rescheduleAlarm(s: WatchSettings): Promise<void> {
  try {
    await browser.alarms.clear(ALARM_NAME);
  } catch (_) { /* ignore */ }
  if (!s.enabled || !s.path) return;
  const minutes = Math.max(1, Math.floor(s.pollMinutes || 15));
  await browser.alarms.create(ALARM_NAME, {
    // fire once shortly after (re)configuration, then every N minutes
    delayInMinutes: 1,
    periodInMinutes: minutes,
  });
}

/**
 * One poll cycle. Safe to call ad-hoc from the settings page ("Check now").
 * Returns a small summary the UI can render without another round-trip.
 */
export async function checkOnce(
  adapter: ThunderbirdAdapter,
): Promise<{
  ok: boolean;
  changed: boolean;
  summary?: { total: number; new: number; identical: number; conflict: number; unsupported: number };
  autoImported?: number;
  error?: string;
}> {
  const settings = await loadSettings();
  const state = await loadState();
  if (!settings.enabled || !settings.path) {
    return { ok: false, changed: false, error: "watch_disabled" };
  }

  let file: { text: string; mtime: number; sha256: string; size: number } | null;
  try {
    file = await (browser as any).portableAccountConfig.readWatchedFile(settings.path);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await saveState({ ...state, lastCheckedAt: Date.now(), lastError: msg });
    return { ok: false, changed: false, error: msg };
  }
  if (!file) {
    await saveState({ ...state, lastCheckedAt: Date.now(), lastError: "not_found" });
    return { ok: true, changed: false, error: "not_found" };
  }

  const hash = file.sha256 || `mtime:${file.mtime}`;
  if (hash === state.lastHash) {
    await saveState({ ...state, lastCheckedAt: Date.now(), lastError: undefined });
    return { ok: true, changed: false };
  }

  // File changed — parse + validate. Half-written files are common during a
  // Nextcloud sync, so JSON errors are treated as transient (we just wait
  // for the next poll) without clearing lastHash.
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.text);
  } catch (_) {
    await saveState({ ...state, lastCheckedAt: Date.now(), lastError: "invalid_json" });
    return { ok: false, changed: false, error: "invalid_json" };
  }
  const v = validatePortable(parsed);
  if (!v.ok) {
    await saveState({ ...state, lastCheckedAt: Date.now(), lastError: v.message ?? "invalid" });
    return { ok: false, changed: false, error: v.message ?? "invalid" };
  }
  const cfg = parsed as PortableAccountConfig;
  const plan = await planImport(adapter, cfg);

  let autoImported = 0;
  if (settings.autoImportNew && plan.summary.new > 0) {
    const decisions = new Map<number, ItemDecision>();
    for (const item of plan.items) {
      // Only auto-apply conflict-free new accounts.
      if (item.status === "new") decisions.set(item.index, { kind: "create" });
      else decisions.set(item.index, defaultDecision(item));
    }
    const result = await executeImport(adapter, plan, decisions);
    autoImported = result.imported;
  }

  // Persist the new baseline so we don't notify again for the same content.
  await saveState({
    lastHash: hash,
    lastMtime: file.mtime,
    lastCheckedAt: Date.now(),
    lastError: undefined,
  });

  // Notification: fire when there's something the user might care about.
  const notable = plan.summary.new + plan.summary.conflict;
  if (notable > 0 && (!settings.autoImportNew || plan.summary.conflict > 0)) {
    try {
      const title = getMessage("watchNotifyTitle", "Portable Account Configuration");
      const msg =
        `${plan.summary.new} ${getMessage("statusNew", "new")}, ` +
        `${plan.summary.conflict} ${getMessage("statusConflict", "conflict")}`;
      await browser.notifications.create("portable-account-config.change", {
        type: "basic",
        iconUrl: browser.runtime.getURL("icons/icon-32.png"),
        title,
        message: msg,
      });
    } catch (_) { /* notifications may be disabled by the user */ }
  }

  return {
    ok: true,
    changed: true,
    summary: plan.summary,
    autoImported,
  };
}

function getMessage(key: string, fallback: string): string {
  try {
    const s = browser.i18n.getMessage(key);
    return s || fallback;
  } catch (_) {
    return fallback;
  }
}

/**
 * Wire up alarm + notification-click handlers. Call once from background
 * bootstrap. Idempotent per event page load.
 */
export function installWatcher(adapter: ThunderbirdAdapter): void {
  browser.alarms.onAlarm.addListener(async (alarm: { name: string }) => {
    if (alarm.name !== ALARM_NAME) return;
    try { await checkOnce(adapter); } catch (_) { /* swallow — reported via state */ }
  });

  browser.notifications.onClicked.addListener(async (id: string) => {
    if (id !== "portable-account-config.change") return;
    try { await browser.notifications.clear(id); } catch (_) {}
    await browser.tabs.create({
      url: browser.runtime.getURL("ui/import.html?source=watched"),
    });
  });

  // Re-establish the alarm on startup / reload so the poller survives
  // Thunderbird restarts.
  void (async () => {
    const s = await loadSettings();
    await rescheduleAlarm(s);
  })();
}
