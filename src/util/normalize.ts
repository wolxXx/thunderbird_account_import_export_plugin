/**
 * Normalization helpers used for duplicate detection during import (§9).
 *
 * Per Decisions/Konflikt-Matching-Toleranz: `trim` + `toLowerCase` for
 * email/hostname/username. Applied only inside the matcher — the exported
 * data itself keeps the original casing.
 */

import type { PortableAccount } from "../model/portable.js";

export function norm(s: string): string {
  return s.trim().toLowerCase();
}

export interface MatchKey {
  type: string;
  email: string;
  hostname: string;
  username: string;
}

/**
 * Build the normalized match key for an account.
 *
 * If the account has no identities, `email` falls back to the empty string.
 * The default identity is preferred; otherwise the first identity is used.
 */
export function matchKey(a: PortableAccount): MatchKey {
  const identity =
    a.identities.find((i) => i.default) ?? a.identities[0];
  const email = identity ? norm(identity.email) : "";
  return {
    type: a.type,
    email,
    hostname: norm(a.incoming.hostname),
    username: norm(a.incoming.username),
  };
}

export function matchKeyEquals(a: MatchKey, b: MatchKey): boolean {
  return (
    a.type === b.type &&
    a.email === b.email &&
    a.hostname === b.hostname &&
    a.username === b.username
  );
}
