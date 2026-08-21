/**
 * Test fixtures: builders for portable accounts and pre-populated adapters.
 * Keeping them separate keeps individual test files short and focused.
 */

import type {
  PortableAccount,
  PortableSmtpServer,
} from "../src/model/portable.js";
import { InMemoryThunderbirdAdapter } from "../src/adapter/memory.js";

export function makeSmtp(overrides: Partial<PortableSmtpServer> = {}): PortableSmtpServer {
  return {
    id: "smtp-1",
    hostname: "smtp.example.com",
    port: 465,
    username: "max@example.com",
    security: "ssl",
    authentication: "password",
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<PortableAccount> = {}): PortableAccount {
  return {
    name: "Firma",
    type: "imap",
    incoming: {
      hostname: "imap.example.com",
      port: 993,
      username: "max@example.com",
      security: "ssl",
      authentication: "password",
    },
    identities: [
      {
        fullName: "Max Mustermann",
        email: "max@example.com",
        replyTo: "",
        organization: "",
        signature: "",
        signatureFormat: "plain",
        default: true,
        smtpServer: "smtp-1",
      },
    ],
    ...overrides,
  };
}

export async function seededAdapter(
  accounts: PortableAccount[],
  smtp: PortableSmtpServer[] = [makeSmtp()],
): Promise<InMemoryThunderbirdAdapter> {
  const adapter = new InMemoryThunderbirdAdapter();
  const smtpByRef = new Map(smtp.map((s) => [s.id, s]));
  for (const a of accounts) {
    await adapter.createAccount(a, smtpByRef);
  }
  return adapter;
}
