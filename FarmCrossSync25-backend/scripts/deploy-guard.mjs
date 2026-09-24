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
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEV_ONLY_VARS = ["ENABLE_R2_TEST", "FARM_CROSSSYNC_LOCAL_DEV"];

/**
 * Secrets the Worker needs in production. Without them the save routes fall
 * back to the unusable `presigned:false` placeholder, which is a local-dev
 * behaviour and must never ship (ticket 89).
 */
export const REQUIRED_SECRETS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
];

/** Values that mean "not filled in yet". */
const PLACEHOLDER_IDS = new Set([
  "00000000-0000-0000-0000-000000000000",
  "your-database-id",
  "changeme",
  "replace-me",
  "xxx",
  "",
]);

const PLACEHOLDER_URL_PATTERNS = [
  /example\.com/i,
  /placeholder/i,
  /changeme/i,
  /your-/i,
  /^https?:\/\/localhost\b/i,
  /^https?:\/\/127\.0\.0\.1\b/i,
  /<[^>]+>/,
];

/** A database_id that is missing or still a scaffold placeholder. */
export function findPlaceholderDatabaseIds(config) {
  const found = [];
  const push = (label, id) => {
    if (typeof id !== "string" || PLACEHOLDER_IDS.has(id.trim().toLowerCase())) {
      found.push(`${label}=${JSON.stringify(id)}`);
    }
  };
  if (config && typeof config === "object") {
    const walk = (node, label) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node.d1_databases)) {
        node.d1_databases.forEach((db, i) =>
          push(`${label}d1_databases[${i}]`, db?.database_id),
        );
      }
      if (node.env && typeof node.env === "object") {
        for (const [name, env] of Object.entries(node.env)) {
          walk(env, `env.${name}.`);
        }
      }
    };
    walk(config, "");
  }
  return found;
}

/**
 * Placeholder-looking URLs in `vars`. Localhost is fine in a dev-only var, so
 * only vars that look like a deployed endpoint are inspected.
 */
export function findPlaceholderUrls(config) {
  const found = [];
  const scan = (vars, label) => {
    for (const [name, value] of Object.entries(vars ?? {})) {
      if (typeof value !== "string") continue;
      if (!/URL|ENDPOINT|HOST|ORIGIN/i.test(name)) continue;
      if (PLACEHOLDER_URL_PATTERNS.some((re) => re.test(value))) {
        found.push(`${label}${name}=${JSON.stringify(value)}`);
      }
    }
  };
  if (config && typeof config === "object") {
    scan(config.vars, "");
    if (config.env && typeof config.env === "object") {
      for (const [name, env] of Object.entries(config.env)) {
        scan(env?.vars, `env.${name}.`);
      }
    }
  }
  return found;
}

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
  const text = readFileSync(file, "utf8");
  const config = JSON.parse(stripJsonComments(text));

  const found = findDeployedDevVars(text);
  if (found.length > 0) {
    console.error(
      `deploy-guard: REFUSING TO DEPLOY. ${path.basename(file)} sets ` +
        `${found.join(", ")} in a vars block. These development-only vars ` +
        "belong in .dev.vars or `wrangler dev --var`, never in a deployed " +
        "configuration (see README \"Development-only R2 test route\").",
    );
    process.exit(1);
  }

  const placeholders = findPlaceholderDatabaseIds(config);
  if (placeholders.length > 0) {
    console.error(
      `deploy-guard: REFUSING TO DEPLOY. ${path.basename(file)} still has a ` +
        `placeholder D1 database id (${placeholders.join(", ")}). Replace it ` +
        "with the real database id from `wrangler d1 create` before deploying.",
    );
    process.exit(1);
  }

  const badUrls = findPlaceholderUrls(config);
  if (badUrls.length > 0) {
    console.error(
      `deploy-guard: REFUSING TO DEPLOY. ${path.basename(file)} carries a ` +
        `placeholder-looking URL (${badUrls.join(", ")}). Set the real ` +
        "production endpoint before deploying.",
    );
    process.exit(1);
  }

  console.log(`deploy-guard: ${path.basename(file)} carries no dev-only vars, placeholder ids, or placeholder URLs`);
}

/**
 * Production secrets are set on the Cloudflare side, not in the repo. Confirm
 * they exist via `wrangler secret list`; when that cannot run (no credentials,
 * no network) fail closed unless the operator explicitly attests to it.
 */
function checkSecrets(root) {
  const attested = process.env.FARM_CROSSSYNC_SECRETS_CONFIRMED === "true";
  let listed;
  try {
    const res = spawnSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["wrangler", "secret", "list", "--json"],
      { cwd: root, encoding: "utf8", timeout: 60_000 },
    );
    if (res.status === 0 && res.stdout) {
      listed = new Set(JSON.parse(res.stdout).map((s) => s.name));
    }
  } catch {
    listed = undefined;
  }

  if (listed) {
    const missing = REQUIRED_SECRETS.filter((name) => !listed.has(name));
    if (missing.length > 0) {
      console.error(
        `deploy-guard: REFUSING TO DEPLOY. Missing Worker secrets: ${missing.join(", ")}. ` +
          "Set them with `wrangler secret put <NAME>`; without them the save " +
          "routes fall back to the local-dev placeholder (see README).",
      );
      process.exit(1);
    }
    console.log(`deploy-guard: all ${REQUIRED_SECRETS.length} production secrets present`);
    return;
  }

  if (!attested) {
    console.error(
      "deploy-guard: REFUSING TO DEPLOY. Could not verify Worker secrets " +
        `(${REQUIRED_SECRETS.join(", ")}) — \`wrangler secret list\` did not ` +
        "succeed. Set them with `wrangler secret put <NAME>`, or re-run with " +
        "FARM_CROSSSYNC_SECRETS_CONFIRMED=true once you have confirmed they exist.",
    );
    process.exit(1);
  }
  console.log(
    "deploy-guard: secret check skipped on operator attestation " +
      "(FARM_CROSSSYNC_SECRETS_CONFIRMED=true)",
  );
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

  checkSecrets(root);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
