#!/usr/bin/env node
/**
 * Build script: compiles TypeScript into `dist/` and copies every non-TS
 * asset from `src/` (manifest.json, HTML/CSS, _locales, experiment/, icons)
 * verbatim so the resulting `dist/` directory can be loaded as a Thunderbird
 * WebExtension by `web-ext` or by the temporary add-on dialog.
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. TypeScript.
execSync("npx tsc -p tsconfig.json", { stdio: "inherit" });

// tsc keeps the `src/` prefix because rootDir is repo root; flatten it.
const compiledSrc = join(dist, "src");
if (existsSync(compiledSrc)) {
  cpSync(compiledSrc, dist, { recursive: true });
  rmSync(compiledSrc, { recursive: true, force: true });
}

// 2. Static assets from src/, mirrored to dist/ root.
for (const asset of [
  "manifest.json",
  "experiment",
  "ui",
  "_locales",
  "icons",
]) {
  const from = join(root, "src", asset);
  if (existsSync(from)) cpSync(from, join(dist, asset), { recursive: true });
}

// 3. Schema — used by the runtime validator via import.
cpSync(join(root, "schema"), join(dist, "schema"), { recursive: true });

console.log("Build complete →", dist);
