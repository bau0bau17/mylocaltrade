import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  conversationsTable,
  userReportsTable,
  conversationReportsTable,
  reportAppealsTable,
  traderAuditLogTable,
  companyMembersTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const fixtureUsers: number[] = [];
const fixtureProfiles: number[] = [];
const fixtureConversations: number[] = [];
const fixtureUserReports: number[] = [];
const fixtureConversationReports: number[] = [];
const fixtureAppeals: number[] = [];

async function fixtureUser(role: "admin" | "customer" | "trader", label: string) {
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `readiness-${label}-${suffix}@example.test`,
      passwordHash: "test-only",
      fullName: `Readiness ${label}`,
      role,
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  fixtureUsers.push(row.id);
  return row.id;
}

describe("Online Safety reporting API guards", () => {
  it("publishes suspected illegal content without exposing CSEA escalation", async () => {
    const response = await request(app).get("/api/report-categories");
    expect(response.status).toBe(200);
    expect(response.body.categories.trader).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "SUSPECTED_ILLEGAL_CONTENT" })]),
    );
    expect(JSON.stringify(response.body)).not.toContain("CSEA");
  });

  it("rejects unauthenticated profile, chat, review appeal and status access", async () => {
    for (const response of await Promise.all([
      request(app).post("/api/reports").send({ reportedRole: "trader", traderProfileId: 1, category: "SUSPECTED_ILLEGAL_CONTENT" }),
      request(app).get("/api/reports"),
      request(app).post("/api/reports/1/appeal").send({ reason: "I disagree with this decision." }),
      request(app).post("/api/conversation-reports/1/appeal").send({ reason: "I disagree with this decision." }),
      request(app).post("/api/admin/user-reports/1/csea-escalate"),
      request(app).get("/api/admin/csea-candidates"),
      request(app).get("/api/admin/csea-reports"),
      request(app).post("/api/admin/csea-reports/user/1/complete"),
      request(app).post("/api/admin/csea-reports/conversation/1/complete"),
    ])) {
      expect(response.status).toBe(401);
    }
  });

  it("keeps the existing authenticated chat report contract reachable", async () => {
    // Authentication and participant checks are intentionally server-side; an
    // invalid token must not turn this into an IDOR probe.
    const response = await request(app)
      .post("/api/conversations/999999/report")
      .set("Authorization", "Bearer not-a-token")
      .send({ category: "SUSPECTED_ILLEGAL_CONTENT", reason: "Potentially illegal content" });
    expect(response.status).toBe(401);
  });

  it("allows specialist escalation despite an OPEN ordinary appeal on both report routes", async () => {
    const previousAllowlist = process.env.CSEA_SPECIALIST_ADMIN_EMAILS;
    const specialistId = await fixtureUser("admin", "specialist");
    const ordinaryAdminId = await fixtureUser("admin", "ordinary");
    const reporterId = await fixtureUser("customer", "reporter");
    const subjectId = await fixtureUser("trader", "subject");
    const [profile] = await db
      .insert(traderProfilesTable)
      .values({
        userId: subjectId,
        businessName: `Readiness Trades ${suffix}`,
        contactName: "Readiness Subject",
        email: `profile-${suffix}@example.test`,
        phone: "+447000000099",
        mainCategory: "plumbing",
        town: "London",
        postcode: "SW1A 1AA",
        isActive: true,
        businessProfileCompleted: true,
        verificationStatus: "VERIFIED",
      })
      .returning({ id: traderProfilesTable.id });
    fixtureProfiles.push(profile.id);
    const [conversation] = await db
      .insert(conversationsTable)
      .values({
        customerId: reporterId,
        traderUserId: subjectId,
        traderProfileId: profile.id,
        serviceRequired: "CSEA escalation fixture",
        status: "ACTIVE",
        traderStatus: "NEW",
      })
      .returning({ id: conversationsTable.id });
    fixtureConversations.push(conversation.id);

    const [userReport] = await db
      .insert(userReportsTable)
      .values({
        reporterUserId: reporterId,
        reporterRole: "customer",
        reportedUserId: subjectId,
        reportedRole: "trader",
        reportedTraderProfileId: profile.id,
        category: "SUSPECTED_ILLEGAL_CONTENT",
        status: "RESOLVED",
        outcome: "REFERRED_ESCALATED",
      })
      .returning({ id: userReportsTable.id });
    fixtureUserReports.push(userReport.id);
    const [conversationReport] = await db
      .insert(conversationReportsTable)
      .values({
        conversationId: conversation.id,
        reportedByUserId: reporterId,
        reportedByRole: "customer",
        reason: "CSEA escalation fixture",
        category: "SUSPECTED_ILLEGAL_CONTENT",
        status: "RESOLVED",
        outcome: "REFERRED_ESCALATED",
      })
      .returning({ id: conversationReportsTable.id });
    fixtureConversationReports.push(conversationReport.id);
    const [userAppeal] = await db
      .insert(reportAppealsTable)
      .values({
        reportId: userReport.id,
        appellantUserId: reporterId,
        reason: "Ordinary appeal remains open",
        status: "OPEN",
      })
      .returning({ id: reportAppealsTable.id });
    fixtureAppeals.push(userAppeal.id);
    const [conversationAppeal] = await db
      .insert(reportAppealsTable)
      .values({
        conversationReportId: conversationReport.id,
        appellantUserId: reporterId,
        reason: "Ordinary appeal remains open",
        status: "OPEN",
      })
      .returning({ id: reportAppealsTable.id });
    fixtureAppeals.push(conversationAppeal.id);

    process.env.CSEA_SPECIALIST_ADMIN_EMAILS = `readiness-specialist-${suffix}@example.test`;
    const ordinaryToken = generateToken(ordinaryAdminId, "admin");
    const specialistToken = generateToken(specialistId, "admin");
    try {
      for (const path of [
        `/api/admin/user-reports/${userReport.id}/csea-escalate`,
        `/api/admin/conversation-reports/${conversationReport.id}/csea-escalate`,
      ]) {
        const denied = await request(app)
          .post(path)
          .set("Authorization", `Bearer ${ordinaryToken}`);
        expect(denied.status).toBe(403);
      }
      const userEscalation = await request(app)
        .post(`/api/admin/user-reports/${userReport.id}/csea-escalate`)
        .set("Authorization", `Bearer ${specialistToken}`);
      const conversationEscalation = await request(app)
        .post(`/api/admin/conversation-reports/${conversationReport.id}/csea-escalate`)
        .set("Authorization", `Bearer ${specialistToken}`);
      expect(userEscalation.status).toBe(200);
      expect(userEscalation.body.status).toBe("ESCALATED");
      expect(conversationEscalation.status).toBe(200);
      expect(conversationEscalation.body.status).toBe("ESCALATED");
    } finally {
      if (previousAllowlist === undefined) delete process.env.CSEA_SPECIALIST_ADMIN_EMAILS;
      else process.env.CSEA_SPECIALIST_ADMIN_EMAILS = previousAllowlist;
    }
  });

  it("submits eligible appeals once, preserves ownership and safely reports unavailable appeal states", async () => {
    const reporterId = await fixtureUser("customer", "appeal-reporter");
    const otherReporterId = await fixtureUser("customer", "appeal-other-reporter");
    const subjectId = await fixtureUser("trader", "appeal-subject");
    const [profile] = await db.insert(traderProfilesTable).values({
      userId: subjectId,
      businessName: `Appeal Trades ${suffix}`,
      contactName: "Appeal Subject",
      email: `appeal-profile-${suffix}@example.test`,
      phone: "+447000000098",
      mainCategory: "Plumbing",
      town: "Milton Keynes",
      postcode: "MK9 3XS",
      isActive: true,
      businessProfileCompleted: true,
      verificationStatus: "VERIFIED",
    }).returning({ id: traderProfilesTable.id });
    fixtureProfiles.push(profile.id);
    const [conversation] = await db.insert(conversationsTable).values({
      customerId: reporterId,
      traderUserId: subjectId,
      traderProfileId: profile.id,
      serviceRequired: "Appeal fixture",
      status: "ACTIVE",
      traderStatus: "NEW",
    }).returning({ id: conversationsTable.id });
    fixtureConversations.push(conversation.id);

    const now = new Date();
    const expiredAt = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    const [eligibleProfile, expiredProfile, restrictedProfile] = await db.insert(userReportsTable).values([
      {
        reporterUserId: reporterId, reporterRole: "customer", reportedUserId: subjectId,
        reportedRole: "trader", reportedTraderProfileId: profile.id,
        category: "OTHER", status: "RESOLVED", outcome: "NO_VIOLATION", outcomeAt: now,
      },
      {
        reporterUserId: reporterId, reporterRole: "customer", reportedUserId: subjectId,
        reportedRole: "trader", reportedTraderProfileId: profile.id,
        category: "OTHER", status: "RESOLVED", outcome: "NO_VIOLATION", outcomeAt: expiredAt,
      },
      {
        reporterUserId: reporterId, reporterRole: "customer", reportedUserId: subjectId,
        reportedRole: "trader", reportedTraderProfileId: profile.id,
        category: "SUSPECTED_ILLEGAL_CONTENT", status: "RESOLVED", outcome: "NO_VIOLATION",
        outcomeAt: now, cseaEscalatedAt: now,
      },
    ]).returning({ id: userReportsTable.id });
    fixtureUserReports.push(eligibleProfile.id, expiredProfile.id, restrictedProfile.id);
    const [eligibleConversation] = await db.insert(conversationReportsTable).values({
      conversationId: conversation.id, reportedByUserId: reporterId, reportedByRole: "customer",
      reason: "Eligible conversation appeal fixture", category: "OTHER",
      status: "RESOLVED", outcome: "NO_VIOLATION", outcomeAt: now,
    }).returning({ id: conversationReportsTable.id });
    fixtureConversationReports.push(eligibleConversation.id);

    const reporterToken = generateToken(reporterId, "customer");
    const otherToken = generateToken(otherReporterId, "customer");
    const client = (ip: string) => ({ "Authorization": `Bearer ${reporterToken}`, "X-Forwarded-For": ip });
    const statusBefore = await request(app).get("/api/reports").set(client("198.51.100.1"));
    expect(statusBefore.status).toBe(200);
    expect(JSON.stringify(statusBefore.body)).not.toContain("CSEA");
    const byId = new Map<number, { id: number; appealEligible: boolean }>(
      statusBefore.body.reports.map((r: { id: number; appealEligible: boolean }) => [r.id, r]),
    );
    expect(byId.get(eligibleProfile.id)?.appealEligible).toBe(true);
    expect(byId.get(eligibleConversation.id)?.appealEligible).toBe(true);
    expect(byId.get(expiredProfile.id)?.appealEligible).toBe(false);
    expect(byId.get(restrictedProfile.id)?.appealEligible).toBe(false);

    const profileAppeal = await request(app).post(`/api/reports/${eligibleProfile.id}/appeal`)
      .set(client("198.51.100.2")).send({ reason: "Please review this profile report decision." });
    const conversationAppeal = await request(app).post(`/api/conversation-reports/${eligibleConversation.id}/appeal`)
      .set(client("198.51.100.3")).send({ reason: "Please review this conversation report decision." });
    expect(profileAppeal.status).toBe(201);
    expect(profileAppeal.body).toMatchObject({ status: "OPEN" });
    expect(conversationAppeal.status).toBe(201);
    expect(conversationAppeal.body).toMatchObject({ status: "OPEN" });
    fixtureAppeals.push(profileAppeal.body.appealId, conversationAppeal.body.appealId);

    // This is the same refetch the mobile success path performs. Check it
    // before deliberate failure requests, which are rate-limited in this
    // shared development database.
    const statusAfter = await request(app).get("/api/reports").set(client("198.51.100.4"));
    expect(statusAfter.status).toBe(200);
    const afterById = new Map<number, { id: number; appeal: unknown; appealEligible: boolean }>(
      statusAfter.body.reports.map((r: { id: number; appeal: unknown; appealEligible: boolean }) => [r.id, r]),
    );
    expect(afterById.get(eligibleProfile.id)?.appeal).toBeTruthy();
    expect(afterById.get(eligibleProfile.id)?.appealEligible).toBe(false);
    expect(afterById.get(eligibleConversation.id)?.appeal).toBeTruthy();
    expect(afterById.get(eligibleConversation.id)?.appealEligible).toBe(false);

    const duplicate = await request(app).post(`/api/reports/${eligibleProfile.id}/appeal`)
      .set(client("198.51.100.5")).send({ reason: "Please review this profile report decision." });
    const expired = await request(app).post(`/api/reports/${expiredProfile.id}/appeal`)
      .set(client("198.51.100.6")).send({ reason: "Please review this expired report decision." });
    const restricted = await request(app).post(`/api/reports/${restrictedProfile.id}/appeal`)
      .set(client("198.51.100.7")).send({ reason: "Please review this restricted report decision." });
    const foreign = await request(app).post(`/api/reports/${eligibleProfile.id}/appeal`)
      .set({ "Authorization": `Bearer ${otherToken}`, "X-Forwarded-For": "198.51.100.8" }).send({ reason: "Please review another user's report decision." });
    expect(duplicate.status).toBe(409);
    expect(expired.status).toBe(409);
    expect(restricted.status).toBe(409);
    expect(foreign.status).toBe(404);
  });
});

afterAll(async () => {
  if (fixtureAppeals.length) await db.delete(reportAppealsTable).where(inArray(reportAppealsTable.id, fixtureAppeals));
  if (fixtureConversationReports.length) await db.delete(conversationReportsTable).where(inArray(conversationReportsTable.id, fixtureConversationReports));
  if (fixtureUserReports.length) await db.delete(userReportsTable).where(inArray(userReportsTable.id, fixtureUserReports));
  if (fixtureConversations.length) await db.delete(conversationsTable).where(inArray(conversationsTable.id, fixtureConversations));
  if (fixtureProfiles.length) await db.delete(companyMembersTable).where(inArray(companyMembersTable.traderProfileId, fixtureProfiles));
  if (fixtureProfiles.length) await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.id, fixtureProfiles));
  if (fixtureUsers.length) await db.delete(traderAuditLogTable).where(inArray(traderAuditLogTable.performedBy, fixtureUsers));
  if (fixtureUsers.length) await db.delete(usersTable).where(inArray(usersTable.id, fixtureUsers));
});