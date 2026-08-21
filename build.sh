#!/usr/bin/env bash
set -euo pipefail

# Single source of truth for the add-on version.
VERSION="0.4.11"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid version: $VERSION" >&2
  exit 1
fi

# Keep npm metadata and the Thunderbird manifest in sync.
npm version "$VERSION" --no-git-tag-version --allow-same-version --ignore-scripts
node -e '
const fs = require("node:fs");
const file = "src/manifest.json";
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
manifest.version = process.argv[1];
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
' "$VERSION"

npm run lint
npm test
npm run package
