import { exportAccounts, serialize } from "../src/core/export";
import { validatePortable } from "../src/io/validate";
import { PORTABLE_FORMAT, PORTABLE_VERSION } from "../src/model/portable";
import { makeAccount, makeSmtp, seededAdapter } from "./fixtures";

describe("exportAccounts", () => {
  const fixedNow = () => new Date("2026-08-19T12:00:00.000Z");

  it("exports a single IMAP account with linked SMTP", async () => {
    const adapter = await seededAdapter([makeAccount()]);
    const cfg = await exportAccounts(adapter, { now: fixedNow });
    expect(cfg.format).toBe(PORTABLE_FORMAT);
    expect(cfg.version).toBe(PORTABLE_VERSION);
    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.smtpServers).toHaveLength(1);
    expect(cfg.smtpServers[0].id).toMatch(/^smtp-\d+$/);
    expect(cfg.accounts[0].identities[0].smtpServer).toBe(cfg.smtpServers[0].id);
  });

  it("produces schema-valid JSON", async () => {
    const adapter = await seededAdapter([
      makeAccount(),
      makeAccount({
        name: "Second",
        incoming: {
          hostname: "imap2.example.com", port: 993, username: "second@example.com",
          security: "starttls", authentication: "password",
        },
        identities: [{
          fullName: "Second", email: "second@example.com",
          replyTo: "", organization: "",
          signature: "", signatureFormat: "plain",
          default: true, smtpServer: "smtp-1",
        }],
      }),
    ]);
    const cfg = await exportAccounts(adapter, { now: fixedNow });
    const json = serialize(cfg);
    const parsed = JSON.parse(json);
    expect(validatePortable(parsed).ok).toBe(true);
    // deterministic top-level shape
    expect(json.endsWith("\n")).toBe(true);
  });

  it("does not leak passwords or tokens", async () => {
    const adapter = await seededAdapter([makeAccount()]);
    const json = serialize(await exportAccounts(adapter, { now: fixedNow }));
    expect(json.toLowerCase()).not.toContain("password:");
    expect(json).not.toContain("oauth_token");
    // The only appearance of "password" allowed is as authentication method value.
    for (const match of json.matchAll(/"([^"]*password[^"]*)"/g)) {
      expect(match[1]).toBe("password");
    }
  });

  it("restricts export to selected native ids", async () => {
    const adapter = await seededAdapter([
      makeAccount(),
      makeAccount({ name: "Other", identities: [
        { fullName: "Other", email: "other@example.com",
          replyTo: "", organization: "",
          signature: "", signatureFormat: "plain",
          default: true, smtpServer: null },
      ]}),
    ]);
    const all = await adapter.listAccounts();
    const only = await exportAccounts(adapter, {
      now: fixedNow,
      onlyNativeIds: [all[0].nativeId],
    });
    expect(only.accounts).toHaveLength(1);
    expect(only.accounts[0].name).toBe("Firma");
  });

  it("skips SMTP servers not referenced by exported accounts", async () => {
    const adapter = await seededAdapter([
      makeAccount({ identities: [{
        fullName: "X", email: "x@example.com",
        replyTo: "", organization: "",
        signature: "", signatureFormat: "plain",
        default: true, smtpServer: null,
      }]}),
    ], [makeSmtp()]);
    const cfg = await exportAccounts(adapter, { now: fixedNow });
    expect(cfg.smtpServers).toHaveLength(0);
  });
});
