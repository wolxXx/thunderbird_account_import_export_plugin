import { validatePortable } from "../src/io/validate";
import { PORTABLE_FORMAT, PORTABLE_VERSION } from "../src/model/portable";
import { makeAccount, makeSmtp } from "./fixtures";

const validPayload = () => ({
  format: PORTABLE_FORMAT,
  version: PORTABLE_VERSION,
  exportedAt: "2026-08-19T12:00:00Z",
  accounts: [makeAccount()],
  smtpServers: [makeSmtp()],
});

describe("validatePortable", () => {
  it("accepts a valid v1 export", () => {
    expect(validatePortable(validPayload()).ok).toBe(true);
  });

  it("rejects wrong format string", () => {
    const bad = { ...validPayload(), format: "something-else" };
    const r = validatePortable(bad);
    expect(r.ok).toBe(false);
  });

  it("rejects unknown version", () => {
    const bad = { ...validPayload(), version: 99 };
    const r = validatePortable(bad);
    expect(r.ok).toBe(false);
  });

  it("rejects missing required fields", () => {
    const bad = { ...validPayload() } as Record<string, unknown>;
    delete bad.accounts;
    expect(validatePortable(bad).ok).toBe(false);
  });

  it("rejects arbitrary junk", () => {
    expect(validatePortable({ hello: "world" }).ok).toBe(false);
    expect(validatePortable(null).ok).toBe(false);
    expect(validatePortable(42).ok).toBe(false);
  });
});
