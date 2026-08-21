/**
 * Portable Thunderbird Account Configuration — data model (v1).
 *
 * This model is intentionally decoupled from the internal Thunderbird
 * representation. It contains only the semantic properties needed to
 * re-create an equivalent account on any platform.
 *
 * See: Feature Specification §15 and §26 (stable abstraction layer).
 */

export const PORTABLE_FORMAT = "thunderbird-portable-account-config" as const;
export const PORTABLE_VERSION = 1 as const;

export type SocketType = "plain" | "starttls" | "ssl";

/**
 * Authentication method as reported by Thunderbird. We keep the raw string
 * (e.g. "password", "oauth2", "gssapi") without interpreting it. Tokens are
 * never exported (see §7).
 */
export type Authentication = string;

export type AccountType =
  | "imap"
  | "pop3"
  | "ews"
  | "nntp"
  | "rss"
  | "none"
  | "unsupported";

export interface IncomingServer {
  hostname: string;
  port: number;
  username: string;
  security: SocketType;
  authentication: Authentication;
  /** Optional URL for EWS accounts (only meaningful for type "ews"). */
  ewsUrl?: string;
}

export type SignatureFormat = "plain" | "html";

export interface Identity {
  fullName: string;
  email: string;
  replyTo: string;
  organization: string;
  /**
   * Inline signature content. If Thunderbird stores the signature as a file
   * (sig_file), its content is embedded here — the path itself is never
   * exported (see §17, and Decisions/Signaturen).
   */
  signature: string;
  signatureFormat: SignatureFormat;
  default: boolean;
  /** Reference to an entry in the top-level `smtpServers` array by `id`. */
  smtpServer: string | null;
}

export interface PortableAccount {
  name: string;
  type: AccountType;
  incoming: IncomingServer;
  identities: Identity[];
  /**
   * Set to a human-readable reason when the source account uses a type or
   * feature that cannot be represented portably. Consumers should skip such
   * accounts during import (§3).
   */
  unsupportedReason?: string;
}

export interface PortableSmtpServer {
  /** Stable, export-local ID referenced from identities. */
  id: string;
  hostname: string;
  port: number;
  username: string;
  security: SocketType;
  authentication: Authentication;
}

export interface PortableAccountConfig {
  format: typeof PORTABLE_FORMAT;
  version: typeof PORTABLE_VERSION;
  /** ISO-8601 timestamp. */
  exportedAt: string;
  accounts: PortableAccount[];
  smtpServers: PortableSmtpServer[];
}
