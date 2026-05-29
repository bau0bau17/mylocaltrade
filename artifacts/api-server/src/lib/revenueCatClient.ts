import { createClient } from "@replit/revenuecat-sdk/client";

/**
 * Authenticated RevenueCat Developer API (v2) client.
 *
 * Auth comes from the Replit RevenueCat connector. We fetch the connection's
 * OAuth access token from the Replit connectors service (tokens expire and are
 * refreshed automatically), so the returned client must never be cached — call
 * getUncachableRevenueCatClient() on every request.
 */

const REVENUECAT_API_BASE_URL = "https://api.revenuecat.com/v2";

type ConnectionSettings = {
  settings?: {
    access_token?: string;
    expires_at?: string;
    oauth?: { credentials?: { access_token?: string; expires_at?: string } };
  };
};

let cachedConnection: ConnectionSettings | null = null;

function readToken(conn: ConnectionSettings | null): {
  accessToken?: string;
  expiresAt?: string;
} {
  const s = conn?.settings;
  return {
    accessToken: s?.access_token ?? s?.oauth?.credentials?.access_token,
    expiresAt: s?.expires_at ?? s?.oauth?.credentials?.expires_at,
  };
}

async function getAccessToken(): Promise<string> {
  const cached = readToken(cachedConnection);
  if (
    cached.accessToken &&
    cached.expiresAt &&
    new Date(cached.expiresAt).getTime() > Date.now() + 60_000
  ) {
    return cached.accessToken;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "RevenueCat connector is not available: missing REPLIT_CONNECTORS_HOSTNAME or Replit identity token.",
    );
  }

  const res = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=revenuecat`,
    {
      headers: {
        Accept: "application/json",
        X_REPLIT_TOKEN: xReplitToken,
      },
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch RevenueCat connection: ${res.status}`);
  }
  const data = (await res.json()) as { items?: ConnectionSettings[] };
  cachedConnection = data.items?.[0] ?? null;

  const { accessToken } = readToken(cachedConnection);
  if (!accessToken) {
    throw new Error(
      "RevenueCat connector is not connected. Connect it via the Integrations pane.",
    );
  }
  return accessToken;
}

/**
 * Returns a fresh authenticated `@replit/revenuecat-sdk` client. Never cache the
 * returned value — call this on every request so token refresh works.
 */
export async function getUncachableRevenueCatClient() {
  const accessToken = await getAccessToken();
  return createClient({
    baseUrl: REVENUECAT_API_BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}
