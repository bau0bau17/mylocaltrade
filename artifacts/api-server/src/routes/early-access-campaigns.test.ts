import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  earlyAccessRegistrationsTable,
  earlyAccessEventsTable,
  earlyAccessCampaignsTable,
  earlyAccessCampaignRecipientsTable,
  earlyAccessCampaignBatchesTable,
  earlyAccessCampaignEventsTable,
} from "@workspace/db/schema";
import { eq, inArray, like } from "drizzle-orm";

// No real Brevo traffic in tests, ever: the whole marketing client is
// mocked. The safety classes/constants stay real so error paths behave.
vi.mock("../lib/brevo-marketing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/brevo-marketing")>();
  return {
    ...actual,
    marketingSendingStatus: vi.fn(() => ({
      enabled: false as const,
      reason: "MARKETING_BREVO_ENABLED is not set to 'true'",
    })),
    createBatchList: vi.fn(async () => 111),
    upsertContactsIntoList: vi.fn(async () => undefined),
    createCampaign: vi.fn(async () => 999),
    sendCampaignNow: vi.fn(async () => undefined),
    getCampaignStatus: vi.fn(async () => "sent"),
    deleteList: vi.fn(async () => undefined),
    deleteCampaign: vi.fn(async () => undefined),
  };
});

// Email transport mocked: test sends + form confirmation emails never leave.
vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendEarlyAccessConfirmationEmail: vi.fn(async () => "brevo" as const),
    sendEarlyAccessNotificationEmail: vi.fn(async () => "brevo" as const),
    sendEarlyAccessCampaignTestEmail: vi.fn(async () => "brevo" as const),
  };
});

import app from "../app";
import { generateToken } from "../lib/auth";
import { LAUNCH_CONSENT_VERSION } from "../lib/early-access-consent";
import {
  marketingSendingStatus,
  createCampaign,
  upsertContactsIntoList,
  sendCampaignNow,
  getCampaignStatus,
  deleteList,
  deleteCampaign,
  BrevoApiError,
} from "../lib/brevo-marketing";
import {
  billingPeriodStart,
  effectiveDailyCap,
  sendAllowanceModel,
} from "../lib/early-access-campaigns";
import {
  sendEarlyAccessCampaignTestEmail,
  sendEarlyAccessConfirmationEmail,
} from "../lib/email";
import {
  buildUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../lib/early-access-unsubscribe";

const statusMock = vi.mocked(marketingSendingStatus);
const createCampaignMock = vi.mocked(createCampaign);
const upsertMock = vi.mocked(upsertContactsIntoList);
const sendNowMock = vi.mocked(sendCampaignNow);
const campaignStatusMock = vi.mocked(getCampaignStatus);
const deleteListMock = vi.mocked(deleteList);
const deleteCampaignMock = vi.mocked(deleteCampaign);
const testEmailMock = vi.mocked(sendEarlyAccessCampaignTestEmail);
const confirmEmailMock = vi.mocked(sendEarlyAccessConfirmationEmail);

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `eacamp-${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];
let adminToken: string;
let adminEmail: string;
let customerToken: string;

async function createUser(role: "customer" | "admin") {
  const email = emailFor(`user-${role}-${createdUserIds.length}`);
  const [u] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `EA Campaign Test ${role}`,
      role,
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return { id: u.id, email };
}

/** Confirmed + consented registration (eligible unless overridden). */
async function seedRegistration(
  label: string,
  overrides: Partial<typeof earlyAccessRegistrationsTable.$inferInsert> = {},
) {
  const [row] = await db
    .insert(earlyAccessRegistrationsTable)
    .values({
      name: `Camp ${label}`,
      email: emailFor(label),
      emailNormalized: emailFor(label),
      audienceType: "customer",
      confirmedAt: new Date(),
      launchConsentAt: new Date(),
      launchConsentVersion: LAUNCH_CONSENT_VERSION,
      marketingConsentAt: new Date(),
      marketingConsentVersion: "marketing-v1-2026-08-12",
      ...overrides,
    })
    .returning({ id: earlyAccessRegistrationsTable.id });
  return row.id;
}

async function createDraft(
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const res = await request(app)
    .post("/api/admin/early-access/campaigns")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      type: "marketing",
      name: `Test campaign ${SUFFIX}`,
      subject: "Big news from MyLocalTrade",
      previewText: "A quick update",
      heading: "We have news",
      bodyText: "Hello!\n\nSomething exciting is coming.",
      ctaLabel: "See more",
      ctaUrl: "https://mylocaltrade.co.uk/news",
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.campaign.id as number;
}

async function queueCampaign(id: number): Promise<number> {
  const aud = await request(app)
    .get(`/api/admin/early-access/campaigns/${id}/audience`)
    .set("Authorization", `Bearer ${adminToken}`);
  expect(aud.status).toBe(200);
  const res = await request(app)
    .post(`/api/admin/early-access/campaigns/${id}/queue`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ confirmation: aud.body.confirmationPhrase });
  expect(res.status).toBe(200);
  return res.body.snapshotCount as number;
}

async function cleanup() {
  const camps = await db
    .select({ id: earlyAccessCampaignsTable.id })
    .from(earlyAccessCampaignsTable)
    .where(like(earlyAccessCampaignsTable.name, `%${SUFFIX}%`));
  const campIds = camps.map((c) => c.id);
  if (campIds.length) {
    await db
      .delete(earlyAccessCampaignEventsTable)
      .where(inArray(earlyAccessCampaignEventsTable.campaignId, campIds));
    await db
      .delete(earlyAccessCampaignBatchesTable)
      .where(inArray(earlyAccessCampaignBatchesTable.campaignId, campIds));
    await db
      .delete(earlyAccessCampaignRecipientsTable)
      .where(inArray(earlyAccessCampaignRecipientsTable.campaignId, campIds));
    await db
      .delete(earlyAccessCampaignsTable)
      .where(inArray(earlyAccessCampaignsTable.id, campIds));
  }
  const regs = await db
    .select({ id: earlyAccessRegistrationsTable.id })
    .from(earlyAccessRegistrationsTable)
    .where(like(earlyAccessRegistrationsTable.emailNormalized, `%${SUFFIX}%`));
  const regIds = regs.map((r) => r.id);
  if (regIds.length) {
    await db
      .delete(earlyAccessCampaignRecipientsTable)
      .where(
        inArray(earlyAccessCampaignRecipientsTable.registrationId, regIds),
      );
    await db
      .delete(earlyAccessEventsTable)
      .where(inArray(earlyAccessEventsTable.registrationId, regIds));
    await db
      .delete(earlyAccessRegistrationsTable)
      .where(inArray(earlyAccessRegistrationsTable.id, regIds));
  }
  if (createdUserIds.length) {
    await db
      .delete(earlyAccessEventsTable)
      .where(inArray(earlyAccessEventsTable.performedBy, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
}

beforeAll(async () => {
  const admin = await createUser("admin");
  adminToken = generateToken(admin.id, "admin", 1);
  adminEmail = admin.email;
  const customer = await createUser("customer");
  customerToken = generateToken(customer.id, "customer", 1);
});

afterAll(cleanup);

beforeEach(async () => {
  vi.clearAllMocks();
  statusMock.mockReturnValue({
    enabled: false,
    reason: "MARKETING_BREVO_ENABLED is not set to 'true'",
  });
  delete process.env.BREVO_WEBHOOK_SECRET;
  await db.execute(
    // Shared-store limiters: clear so unrelated runs never starve us.
    // (Same pattern as the other early-access suites.)
    // eslint-disable-next-line drizzle/enforce-delete-with-where
    (await import("drizzle-orm")).sql`DELETE FROM rate_limit_hits WHERE key LIKE 'early-access%' OR key LIKE 'brevo-webhook%'`,
  );
});

describe("admin authz", () => {
  it("rejects anonymous and non-admin access to every campaign route", async () => {
    const anon = await request(app).get("/api/admin/early-access/campaigns");
    expect(anon.status).toBe(401);
    const customer = await request(app)
      .get("/api/admin/early-access/campaigns")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(customer.status).toBe(403);
    const post = await request(app)
      .post("/api/admin/early-access/campaigns")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ type: "launch", name: "nope" });
    expect(post.status).toBe(403);
  });
});

describe("draft editor validation", () => {
  it("rejects invalid type and non-HTTPS CTA URLs", async () => {
    const badType = await request(app)
      .post("/api/admin/early-access/campaigns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "spam", name: "x" });
    expect(badType.status).toBe(400);

    const badUrl = await request(app)
      .post("/api/admin/early-access/campaigns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        type: "marketing",
        name: `bad-url ${SUFFIX}`,
        ctaUrl: "http://insecure.example.com/x",
      });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.error).toMatch(/HTTPS/);

    const creds = await request(app)
      .post("/api/admin/early-access/campaigns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        type: "marketing",
        name: `cred-url ${SUFFIX}`,
        ctaUrl: "https://user:pass@example.com/x",
      });
    expect(creds.status).toBe(400);
  });

  it("blocks queueing while required content is missing", async () => {
    const id = await createDraft({ subject: "" });
    const res = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/queue`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirmation: "SEND TO 0 PEOPLE" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Subject/);
  });

  it("escapes admin-entered content in the rendered template", async () => {
    const id = await createDraft({
      heading: `<script>alert(1)</script>`,
      bodyText: `Line <b>one</b>\n\nLine "two"`,
    });
    const res = await request(app)
      .get(`/api/admin/early-access/campaigns/${id}/preview`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.html).not.toContain("<script>alert(1)</script>");
    expect(res.body.html).toContain("&lt;script&gt;");
    expect(res.body.html).toContain("&lt;b&gt;one&lt;/b&gt;");
    // Unsubscribe + privacy links are always present.
    expect(res.body.html).toContain("/unsubscribe");
    expect(res.body.html).toContain("/privacy-policy");
  });
});

describe("audience, queue snapshot and immutability", () => {
  it("computes eligibility server-side and rejects a stale confirmation phrase", async () => {
    await seedRegistration("aud-eligible");
    await seedRegistration("aud-noconsent", { marketingConsentAt: null });
    await seedRegistration("aud-pending", { confirmedAt: null });
    await seedRegistration("aud-unsub", {
      unsubscribedAt: new Date(),
      unsubscribeSource: "user",
    });
    const id = await createDraft();
    const aud = await request(app)
      .get(`/api/admin/early-access/campaigns/${id}/audience`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(aud.status).toBe(200);
    expect(aud.body.audience.eligible).toBeGreaterThanOrEqual(1);
    expect(aud.body.audience.excludedConsentMissing).toBeGreaterThanOrEqual(1);
    expect(aud.body.audience.excludedConfirmationPending).toBeGreaterThanOrEqual(1);
    expect(aud.body.audience.excludedUnsubscribedOrSuppressed).toBeGreaterThanOrEqual(1);
    expect(aud.body.confirmationPhrase).toBe(
      `SEND TO ${aud.body.audience.eligible} PEOPLE`,
    );

    const wrong = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/queue`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirmation: `SEND TO ${aud.body.audience.eligible + 5} PEOPLE` });
    expect(wrong.status).toBe(409);

    const snapshotCount = await queueCampaign(id);
    expect(snapshotCount).toBe(aud.body.audience.eligible);

    // Ineligible fixtures never entered the snapshot.
    const recips = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.campaignId, id));
    const emails = recips.map((r) => r.emailNormalized);
    expect(emails).toContain(emailFor("aud-eligible"));
    expect(emails).not.toContain(emailFor("aud-noconsent"));
    expect(emails).not.toContain(emailFor("aud-pending"));
    expect(emails).not.toContain(emailFor("aud-unsub"));

    // Content is immutable once queued; re-queueing is refused.
    const edit = await request(app)
      .patch(`/api/admin/early-access/campaigns/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "new name" });
    expect(edit.status).toBe(409);
    const requeue = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/queue`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirmation: aud.body.confirmationPhrase });
    expect(requeue.status).toBe(409);
  });

  it("only puts explicitly-consented recipients into launch vs marketing audiences", async () => {
    const launchOnly = await seedRegistration("launch-only", {
      marketingConsentAt: null,
      marketingConsentVersion: null,
    });
    const id = await createDraft({ type: "launch", name: `launch ${SUFFIX}` });
    await queueCampaign(id);
    const recips = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.campaignId, id));
    expect(
      recips.some((r) => r.registrationId === launchOnly),
    ).toBe(true);
  });
});

describe("batch sending", () => {
  it("refuses to touch Brevo while sending is disabled and releases recipients", async () => {
    await seedRegistration("batch-disabled");
    const id = await createDraft({ name: `disabled ${SUFFIX}` });
    await queueCampaign(id);
    const res = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("brevo_disabled");
    expect(createCampaignMock).not.toHaveBeenCalled();
    expect(sendNowMock).not.toHaveBeenCalled();
    const recips = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.campaignId, id));
    expect(recips.every((r) => r.status === "queued")).toBe(true);
    const [camp] = await db
      .select()
      .from(earlyAccessCampaignsTable)
      .where(eq(earlyAccessCampaignsTable.id, id));
    expect(camp.status).toBe("queued");
  });

  it("sends a batch through the mocked Brevo pipeline and finishes the campaign", async () => {
    statusMock.mockReturnValue({ enabled: true });
    const regId = await seedRegistration("batch-send");
    const id = await createDraft({ name: `send ${SUFFIX}` });
    await queueCampaign(id);
    const res = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sent).toBeGreaterThanOrEqual(1);
    expect(res.body.remaining).toBe(0);
    expect(["completed", "partially_failed"]).toContain(res.body.campaignStatus);

    // Our fixture went out with a personal unsubscribe token, no CC/BCC
    // possible (the client only ever passes list targeting).
    const contacts = upsertMock.mock.calls.flatMap((call) => call[1]);
    const mine = contacts.find((c) => c.email === emailFor("batch-send"));
    expect(mine).toBeDefined();
    expect(verifyUnsubscribeToken(mine!.unsubscribeToken)).toBe(regId);
    expect(createCampaignMock).toHaveBeenCalledOnce();
    expect(sendNowMock).toHaveBeenCalledWith(999);
    const campaignHtml = createCampaignMock.mock.calls[0][0].htmlContent;
    expect(campaignHtml).toContain("{{ contact.EA_UNSUB_TOKEN }}");
    expect(campaignHtml).toContain("{{ unsubscribe }}");

    const [recip] = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(
        eq(earlyAccessCampaignRecipientsTable.registrationId, regId),
      );
    expect(recip.status).toBe("sent");
    expect(recip.sentAt).not.toBeNull();
    const batches = await db
      .select()
      .from(earlyAccessCampaignBatchesTable)
      .where(eq(earlyAccessCampaignBatchesTable.campaignId, id));
    expect(batches[0].status).toBe("sent");
    expect(batches[0].brevoCampaignId).toBe(999);

    // Double-click safety: the finished campaign refuses another batch.
    const again = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("bad_status");
  });

  it("re-checks live opt-outs at batch time — snapshot never overrides them", async () => {
    statusMock.mockReturnValue({ enabled: true });
    const stayId = await seedRegistration("recheck-stay");
    const optOutId = await seedRegistration("recheck-optout");
    const suppressId = await seedRegistration("recheck-suppress");
    const id = await createDraft({ name: `recheck ${SUFFIX}` });
    await queueCampaign(id);
    // Opt-outs happen AFTER the snapshot:
    await db
      .update(earlyAccessRegistrationsTable)
      .set({ unsubscribedAt: new Date(), unsubscribeSource: "user" })
      .where(eq(earlyAccessRegistrationsTable.id, optOutId));
    await db
      .update(earlyAccessRegistrationsTable)
      .set({ emailSuppressedAt: new Date(), emailSuppressionReason: "hard_bounce" })
      .where(eq(earlyAccessRegistrationsTable.id, suppressId));

    const res = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBeGreaterThanOrEqual(2);

    const rows = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.campaignId, id));
    const byReg = new Map(rows.map((r) => [r.registrationId, r]));
    expect(byReg.get(stayId)!.status).toBe("sent");
    expect(byReg.get(optOutId)!.status).toBe("unsubscribed");
    expect(byReg.get(suppressId)!.status).toBe("suppressed");
    const sentEmails = upsertMock.mock.calls
      .flatMap((call) => call[1])
      .map((c) => c.email);
    expect(sentEmails).not.toContain(emailFor("recheck-optout"));
    expect(sentEmails).not.toContain(emailFor("recheck-suppress"));
  });

  it("stops at the daily cap and resumes the next day (waiting_quota)", async () => {
    statusMock.mockReturnValue({ enabled: true });
    const prev = process.env.MARKETING_DAILY_SEND_CAP;
    process.env.MARKETING_DAILY_SEND_CAP = "0";
    try {
      await seedRegistration("quota-blocked");
      const id = await createDraft({ name: `quota ${SUFFIX}` });
      await queueCampaign(id);
      const res = await request(app)
        .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(429);
      expect(res.body.code).toBe("quota_exhausted");
      const [camp] = await db
        .select()
        .from(earlyAccessCampaignsTable)
        .where(eq(earlyAccessCampaignsTable.id, id));
      expect(camp.status).toBe("waiting_quota");
      expect(sendNowMock).not.toHaveBeenCalled();

      // Quota back (next day): the same button continues the same campaign.
      process.env.MARKETING_DAILY_SEND_CAP = prev ?? "200";
      const cont = await request(app)
        .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(cont.status).toBe(200);
      expect(cont.body.ok).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MARKETING_DAILY_SEND_CAP;
      else process.env.MARKETING_DAILY_SEND_CAP = prev;
    }
  });
});

describe("pause / resume / cancel", () => {
  it("pauses and resumes a queued campaign; paused campaigns cannot send", async () => {
    await seedRegistration("pause-fixture");
    const id = await createDraft({ name: `pause ${SUFFIX}` });
    await queueCampaign(id);
    const pause = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/pause`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(pause.status).toBe(200);
    const blocked = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(blocked.status).toBe(409);
    const resume = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/resume`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(resume.status).toBe(200);
    expect(resume.body.campaign.status).toBe("queued");
  });

  it("cancels remaining recipients and is terminal", async () => {
    await seedRegistration("cancel-fixture");
    const id = await createDraft({ name: `cancel ${SUFFIX}` });
    await queueCampaign(id);
    const cancel = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelledRecipients).toBeGreaterThanOrEqual(1);
    const rows = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.campaignId, id));
    expect(rows.every((r) => r.status === "cancelled")).toBe(true);
    const send = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(send.status).toBe(409);
    const recancel = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(recancel.status).toBe(409);
  });
});

describe("test sends", () => {
  it("sends the test only to the requesting admin and enforces the daily limit", async () => {
    const id = await createDraft({ name: `testsend ${SUFFIX}` });
    const res = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/test-send`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "attacker@example.test" }); // must be ignored
    expect(res.status).toBe(200);
    expect(testEmailMock).toHaveBeenCalledOnce();
    expect(testEmailMock.mock.calls[0][0].toEmail).toBe(adminEmail);
    expect(testEmailMock.mock.calls[0][0].html).toContain("TEST EMAIL");

    // Exhaust the per-campaign daily limit via audit events.
    await db.insert(earlyAccessCampaignEventsTable).values(
      Array.from({ length: 5 }, () => ({
        campaignId: id,
        kind: "TEST_SENT",
        details: { channel: "brevo", ok: true },
      })),
    );
    const limited = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/test-send`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(limited.status).toBe(429);
  });

  it("refuses test sends of incomplete content", async () => {
    const id = await createDraft({ name: `testsend-bad ${SUFFIX}`, ctaUrl: "" });
    const res = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/test-send`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(testEmailMock).not.toHaveBeenCalled();
  });
});

describe("public unsubscribe", () => {
  it("verifies signed tokens and rejects tampering", async () => {
    const regId = await seedRegistration("unsub-token");
    const token = buildUnsubscribeToken(regId);
    expect(verifyUnsubscribeToken(token)).toBe(regId);
    // Tamper with the id → signature mismatch.
    const parts = token.split(".");
    expect(
      verifyUnsubscribeToken(`u1.${Number(parts[1]) + 1}.${parts[2]}`),
    ).toBeNull();
    expect(verifyUnsubscribeToken("u1.abc.def")).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken(null)).toBeNull();
  });

  it("POST unsubscribes idempotently; invalid tokens get one generic 400", async () => {
    const regId = await seedRegistration("unsub-flow");
    const bad = await request(app)
      .post("/api/early-access/unsubscribe")
      .send({ token: "u1.123.not-a-real-signature" });
    expect(bad.status).toBe(400);

    const token = buildUnsubscribeToken(regId);
    const ok = await request(app)
      .post("/api/early-access/unsubscribe")
      .send({ token });
    expect(ok.status).toBe(200);
    const [row] = await db
      .select()
      .from(earlyAccessRegistrationsTable)
      .where(eq(earlyAccessRegistrationsTable.id, regId));
    expect(row.unsubscribedAt).not.toBeNull();
    expect(row.unsubscribeSource).toBe("user");
    const events = await db
      .select()
      .from(earlyAccessEventsTable)
      .where(eq(earlyAccessEventsTable.registrationId, regId));
    expect(events.filter((e) => e.kind === "UNSUBSCRIBED")).toHaveLength(1);

    // Replay: still success, still exactly one event, source untouched.
    const again = await request(app)
      .post("/api/early-access/unsubscribe")
      .send({ token });
    expect(again.status).toBe(200);
    const eventsAfter = await db
      .select()
      .from(earlyAccessEventsTable)
      .where(eq(earlyAccessEventsTable.registrationId, regId));
    expect(eventsAfter.filter((e) => e.kind === "UNSUBSCRIBED")).toHaveLength(1);
  });

  it("never downgrades an admin suppression", async () => {
    const regId = await seedRegistration("unsub-admin", {
      unsubscribedAt: new Date(),
      unsubscribeSource: "admin",
    });
    const res = await request(app)
      .post("/api/early-access/unsubscribe")
      .send({ token: buildUnsubscribeToken(regId) });
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(earlyAccessRegistrationsTable)
      .where(eq(earlyAccessRegistrationsTable.id, regId));
    expect(row.unsubscribeSource).toBe("admin");
  });
});

describe("Brevo webhook sync", () => {
  it("is disabled without the secret env and rejects wrong secrets", async () => {
    const off = await request(app)
      .post("/api/early-access/brevo-events")
      .send({ event: "hard_bounce", email: emailFor("whatever") });
    expect(off.status).toBe(404);

    process.env.BREVO_WEBHOOK_SECRET = `whsec-${SUFFIX}`;
    const wrong = await request(app)
      .post("/api/early-access/brevo-events")
      .set("x-webhook-secret", "nope")
      .send({ event: "hard_bounce", email: emailFor("whatever") });
    expect(wrong.status).toBe(401);

    // Query-string authentication is deliberately NOT accepted (secrets in
    // URLs leak into proxy/access logs).
    const query = await request(app)
      .post(
        `/api/early-access/brevo-events?secret=${encodeURIComponent(process.env.BREVO_WEBHOOK_SECRET)}`,
      )
      .send({ event: "hard_bounce", email: emailFor("whatever") });
    expect(query.status).toBe(401);

    // Rotation: the previous secret keeps working while configured.
    process.env.BREVO_WEBHOOK_SECRET_PREVIOUS = "old-webhook-secret";
    const prev = await request(app)
      .post("/api/early-access/brevo-events")
      .set("x-webhook-secret", "old-webhook-secret")
      .send({ event: "opened", email: emailFor("whatever") });
    expect(prev.status).toBe(200);
    delete process.env.BREVO_WEBHOOK_SECRET_PREVIOUS;
  });

  it("applies bounce suppression + unsubscribe sync idempotently", async () => {
    process.env.BREVO_WEBHOOK_SECRET = `whsec-${SUFFIX}`;
    const secret = process.env.BREVO_WEBHOOK_SECRET;
    const bounceId = await seedRegistration("wh-bounce");
    const unsubId = await seedRegistration("wh-unsub");

    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post("/api/early-access/brevo-events")
        .set("x-webhook-secret", secret)
        .send({ event: "hard_bounce", email: emailFor("wh-bounce") });
      expect(res.status).toBe(200);
    }
    const [bounced] = await db
      .select()
      .from(earlyAccessRegistrationsTable)
      .where(eq(earlyAccessRegistrationsTable.id, bounceId));
    expect(bounced.emailSuppressedAt).not.toBeNull();
    expect(bounced.emailSuppressionReason).toBe("hard_bounce");
    const suppressEvents = await db
      .select()
      .from(earlyAccessEventsTable)
      .where(eq(earlyAccessEventsTable.registrationId, bounceId));
    expect(
      suppressEvents.filter((e) => e.kind === "EMAIL_SUPPRESSED"),
    ).toHaveLength(1);

    const unsubRes = await request(app)
      .post("/api/early-access/brevo-events")
        .set("x-webhook-secret", secret)
      .send({ event: "unsubscribed", email: emailFor("wh-unsub") });
    expect(unsubRes.status).toBe(200);
    const [unsubbed] = await db
      .select()
      .from(earlyAccessRegistrationsTable)
      .where(eq(earlyAccessRegistrationsTable.id, unsubId));
    expect(unsubbed.unsubscribedAt).not.toBeNull();
    expect(unsubbed.unsubscribeSource).toBe("user");

    // Unknown events/emails are acknowledged without side effects.
    const noop = await request(app)
      .post("/api/early-access/brevo-events")
        .set("x-webhook-secret", secret)
      .send({ event: "opened", email: emailFor("wh-bounce") });
    expect(noop.status).toBe(200);
  });

  it("updates campaign recipient state from webhook events", async () => {
    process.env.BREVO_WEBHOOK_SECRET = `whsec-${SUFFIX}`;
    const secret = process.env.BREVO_WEBHOOK_SECRET;
    statusMock.mockReturnValue({ enabled: true });
    const regId = await seedRegistration("wh-recip");
    const id = await createDraft({ name: `wh-recip ${SUFFIX}` });
    await queueCampaign(id);
    await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);

    await request(app)
      .post("/api/early-access/brevo-events")
        .set("x-webhook-secret", secret)
      .send({ event: "delivered", email: emailFor("wh-recip") });
    let [recip] = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.registrationId, regId));
    expect(recip.status).toBe("delivered");

    await request(app)
      .post("/api/early-access/brevo-events")
        .set("x-webhook-secret", secret)
      .send({ event: "spam", email: emailFor("wh-recip") });
    [recip] = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.registrationId, regId));
    expect(recip.status).toBe("complained");
    const [reg] = await db
      .select()
      .from(earlyAccessRegistrationsTable)
      .where(eq(earlyAccessRegistrationsTable.id, regId));
    expect(reg.emailSuppressionReason).toBe("complaint");
  });
});

describe("Phase 2B hardening", () => {
  async function sendOneBatch(label: string) {
    statusMock.mockReturnValue({ enabled: true });
    await seedRegistration(label);
    const id = await createDraft({ name: `${label} ${SUFFIX}` });
    await queueCampaign(id);
    const res = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    return { id, res };
  }

  it("cleans up temporary Brevo lists after send, idempotently", async () => {
    // Hold the opportunistic in-send cleanup off so the endpoint is what
    // actually deletes the list in this test.
    campaignStatusMock.mockResolvedValue("inProcess");
    const { id, res } = await sendOneBatch("cleanup-ok");
    expect(res.status).toBe(200);

    campaignStatusMock.mockResolvedValue("sent");
    const clean = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/cleanup`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(clean.status).toBe(200);
    expect(clean.body.deleted).toBe(1);
    expect(deleteListMock).toHaveBeenCalledWith(111);
    const [batch] = await db
      .select()
      .from(earlyAccessCampaignBatchesTable)
      .where(eq(earlyAccessCampaignBatchesTable.campaignId, id));
    expect(batch.brevoListDeletedAt).not.toBeNull();
    // Local evidence is untouched: recipients + Brevo campaign ref stay.
    expect(batch.brevoCampaignId).toBe(999);
    const recips = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.campaignId, id));
    expect(recips.some((r) => r.status === "sent")).toBe(true);

    // Idempotent: a second pass finds nothing to do and never resends.
    deleteListMock.mockClear();
    sendNowMock.mockClear();
    const again = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/cleanup`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(again.body.checked).toBe(0);
    expect(deleteListMock).not.toHaveBeenCalled();
    expect(sendNowMock).not.toHaveBeenCalled();
  });

  it("keeps the list while Brevo still reports the campaign as sending", async () => {
    campaignStatusMock.mockResolvedValue("inProcess");
    const { id } = await sendOneBatch("cleanup-active");
    deleteListMock.mockClear();
    const clean = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/cleanup`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(clean.body.skippedStillActive).toBe(1);
    expect(deleteListMock).not.toHaveBeenCalled();
    campaignStatusMock.mockResolvedValue("sent");
  });

  it("tracks failed cleanups and surfaces orphaned lists, retry-safe", async () => {
    campaignStatusMock.mockResolvedValue("inProcess");
    const { id } = await sendOneBatch("cleanup-fail");
    campaignStatusMock.mockResolvedValue("sent");
    deleteListMock.mockRejectedValueOnce(new Error("brevo down"));
    const fail = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/cleanup`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(fail.body.failed).toBe(1);
    let [batch] = await db
      .select()
      .from(earlyAccessCampaignBatchesTable)
      .where(eq(earlyAccessCampaignBatchesTable.campaignId, id));
    expect(batch.cleanupAttempts).toBe(1);
    expect(batch.cleanupLastError).toContain("brevo down");

    // Repeated failure becomes a visible orphan warning.
    await db
      .update(earlyAccessCampaignBatchesTable)
      .set({ cleanupAttempts: 3 })
      .where(eq(earlyAccessCampaignBatchesTable.id, batch.id));
    const detail = await request(app)
      .get(`/api/admin/early-access/campaigns/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.orphanedBrevoLists).toBe(1);

    // Retry succeeds later without touching recipients or resending.
    sendNowMock.mockClear();
    const retry = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/cleanup`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(retry.body.deleted).toBe(1);
    expect(retry.body.orphanedBrevoLists).toBe(0);
    expect(sendNowMock).not.toHaveBeenCalled();
    [batch] = await db
      .select()
      .from(earlyAccessCampaignBatchesTable)
      .where(eq(earlyAccessCampaignBatchesTable.id, batch.id));
    expect(batch.brevoListDeletedAt).not.toBeNull();
    expect(batch.cleanupLastError).toBeNull();
  });

  it("treats not_enough_credits as NOT SENT: waiting_quota, queue preserved, draft deleted, safe retry", async () => {
    statusMock.mockReturnValue({ enabled: true });
    const regId = await seedRegistration("credits-fail");
    const id = await createDraft({ name: `credits ${SUFFIX}` });
    await queueCampaign(id);
    sendNowMock.mockRejectedValueOnce(
      new BrevoApiError({
        method: "POST",
        path: "/emailCampaigns/999/sendNow",
        status: 402,
        brevoCode: "not_enough_credits",
        message: "Not enough credits",
      }),
    );
    const res = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("brevo_credits");

    // Nothing sent, nothing assumed-sent, never-sent draft cleaned up.
    expect(deleteCampaignMock).toHaveBeenCalledWith(999);
    const [camp] = await db
      .select()
      .from(earlyAccessCampaignsTable)
      .where(eq(earlyAccessCampaignsTable.id, id));
    expect(camp.status).toBe("waiting_quota");
    let [recip] = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.registrationId, regId));
    expect(recip.status).toBe("queued");
    const batches = await db
      .select()
      .from(earlyAccessCampaignBatchesTable)
      .where(eq(earlyAccessCampaignBatchesTable.campaignId, id));
    expect(batches[0].status).toBe("failed");
    expect(batches[0].statusDetail).toContain("not_enough_credits");

    // After the allowance recovers (plan upgrade / next day), the SAME
    // button resumes and the recipient is sent exactly once.
    const cont = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(cont.status).toBe(200);
    [recip] = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.registrationId, regId));
    expect(recip.status).toBe("sent");
  });

  it("keeps ambiguous sendNow failures on the assumed-sent path (never resends)", async () => {
    statusMock.mockReturnValue({ enabled: true });
    const regId = await seedRegistration("ambiguous-fail");
    const id = await createDraft({ name: `ambiguous ${SUFFIX}` });
    await queueCampaign(id);
    sendNowMock.mockRejectedValueOnce(new Error("socket hang up"));
    const res = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("needs_recovery_review");
    // The draft is NOT deleted — it may have gone out.
    expect(deleteCampaignMock).not.toHaveBeenCalled();

    const next = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(next.status).toBe(200);
    const [recip] = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.registrationId, regId));
    // Conservatively assumed sent — flagged, never resent.
    expect(recip.status).toBe("sent");
    const batches = await db
      .select()
      .from(earlyAccessCampaignBatchesTable)
      .where(eq(earlyAccessCampaignBatchesTable.campaignId, id));
    expect(batches[0].statusDetail).toBe("recovered_assumed_sent");
    // sendNow was attempted exactly once — never retried for this batch.
    expect(sendNowMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to reserve over a fresh in-flight batch (send lease) and recovers after expiry", async () => {
    statusMock.mockReturnValue({ enabled: true });
    await seedRegistration("lease-race");
    const id = await createDraft({ name: `lease ${SUFFIX}` });
    await queueCampaign(id);
    // Simulate worker A mid-flight: committed reservation, no Brevo id yet.
    const [pendingBatch] = await db
      .insert(earlyAccessCampaignBatchesTable)
      .values({ campaignId: id, batchNumber: 1, recipientCount: 1, status: "pending" })
      .returning();
    const blocked = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("in_progress");
    // Worker A's reservation was NOT released, nothing was sent.
    expect(createCampaignMock).not.toHaveBeenCalled();

    // After the lease expires (proven crash), recovery releases and resumes.
    await db
      .update(earlyAccessCampaignBatchesTable)
      .set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) })
      .where(eq(earlyAccessCampaignBatchesTable.id, pendingBatch.id));
    const recovered = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(recovered.status).toBe(200);
    const [released] = await db
      .select()
      .from(earlyAccessCampaignBatchesTable)
      .where(eq(earlyAccessCampaignBatchesTable.id, pendingBatch.id));
    expect(released.status).toBe("failed");
    expect(released.statusDetail).toBe("recovered_released");
  });

  it("persists the Brevo list id before contact upload so failed batches stay cleanable", async () => {
    statusMock.mockReturnValue({ enabled: true });
    await seedRegistration("leak-guard");
    const id = await createDraft({ name: `leak ${SUFFIX}` });
    await queueCampaign(id);
    upsertMock.mockRejectedValueOnce(new Error("upload failed"));
    const res = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/send-batch`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(502);
    const [batch] = await db
      .select()
      .from(earlyAccessCampaignBatchesTable)
      .where(eq(earlyAccessCampaignBatchesTable.campaignId, id));
    expect(batch.status).toBe("failed");
    // The remote list is discoverable for cleanup even though the campaign
    // was never created.
    expect(batch.brevoListId).toBe(111);
    const clean = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/cleanup`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(clean.body.deleted).toBe(1);
    expect(deleteListMock).toHaveBeenCalledWith(111);
  });

  it("enforces the GLOBAL daily test-send limit across campaigns", async () => {
    const prev = process.env.TEST_EMAIL_DAILY_LIMIT;
    process.env.TEST_EMAIL_DAILY_LIMIT = "0";
    try {
      const id = await createDraft({ name: `global-test ${SUFFIX}` });
      const res = await request(app)
        .post(`/api/admin/early-access/campaigns/${id}/test-send`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(429);
      expect(res.body.error).toMatch(/Global test-send limit/);
      expect(testEmailMock).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.TEST_EMAIL_DAILY_LIMIT;
      else process.env.TEST_EMAIL_DAILY_LIMIT = prev;
    }
  });

  it("rotates the unsubscribe secret without breaking already-sent links", async () => {
    const regId = await seedRegistration("rotate-unsub");
    const oldToken = buildUnsubscribeToken(regId);
    const prevCurrent = process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET!;
    try {
      process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET = "rotated-new-secret";
      process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET_PREVIOUS = prevCurrent;
      // Old links keep working through the previous secret…
      expect(verifyUnsubscribeToken(oldToken)).toBe(regId);
      // …new tokens are signed with the NEW secret only.
      const newToken = buildUnsubscribeToken(regId);
      expect(verifyUnsubscribeToken(newToken)).toBe(regId);
      delete process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET_PREVIOUS;
      expect(verifyUnsubscribeToken(oldToken)).toBeNull();
      expect(verifyUnsubscribeToken(newToken)).toBe(regId);
    } finally {
      process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET = prevCurrent;
      delete process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET_PREVIOUS;
    }
  });

  it("models the configurable plan allowance (daily 'none', monthly caps, config validation)", () => {
    const env = process.env;
    const prev = {
      daily: env.BREVO_ACCOUNT_DAILY_CAP,
      monthly: env.BREVO_ACCOUNT_MONTHLY_CAP,
      reset: env.BREVO_MONTHLY_RESET_DAY,
    };
    try {
      // Free plan default: 300/day, no monthly cap.
      delete env.BREVO_ACCOUNT_DAILY_CAP;
      delete env.BREVO_ACCOUNT_MONTHLY_CAP;
      delete env.BREVO_MONTHLY_RESET_DAY;
      let model = sendAllowanceModel();
      expect(model.accountDailyCap).toBe(300);
      expect(model.accountMonthlyCap).toBeNull();
      expect(model.configIssues).toHaveLength(0);

      // Paid plan example: 5,000/month, no daily cap.
      env.BREVO_ACCOUNT_DAILY_CAP = "none";
      env.BREVO_ACCOUNT_MONTHLY_CAP = "5000";
      env.BREVO_MONTHLY_RESET_DAY = "15";
      model = sendAllowanceModel();
      expect(model.accountDailyCap).toBeNull();
      expect(model.accountMonthlyCap).toBe(5000);
      expect(model.monthlyResetDay).toBe(15);
      expect(model.configIssues).toHaveLength(0);
      // With no account daily cap, the marketing cap is the daily limit.
      expect(effectiveDailyCap()).toBe(model.marketingDailyCap);

      // Billing period math anchors on the reset day.
      const start = billingPeriodStart(15);
      expect(start.getDate()).toBe(15);
      expect(start.getTime()).toBeLessThanOrEqual(Date.now());

      // Bad values are surfaced, never silently accepted.
      env.BREVO_ACCOUNT_DAILY_CAP = "lots";
      env.BREVO_MONTHLY_RESET_DAY = "31";
      model = sendAllowanceModel();
      expect(model.configIssues.length).toBeGreaterThanOrEqual(2);
    } finally {
      for (const [key, value] of [
        ["BREVO_ACCOUNT_DAILY_CAP", prev.daily],
        ["BREVO_ACCOUNT_MONTHLY_CAP", prev.monthly],
        ["BREVO_MONTHLY_RESET_DAY", prev.reset],
      ] as const) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
    }
  });

  it("labels quota numbers as local estimates in the admin API", async () => {
    const id = await createDraft({ name: `quota-label ${SUFFIX}` });
    const detail = await request(app)
      .get(`/api/admin/early-access/campaigns/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.quota.allowance.source).toBe("local_estimate");
    expect(detail.body.quota.allowance.sourceNote).toMatch(/Brevo's dashboard/);
    expect(detail.body.testSendDailyLimitGlobal).toBeGreaterThan(0);
  });
});

describe("public form respects deliverability suppression", () => {
  it("never starts a confirmation flow for a bounce-suppressed address", async () => {
    await seedRegistration("form-suppressed", {
      confirmedAt: null,
      launchConsentAt: null,
      launchConsentVersion: null,
      marketingConsentAt: null,
      marketingConsentVersion: null,
      emailSuppressedAt: new Date(),
      emailSuppressionReason: "hard_bounce",
    });
    const res = await request(app)
      .post("/api/early-access")
      .send({
        name: "Suppressed Person",
        email: emailFor("form-suppressed"),
        type: "customer",
        consent: true,
      });
    expect(res.status).toBe(200); // generic success — never reveals state
    expect(confirmEmailMock).not.toHaveBeenCalled();
  });
});
