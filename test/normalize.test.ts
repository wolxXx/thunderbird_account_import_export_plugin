import { matchKey, matchKeyEquals, norm } from "../src/util/normalize";
import { makeAccount } from "./fixtures";

describe("normalize", () => {
  it("norm trims and lowercases", () => {
    expect(norm("  MAX@Example.COM ")).toBe("max@example.com");
  });

  it("matchKey uses default identity when present", () => {
    const account = makeAccount({
      identities: [
        {
          fullName: "Second",
          email: "second@example.com",
          replyTo: "", organization: "",
          signature: "", signatureFormat: "plain",
          default: false, smtpServer: null,
        },
        {
          fullName: "Primary",
          email: "primary@example.com",
          replyTo: "", organization: "",
          signature: "", signatureFormat: "plain",
          default: true, smtpServer: null,
        },
      ],
    });
    expect(matchKey(account).email).toBe("primary@example.com");
  });

  it("matchKey normalizes across case and whitespace", () => {
    const a = makeAccount();
    const b = makeAccount({
      name: "different display name",
      incoming: {
        ...a.incoming,
        hostname: "  IMAP.Example.COM  ",
        username: " MAX@example.com ",
      },
      identities: [{ ...a.identities[0], email: "MAX@Example.com" }],
    });
    expect(matchKeyEquals(matchKey(a), matchKey(b))).toBe(true);
  });

  it("matchKey differs when account type differs", () => {
    const a = matchKey(makeAccount({ type: "imap" }));
    const b = matchKey(makeAccount({ type: "pop3" }));
    expect(matchKeyEquals(a, b)).toBe(false);
  });
});
