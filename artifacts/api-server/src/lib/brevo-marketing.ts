/**
 * Brevo Contacts + Marketing Campaign API client (Phase 2B).
 *
 * Bulk launch/marketing campaigns go through Brevo's MARKETING pipeline
 * (contact lists + email campaigns) — NEVER through the transactional
 * verification/password-reset route. Brevo then provides its native
 * unsubscribe handling and List-Unsubscribe headers on every campaign
 * email; those events are synchronised back via the webhook route.
 *
 * SAFETY GATE: every real API call requires BOTH an API key and the
 * explicit opt-in flag MARKETING_BREVO_ENABLED=true. Anything else throws
 * BrevoMarketingDisabledError before any network traffic — development and
 * tests can therefore never create production Brevo lists, contacts or
 * campaigns by accident.
 *
 * The API key is never logged; errors carry status + Brevo's short message
 * only.
 */

const BREVO_BASE = "https://api.brevo.com/v3";

/** Folder that owns our lists inside Brevo's contact organisation. */
const BREVO_FOLDER_NAME = "MyLocalTrade";

export const BREVO_LIST_NAMES = {
  launch: "MyLocalTrade Early Access – Launch",
  marketing: "MyLocalTrade Marketing Subscribers",
} as const;

export const CAMPAIGN_SENDER = {
  name: "MyLocalTrade",
  email: "noreply@mylocaltrade.co.uk",
} as const;

export class BrevoMarketingDisabledError extends Error {
  constructor(reason: string) {
    super(`Brevo marketing sending is disabled: ${reason}`);
    this.name = "BrevoMarketingDisabledError";
  }
}

/**
 * HTTP-level Brevo rejection. Carries the status and Brevo's machine `code`
 * so callers can distinguish DEFINITE rejections (4xx — the request was
 * refused, nothing was sent) from AMBIGUOUS failures (network errors /
 * 5xx — the request may have been processed). Never contains the API key
 * or any recipient data.
 */
export class BrevoApiError extends Error {
  readonly status: number;
  readonly brevoCode: string | null;
  constructor(opts: { method: string; path: string; status: number; brevoCode: string | null; message: string }) {
    super(`Brevo ${opts.method} ${opts.path} → ${opts.status}: ${opts.message}`);
    this.name = "BrevoApiError";
    this.status = opts.status;
    this.brevoCode = opts.brevoCode;
  }
  /** The request was definitively refused — nothing can have been sent. */
  get definiteRejection(): boolean {
    return this.status >= 400 && this.status < 500;
  }
  /** Brevo's explicit out-of-credits rejection (daily or monthly plan cap). */
  get insufficientCredits(): boolean {
    return this.brevoCode === "not_enough_credits";
  }
}

function marketingApiKey(): string | undefined {
  // Prefer a dedicated marketing key; fall back to existing keys only if
  // present (the free-plan account uses one key across pipelines).
  return (
    process.env.BREVO_API_KEY_MARKETING ??
    process.env.BREVO_API_KEY_CONTACT ??
    process.env.BREVO_API_KEY_VERIFICATION
  );
}

export function marketingSendingStatus():
  | { enabled: true }
  | { enabled: false; reason: string } {
  if (process.env.MARKETING_BREVO_ENABLED !== "true") {
    return {
      enabled: false,
      reason: "MARKETING_BREVO_ENABLED is not set to 'true'",
    };
  }
  if (!marketingApiKey()) {
    return { enabled: false, reason: "no Brevo API key is configured" };
  }
  return { enabled: true };
}

function requireEnabled(): string {
  const status = marketingSendingStatus();
  if (!status.enabled) throw new BrevoMarketingDisabledError(status.reason);
  return marketingApiKey()!;
}

async function brevoFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const key = requireEnabled();
  const res = await fetch(`${BREVO_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "api-key": key,
      accept: "application/json",
      ...(init?.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    let message = res.statusText;
    let brevoCode: string | null = null;
    try {
      const data = (await res.json()) as { message?: string; code?: string };
      message = data.message ?? data.code ?? message;
      brevoCode = data.code ?? null;
    } catch {
      /* non-JSON error body */
    }
    // Never include the request body (could carry recipient emails) or key.
    throw new BrevoApiError({
      method: init?.method ?? "GET",
      path,
      status: res.status,
      brevoCode,
      message,
    });
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function ensureFolder(): Promise<number> {
  const data = await brevoFetch<{
    folders?: Array<{ id: number; name: string }>;
  }>("/contacts/folders?limit=50&offset=0");
  const found = data.folders?.find((f) => f.name === BREVO_FOLDER_NAME);
  if (found) return found.id;
  const created = await brevoFetch<{ id: number }>("/contacts/folders", {
    method: "POST",
    body: { name: BREVO_FOLDER_NAME },
  });
  return created.id;
}

/** Find-or-create one of our named lists; returns the Brevo list id. */
export async function ensureList(name: string): Promise<number> {
  for (let offset = 0; offset < 500; offset += 50) {
    const data = await brevoFetch<{
      lists?: Array<{ id: number; name: string }>;
      count?: number;
    }>(`/contacts/lists?limit=50&offset=${offset}`);
    const found = data.lists?.find((l) => l.name === name);
    if (found) return found.id;
    if (!data.lists || data.lists.length < 50) break;
  }
  const folderId = await ensureFolder();
  const created = await brevoFetch<{ id: number }>("/contacts/lists", {
    method: "POST",
    body: { name, folderId },
  });
  return created.id;
}

/**
 * Create a brand-new list for ONE batch. Batch lists are immutable by
 * convention: they are never cleared or reused, so a concurrently running
 * batch can never swap another batch's audience out from under its send
 * (the shared-mutable-list contamination class of bug).
 */
export async function createBatchList(name: string): Promise<number> {
  const folderId = await ensureFolder();
  const created = await brevoFetch<{ id: number }>("/contacts/lists", {
    method: "POST",
    body: { name: name.slice(0, 150), folderId },
  });
  return created.id;
}

export type BrevoBatchContact = {
  email: string;
  firstName: string;
  /** Signed unsubscribe token → per-recipient visible unsubscribe link. */
  unsubscribeToken: string;
};

/**
 * Upsert the batch's contacts into the list. updateEnabled keeps existing
 * Brevo-side state (e.g. their blacklist flag) intact.
 */
export async function upsertContactsIntoList(
  listId: number,
  contacts: BrevoBatchContact[],
): Promise<void> {
  for (const contact of contacts) {
    await brevoFetch("/contacts", {
      method: "POST",
      body: {
        email: contact.email,
        updateEnabled: true,
        listIds: [listId],
        attributes: {
          FIRSTNAME: contact.firstName,
          EA_UNSUB_TOKEN: contact.unsubscribeToken,
        },
      },
    });
  }
}

/**
 * Create a classic campaign targeting the list and trigger the send.
 * Returns the Brevo campaign id. The caller stores the id BEFORE sendNow so
 * a crash in between is detectable (no silent duplicate sends).
 */
export async function createCampaign(opts: {
  name: string;
  subject: string;
  previewText: string;
  htmlContent: string;
  listId: number;
}): Promise<number> {
  const created = await brevoFetch<{ id: number }>("/emailCampaigns", {
    method: "POST",
    body: {
      name: opts.name,
      subject: opts.subject,
      previewText: opts.previewText,
      type: "classic",
      sender: CAMPAIGN_SENDER,
      replyTo: CAMPAIGN_SENDER.email,
      htmlContent: opts.htmlContent,
      recipients: { listIds: [opts.listId] },
      // Never CC/BCC — Brevo campaigns have no CC concept, and we never
      // add one via params.
    },
  });
  return created.id;
}

export async function sendCampaignNow(brevoCampaignId: number): Promise<void> {
  await brevoFetch(`/emailCampaigns/${brevoCampaignId}/sendNow`, {
    method: "POST",
    body: {},
  });
}

/**
 * Brevo-side campaign status ('sent', 'queued', 'draft', 'inProcess', …) or
 * null when the campaign no longer exists. Used to decide when deleting a
 * batch's temporary list can no longer affect an active send.
 */
export async function getCampaignStatus(
  brevoCampaignId: number,
): Promise<string | null> {
  try {
    const data = await brevoFetch<{ status?: string }>(
      `/emailCampaigns/${brevoCampaignId}`,
    );
    return data?.status ?? null;
  } catch (err) {
    if (err instanceof BrevoApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Delete a temporary batch list. Idempotent: a 404 (already gone) counts as
 * success. Deletes ONLY the remote list — contacts themselves and all local
 * snapshot/consent/audit rows are untouched.
 */
export async function deleteList(listId: number): Promise<void> {
  try {
    await brevoFetch(`/contacts/lists/${listId}`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof BrevoApiError && err.status === 404) return;
    throw err;
  }
}

/**
 * Delete a Brevo campaign that was created but DEFINITELY never sent
 * (explicit sendNow rejection). Idempotent via 404-as-success. Never called
 * for campaigns whose send outcome is ambiguous.
 */
export async function deleteCampaign(brevoCampaignId: number): Promise<void> {
  try {
    await brevoFetch(`/emailCampaigns/${brevoCampaignId}`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof BrevoApiError && err.status === 404) return;
    throw err;
  }
}
