#!/usr/bin/env node
// Static theme/layout audit (ticket 48).
//
// Guards the dark-theme contract without a GUI: no component may hardcode a
// color (they must use the CSS variables owned by src/routes/+layout.svelte),
// and no fixed width may reach the 900px minimum window width. Run with
// `npm run audit:styles`.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
const themeFile = join(root, "routes", "+layout.svelte");
const MIN_WINDOW = 900;

function* svelteFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* svelteFiles(path);
    else if (entry.name.endsWith(".svelte")) yield path;
  }
}

const findings = [];
for (const file of svelteFiles(root)) {
  if (file === themeFile) continue;
  const rel = relative(root, file);
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const where = `${rel}:${i + 1}`;
      const color = line.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsl\(/);
      if (color) findings.push(`${where} hardcoded color "${color[0]}"`);
      const width = line.match(/(?:min-)?width:\s*(\d+)px/);
      if (width && Number(width[1]) >= MIN_WINDOW) {
        findings.push(`${where} fixed width ${width[1]}px >= ${MIN_WINDOW}px`);
      }
    });
}

if (findings.length) {
  console.error("Style audit failed:");
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log("Style audit passed: no hardcoded colors outside the theme, no fixed widths >= 900px.");
