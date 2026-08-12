import { describe, it, beforeEach, afterAll, expect, vi } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  earlyAccessRegistrationsTable,
  earlyAccessEventsTable,
} from "@workspace/db/schema";
import { eq, inArray, like, sql } from "drizzle-orm";

// Storage is the source of truth; email transport is mocked so tests never
// hold real transport creds and never produce real Brevo traffic (belt and
// braces: test-setup.ts also strips all transport env vars).
vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendEarlyAccessNotificationEmail: vi.fn(async () => "brevo" as const),
    sendEarlyAccessConfirmationEmail: vi.fn(async () => "brevo" as const),
  };
});

import app from "../app";
import {
  sendEarlyAccessConfirmationEmail,
  sendEarlyAccessNotificationEmail,
} from "../lib/email";
import {
  LAUNCH_CONSENT_VERSION,
  MARKETING_CONSENT_VERSION,
} from "../lib/early-access-consent";

const notifyMock = vi.mocked(sendEarlyAccessNotificationEmail);
const confirmMock = vi.mocked(sendEarlyAccessConfirmationEmail);

// Unique suffix keeps fixtures isolated on the shared dev database.
const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `ea-${label}-${SUFFIX}@example.test`;

const VALID = {
  name: "Test Person",
  email: emailFor("main"),
  type: "customer",
  town: "MK44",
  message: "Looking forward to it",
  consent: true,
  _hp: "",
  _t: null,
};

function submit(body: Record<string, unknown>) {
  return request(app).post("/api/early-access").send(body);
}

function confirm(token: unknown) {
  return request(app).post("/api/early-access/confirm").send({ token });
}

/** Raw token from the confirmUrl of the LAST confirmation email "sent". */
function lastEmailedToken(): string {
  const call = confirmMock.mock.calls.at(-1);
  expect(call, "expected a confirmation email").toBeDefined();
  const url = new URL(call![0].confirmUrl);
  const token = url.searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
}

async function getRegistration(email: string) {
  const [row] = await db
    .select()
    .from(earlyAccessRegistrationsTable)
    .where(
      eq(earlyAccessRegistrationsTable.emailNormalized, email.toLowerCase()),
    );
  return row;
}

async function getEvents(registrationId: number) {
  return db
    .select()
    .from(earlyAccessEventsTable)
    .where(eq(earlyAccessEventsTable.registrationId, registrationId))
    .orderBy(earlyAccessEventsTable.id);
}

async function cleanupFixtures() {
  const rows = await db
    .select({ id: earlyAccessRegistrationsTable.id })
    .from(earlyAccessRegistrationsTable)
    .where(
      like(earlyAccessRegistrationsTable.emailNormalized, `%${SUFFIX}%`),
    );
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db
      .delete(earlyAccessEventsTable)
      .where(inArray(earlyAccessEventsTable.registrationId, ids));
    await db
      .delete(earlyAccessRegistrationsTable)
      .where(inArray(earlyAccessRegistrationsTable.id, ids));
  }
}

beforeEach(async () => {
  notifyMock.mockClear();
  confirmMock.mockClear();
  confirmMock.mockImplementation(async () => "brevo" as const);
  await cleanupFixtures();
  // Each test submits from the same test IP; keep the per-IP limiter fresh.
  await db.execute(sql`DELETE FROM rate_limit_hits`);
});

afterAll(cleanupFixtures);

describe("POST /api/early-access (double opt-in submission)", () => {
  it("stores a PENDING registration: no consent active, hashed token, audited send", async () => {
    const res = await submit(VALID);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await getRegistration(VALID.email);
    expect(row).toBeDefined();
    expect(row.name).toBe("Test Person");
    // NOT eligible for anything until confirmed:
    expect(row.launchConsentAt).toBeNull();
    expect(row.marketingConsentAt).toBeNull();
    expect(row.confirmedAt).toBeNull();
    // Pending request stored with wording versions + submission timestamp:
    expect(row.pendingRequestedAt).toBeInstanceOf(Date);
    expect(row.pendingLaunchConsentVersion).toBe(LAUNCH_CONSENT_VERSION);
    expect(row.pendingMarketingConsentVersion).toBeNull();
    expect(row.confirmationTokenExpiresAt!.getTime()).toBeGreaterThan(
      Date.now() + 47 * 60 * 60 * 1000,
    );

    // Only a SHA-256 hash is stored — never the raw token.
    const rawToken = lastEmailedToken();
    expect(row.confirmationTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.confirmationTokenHash).not.toBe(rawToken);
    expect(JSON.stringify(row)).not.toContain(rawToken);

    const events = await getEvents(row.id);
    expect(events.map((e) => e.kind)).toEqual([
      "REGISTERED",
      "CONFIRMATION_SENT",
    ]);
    // Audit records the real dispatch channel, never the token/URL.
    expect((events[1].details as any).channel).toBe("brevo");
    expect((events[1].details as any).ok).toBe(true);
    expect(JSON.stringify(events)).not.toContain(rawToken);

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it("records send failure honestly when the transport reports no delivery", async () => {
    confirmMock.mockImplementation(async () => "none" as const);
    await submit({ ...VALID, email: emailFor("nosend") });
    const row = await getRegistration(emailFor("nosend"));
    const events = await getEvents(row.id);
    const sendEvent = events.find((e) => e.kind === "CONFIRMATION_SENT");
    expect((sendEvent!.details as any).channel).toBe("none");
    expect((sendEvent!.details as any).ok).toBe(false);
  });

  it("stores the marketing request as pending only (explicit boolean true)", async () => {
    await submit({ ...VALID, email: emailFor("mkt"), marketingConsent: true });
    const row = await getRegistration(emailFor("mkt"));
    expect(row.pendingMarketingConsentVersion).toBe(MARKETING_CONSENT_VERSION);
    expect(row.marketingConsentAt).toBeNull(); // not active yet

    await submit({
      ...VALID,
      email: emailFor("truthy"),
      marketingConsent: "yes",
    });
    const truthy = await getRegistration(emailFor("truthy"));
    expect(truthy.pendingMarketingConsentVersion).toBeNull();
  });

  it("returns the identical generic response for new and repeat submissions", async () => {
    const email = emailFor("generic");
    const first = await submit({ ...VALID, email });
    const second = await submit({ ...VALID, email });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("repeat submission replaces the previous token (old link stops working)", async () => {
    const email = emailFor("replace");
    await submit({ ...VALID, email });
    const oldToken = lastEmailedToken();
    await submit({ ...VALID, email });
    const newToken = lastEmailedToken();
    expect(newToken).not.toBe(oldToken);

    const oldRes = await confirm(oldToken);
    expect(oldRes.status).toBe(400);
    const newRes = await confirm(newToken);
    expect(newRes.status).toBe(200);
  });

  it("caps confirmation emails per address per day, keeping the live link valid", async () => {
    const email = emailFor("cap");
    await submit({ ...VALID, email });
    await submit({ ...VALID, email });
    await submit({ ...VALID, email });
    expect(confirmMock).toHaveBeenCalledTimes(3);
    const capToken = lastEmailedToken();

    const fourth = await submit({ ...VALID, email });
    expect(fourth.status).toBe(200); // generic response either way
    expect(confirmMock).toHaveBeenCalledTimes(3); // no 4th email

    // The 3rd emailed link is still the live one.
    const res = await confirm(capToken);
    expect(res.status).toBe(200);
  });

  it("holds the cap under CONCURRENT submissions (reservation is transactional)", async () => {
    const email = emailFor("racecap");
    // 5 parallel submissions for the same address: row-lock serialisation +
    // in-transaction send reservation must yield at most 3 emails.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => submit({ ...VALID, email })),
    );
    for (const r of results) expect(r.status).toBe(200);
    expect(confirmMock.mock.calls.length).toBeLessThanOrEqual(3);

    const row = await getRegistration(email);
    const events = await getEvents(row.id);
    const sends = events.filter((e) => e.kind === "CONFIRMATION_SENT");
    expect(sends.length).toBeLessThanOrEqual(3);
    expect(sends.length).toBe(confirmMock.mock.calls.length);
  });

  it("sends nothing new when a confirmed subscriber resubmits with nothing to confirm", async () => {
    const email = emailFor("settled");
    await submit({ ...VALID, email, marketingConsent: true });
    await confirm(lastEmailedToken());
    confirmMock.mockClear();

    await submit({ ...VALID, email, marketingConsent: true });
    expect(confirmMock).not.toHaveBeenCalled();
    const row = await getRegistration(email);
    expect(row.confirmedAt).toBeInstanceOf(Date);
  });

  it("never sends a confirmation email to an admin-suppressed address", async () => {
    const email = emailFor("suppressed");
    await submit({ ...VALID, email });
    const row = await getRegistration(email);
    await db
      .update(earlyAccessRegistrationsTable)
      .set({ unsubscribedAt: new Date(), unsubscribeSource: "admin" })
      .where(eq(earlyAccessRegistrationsTable.id, row.id));
    confirmMock.mockClear();

    await submit({ ...VALID, email, marketingConsent: true });
    expect(confirmMock).not.toHaveBeenCalled();
    const after = await getRegistration(email);
    expect(after.unsubscribeSource).toBe("admin");
    const events = await getEvents(row.id);
    const detailsUpdated = events.filter((e) => e.kind === "DETAILS_UPDATED").pop();
    expect((detailsUpdated!.details as any).confirmationWithheld).toBe(
      "admin_suppressed",
    );
  });

  it("filled honeypot pretends success, stores nothing and sends nothing", async () => {
    const email = emailFor("bot");
    const res = await submit({ ...VALID, email, _hp: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(await getRegistration(email)).toBeUndefined();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("rejects missing consent, bad email and unknown type", async () => {
    for (const bad of [
      { ...VALID, consent: false },
      { ...VALID, email: "not-an-email" },
      { ...VALID, type: "alien" },
    ]) {
      const res = await submit(bad);
      expect(res.status).toBe(400);
    }
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("preserves a Phase 1 legacy row's consent until a fresh confirmation", async () => {
    const email = emailFor("legacy");
    const legacyConsentAt = new Date("2026-08-01T00:00:00Z");
    await db.insert(earlyAccessRegistrationsTable).values({
      name: "Legacy Person",
      email,
      emailNormalized: email,
      audienceType: "customer",
      launchConsentAt: legacyConsentAt,
      launchConsentVersion: "launch-v1-legacy",
    });

    await submit({ ...VALID, email });
    const row = await getRegistration(email);
    // Existing classification untouched until the person confirms:
    expect(row.launchConsentVersion).toBe("launch-v1-legacy");
    expect(row.launchConsentAt!.getTime()).toBe(legacyConsentAt.getTime());
    expect(row.confirmedAt).toBeNull();
    // …but a confirmation flow was offered:
    expect(row.pendingLaunchConsentVersion).toBe(LAUNCH_CONSENT_VERSION);
    expect(confirmMock).toHaveBeenCalledTimes(1);

    await confirm(lastEmailedToken());
    const after = await getRegistration(email);
    expect(after.confirmedAt).toBeInstanceOf(Date);
    expect(after.launchConsentVersion).toBe(LAUNCH_CONSENT_VERSION);
  });
});

describe("POST /api/early-access/confirm", () => {
  it("activates launch consent only when marketing was not requested", async () => {
    const email = emailFor("launchonly");
    await submit({ ...VALID, email });
    const res = await confirm(lastEmailedToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await getRegistration(email);
    expect(row.confirmedAt).toBeInstanceOf(Date);
    expect(row.confirmationTokenUsedAt).toBeInstanceOf(Date);
    expect(row.launchConsentAt).toBeInstanceOf(Date);
    expect(row.launchConsentVersion).toBe(LAUNCH_CONSENT_VERSION);
    expect(row.marketingConsentAt).toBeNull();

    const kinds = (await getEvents(row.id)).map((e) => e.kind);
    expect(kinds).toContain("EMAIL_CONFIRMED");
    expect(kinds).toContain("LAUNCH_CONSENT");
    expect(kinds).not.toContain("MARKETING_CONSENT");
  });

  it("activates launch + marketing when marketing was explicitly requested", async () => {
    const email = emailFor("both");
    await submit({ ...VALID, email, marketingConsent: true });
    await confirm(lastEmailedToken());

    const row = await getRegistration(email);
    expect(row.launchConsentVersion).toBe(LAUNCH_CONSENT_VERSION);
    expect(row.marketingConsentAt).toBeInstanceOf(Date);
    expect(row.marketingConsentVersion).toBe(MARKETING_CONSENT_VERSION);
    const events = await getEvents(row.id);
    const mkt = events.find((e) => e.kind === "MARKETING_CONSENT");
    expect(mkt!.wordingVersion).toBe(MARKETING_CONSENT_VERSION);
  });

  it("rejects an expired token with the same generic message as an unknown one", async () => {
    const email = emailFor("expired");
    await submit({ ...VALID, email });
    const token = lastEmailedToken();
    const row = await getRegistration(email);
    await db
      .update(earlyAccessRegistrationsTable)
      .set({ confirmationTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(earlyAccessRegistrationsTable.id, row.id));

    const expired = await confirm(token);
    const unknown = await confirm("A".repeat(43));
    const malformed = await confirm("nope");
    expect(expired.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(expired.body).toEqual(unknown.body);
    expect(malformed.body).toEqual(unknown.body);

    const after = await getRegistration(email);
    expect(after.launchConsentAt).toBeNull(); // nothing activated
  });

  it("is single-use and idempotent: replay succeeds without duplicate events", async () => {
    const email = emailFor("replay");
    await submit({ ...VALID, email });
    const token = lastEmailedToken();
    expect((await confirm(token)).status).toBe(200);
    expect((await confirm(token)).status).toBe(200); // idempotent replay

    const row = await getRegistration(email);
    const events = await getEvents(row.id);
    expect(events.filter((e) => e.kind === "EMAIL_CONFIRMED")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "LAUNCH_CONSENT")).toHaveLength(1);
  });

  it("concurrent confirmations produce exactly one set of consent events", async () => {
    const email = emailFor("race");
    await submit({ ...VALID, email });
    const token = lastEmailedToken();

    const results = await Promise.all([
      confirm(token),
      confirm(token),
      confirm(token),
    ]);
    for (const r of results) expect(r.status).toBe(200);

    const row = await getRegistration(email);
    const events = await getEvents(row.id);
    expect(events.filter((e) => e.kind === "EMAIL_CONFIRMED")).toHaveLength(1);
  });

  it("GET requests (link scanners) can never activate consent", async () => {
    const email = emailFor("scanner");
    await submit({ ...VALID, email });
    const token = lastEmailedToken();

    // Scanners follow the emailed URL with GETs; the API accepts only an
    // explicit POST — a GET (even with the token) activates nothing.
    const get = await request(app).get(
      `/api/early-access/confirm?token=${token}`,
    );
    expect(get.status).toBe(404);

    const row = await getRegistration(email);
    expect(row.confirmedAt).toBeNull();
    expect(row.launchConsentAt).toBeNull();

    // The explicit POST still works afterwards.
    expect((await confirm(token)).status).toBe(200);
  });

  it("verified resubscription lifts a VOLUNTARY unsubscribe only", async () => {
    const email = emailFor("resub");
    await submit({ ...VALID, email, marketingConsent: true });
    await confirm(lastEmailedToken());
    const row = await getRegistration(email);
    await db
      .update(earlyAccessRegistrationsTable)
      .set({ unsubscribedAt: new Date(), unsubscribeSource: "user" })
      .where(eq(earlyAccessRegistrationsTable.id, row.id));

    // 1. New explicit submission → 2. new confirmation email…
    await submit({ ...VALID, email, marketingConsent: true });
    let after = await getRegistration(email);
    // …the submission ALONE must not restore anything:
    expect(after.unsubscribedAt).toBeInstanceOf(Date);

    // 3. explicit confirmation action → 4. fresh consent events + lift.
    await confirm(lastEmailedToken());
    after = await getRegistration(email);
    expect(after.unsubscribedAt).toBeNull();
    expect(after.unsubscribeSource).toBeNull();
    expect(after.marketingConsentAt).toBeInstanceOf(Date);
    const events = await getEvents(row.id);
    const confirmedEvent = events.filter((e) => e.kind === "EMAIL_CONFIRMED").pop();
    expect((confirmedEvent!.details as any).unsubscribeLifted).toBe("user");
  });

  it("NEVER lifts an admin suppression, even with a valid confirmation", async () => {
    const email = emailFor("adminlock");
    await submit({ ...VALID, email, marketingConsent: true });
    const token = lastEmailedToken();
    const row = await getRegistration(email);
    // Suppressed AFTER the email went out — the outstanding link must not
    // override the admin decision.
    await db
      .update(earlyAccessRegistrationsTable)
      .set({ unsubscribedAt: new Date(), unsubscribeSource: "admin" })
      .where(eq(earlyAccessRegistrationsTable.id, row.id));

    expect((await confirm(token)).status).toBe(200);
    const after = await getRegistration(email);
    expect(after.unsubscribedAt).toBeInstanceOf(Date);
    expect(after.unsubscribeSource).toBe("admin");
    // Consent evidence is still kept for a future admin decision:
    expect(after.confirmedAt).toBeInstanceOf(Date);
    const events = await getEvents(row.id);
    const confirmedEvent = events.filter((e) => e.kind === "EMAIL_CONFIRMED").pop();
    expect((confirmedEvent!.details as any).suppressionRetained).toBe("admin");
  });
});
