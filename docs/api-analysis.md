# Phase 1 — Thunderbird WebExtension API analysis (TB 128 ESR)

Status of what the official [`messenger.*`](https://webextension-api.thunderbird.net/en/128-esr/)
API surface in Thunderbird 128 ESR does and doesn't cover for a fully
portable account export/import, and where our WebExtension **experiment**
has to fill the gaps.

## Reading side (Export)

| Data | Official API | Notes |
|------|--------------|-------|
| Accounts (list, name, type, id) | `messenger.accounts.list()` | ✅ Sufficient (`accountsRead`). |
| Incoming server (hostname, port, username, socket type, auth method) | `messenger.accounts.list()` returns each account's `incomingServer` | ✅ Present in TB 128. |
| Identities (name, email, replyTo, organization, signature, signatureIsPlainText, htmlSigFormat, smtpServerId, default) | `messenger.identities.*` | ✅ Present. Signature *content* is exposed; the sig_file *path* is not (see below). |
| SMTP servers | ❌ Not exposed via WebExtension API | ⚠️ Handled by experiment (`portableAccountConfig.listSmtpServers`). |
| Signature file content when identity uses `sig_file` | ❌ Not exposed | ⚠️ Handled by experiment (`readSignatureFile`), path never exported. |
| Passwords / OAuth tokens | ❌ (by design) | Never exported (§7). |

## Writing side (Import)

| Operation | Official API | Notes |
|-----------|--------------|-------|
| Create account | ❌ | Experiment (`createAccount`) via `nsIMsgAccountManager`. |
| Update account | ❌ | Experiment (`updateAccount`). |
| Create SMTP server | ❌ | Experiment (implicitly via `createAccount`). |
| Update identity fields already present in TB API | Partial via `messenger.identities.update()` | Only for fields already covered — currently we consolidate all mutation in the experiment for symmetry. |

## Consequences

1. The experiment surface is deliberately **minimal**: `listSmtpServers`,
   `readSignatureFile`, `createAccount`, `updateAccount`. Everything else
   uses official APIs.
2. The add-on gracefully degrades: `listSmtpServers` returning `[]` still
   lets export finish (identities will point at `smtpServer: null`).
3. As soon as any of these become official APIs, the corresponding
   experiment function is deleted and `adapter/webext.ts` is switched to
   the official call — the portable model and everything above the
   adapter stay untouched.

## EWS / OAuth

- OAuth is treated as a plain `authentication: "oauth2"` marker; tokens
  are never exported. On import Thunderbird performs its normal OAuth
  login flow at first use.
- EWS accounts export as `type: "ews"` with an optional `ewsUrl`. On
  older Thunderbirds without EWS support the incoming account is marked
  `unsupported` during planning.
