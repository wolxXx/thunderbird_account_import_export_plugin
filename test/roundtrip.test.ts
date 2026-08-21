/**
 * §23 round-trip invariant:
 *   export(import(export(x))) ≈ export(x)
 *
 * Internal identifiers (native ids, SMTP native keys, exportedAt) may
 * differ; every other semantic property must be preserved.
 */
import { exportAccounts, serialize } from "../src/core/export";
import { executeImport, planImport } from "../src/core/import";
import { InMemoryThunderbirdAdapter } from "../src/adapter/memory";
import { makeAccount, makeSmtp, seededAdapter } from "./fixtures";
import type { PortableAccountConfig } from "../src/model/portable";

const fixedNow = () => new Date("2026-08-19T12:00:00.000Z");

/** Strip fields that are allowed to differ per §23. */
function canonical(cfg: PortableAccountConfig) {
  const { exportedAt: _e, smtpServers, ...rest } = cfg;
  // SMTP ids are renumbered by the exporter (smtp-1, smtp-2, ...) — since
  // the source only has one SMTP server here, the ids will match, but we
  // still strip them to be safe against reordering.
  return {
    ...rest,
    smtpServers: smtpServers.map(({ id: _id, ...s }) => s),
    accounts: rest.accounts.map((a) => ({
      ...a,
      identities: a.identities.map(({ smtpServer: _s, ...i }) => i),
    })),
  };
}

describe("round-trip", () => {
  it("preserves semantic content for a multi-account export", async () => {
    const source = await seededAdapter(
      [
        makeAccount(),
        makeAccount({
          name: "Second",
          incoming: {
            hostname: "imap2.example.com", port: 993, username: "u2@example.com",
            security: "starttls", authentication: "password",
          },
          identities: [
            {
              fullName: "User Two", email: "u2@example.com",
              replyTo: "reply@example.com", organization: "Acme",
              signature: "-- \\nBest,\\nU2", signatureFormat: "plain",
              default: true, smtpServer: "smtp-2",
            },
          ],
        }),
      ],
      [
        makeSmtp(),
        makeSmtp({ id: "smtp-2", hostname: "smtp2.example.com", username: "u2@example.com" }),
      ],
    );

    const firstExport = await exportAccounts(source, { now: fixedNow });
    const firstJson = serialize(firstExport);

    // Import into a fresh Thunderbird instance.
    const target = new InMemoryThunderbirdAdapter();
    const parsed = JSON.parse(firstJson) as PortableAccountConfig;
    const plan = await planImport(target, parsed);
    const result = await executeImport(target, plan, new Map());
    expect(result.imported).toBe(2);
    expect(result.failed).toHaveLength(0);

    // Re-export from the fresh Thunderbird.
    const secondExport = await exportAccounts(target, { now: fixedNow });

    expect(canonical(secondExport)).toEqual(canonical(firstExport));
  });

  it("second import over the same target is a no-op (all identical)", async () => {
    const source = await seededAdapter([makeAccount()]);
    const cfg = await exportAccounts(source, { now: fixedNow });
    const target = new InMemoryThunderbirdAdapter();

    let plan = await planImport(target, cfg);
    await executeImport(target, plan, new Map());

    plan = await planImport(target, cfg);
    expect(plan.summary.identical).toBe(1);
    expect(plan.summary.new).toBe(0);
    const second = await executeImport(target, plan, new Map());
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
  });
});
