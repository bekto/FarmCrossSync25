// Environment configuration for the desktop client.
//
// Spec: "The client embeds only `API_BASE_URL`; all secrets live in Worker
// secret storage or local dev files excluded from Git." Environments are
// local (Wrangler local Worker/D1/R2) -> Cloudflare staging -> production.
//
// Selection: `VITE_APP_ENV` = local | staging | production (default `local`).
// `VITE_API_BASE_URL` still overrides the host if set, so a build can point at
// any host without editing code. This module is the single source of truth for
// the base URL; services must not hardcode hosts.

export type AppEnv = "local" | "staging" | "production";

/**
 * Per-environment API hosts. Staging/production are placeholders until the
 * Worker is deployed; override with `VITE_API_BASE_URL` per build rather than
 * editing these.
 */
export const API_BASE_URLS: Record<AppEnv, string> = {
  local: "http://localhost:8787",
  staging: "https://farm-crosssync-backend-staging.workers.dev",
  production: "https://farm-crosssync-backend.workers.dev",
};

export function isAppEnv(value: unknown): value is AppEnv {
  return value === "local" || value === "staging" || value === "production";
}

/** Unknown or missing value falls back to `local` (safe default for dev). */
export function resolveAppEnv(value: string | undefined): AppEnv {
  return isAppEnv(value) ? value : "local";
}

export function resolveApiBaseUrl(env: AppEnv): string {
  return API_BASE_URLS[env];
}

function metaEnv(key: string): string | undefined {
  const env = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env;
  return env?.[key];
}

/** The environment selected from `VITE_APP_ENV`, defaulting to `local`. */
export function configuredAppEnv(): AppEnv {
  return resolveAppEnv(metaEnv("VITE_APP_ENV"));
}

/** `VITE_API_BASE_URL` override, else the selected environment's host. */
export function configuredApiBaseUrl(): string {
  return metaEnv("VITE_API_BASE_URL") ?? resolveApiBaseUrl(configuredAppEnv());
}

/**
 * Backwards-compatible single export: the selected environment's base URL.
 * New code should resolve via `resolveApiBaseUrl` / `configuredApiBaseUrl`.
 */
export const API_BASE_URL: string = configuredApiBaseUrl();
