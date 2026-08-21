/**
 * Import pipeline: JSON → validated portable model → plan → execute.
 *
 * The pipeline is split in two phases so the UI can show a preview (§12)
 * and collect user decisions (§10, §11) before any account is touched:
 *
 *   1. `planImport(adapter, cfg)` — no side effects. Compares each portable
 *      account with existing native accounts and classifies it as:
 *        - "new"          (Fall A)
 *        - "identical"    (Fall B)
 *        - "conflict"     (Fall C, with field-level diff)
 *        - "unsupported"  (§14)
 *   2. `executeImport(adapter, plan, decisions)` — applies the user's
 *      decisions transactionally per account (§13): failures on one account
 *      never leave another account half-created; other accounts continue.
 */

import type {
  PortableAccount,
  PortableAccountConfig,
  PortableSmtpServer,
} from "../model/portable.js";
import type {
  NativeAccount,
  ThunderbirdAdapter,
} from "../adapter/thunderbird.js";
import { matchKey, matchKeyEquals } from "../util/normalize.js";

export type ItemStatus = "new" | "identical" | "conflict" | "unsupported";

export interface FieldDiff {
  path: string;
  existing: unknown;
  incoming: unknown;
}

export interface PlanItem {
  /** Index of the account inside `cfg.accounts`. */
  index: number;
  status: ItemStatus;
  incoming: PortableAccount;
  /** Existing account, if a duplicate was detected. */
  existing?: NativeAccount;
  /** Field-level differences, populated only when status === "conflict". */
  differences: FieldDiff[];
  /** Human-readable reason when status === "unsupported". */
  reason?: string;
}

export interface ImportPlan {
  items: PlanItem[];
  /** SMTP servers, indexed by their portable `id` for fast lookup. */
  smtpByRef: Map<string, PortableSmtpServer>;
  summary: { total: number; new: number; identical: number; conflict: number; unsupported: number };
}

export type ItemDecision =
  | { kind: "skip" }
  | { kind: "create" }
  | { kind: "update" };

export interface ExecuteResult {
  imported: number;
  updated: number;
  skipped: number;
  failed: { index: number; error: string }[];
}

/**
 * Compute the field-level diff between an incoming portable account and an
 * existing native account. Only semantically comparable fields are included;
 * ordering of `identities` is compared by matching on email address rather
 * than array position, so that a re-ordered identity list doesn't produce a
 * spurious conflict.
 */
function diffAccount(
  existing: NativeAccount,
  incoming: PortableAccount,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const cmp = (path: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push({ path, existing: a, incoming: b });
    }
  };
  cmp("name", existing.name, incoming.name);
  cmp("type", existing.type, incoming.type);
  cmp("incoming.hostname", existing.incoming.hostname, incoming.incoming.hostname);
  cmp("incoming.port", existing.incoming.port, incoming.incoming.port);
  cmp("incoming.username", existing.incoming.username, incoming.incoming.username);
  cmp("incoming.security", existing.incoming.security, incoming.incoming.security);
  cmp("incoming.authentication", existing.incoming.authentication, incoming.incoming.authentication);

  // Identity comparison keyed by lowercased email.
  const byEmail = new Map(
    existing.identities.map((i) => [i.email.trim().toLowerCase(), i]),
  );
  for (const ii of incoming.identities) {
    const key = ii.email.trim().toLowerCase();
    const ei = byEmail.get(key);
    if (!ei) {
      diffs.push({ path: `identities[${ii.email}]`, existing: undefined, incoming: ii });
      continue;
    }
    cmp(`identities[${ii.email}].fullName`, ei.fullName, ii.fullName);
    cmp(`identities[${ii.email}].replyTo`, ei.replyTo, ii.replyTo);
    cmp(`identities[${ii.email}].organization`, ei.organization, ii.organization);
    cmp(`identities[${ii.email}].signature`, ei.signature, ii.signature);
    cmp(`identities[${ii.email}].signatureFormat`, ei.signatureFormat, ii.signatureFormat);
    cmp(`identities[${ii.email}].default`, ei.default, ii.default);
    byEmail.delete(key);
  }
  for (const [email, ei] of byEmail) {
    diffs.push({ path: `identities[${email}]`, existing: ei, incoming: undefined });
  }
  return diffs;
}

export async function planImport(
  adapter: ThunderbirdAdapter,
  cfg: PortableAccountConfig,
): Promise<ImportPlan> {
  const existing = await adapter.listAccounts();
  const existingKeys = existing.map((a) => ({ acct: a, key: matchKey(a) }));

  const smtpByRef = new Map<string, PortableSmtpServer>();
  for (const s of cfg.smtpServers) smtpByRef.set(s.id, s);

  const items: PlanItem[] = cfg.accounts.map((incoming, index) => {
    if (incoming.type === "unsupported" || incoming.unsupportedReason) {
      return {
        index,
        status: "unsupported",
        incoming,
        differences: [],
        reason: incoming.unsupportedReason ?? "unsupported_account_type",
      };
    }
    const key = matchKey(incoming);
    const match = existingKeys.find((e) => matchKeyEquals(e.key, key));
    if (!match) {
      return { index, status: "new", incoming, differences: [] };
    }
    const differences = diffAccount(match.acct, incoming);
    return {
      index,
      status: differences.length === 0 ? "identical" : "conflict",
      incoming,
      existing: match.acct,
      differences,
    };
  });

  const summary = {
    total: items.length,
    new: items.filter((i) => i.status === "new").length,
    identical: items.filter((i) => i.status === "identical").length,
    conflict: items.filter((i) => i.status === "conflict").length,
    unsupported: items.filter((i) => i.status === "unsupported").length,
  };

  return { items, smtpByRef, summary };
}

/**
 * Default decision policy per §10 / §11:
 *   - new         → create
 *   - identical   → skip
 *   - conflict    → skip (user must decide explicitly)
 *   - unsupported → skip
 */
export function defaultDecision(item: PlanItem): ItemDecision {
  switch (item.status) {
    case "new":
      return { kind: "create" };
    case "identical":
    case "conflict":
    case "unsupported":
      return { kind: "skip" };
  }
}

export async function executeImport(
  adapter: ThunderbirdAdapter,
  plan: ImportPlan,
  decisions: Map<number, ItemDecision>,
): Promise<ExecuteResult> {
  const result: ExecuteResult = { imported: 0, updated: 0, skipped: 0, failed: [] };

  for (const item of plan.items) {
    const decision = decisions.get(item.index) ?? defaultDecision(item);
    try {
      if (decision.kind === "skip") {
        result.skipped += 1;
        continue;
      }
      if (decision.kind === "update") {
        if (!item.existing) throw new Error("cannot_update_without_existing");
        await adapter.updateAccount(item.existing.nativeId, item.incoming, plan.smtpByRef);
        result.updated += 1;
        continue;
      }
      // "create" (either new, or user chose "import as new" for a conflict).
      await adapter.createAccount(item.incoming, plan.smtpByRef);
      result.imported += 1;
    } catch (err) {
      result.failed.push({
        index: item.index,
        error: err instanceof Error ? err.message : String(err),
      });
      // §13: do not abort the whole import — continue with next account.
    }
  }

  return result;
}
