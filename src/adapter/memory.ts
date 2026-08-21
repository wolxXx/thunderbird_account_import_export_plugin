/**
 * In-memory implementation of `ThunderbirdAdapter` for tests.
 *
 * Behaves like a tiny Thunderbird: keeps arrays of accounts and SMTP
 * servers, assigns opaque native ids, and lets tests round-trip a portable
 * configuration through export → import → export without touching a real
 * runtime.
 */

import type {
  PortableAccount,
  PortableSmtpServer,
} from "../model/portable.js";
import type {
  NativeAccount,
  NativeSmtpServer,
  ThunderbirdAdapter,
  WriteResult,
} from "./thunderbird.js";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * Clone the portable identities and rewrite `smtpServer` references so they
 * point to the local (native) SMTP server ids of this adapter instance.
 */
function relinkIdentities(
  account: PortableAccount,
  smtpByRef: Map<string, PortableSmtpServer>,
  refToNative: Map<string, string>,
): PortableAccount["identities"] {
  return account.identities.map((id) => ({
    ...id,
    smtpServer: id.smtpServer
      ? refToNative.get(id.smtpServer) ??
        // If the referenced SMTP wasn't materialized (e.g. missing from
        // `smtpByRef`), we keep the original ref so the failure is visible.
        id.smtpServer
      : null,
  }));
}

export class InMemoryThunderbirdAdapter implements ThunderbirdAdapter {
  private accounts: NativeAccount[] = [];
  private smtpServers: NativeSmtpServer[] = [];

  async listAccounts(): Promise<NativeAccount[]> {
    // Return deep copies so callers can't mutate internal state.
    return this.accounts.map((a) => structuredClone(a));
  }

  async listSmtpServers(): Promise<NativeSmtpServer[]> {
    return this.smtpServers.map((s) => structuredClone(s));
  }

  /**
   * Materialize the SMTP servers referenced by `account` and return a map
   * from portable ref-id → native SMTP id, creating servers as needed.
   *
   * SMTP servers are deduplicated by (hostname, port, username, security):
   * if an equivalent server already exists it is reused instead of creating
   * a duplicate — matching Thunderbird's own behavior.
   */
  private ensureSmtpServers(
    account: PortableAccount,
    smtpByRef: Map<string, PortableSmtpServer>,
  ): Map<string, string> {
    const refToNative = new Map<string, string>();
    for (const identity of account.identities) {
      const ref = identity.smtpServer;
      if (!ref || refToNative.has(ref)) continue;
      const src = smtpByRef.get(ref);
      if (!src) continue;
      const existing = this.smtpServers.find(
        (s) =>
          s.hostname.toLowerCase() === src.hostname.toLowerCase() &&
          s.port === src.port &&
          s.username.toLowerCase() === src.username.toLowerCase() &&
          s.security === src.security,
      );
      if (existing) {
        refToNative.set(ref, existing.nativeId);
      } else {
        const nativeId = nextId("smtp");
        this.smtpServers.push({
          ...src,
          id: nativeId,
          nativeId,
        });
        refToNative.set(ref, nativeId);
      }
    }
    return refToNative;
  }

  async createAccount(
    account: PortableAccount,
    smtpByRef: Map<string, PortableSmtpServer>,
  ): Promise<WriteResult> {
    if (account.type === "unsupported") {
      throw new Error("cannot_create_unsupported_account");
    }
    const refToNative = this.ensureSmtpServers(account, smtpByRef);
    const nativeId = nextId("acct");
    this.accounts.push({
      ...structuredClone(account),
      identities: relinkIdentities(account, smtpByRef, refToNative),
      nativeId,
    });
    return { nativeId };
  }

  async updateAccount(
    nativeId: string,
    account: PortableAccount,
    smtpByRef: Map<string, PortableSmtpServer>,
  ): Promise<WriteResult> {
    const idx = this.accounts.findIndex((a) => a.nativeId === nativeId);
    if (idx === -1) throw new Error("account_not_found");
    const refToNative = this.ensureSmtpServers(account, smtpByRef);
    this.accounts[idx] = {
      ...structuredClone(account),
      identities: relinkIdentities(account, smtpByRef, refToNative),
      nativeId,
    };
    return { nativeId };
  }
}
