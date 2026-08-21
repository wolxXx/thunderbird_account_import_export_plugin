/**
 * Export pipeline: Thunderbird adapter → portable model → JSON string.
 *
 * The adapter is expected to already return accounts in portable shape,
 * with native SMTP-server ids in `identity.smtpServer`. This module:
 *
 *  - Optionally filters accounts by native id (§20, UI can restrict export).
 *  - Renumbers SMTP references to stable export-local ids (`smtp-1`,
 *    `smtp-2`, ...) so exports are deterministic and don't leak internal
 *    Thunderbird ids (§2).
 *  - Emits a `PortableAccountConfig` with the current timestamp.
 */

import {
  PORTABLE_FORMAT,
  PORTABLE_VERSION,
  type PortableAccount,
  type PortableAccountConfig,
  type PortableSmtpServer,
} from "../model/portable.js";
import type {
  NativeAccount,
  NativeSmtpServer,
  ThunderbirdAdapter,
} from "../adapter/thunderbird.js";

export interface ExportOptions {
  /** Restrict export to accounts with these native ids. */
  onlyNativeIds?: string[];
  /** Override the timestamp (mainly for reproducible tests). */
  now?: () => Date;
}

/**
 * Strip the internal `nativeId` and rewrite SMTP references to portable ids.
 */
function stripNative(
  account: NativeAccount,
  nativeToRef: Map<string, string>,
): PortableAccount {
  const { nativeId: _nativeId, ...portable } = account;
  return {
    ...portable,
    identities: account.identities.map((id) => ({
      ...id,
      smtpServer: id.smtpServer
        ? nativeToRef.get(id.smtpServer) ?? null
        : null,
    })),
  };
}

export async function exportAccounts(
  adapter: ThunderbirdAdapter,
  options: ExportOptions = {},
): Promise<PortableAccountConfig> {
  const allAccounts = await adapter.listAccounts();
  const selected = options.onlyNativeIds
    ? allAccounts.filter((a) => options.onlyNativeIds!.includes(a.nativeId))
    : allAccounts;

  const allSmtp = await adapter.listSmtpServers();

  // Collect only SMTP servers actually referenced by exported identities.
  const referencedNativeIds = new Set<string>();
  for (const acc of selected) {
    for (const id of acc.identities) {
      if (id.smtpServer) referencedNativeIds.add(id.smtpServer);
    }
  }

  const nativeToRef = new Map<string, string>();
  const smtpServers: PortableSmtpServer[] = [];
  let counter = 0;
  for (const native of allSmtp) {
    if (!referencedNativeIds.has(native.nativeId)) continue;
    counter += 1;
    const refId = `smtp-${counter}`;
    nativeToRef.set(native.nativeId, refId);
    const { nativeId: _n, ...portable } = native as NativeSmtpServer;
    smtpServers.push({ ...portable, id: refId });
  }

  const accounts = selected.map((a) => stripNative(a, nativeToRef));

  const now = (options.now ?? (() => new Date()))();
  return {
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    exportedAt: now.toISOString(),
    accounts,
    smtpServers,
  };
}

/**
 * Serialize a portable configuration to pretty-printed JSON with a trailing
 * newline — a stable, diff-friendly representation.
 */
export function serialize(cfg: PortableAccountConfig): string {
  return JSON.stringify(cfg, null, 2) + "\n";
}
