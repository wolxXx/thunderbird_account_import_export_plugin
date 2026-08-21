/**
 * Adapter interface between Thunderbird's runtime API and the portable model.
 *
 * Following §26 of the specification, this is the single stable seam:
 * everything above (export/import logic, UI, tests) depends on this
 * interface, and only the concrete implementation talks to
 * `messenger.accounts` / the WebExtension experiment.
 *
 * Two implementations live side-by-side:
 *  - `WebExtensionThunderbirdAdapter` (src/adapter/webext.ts) — used at
 *    runtime inside Thunderbird.
 *  - `InMemoryThunderbirdAdapter` (src/adapter/memory.ts) — used by unit
 *    tests and for the round-trip invariant test (§23).
 */

import type {
  PortableAccount,
  PortableSmtpServer,
} from "../model/portable.js";

/**
 * A native (Thunderbird-side) account, already normalized into the portable
 * shape. `nativeId` is the opaque runtime identifier used to update or delete
 * the account; it is never exported.
 */
export interface NativeAccount extends PortableAccount {
  nativeId: string;
}

export interface NativeSmtpServer extends PortableSmtpServer {
  nativeId: string;
}

/**
 * Result of a create-or-update operation. `nativeId` is the id of the
 * account after the operation.
 */
export interface WriteResult {
  nativeId: string;
}

export interface ThunderbirdAdapter {
  /** List all existing accounts, in portable form. */
  listAccounts(): Promise<NativeAccount[]>;

  /** List all SMTP servers referenced by any identity, in portable form. */
  listSmtpServers(): Promise<NativeSmtpServer[]>;

  /**
   * Create a new account with the given portable configuration.
   *
   * Implementations SHOULD refuse to create accounts of type "unsupported"
   * or types the running Thunderbird does not support, and surface a clear
   * error message (§14).
   */
  createAccount(
    account: PortableAccount,
    smtpByRef: Map<string, PortableSmtpServer>,
  ): Promise<WriteResult>;

  /**
   * Update the configuration of an existing account in place.
   *
   * `nativeId` identifies the target account. The passed `account` provides
   * the new desired configuration. Identity list and SMTP references may
   * change; passwords are never touched.
   */
  updateAccount(
    nativeId: string,
    account: PortableAccount,
    smtpByRef: Map<string, PortableSmtpServer>,
  ): Promise<WriteResult>;
}
