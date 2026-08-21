/* global ExtensionCommon, ChromeUtils */
/**
 * Parent-scope implementation of the `portableAccountConfig` experiment.
 *
 * This file runs in Thunderbird's privileged parent process and must not be
 * bundled by the TypeScript build — it uses XPCOM directly.
 *
 * Scope (kept intentionally minimal, see spec §18):
 *   - listSmtpServers()          — enumerate MsgOutgoingServers.
 *   - readSignatureFile(id)      — read a sig_file for an identity.
 *   - createAccount(spec)        — create IMAP/POP3 accounts + SMTP.
 *   - updateAccount(id, spec)    — mutate an existing account in place.
 *
 * Passwords and OAuth tokens are never read, written or exported.
 *
 * NOTE (Phase 1 outcome): TB 128 ESR does not yet expose SMTP servers or
 * account creation via the public WebExtension API. Until that changes, the
 * bodies below need to be filled in with the XPCOM calls documented in the
 * README (see `docs/api-analysis.md`). The functions currently return safe
 * empty defaults / throw "not_implemented" so that the rest of the add-on
 * remains testable and installable, and Phase 2's export prototype works
 * once a small `listSmtpServers` XPCOM stub is added.
 */

"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs",
);

// Lazily loaded XPCOM helpers. Wrapped in a getter object so that unit tests
// on the JS side (if any) can stub it out.
const Lazy = {};
ChromeUtils.defineESModuleGetters(Lazy, {
  MailServices: "resource:///modules/MailServices.sys.mjs",
});

function socketTypeToString(n) {
  // nsMsgSocketType: 0 plain, 2 starttls, 3 ssl
  switch (n) {
    case 3: return "ssl";
    case 2: return "starttls";
    default: return "plain";
  }
}

function stringToSocketType(s) {
  switch ((s || "").toLowerCase()) {
    case "ssl": return 3;
    case "starttls": return 2;
    default: return 0;
  }
}

function iterateServers() {
  // TB 128+ (nsIMsgOutgoingServerService) exposes .servers; older code paths
  // used MailServices.smtp.servers (nsISmtpService). Both return array-like
  // enumerations of nsIMsgOutgoingServer / nsISmtpServer respectively.
  const ms = Lazy.MailServices;
  const svc = (ms.outgoingServer && ms.outgoingServer.servers) ||
              (ms.smtp && ms.smtp.servers) ||
              [];
  const list = [];
  // Support both plain arrays and XPCOM enumerators.
  if (typeof svc[Symbol.iterator] === "function") {
    for (const s of svc) list.push(s);
  } else if (typeof svc.enumerate === "function") {
    const en = svc.enumerate();
    while (en.hasMoreElements()) list.push(en.getNext());
  } else if ("length" in svc) {
    for (let i = 0; i < svc.length; i++) list.push(svc.queryElementAt ? svc.queryElementAt(i, Ci.nsISupports) : svc[i]);
  }
  return list;
}

function readSmtpServers() {
  const out = [];
  for (const raw of iterateServers()) {
    let s = raw;
    try {
      if (raw.QueryInterface && Ci.nsISmtpServer) {
        try { s = raw.QueryInterface(Ci.nsISmtpServer); } catch (_) { s = raw; }
      }
    } catch (_) { /* ignore */ }
    out.push({
      id: raw.key || s.key || "",
      hostname: s.hostname || "",
      port: s.port || 0,
      username: s.username || "",
      socketType: socketTypeToString(s.socketType),
      authMethod: String(s.authMethod ?? "password"),
    });
  }
  return out;
}

function readIncomingServer(accountKey) {
  const acc = Lazy.MailServices.accounts.getAccount(accountKey);
  if (!acc) return null;
  const s = acc.incomingServer;
  if (!s) return null;
  const result = {
    type: s.type || "",
    hostname: s.hostName || s.hostname || "",
    port: s.port || 0,
    username: s.username || s.realUsername || "",
    socketType: socketTypeToString(s.socketType),
    authMethod: String(s.authMethod ?? "password"),
  };
  // EWS URL, when applicable.
  try {
    const ews = s.getStringValue && s.getStringValue("ews_url");
    if (ews) result.ewsUrl = ews;
  } catch (_) { /* ignore */ }
  return result;
}

/**
 * Map a portable account.type onto Thunderbird's incoming-server type string
 * as expected by nsIMsgAccountManager.createIncomingServer.
 */
function incomingTypeFor(portableType) {
  switch (portableType) {
    case "imap": return "imap";
    case "pop3": return "pop3";
    case "nntp": return "nntp";
    case "rss":  return "rss";
    case "ews":  return "ews";
    case "none": return "none";
    default: throw new Error("cannot_create_unsupported_account:" + portableType);
  }
}

/**
 * Locate an existing SMTP server matching hostname/port/username, or create
 * a new one. Passwords are never written — Thunderbird will prompt on first
 * use. Returns the server key.
 */
function findOrCreateSmtpServer(smtp) {
  const ms = Lazy.MailServices;
  for (const raw of iterateServers()) {
    let s = raw;
    try { if (raw.QueryInterface && Ci.nsISmtpServer) s = raw.QueryInterface(Ci.nsISmtpServer); } catch (_) {}
    if ((s.hostname || "").toLowerCase() === (smtp.hostname || "").toLowerCase()
        && Number(s.port) === Number(smtp.port)
        && (s.username || "") === (smtp.username || "")) {
      return raw.key || s.key;
    }
  }
  // Create new SMTP server. TB 128+: MailServices.outgoingServer.createServer("smtp").
  let server;
  if (ms.outgoingServer && typeof ms.outgoingServer.createServer === "function") {
    server = ms.outgoingServer.createServer("smtp");
  } else if (ms.smtp && typeof ms.smtp.createServer === "function") {
    server = ms.smtp.createServer();
  } else {
    throw new Error("no_smtp_service");
  }
  let target = server;
  try { if (server.QueryInterface && Ci.nsISmtpServer) target = server.QueryInterface(Ci.nsISmtpServer); } catch (_) {}
  target.hostname = smtp.hostname || "";
  target.port = Number(smtp.port) || 0;
  target.username = smtp.username || "";
  target.socketType = stringToSocketType(smtp.security);
  // authMethod: 3 = password cleartext, 10 = OAuth2, keep 3 as safe default.
  target.authMethod = smtp.authentication === "oauth2" ? 10 : 3;
  return server.key || target.key;
}

/**
 * Populate identity fields from the portable model. Never writes passwords
 * or file paths; signatures are always inline.
 */
function applyIdentity(identity, portable, smtpKeyByRef) {
  identity.fullName = portable.fullName || "";
  identity.email = portable.email || "";
  identity.replyTo = portable.replyTo || "";
  identity.organization = portable.organization || "";
  if (portable.signature) {
    identity.htmlSigText = portable.signature;
    identity.htmlSigFormat = portable.signatureFormat === "html";
    identity.attachSignature = false;
  }
  if (portable.smtpServer && smtpKeyByRef.has(portable.smtpServer)) {
    identity.smtpServerKey = smtpKeyByRef.get(portable.smtpServer);
  }
}

function buildSmtpKeyMap(spec) {
  const map = new Map();
  const list = spec.smtpServers || [];
  for (const smtp of list) {
    try {
      map.set(smtp.id, findOrCreateSmtpServer(smtp));
    } catch (e) {
      Cu.reportError(e);
    }
  }
  return map;
}

function createAccountImpl(spec) {
  const account = spec && spec.account;
  if (!account) throw new Error("missing_account");
  if (account.type === "unsupported" || account.unsupportedReason) {
    throw new Error("cannot_create_unsupported_account");
  }
  const ms = Lazy.MailServices;
  const smtpKeyByRef = buildSmtpKeyMap(spec);

  const type = incomingTypeFor(account.type);
  const inc = account.incoming || {};
  const server = ms.accounts.createIncomingServer(
    inc.username || "",
    inc.hostname || "",
    type,
  );
  server.port = Number(inc.port) || server.port;
  server.socketType = stringToSocketType(inc.security);
  // authMethod 3 = password, 10 = OAuth2, 4 = gssapi. Keep the mapping tight.
  if (inc.authentication === "oauth2") server.authMethod = 10;
  else if (inc.authentication === "gssapi") server.authMethod = 4;
  else server.authMethod = 3;
  if (account.type === "ews" && inc.ewsUrl) {
    try { server.setStringValue("ews_url", inc.ewsUrl); } catch (_) {}
  }
  if (account.name) {
    try { server.prettyName = account.name; } catch (_) {}
  }

  const nsAccount = ms.accounts.createAccount();
  nsAccount.incomingServer = server;

  const identities = account.identities || [];
  let defaultId = null;
  for (const pid of identities) {
    const identity = ms.accounts.createIdentity();
    applyIdentity(identity, pid, smtpKeyByRef);
    nsAccount.addIdentity(identity);
    if (pid.default && !defaultId) defaultId = identity;
  }
  if (defaultId) {
    try { nsAccount.defaultIdentity = defaultId; } catch (_) {}
  }

  return { nativeId: nsAccount.key };
}

function updateAccountImpl(nativeId, spec) {
  const account = spec && spec.account;
  if (!account) throw new Error("missing_account");
  const ms = Lazy.MailServices;
  const nsAccount = ms.accounts.getAccount(nativeId);
  if (!nsAccount) throw new Error("account_not_found:" + nativeId);
  const smtpKeyByRef = buildSmtpKeyMap(spec);

  const server = nsAccount.incomingServer;
  const inc = account.incoming || {};
  if (server) {
    if (inc.hostname) { try { server.hostName = inc.hostname; } catch (_) {} }
    if (inc.port) server.port = Number(inc.port);
    if (inc.username) { try { server.username = inc.username; } catch (_) {} }
    if (inc.security) server.socketType = stringToSocketType(inc.security);
    if (inc.authentication === "oauth2") server.authMethod = 10;
    else if (inc.authentication === "gssapi") server.authMethod = 4;
    else if (inc.authentication) server.authMethod = 3;
    if (account.type === "ews" && inc.ewsUrl) {
      try { server.setStringValue("ews_url", inc.ewsUrl); } catch (_) {}
    }
    if (account.name) { try { server.prettyName = account.name; } catch (_) {} }
  }

  // Merge identities keyed by email. Existing identities with matching email
  // are updated; new ones are appended. Existing identities without a match
  // in the incoming spec are left untouched (§13 — no destructive changes).
  const existing = new Map();
  for (const id of nsAccount.identities) {
    existing.set((id.email || "").trim().toLowerCase(), id);
  }
  let defaultId = null;
  for (const pid of account.identities || []) {
    const key = (pid.email || "").trim().toLowerCase();
    let identity = existing.get(key);
    if (!identity) {
      identity = ms.accounts.createIdentity();
      applyIdentity(identity, pid, smtpKeyByRef);
      nsAccount.addIdentity(identity);
    } else {
      applyIdentity(identity, pid, smtpKeyByRef);
    }
    if (pid.default && !defaultId) defaultId = identity;
  }
  if (defaultId) {
    try { nsAccount.defaultIdentity = defaultId; } catch (_) {}
  }

  return { nativeId: nsAccount.key };
}

/**
 * Read an arbitrary file (typically the "watched" portable-config JSON in a
 * synced folder such as Nextcloud/Dropbox). Returns null if the file does
 * not exist yet. Throws for permission errors or oversized files so the
 * caller can surface a real diagnostic instead of silently doing nothing.
 */
async function readWatchedFileImpl(path) {
  if (!path || typeof path !== "string") throw new Error("invalid_path");
  const MAX_BYTES = 4 * 1024 * 1024;
  let IOUtils;
  try {
    ({ IOUtils } = globalThis);
  } catch (_) { /* older TB */ }
  if (!IOUtils) throw new Error("io_unavailable");

  let stat;
  try {
    stat = await IOUtils.stat(path);
  } catch (e) {
    // NotFound is normal (file not created yet); anything else propagates.
    if (e && (e.name === "NotFoundError" || String(e).includes("NS_ERROR_FILE_NOT_FOUND"))) {
      return null;
    }
    throw new Error("stat_failed:" + (e && e.message ? e.message : String(e)));
  }
  if (stat && stat.type === "directory") throw new Error("path_is_directory");
  if (stat && typeof stat.size === "number" && stat.size > MAX_BYTES) {
    throw new Error("file_too_large:" + stat.size);
  }

  let bytes;
  try {
    bytes = await IOUtils.read(path);
  } catch (e) {
    throw new Error("read_failed:" + (e && e.message ? e.message : String(e)));
  }

  const text = new TextDecoder("utf-8").decode(bytes);

  // SHA-256 via WebCrypto (available in privileged JSM context in TB 128+).
  let sha256 = "";
  try {
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    sha256 = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (_) { /* leave empty; mtime fallback still works */ }

  const mtime = stat && stat.lastModified
    ? Number(stat.lastModified)
    : (stat && stat.lastModificationDate ? Number(stat.lastModificationDate) : 0);

  return { text, mtime, sha256, size: bytes.byteLength };
}

/**
 * Atomically write a UTF-8 text file: write to `<path>.tmp` then rename
 * over the target. This avoids Nextcloud/Dropbox picking up half-written
 * JSON while the auto-export is still running.
 */
async function writeWatchedFileImpl(path, text) {
  if (!path || typeof path !== "string") throw new Error("invalid_path");
  if (typeof text !== "string") throw new Error("invalid_text");
  let IOUtils;
  try {
    ({ IOUtils } = globalThis);
  } catch (_) { /* older TB */ }
  if (!IOUtils) throw new Error("io_unavailable");

  // Refuse to overwrite a directory in place.
  try {
    const stat = await IOUtils.stat(path);
    if (stat && stat.type === "directory") throw new Error("path_is_directory");
  } catch (e) {
    // NotFound is fine — file will be created.
    if (!(e && (e.name === "NotFoundError" || String(e).includes("NS_ERROR_FILE_NOT_FOUND")))) {
      if (String(e && e.message).startsWith("path_is_directory")) throw e;
      // any other stat error we tolerate; the write below will surface it.
    }
  }

  const bytes = new TextEncoder().encode(text);
  const tmpPath = path + ".tmp";

  // Prefer IOUtils' built-in atomic write (tmpPath option) when available;
  // fall back to explicit write+move for older TB releases.
  try {
    await IOUtils.write(path, bytes, { tmpPath });
  } catch (e1) {
    try {
      await IOUtils.write(tmpPath, bytes);
      await IOUtils.move(tmpPath, path);
    } catch (e2) {
      throw new Error("write_failed:" + (e2 && e2.message ? e2.message : String(e2)));
    }
  }

  let sha256 = "";
  try {
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    sha256 = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (_) { /* optional */ }

  return { bytesWritten: bytes.byteLength, sha256 };
}

this.portableAccountConfig = class extends ExtensionCommon.ExtensionAPI {
  getAPI(_context) {
    return {
      portableAccountConfig: {
        async listSmtpServers() {
          return readSmtpServers();
        },

        async getIncomingServer(accountKey) {
          return readIncomingServer(accountKey);
        },

        async readSignatureFile(identityId) {
          try {
            const identity = Lazy.MailServices.accounts.getIdentity(identityId);
            if (!identity || !identity.attachSignature) return null;
            const file = identity.signature;
            if (!file || !file.exists()) return null;
            const stream = Cc["@mozilla.org/network/file-input-stream;1"]
              .createInstance(Ci.nsIFileInputStream);
            stream.init(file, 0x01, 0, 0);
            const sstream = Cc["@mozilla.org/scriptableinputstream;1"]
              .createInstance(Ci.nsIScriptableInputStream);
            sstream.init(stream);
            const content = sstream.read(sstream.available());
            sstream.close();
            stream.close();
            const format = /\.html?$/i.test(file.leafName) || identity.htmlSigFormat
              ? "html"
              : "plain";
            return { content, format };
          } catch (e) {
            Cu.reportError(e);
            return null;
          }
        },

        async readWatchedFile(path) {
          return readWatchedFileImpl(path);
        },

        async writeWatchedFile(path, text) {
          return writeWatchedFileImpl(path, text);
        },

        async createAccount(spec) {
          return createAccountImpl(spec);
        },

        async updateAccount(nativeId, spec) {
          return updateAccountImpl(nativeId, spec);
        },
      },
    };
  }
};

// Silence linter for unused helper — kept for later use by createAccount.
void stringToSocketType;
