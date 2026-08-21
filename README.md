# Portable Thunderbird Account Configuration

A Thunderbird WebExtension add-on that exports the semantic mail account
configuration into a small platform-independent JSON file and imports it
back on any other Thunderbird — Windows, Linux or macOS. See
[Feature Specification](./Feature%20Specification_%20Portable%20Thunderbird%20Account%20Configuration.md)
for the full requirements.

> **Not a migration tool.** The add-on only moves *account
> configuration* — no messages, no local folders, no passwords or tokens.

## Supported Thunderbird versions

- Minimum: **Thunderbird 128 ESR** (Manifest V3).
- Passwords and OAuth tokens are never exported; Thunderbird will prompt
  for them on first use after import.

## Supported account types

| Type | Export | Import |
|------|--------|--------|
| IMAP | ✅ | ✅ |
| POP3 | ✅ | ✅ |
| EWS  | ✅ (config + `ewsUrl`) | ✅ if the target Thunderbird supports EWS |
| NNTP | ⚠️ config only | ⚠️ config only |
| RSS  | ⚠️ | ⚠️ |
| Local Folders | ❌ | ❌ |

Unsupported account types are exported with a clear `unsupportedReason`
and are skipped on import.

## Export format

- Extension: `.tbaccount`
- Content: JSON, versioned (`version: 1`)
- Formal schema:
  [`schema/portable-account-config.schema.json`](./schema/portable-account-config.schema.json)
- Fully described in the [Feature Specification §15](./Feature%20Specification_%20Portable%20Thunderbird%20Account%20Configuration.md).

The JSON contains only semantic data. It intentionally omits:

- profile paths, OS paths, `prefs.js` fragments
- internal Thunderbird ids
- caches, UI state
- **passwords, OAuth tokens** (§7)

## Security model

- Passwords and tokens are never read, never exported, never stored.
- SMTP servers are exported by-reference; identities carry a stable
  export-local id (`smtp-1`, `smtp-2`, …), not the internal Thunderbird
  server key.
- Signature files (`sig_file`) are read once during export and their
  *content* is embedded — the path is discarded so the file cannot be
  referenced from another OS.
- Duplicate matching uses normalized (`trim` + `toLowerCase`) email,
  hostname and username; account names are **never** the sole match
  criterion (§9).

## Known limitations

- SMTP-server enumeration and account creation currently need a small
  WebExtension experiment (see [`docs/api-analysis.md`](./docs/api-analysis.md));
  once Thunderbird ships official APIs the experiment will be removed.
- Passwords are re-entered on first connect; there is no plan to change
  this in v1.

## Development

```bash
npm install
npm run build   # → dist/  (ready to load in Thunderbird)
npm test        # run unit + round-trip tests
npm run package # → web-ext-artifacts/*.zip und *.xpi
build.sh            # Version oben in build.sh ändern und package bauen
npm run run:tb  # launch a temporary Thunderbird with the add-on loaded
```

Layout:

```
src/
  manifest.json           MV3 manifest, TB ≥128 ESR
  background.ts           event-page controller
  adapter/                Thunderbird ↔ portable model seam
    thunderbird.ts        interface
    webext.ts             runtime implementation
    memory.ts             in-memory fake used by tests
  core/
    export.ts             adapter → portable → JSON
    import.ts             JSON → plan → executeImport
  io/validate.ts          Ajv-based schema validator
  model/portable.ts       portable data model (TS)
  util/normalize.ts       matching helpers (§9)
  experiment/             minimal WebExtension experiment
  ui/                     popup HTML/CSS/JS
  _locales/{de,en}/       i18n
schema/                   JSON schema for the .tbaccount format
test/                     Jest tests, including round-trip invariant
docs/api-analysis.md      Phase 1 result
```

## Tests

`npm test` runs:

- schema validation (valid, invalid, wrong version)
- normalization + duplicate matching (case, whitespace)
- diff generation for conflict detection
- new / identical / conflict / unsupported classification
- **round-trip invariant** (§23): `export(import(export(x))) ≈ export(x)`
- no passwords ever appear in the export

## License

MIT — see [LICENSE](./LICENSE).
