import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
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
  outreachSuppressionsTable,
} from "@workspace/db/schema";
import { eq, and, inArray, like, sql } from "drizzle-orm";

import app from "../app";
import { generateToken } from "../lib/auth";
import { LAUNCH_CONSENT_VERSION } from "../lib/early-access-consent";

/**
 * Campaign deletion & retention rules (docs/data-retention.md):
 * - only never-queued drafts with no snapshot/send activity can be deleted,
 *   and the deletion leaves an audit event;
 * - anything queued/sent/cancelled is archived, never deleted;
 * - archiving and anonymisation never touch suppression or consent evidence;
 * - recipient personal data can be anonymised later while keeping aggregate
 *   statistics and the non-identifying audit trail.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `caret-${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];
const createdCampaignIds: number[] = [];
let adminToken: string;
let adminId: number;
let customerToken: string;

async function createUser(role: "customer" | "admin") {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`user-${role}-${createdUserIds.length}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Campaign Retention Test ${role}`,
      role,
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

async function seedRegistration(label: string) {
  const [row] = await db
    .insert(earlyAccessRegistrationsTable)
    .values({
      name: `Caret ${label}`,
      email: emailFor(label),
      emailNormalized: emailFor(label),
      audienceType: "customer",
      confirmedAt: new Date(),
      launchConsentAt: new Date(),
      launchConsentVersion: LAUNCH_CONSENT_VERSION,
      marketingConsentAt: new Date(),
      marketingConsentVersion: "marketing-v1-2026-08-12",
    })
    .returning({ id: earlyAccessRegistrationsTable.id });
  return row.id;
}

async function createDraft(): Promise<number> {
  const res = await request(app)
    .post("/api/admin/early-access/campaigns")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      type: "marketing",
      name: `Retention test ${SUFFIX}`,
      subject: "Subject",
      previewText: "Preview",
      heading: "Heading",
      bodyText: "Body text.",
      ctaLabel: "Open",
      ctaUrl: "https://mylocaltrade.co.uk/news",
    });
  expect(res.status).toBe(201);
  createdCampaignIds.push(res.body.campaign.id);
  return res.body.campaign.id as number;
}

async function queueCampaign(id: number): Promise<void> {
  const aud = await request(app)
    .get(`/api/admin/early-access/campaigns/${id}/audience`)
    .set("Authorization", `Bearer ${adminToken}`);
  expect(aud.status).toBe(200);
  const res = await request(app)
    .post(`/api/admin/early-access/campaigns/${id}/queue`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ confirmation: aud.body.confirmationPhrase });
  expect(res.status).toBe(200);
}

async function cancelCampaign(id: number): Promise<void> {
  const res = await request(app)
    .post(`/api/admin/early-access/campaigns/${id}/cancel`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({});
  expect(res.status).toBe(200);
}

async function eventsFor(id: number, kind: string) {
  return db
    .select()
    .from(earlyAccessCampaignEventsTable)
    .where(
      and(
        eq(earlyAccessCampaignEventsTable.campaignId, id),
        eq(earlyAccessCampaignEventsTable.kind, kind),
      ),
    );
}

beforeAll(async () => {
  adminId = await createUser("admin");
  adminToken = generateToken(adminId, "admin", 1);
  const customerId = await createUser("customer");
  customerToken = generateToken(customerId, "customer", 1);
});

beforeEach(async () => {
  await db.execute(
    // eslint-disable-next-line drizzle/enforce-delete-with-where
    sql`DELETE FROM rate_limit_hits WHERE key LIKE 'api%' OR key LIKE 'early-access%'`,
  );
});

afterAll(async () => {
  if (createdCampaignIds.length) {
    await db
      .delete(earlyAccessCampaignEventsTable)
      .where(inArray(earlyAccessCampaignEventsTable.campaignId, createdCampaignIds));
    await db
      .delete(earlyAccessCampaignBatchesTable)
      .where(inArray(earlyAccessCampaignBatchesTable.campaignId, createdCampaignIds));
    await db
      .delete(earlyAccessCampaignRecipientsTable)
      .where(inArray(earlyAccessCampaignRecipientsTable.campaignId, createdCampaignIds));
    await db
      .delete(earlyAccessCampaignsTable)
      .where(inArray(earlyAccessCampaignsTable.id, createdCampaignIds));
  }
  const regs = await db
    .select({ id: earlyAccessRegistrationsTable.id })
    .from(earlyAccessRegistrationsTable)
    .where(like(earlyAccessRegistrationsTable.emailNormalized, `%${SUFFIX}%`));
  const regIds = regs.map((r) => r.id);
  if (regIds.length) {
    await db
      .delete(earlyAccessEventsTable)
      .where(inArray(earlyAccessEventsTable.registrationId, regIds));
    await db
      .delete(earlyAccessRegistrationsTable)
      .where(inArray(earlyAccessRegistrationsTable.id, regIds));
  }
  await db
    .delete(outreachSuppressionsTable)
    .where(like(outreachSuppressionsTable.emailNormalized, `%${SUFFIX}%`));
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

describe("authz", () => {
  it("rejects anonymous and non-admin access to the retention endpoints", async () => {
    expect((await request(app).delete("/api/admin/early-access/campaigns/1")).status).toBe(401);
    expect(
      (
        await request(app)
          .delete("/api/admin/early-access/campaigns/1")
          .set("Authorization", `Bearer ${customerToken}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/admin/early-access/campaigns/1/archive")
          .set("Authorization", `Bearer ${customerToken}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/admin/early-access/campaigns/1/anonymise-recipients")
          .set("Authorization", `Bearer ${customerToken}`)
      ).status,
    ).toBe(403);
  });
});

describe("draft deletion", () => {
  it("hard-deletes a never-queued draft and keeps a non-identifying audit event", async () => {
    const id = await createDraft();
    const res = await request(app)
      .delete(`/api/admin/early-access/campaigns/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(earlyAccessCampaignsTable)
      .where(eq(earlyAccessCampaignsTable.id, id));
    expect(row).toBeUndefined();

    // The audit event OUTLIVES the campaign row.
    const deleted = await eventsFor(id, "CAMPAIGN_DELETED");
    expect(deleted).toHaveLength(1);
    expect(deleted[0].performedBy).toBe(adminId);
    const details = deleted[0].details as Record<string, unknown>;
    expect(details.name).toBe(`Retention test ${SUFFIX}`);
    expect(details.type).toBe("marketing");
    expect(details.audience).toBe("early_access");
    // Non-identifying only: never recipient emails or content.
    expect(JSON.stringify(details)).not.toMatch(/@example\.test/);
    // The earlier CAMPAIGN_CREATED event is preserved too.
    expect(await eventsFor(id, "CAMPAIGN_CREATED")).toHaveLength(1);

    // Gone from the admin list.
    const list = await request(app)
      .get("/api/admin/early-access/campaigns?includeArchived=1")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.campaigns.some((c: { id: number }) => c.id === id)).toBe(false);
  });

  it("refuses to delete a draft that has produced a test email (send activity)", async () => {
    const id = await createDraft();
    // A test send writes a TEST_SENT audit event (a real email left the
    // system, addressed to the acting admin) without changing status or
    // creating recipients — that alone must block hard deletion.
    await db.insert(earlyAccessCampaignEventsTable).values({
      campaignId: id,
      kind: "TEST_SENT",
      performedBy: adminId,
      details: { channel: "email", ok: true },
    });

    const res = await request(app)
      .delete(`/api/admin/early-access/campaigns/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(409);

    const [row] = await db
      .select()
      .from(earlyAccessCampaignsTable)
      .where(eq(earlyAccessCampaignsTable.id, id));
    expect(row?.status).toBe("draft");
    expect(await eventsFor(id, "TEST_SENT")).toHaveLength(1);
    expect(await eventsFor(id, "CAMPAIGN_DELETED")).toHaveLength(0);
  });

  it("refuses to delete a campaign once it has been queued (or cancelled) and points to archiving", async () => {
    await seedRegistration("del-blocked");
    const id = await createDraft();
    await queueCampaign(id);

    const afterQueue = await request(app)
      .delete(`/api/admin/early-access/campaigns/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(afterQueue.status).toBe(409);
    expect(afterQueue.body.error).toMatch(/archive/i);

    await cancelCampaign(id);
    const afterCancel = await request(app)
      .delete(`/api/admin/early-access/campaigns/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(afterCancel.status).toBe(409);

    // Row, recipient snapshot and audit history all still there.
    const [row] = await db
      .select()
      .from(earlyAccessCampaignsTable)
      .where(eq(earlyAccessCampaignsTable.id, id));
    expect(row?.status).toBe("cancelled");
    const recipients = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.campaignId, id));
    expect(recipients.length).toBeGreaterThan(0);
    expect(await eventsFor(id, "CAMPAIGN_QUEUED")).toHaveLength(1);
    expect(await eventsFor(id, "CAMPAIGN_CANCELLED")).toHaveLength(1);
    expect(await eventsFor(id, "CAMPAIGN_DELETED")).toHaveLength(0);
  });
});

describe("archive behaviour", () => {
  it("archives a cancelled campaign, hides it from the default list, and unarchives it", async () => {
    await seedRegistration("arch");
    const id = await createDraft();
    await queueCampaign(id);
    await cancelCampaign(id);

    const arch = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/archive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(arch.status).toBe(200);
    expect(arch.body.campaign.archivedAt).toBeTruthy();
    expect(await eventsFor(id, "CAMPAIGN_ARCHIVED")).toHaveLength(1);

    // Double-archive is a conflict and never writes a second audit event.
    const again = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/archive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(again.status).toBe(409);
    expect(await eventsFor(id, "CAMPAIGN_ARCHIVED")).toHaveLength(1);

    // Hidden by default, visible with the filter, counted either way.
    const def = await request(app)
      .get("/api/admin/early-access/campaigns")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(def.body.campaigns.some((c: { id: number }) => c.id === id)).toBe(false);
    expect(def.body.archivedCount).toBeGreaterThanOrEqual(1);
    const all = await request(app)
      .get("/api/admin/early-access/campaigns?includeArchived=1")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(all.body.campaigns.some((c: { id: number }) => c.id === id)).toBe(true);

    const unarch = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/unarchive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(unarch.status).toBe(200);
    expect(unarch.body.campaign.archivedAt).toBeNull();
    expect(await eventsFor(id, "CAMPAIGN_UNARCHIVED")).toHaveLength(1);
    const back = await request(app)
      .get("/api/admin/early-access/campaigns")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(back.body.campaigns.some((c: { id: number }) => c.id === id)).toBe(true);
  });

  it("refuses to archive drafts and active campaigns", async () => {
    const draftId = await createDraft();
    const draftRes = await request(app)
      .post(`/api/admin/early-access/campaigns/${draftId}/archive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(draftRes.status).toBe(409);

    await seedRegistration("arch-active");
    const queuedId = await createDraft();
    await queueCampaign(queuedId);
    const queuedRes = await request(app)
      .post(`/api/admin/early-access/campaigns/${queuedId}/archive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(queuedRes.status).toBe(409);
    expect(queuedRes.body.error).toMatch(/cancel/i);
  });

  it("archiving preserves suppression evidence, recipients and the audit trail bit-for-bit", async () => {
    const [suppression] = await db
      .insert(outreachSuppressionsTable)
      .values({
        emailNormalized: emailFor("suppressed"),
        reason: "objection",
        source: "admin",
      })
      .returning();

    await seedRegistration("arch-preserve");
    const id = await createDraft();
    await queueCampaign(id);
    await cancelCampaign(id);
    const recipientsBefore = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.campaignId, id));

    const arch = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/archive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(arch.status).toBe(200);

    const [suppressionAfter] = await db
      .select()
      .from(outreachSuppressionsTable)
      .where(eq(outreachSuppressionsTable.id, suppression.id));
    expect(suppressionAfter).toEqual(suppression);

    const recipientsAfter = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.campaignId, id));
    expect(recipientsAfter).toEqual(recipientsBefore);
    expect(await eventsFor(id, "CAMPAIGN_QUEUED")).toHaveLength(1);
    expect(await eventsFor(id, "CAMPAIGN_CANCELLED")).toHaveLength(1);
  });
});

describe("recipient anonymisation", () => {
  it("strips personal data, keeps aggregate statistics, never touches suppression or registrations", async () => {
    const [suppression] = await db
      .insert(outreachSuppressionsTable)
      .values({
        emailNormalized: emailFor("anon-suppressed"),
        reason: "complaint",
        source: "brevo_webhook",
      })
      .returning();
    const regId = await seedRegistration("anon");
    const id = await createDraft();
    await queueCampaign(id);
    await cancelCampaign(id);

    const res = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/anonymise-recipients`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.anonymised).toBeGreaterThan(0);

    const recipients = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.campaignId, id));
    expect(recipients.length).toBeGreaterThan(0);
    for (const row of recipients) {
      expect(row.emailNormalized).toBe("");
      expect(row.name).toBe("");
      expect(row.registrationId).toBeNull();
      expect(row.outreachContactId).toBeNull();
      // Aggregate statistics survive: status is intact.
      expect(row.status).toBe("cancelled");
    }

    // Audit event carries counts only — no emails, no names.
    const events = await eventsFor(id, "RECIPIENTS_ANONYMISED");
    expect(events).toHaveLength(1);
    const details = events[0].details as Record<string, unknown>;
    expect(details.anonymised).toBe(recipients.length);
    expect(JSON.stringify(details)).not.toMatch(/@|Caret/);

    // Source rows are untouched: the registration keeps its own data
    // (its deletion has its own flow), and suppression is preserved.
    const [reg] = await db
      .select()
      .from(earlyAccessRegistrationsTable)
      .where(eq(earlyAccessRegistrationsTable.id, regId));
    expect(reg?.emailNormalized).toBe(emailFor("anon"));
    const [suppressionAfter] = await db
      .select()
      .from(outreachSuppressionsTable)
      .where(eq(outreachSuppressionsTable.id, suppression.id));
    expect(suppressionAfter).toEqual(suppression);

    // Idempotent: nothing left to anonymise, no duplicate audit event.
    const again = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/anonymise-recipients`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(again.status).toBe(200);
    expect(again.body.anonymised).toBe(0);
    expect(await eventsFor(id, "RECIPIENTS_ANONYMISED")).toHaveLength(1);
  });

  it("refuses to anonymise drafts and active campaigns", async () => {
    const draftId = await createDraft();
    const draftRes = await request(app)
      .post(`/api/admin/early-access/campaigns/${draftId}/anonymise-recipients`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(draftRes.status).toBe(409);

    await seedRegistration("anon-active");
    const queuedId = await createDraft();
    await queueCampaign(queuedId);
    const queuedRes = await request(app)
      .post(`/api/admin/early-access/campaigns/${queuedId}/anonymise-recipients`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(queuedRes.status).toBe(409);
  });
});
