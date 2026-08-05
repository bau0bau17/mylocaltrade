/**
 * CORS origin allow-list.
 *
 * Origins are matched by STRICT equality after normalisation (lowercase,
 * trailing slashes stripped) — never by suffix. `endsWith` matching let
 * `https://evil-admin.mylocaltrade.co.uk` pass a check for
 * `https://admin.mylocaltrade.co.uk`.
 *
 * Production never falls back to "allow everything":
 *   1. `ALLOWED_ORIGINS` (comma-separated, scheme included) wins when set.
 *   2. Otherwise the published domain(s) in `REPLIT_DOMAINS` are used as
 *      exact `https://` origins (covers the standard Replit deployment,
 *      including linked custom domains, without manual config).
 *   3. Neither present → throw at startup, mirroring JWT_SECRET.
 *
 * Outside production a missing ALLOWED_ORIGINS keeps the permissive
 * reflect-any-origin behaviour so local/preview dev keeps working; app.ts
 * logs a warning when that fallback is active.
 */

const normalizeOrigin = (o: string): string => o.trim().toLowerCase().replace(/\/+$/, "");

export function buildAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const raw = env.ALLOWED_ORIGINS;
  if (raw && raw.trim()) {
    return raw.split(",").map(normalizeOrigin).filter(Boolean);
  }
  if (env.NODE_ENV === "production") {
    const domains = env.REPLIT_DOMAINS;
    if (domains && domains.trim()) {
      return domains
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => normalizeOrigin(`https://${d}`));
    }
    throw new Error(
      "ALLOWED_ORIGINS environment variable is required in production (or REPLIT_DOMAINS for Replit deployments)",
    );
  }
  return null;
}

/** null allow-list = dev/test permissive mode (never reachable in production). */
export function isOriginAllowed(origin: string, allowedOrigins: string[] | null): boolean {
  if (allowedOrigins === null) return true;
  // Normalise both sides so a hand-passed (non-buildAllowedOrigins) list
  // still can't miss a legitimate origin over case or a trailing slash.
  const o = normalizeOrigin(origin);
  return allowedOrigins.some((entry) => normalizeOrigin(entry) === o);
}
