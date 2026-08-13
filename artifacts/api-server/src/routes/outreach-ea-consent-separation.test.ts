import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  earlyAccessRegistrationsTable,
  earlyAccessEventsTable,
  outreachContactsTable,
  outreachSuppressionsTable,
  outreachEventsTable,
} from "@workspace/db/schema";
import { eq, inArray, like, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Task #130 — Outreach suppression is PERMANENT and strictly separated from
// Early Access consent.
//
// Decision under test:
// - A previous voluntary Outreach unsubscribe/objection remains permanently
//   recorded in the Outreach suppression list and must never be silently
//   removed.
// - The same person may later self-register through the genuine Early Access
//   form. New EA permission activates ONLY via their own submission +
//   double opt-in email confirmation; marketing only with the explicit
//   optional tick; the new consent covers ONLY the confirmed EA scopes.
// - EA consent NEVER restores Outreach eligibility.
// - The full history of the earlier objection and the later consent is kept.
// - Complaint / hard-bounce / fraud-security block / legal block / admin
//   suppression can never be overridden by a new form submission.
// ---------------------------------------------------------------------------

vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendEarlyAccessNotificationEmail: vi.fn(async () => "brevo" as const),
    sendEarlyAccessConfirmationEmail: vi.fn(async () => "brevo" as const),
  };
});

import app from "../app";
import { generateToken } from "../lib/auth";
import { sendEarlyAccessConfirmationEmail } from "../lib/email";
import { buildOutreachUnsubscribeToken } from "../lib/early-access-unsubscribe";
import {
  LAUNCH_CONSENT_VERSION,
  MARKETING_CONSENT_VERSION,
} from "../lib/early-access-consent";

const confirmMock = vi.mocked(sendEarlyAccessConfirmationEmail);

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `sep-${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];
let adminToken: string;

const LIA =
  "LIA documented 2026-08-01 ref LIA-001: balancing test passed for one B2B recruitment message with clear opt-out.";
const COMPANY_EVIDENCE =
  "Verified on Companies House register 2026-08-01, active status, name matches website.";
const RELEVANCE =
  "UK trade business relevant to MyLocalTrade trader recruitment services.";

function b2bFields(label: string) {
  return {
    email: emailFor(label),
    contact_name: "Jane Smith",
    company_name: `Separation ${label} Ltd`,
    business_type: "limited_company",
    company_number: "12345678",
    website: "https://example.test",
    source_name: "Companies House",
    source_detail: "https://example.test/companies-house/12345678",
    date_obtained: "2026-08-01",
    country: "United Kingdom",
    lawful_route: "corporate_b2b",
    b2b_company_evidence: COMPANY_EVIDENCE,
    b2b_relevance_evidence: RELEVANCE,
    b2b_lia_evidence: LIA,
  };
}

async function addContact(fields: Record<string, string>) {
  return request(app)
    .post("/api/admin/outreach-contacts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(fields);
}

function eaSubmit(email: string, marketing: boolean) {
  return request(app).post("/api/early-access").send({
    name: "Reformed Person",
    email,
    type: "trader",
    town: "MK44",
    consent: true,
    marketingConsent: marketing,
    _hp: "",
  });
}

function eaConfirm(token: string) {
  return request(app).post("/api/early-access/confirm").send({ token });
}

/** Raw token from the confirmUrl of the LAST confirmation email "sent". */
function lastEmailedToken(): string {
  const call = confirmMock.mock.calls.at(-1);
  expect(call, "expected a confirmation email").toBeDefined();
  const token = new URL(call![0].confirmUrl).searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
}

async function suppressionRow(email: string) {
  const [row] = await db
    .select()
    .from(outreachSuppressionsTable)
    .where(eq(outreachSuppressionsTable.emailNormalized, email.toLowerCase()));
  return row;
}

async function eaRow(email: string) {
  const [row] = await db
    .select()
    .from(earlyAccessRegistrationsTable)
    .where(
      eq(earlyAccessRegistrationsTable.emailNormalized, email.toLowerCase()),
    );
  return row;
}

async function cleanup() {
  const eaRows = await db
    .select({ id: earlyAccessRegistrationsTable.id })
    .from(earlyAccessRegistrationsTable)
    .where(like(earlyAccessRegistrationsTable.emailNormalized, `%${SUFFIX}%`));
  const eaIds = eaRows.map((r) => r.id);
  if (eaIds.length) {
    await db
      .delete(earlyAccessEventsTable)
      .where(inArray(earlyAccessEventsTable.registrationId, eaIds));
    await db
      .delete(earlyAccessRegistrationsTable)
      .where(inArray(earlyAccessRegistrationsTable.id, eaIds));
  }
  const contacts = await db
    .select({ id: outreachContactsTable.id })
    .from(outreachContactsTable)
    .where(like(outreachContactsTable.emailNormalized, `%${SUFFIX}%`));
  const contactIds = contacts.map((c) => c.id);
  if (contactIds.length) {
    await db
      .delete(outreachEventsTable)
      .where(inArray(outreachEventsTable.contactId, contactIds));
    await db
      .delete(outreachContactsTable)
      .where(inArray(outreachContactsTable.id, contactIds));
  }
  await db
    .delete(outreachSuppressionsTable)
    .where(like(outreachSuppressionsTable.emailNormalized, `%${SUFFIX}%`));
  if (createdUserIds.length) {
    await db
      .delete(outreachEventsTable)
      .where(inArray(outreachEventsTable.performedBy, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
}

beforeAll(async () => {
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: emailFor("admin"),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: "Separation Test Admin",
      role: "admin",
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(admin.id);
  adminToken = generateToken(admin.id, "admin", 1);
});

afterAll(cleanup);

beforeEach(async () => {
  confirmMock.mockClear();
  confirmMock.mockImplementation(async () => "brevo" as const);
  // Limiter keys are IP-scoped and every suite runs from the same test IP,
  // so per-fixture scoping is impossible. Clearing exactly these prefixes is
  // the established convention of the sibling suites (early-access.test.ts,
  // outreach-contacts.test.ts) to keep the shared limiter fresh.
  await db.execute(
    sql`DELETE FROM rate_limit_hits WHERE key LIKE 'api%' OR key LIKE 'early-access%'`,
  );
});

describe("outreach objection → later genuine Early Access double opt-in", () => {
  it("activates exactly the confirmed EA scopes while the outreach suppression, contact block and full history remain untouched", async () => {
    const email = emailFor("reformed");

    // 1. Outreach contact exists, then voluntarily objects via the signed link.
    const created = await addContact(b2bFields("reformed"));
    expect(created.status).toBe(201);
    const contactId = created.body.contact.id as number;
    const unsub = await request(app)
      .post("/api/early-access/unsubscribe")
      .send({ token: buildOutreachUnsubscribeToken(contactId) });
    expect(unsub.status).toBe(200);

    const suppBefore = await suppressionRow(email);
    expect(suppBefore).toBeDefined();
    expect(suppBefore.reason).toBe("unsubscribed");
    expect(suppBefore.source).toBe("user_link");

    // 2. The same person self-registers via the public EA form, ticking the
    //    optional marketing box, and confirms by email (double opt-in).
    const submitted = await eaSubmit(email, true);
    expect(submitted.status).toBe(200);
    // The submission alone activates NOTHING.
    const pending = await eaRow(email);
    expect(pending.launchConsentAt).toBeNull();
    expect(pending.marketingConsentAt).toBeNull();

    const confirmed = await eaConfirm(lastEmailedToken());
    expect(confirmed.status).toBe(200);

    // 3. EA consent is active for exactly the confirmed scopes.
    const after = await eaRow(email);
    expect(after.launchConsentAt).not.toBeNull();
    expect(after.launchConsentVersion).toBe(LAUNCH_CONSENT_VERSION);
    expect(after.marketingConsentAt).not.toBeNull();
    expect(after.marketingConsentVersion).toBe(MARKETING_CONSENT_VERSION);

    // 4. The outreach suppression row is bit-for-bit the same one — never
    //    removed, replaced or rewritten by the EA flow.
    const suppAfter = await suppressionRow(email);
    expect(suppAfter).toBeDefined();
    expect(suppAfter.id).toBe(suppBefore.id);
    expect(suppAfter.reason).toBe(suppBefore.reason);
    expect(suppAfter.source).toBe(suppBefore.source);
    expect(suppAfter.createdAt.getTime()).toBe(suppBefore.createdAt.getTime());

    // 5. Outreach eligibility is NOT restored.
    const [contact] = await db
      .select()
      .from(outreachContactsTable)
      .where(eq(outreachContactsTable.id, contactId));
    expect(contact.unsubscribedAt).not.toBeNull();
    expect(contact.eligibilityStatus).toBe("blocked");
    const reAdd = await addContact(b2bFields("reformed"));
    expect(reAdd.status).toBe(409);

    // 6. Full history retained on both sides: the objection event AND the
    //    later consent events coexist.
    const outreachEvents = await db
      .select()
      .from(outreachEventsTable)
      .where(eq(outreachEventsTable.contactId, contactId));
    expect(outreachEvents.map((e) => e.kind)).toContain("CONTACT_UNSUBSCRIBED");
    const eaEvents = await db
      .select()
      .from(earlyAccessEventsTable)
      .where(eq(earlyAccessEventsTable.registrationId, after.id));
    const kinds = eaEvents.map((e) => e.kind);
    expect(kinds).toContain("REGISTERED");
    expect(kinds).toContain("LAUNCH_CONSENT");
    expect(kinds).toContain("MARKETING_CONSENT");
  });

  it("a recorded OBJECTION (real admin flow) survives EA double opt-in bit-for-bit, and without the marketing tick only the launch scope activates", async () => {
    const email = emailFor("launch-only");

    // Real objection flow: contact exists, admin records the objection.
    const created = await addContact(b2bFields("launch-only"));
    expect(created.status).toBe(201);
    const contactId = created.body.contact.id as number;
    const suppressed = await request(app)
      .post(`/api/admin/outreach-contacts/${contactId}/suppress`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "objection" });
    expect(suppressed.status).toBe(200);

    const before = await suppressionRow(email);
    expect(before).toBeDefined();
    expect(before.reason).toBe("objection");
    expect(before.source).toBe("admin");

    await eaSubmit(email, false);
    await eaConfirm(lastEmailedToken());

    // Launch scope only — the unticked marketing box grants nothing.
    const after = await eaRow(email);
    expect(after.launchConsentAt).not.toBeNull();
    expect(after.marketingConsentAt).toBeNull();
    expect(after.marketingConsentVersion).toBeNull();

    // The objection suppression row is EXACTLY the one recorded before —
    // never deleted, recreated or rewritten.
    const supp = await suppressionRow(email);
    expect(supp).toBeDefined();
    expect(supp.id).toBe(before.id);
    expect(supp.reason).toBe("objection");
    expect(supp.source).toBe("admin");
    expect(supp.createdAt.getTime()).toBe(before.createdAt.getTime());

    // The objection audit event is retained alongside the later EA consent.
    const events = await db
      .select()
      .from(outreachEventsTable)
      .where(eq(outreachEventsTable.contactId, contactId));
    expect(events.map((e) => e.kind)).toContain("CONTACT_OBJECTED");
    expect(supp.createdAt.getTime()).toBeLessThanOrEqual(
      after.launchConsentAt!.getTime(),
    );
  });
});

describe("non-voluntary outreach suppressions survive any new form submission", () => {
  // complaint = spam complaint, hard_bounce = deliverability, blocked =
  // fraud/security block, admin = admin/legal block. None of these may ever
  // be removed or rewritten by the public EA form + confirmation.
  const CASES = [
    { label: "complaint", reason: "complaint", source: "brevo_webhook" },
    { label: "bounce", reason: "hard_bounce", source: "brevo_webhook" },
    { label: "fraud", reason: "blocked", source: "brevo_webhook" },
    { label: "legal", reason: "admin", source: "admin" },
  ] as const;

  it.each(CASES)(
    "$reason suppression is untouched by EA submit + double opt-in",
    async ({ label, reason, source }) => {
      const email = emailFor(`hard-${label}`);
      const [before] = await db
        .insert(outreachSuppressionsTable)
        .values({ emailNormalized: email.toLowerCase(), reason, source })
        .returning();

      await eaSubmit(email, true);
      const confirmed = await eaConfirm(lastEmailedToken());
      expect(confirmed.status).toBe(200);

      // EA consent may exist (it is a separate lawful basis with its own
      // proof of mailbox ownership)...
      const ea = await eaRow(email);
      expect(ea.launchConsentAt).not.toBeNull();

      // ...but the suppression row is exactly the one inserted above.
      const supp = await suppressionRow(email);
      expect(supp).toBeDefined();
      expect(supp.id).toBe(before.id);
      expect(supp.reason).toBe(reason);
      expect(supp.source).toBe(source);
      expect(supp.createdAt.getTime()).toBe(before.createdAt.getTime());

      // And outreach re-import stays blocked.
      const reAdd = await addContact(b2bFields(`hard-${label}`));
      expect(reAdd.status).toBe(409);
    },
  );
});
