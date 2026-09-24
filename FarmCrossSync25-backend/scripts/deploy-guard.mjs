#!/usr/bin/env node
/**
 * Deploy-time guard for the development-only R2 test route (ticket 77).
 *
 * The `/r2-test/*` route is gated at runtime by `ENABLE_R2_TEST` (switch) and
 * `FARM_CROSSSYNC_LOCAL_DEV` (local-only marker) plus a loopback Host. Those
 * vars belong ONLY in local development (`FarmCrossSync25-backend/.dev.vars` or
 * `wrangler dev --var`). If either name ever appears in the deployed wrangler
 * configuration, something has gone wrong — this guard makes `npm run deploy`
 * fail loudly instead of shipping a Worker with the backdoor switch armed.
 *
 * Fail-closed: an unreadable or unparsable wrangler config also aborts the
 * deploy, because the guard cannot prove the vars are absent.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEV_ONLY_VARS = ["ENABLE_R2_TEST", "FARM_CROSSSYNC_LOCAL_DEV"];

/**
 * Strips `//` line comments and `/* *\/` block comments from JSONC, leaving
 * string literals untouched (so `https://...` inside a value survives).
 */
export function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

/** Every `vars` block in a wrangler config: top level and per-environment. */
function collectVarBlocks(config) {
  const blocks = [];
  if (config && typeof config === "object") {
    if (config.vars && typeof config.vars === "object") blocks.push(config.vars);
    if (config.env && typeof config.env === "object") {
      for (const environment of Object.values(config.env)) {
        if (environment?.vars && typeof environment.vars === "object") {
          blocks.push(environment.vars);
        }
      }
    }
  }
  return blocks;
}

/**
 * Returns the dev-only var names present in the wrangler config's `vars`
 * blocks. Throws when the config cannot be parsed — the caller treats that as
 * a deploy failure (fail closed).
 */
export function findDeployedDevVars(configText) {
  const config = JSON.parse(stripJsonComments(configText));
  const found = new Set();
  for (const vars of collectVarBlocks(config)) {
    for (const name of DEV_ONLY_VARS) {
      if (Object.prototype.hasOwnProperty.call(vars, name)) found.add(name);
    }
  }
  return [...found];
}

function checkConfigFile(file) {
  const found = findDeployedDevVars(readFileSync(file, "utf8"));
  if (found.length > 0) {
    console.error(
      `deploy-guard: REFUSING TO DEPLOY. ${path.basename(file)} sets ` +
        `${found.join(", ")} in a vars block. These development-only vars ` +
        "belong in .dev.vars or `wrangler dev --var`, never in a deployed " +
        "configuration (see README \"Development-only R2 test route\").",
    );
    process.exit(1);
  }
  console.log(`deploy-guard: ${path.basename(file)} carries no dev-only vars`);
}

function main() {
  const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
  const jsonc = path.join(root, "wrangler.jsonc");
  const json = path.join(root, "wrangler.json");
  const toml = path.join(root, "wrangler.toml");

  if (existsSync(toml)) {
    // TOML is not parsed here; fail closed on any mention of a dev-only var.
    const text = readFileSync(toml, "utf8");
    const found = DEV_ONLY_VARS.filter((name) => text.includes(name));
    if (found.length > 0) {
      console.error(
        `deploy-guard: REFUSING TO DEPLOY. wrangler.toml mentions ${found.join(", ")}.`,
      );
      process.exit(1);
    }
    console.log("deploy-guard: wrangler.toml carries no dev-only vars");
  }

  if (existsSync(jsonc)) checkConfigFile(jsonc);
  else if (existsSync(json)) checkConfigFile(json);
  else {
    console.error("deploy-guard: no wrangler.jsonc/wrangler.json found; cannot verify");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
