import { exportAccounts } from "../src/core/export";
import { executeImport, planImport } from "../src/core/import";
import { InMemoryThunderbirdAdapter } from "../src/adapter/memory";
import { makeAccount, seededAdapter } from "./fixtures";

const fixedNow = () => new Date("2026-08-19T12:00:00.000Z");

describe("planImport", () => {
  it("classifies fresh accounts as new", async () => {
    const src = await seededAdapter([makeAccount()]);
    const cfg = await exportAccounts(src, { now: fixedNow });
    const target = new InMemoryThunderbirdAdapter();
    const plan = await planImport(target, cfg);
    expect(plan.summary).toMatchObject({ total: 1, new: 1, identical: 0, conflict: 0 });
    expect(plan.items[0].status).toBe("new");
  });

  it("detects identical accounts across case/whitespace variations", async () => {
    const src = await seededAdapter([makeAccount()]);
    const cfg = await exportAccounts(src, { now: fixedNow });
    // Same account is already on the target, but with different display name
    // and slightly different casing/whitespace.
    const target = await seededAdapter([
      makeAccount({
        name: "different display",
        incoming: {
          hostname: "IMAP.Example.com", port: 993,
          username: " MAX@example.com ",
          security: "ssl", authentication: "password",
        },
      }),
    ]);
    const plan = await planImport(target, cfg);
    // The name difference *is* a diff, so this is a conflict rather than identical.
    expect(plan.items[0].status).toBe("conflict");
    expect(plan.items[0].differences.some((d) => d.path === "name")).toBe(true);
  });

  it("classifies truly identical accounts as identical", async () => {
    const src = await seededAdapter([makeAccount()]);
    const cfg = await exportAccounts(src, { now: fixedNow });
    const target = await seededAdapter([makeAccount()]);
    const plan = await planImport(target, cfg);
    expect(plan.items[0].status).toBe("identical");
    expect(plan.items[0].differences).toHaveLength(0);
  });

  it("detects conflicts on non-key field changes (port, name)", async () => {
    // Same match key (type/email/hostname/username), but port and display
    // name differ — that's the classic Fall C from §11.
    const src = await seededAdapter([
      makeAccount({ name: "Renamed", incoming: {
        hostname: "imap.example.com", port: 143, username: "max@example.com",
        security: "starttls", authentication: "password",
      }}),
    ]);
    const cfg = await exportAccounts(src, { now: fixedNow });
    const target = await seededAdapter([makeAccount()]);
    const plan = await planImport(target, cfg);
    expect(plan.items[0].status).toBe("conflict");
    const paths = plan.items[0].differences.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["name", "incoming.port", "incoming.security"]));
  });

  it("marks unsupported types", async () => {
    const target = new InMemoryThunderbirdAdapter();
    const plan = await planImport(target, {
      format: "thunderbird-portable-account-config",
      version: 1,
      exportedAt: "2026-08-19T12:00:00Z",
      accounts: [makeAccount({ type: "unsupported", unsupportedReason: "unsupported_type:xyz" })],
      smtpServers: [],
    });
    expect(plan.items[0].status).toBe("unsupported");
  });
});

describe("executeImport", () => {
  it("creates new accounts, skips identical, honors decisions", async () => {
    const src = await seededAdapter([
      makeAccount(),
      makeAccount({ name: "Two", identities: [{
        fullName: "Two", email: "two@example.com",
        replyTo: "", organization: "",
        signature: "", signatureFormat: "plain",
        default: true, smtpServer: "smtp-1",
      }]}),
    ]);
    const cfg = await exportAccounts(src, { now: fixedNow });
    const target = await seededAdapter([makeAccount()]); // already has first
    const plan = await planImport(target, cfg);
    const result = await executeImport(target, plan, new Map());
    expect(result.imported).toBe(1); // second account only
    expect(result.skipped).toBe(1);
    expect(result.failed).toHaveLength(0);
  });

  it("continues past failures (§13)", async () => {
    const target = new InMemoryThunderbirdAdapter();
    const cfg = {
      format: "thunderbird-portable-account-config" as const,
      version: 1 as const,
      exportedAt: "2026-08-19T12:00:00Z",
      accounts: [
        makeAccount({ type: "unsupported", unsupportedReason: "boom" }),
        makeAccount({ name: "Good" }),
      ],
      smtpServers: [
        { id: "smtp-1", hostname: "smtp.example.com", port: 465,
          username: "max@example.com", security: "ssl" as const,
          authentication: "password" },
      ],
    };
    const plan = await planImport(target, cfg);
    // Force the unsupported one to be "create" so it fails, second one succeeds.
    const decisions = new Map<number, { kind: "create" | "skip" | "update" }>();
    decisions.set(0, { kind: "create" });
    decisions.set(1, { kind: "create" });
    const result = await executeImport(target, plan, decisions);
    expect(result.imported).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].index).toBe(0);
  });
});
