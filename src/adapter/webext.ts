/**
 * WebExtension implementation of `ThunderbirdAdapter`.
 *
 * Reads accounts/identities via the official `messenger.accounts` API and
 * delegates SMTP-server access, account creation, and reading of on-disk
 * signature files to our small WebExtension experiment (see
 * `experiment/implementation.js` and `experiment/schema.json`).
 *
 * Everything that is not yet available in the official MV3 API for TB 128
 * ESR must go through `messenger.portableAccountConfig.*` (the experiment).
 * The exact call surface of the experiment is intentionally minimal so it
 * can be replaced by official APIs as they land.
 */

import type {
  PortableAccount,
  PortableSmtpServer,
  SocketType,
  AccountType,
  Identity,
} from "../model/portable.js";
import type {
  NativeAccount,
  NativeSmtpServer,
  ThunderbirdAdapter,
  WriteResult,
} from "./thunderbird.js";

// Minimal ambient declarations. The real `messenger` global is provided by
// Thunderbird at runtime; we deliberately do not depend on `@types/thunderbird`
// packages here.
declare const messenger: {
  accounts: {
    list(includeSubFolders?: boolean): Promise<TbAccount[]>;
  };
  portableAccountConfig: {
    listSmtpServers(): Promise<TbSmtpServer[]>;
    getIncomingServer(accountKey: string): Promise<{
      hostname: string;
      port: number;
      username: string;
      socketType?: string;
      authMethod?: string | number;
      ewsUrl?: string;
      type?: string;
    } | null>;
    readSignatureFile(identityId: string): Promise<{ content: string; format: "plain" | "html" } | null>;
    createAccount(spec: unknown): Promise<{ nativeId: string }>;
    updateAccount(nativeId: string, spec: unknown): Promise<{ nativeId: string }>;
  };
};

interface TbIdentity {
  id: string;
  name?: string;
  email?: string;
  replyTo?: string;
  organization?: string;
  signature?: string;
  signatureIsPlainText?: boolean;
  /** Whether Thunderbird stores the signature in a file (sig_file). */
  signatureUsesFile?: boolean;
  smtpServerId?: string | null;
}

interface TbAccount {
  id: string;
  name: string;
  type: string;
  identities: TbIdentity[];
  defaultIdentityId?: string;
  incomingServer?: {
    hostname: string;
    port: number;
    username: string;
    socketType?: string;
    authMethod?: string | number;
    ewsUrl?: string;
  };
}

interface TbSmtpServer {
  id: string;
  hostname: string;
  port: number;
  username: string;
  socketType?: string;
  authMethod?: string | number;
}

function toSocketType(v: string | undefined): SocketType {
  switch ((v ?? "").toLowerCase()) {
    case "ssl":
    case "ssl/tls":
      return "ssl";
    case "starttls":
      return "starttls";
    default:
      return "plain";
  }
}

function toAccountType(v: string): AccountType {
  const t = v.toLowerCase();
  if (t === "imap" || t === "pop3" || t === "ews" || t === "nntp" || t === "rss" || t === "none") {
    return t as AccountType;
  }
  return "unsupported";
}

function authString(v: string | number | undefined): string {
  return v === undefined || v === null ? "password" : String(v);
}

async function toPortableIdentity(i: TbIdentity, isDefault: boolean): Promise<Identity> {
  let signature = i.signature ?? "";
  let signatureFormat: "plain" | "html" = i.signatureIsPlainText ? "plain" : "html";
  if (i.signatureUsesFile) {
    // Decision: embed file signature content, never export the path.
    const embedded = await messenger.portableAccountConfig.readSignatureFile(i.id);
    if (embedded) {
      signature = embedded.content;
      signatureFormat = embedded.format;
    }
  }
  return {
    fullName: i.name ?? "",
    email: i.email ?? "",
    replyTo: i.replyTo ?? "",
    organization: i.organization ?? "",
    signature,
    signatureFormat,
    default: isDefault,
    smtpServer: i.smtpServerId ?? null,
  };
}

async function toPortableAccount(a: TbAccount): Promise<NativeAccount> {
  const type = toAccountType(a.type);
  let incoming: NonNullable<TbAccount["incomingServer"]> = a.incomingServer ?? {
    hostname: "", port: 0, username: "", socketType: "plain", authMethod: "password",
  };
  // messenger.accounts.list() in TB 128+ does not expose incoming-server
  // details. Fall back to the experiment which reads them via XPCOM.
  if (!a.incomingServer || !a.incomingServer.hostname) {
    try {
      const via = await messenger.portableAccountConfig.getIncomingServer(a.id);
      if (via) {
        incoming = {
          hostname: via.hostname,
          port: via.port,
          username: via.username,
          socketType: via.socketType,
          authMethod: via.authMethod,
          ...(via.ewsUrl ? { ewsUrl: via.ewsUrl } : {}),
        };
      }
    } catch (_) { /* keep defaults */ }
  }
  const defaultId = a.defaultIdentityId ?? a.identities[0]?.id;
  const identities = await Promise.all(
    a.identities.map((i) => toPortableIdentity(i, i.id === defaultId)),
  );
  return {
    nativeId: a.id,
    name: a.name,
    type,
    incoming: {
      hostname: incoming.hostname,
      port: incoming.port,
      username: incoming.username,
      security: toSocketType(incoming.socketType),
      authentication: authString(incoming.authMethod),
      ...(incoming.ewsUrl ? { ewsUrl: incoming.ewsUrl } : {}),
    },
    identities,
    ...(type === "unsupported" ? { unsupportedReason: `unsupported_type:${a.type}` } : {}),
  };
}

export class WebExtensionThunderbirdAdapter implements ThunderbirdAdapter {
  async listAccounts(): Promise<NativeAccount[]> {
    const raw = await messenger.accounts.list(false);
    return Promise.all(raw.map(toPortableAccount));
  }

  async listSmtpServers(): Promise<NativeSmtpServer[]> {
    const raw = await messenger.portableAccountConfig.listSmtpServers();
    return raw.map((s) => ({
      nativeId: s.id,
      id: s.id,
      hostname: s.hostname,
      port: s.port,
      username: s.username,
      security: toSocketType(s.socketType),
      authentication: authString(s.authMethod),
    }));
  }

  async createAccount(
    account: PortableAccount,
    smtpByRef: Map<string, PortableSmtpServer>,
  ): Promise<WriteResult> {
    if (account.type === "unsupported") {
      throw new Error("cannot_create_unsupported_account");
    }
    return messenger.portableAccountConfig.createAccount({
      account,
      smtpServers: [...smtpByRef.values()],
    });
  }

  async updateAccount(
    nativeId: string,
    account: PortableAccount,
    smtpByRef: Map<string, PortableSmtpServer>,
  ): Promise<WriteResult> {
    return messenger.portableAccountConfig.updateAccount(nativeId, {
      account,
      smtpServers: [...smtpByRef.values()],
    });
  }
}
