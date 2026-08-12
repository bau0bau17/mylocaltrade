import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  earlyAccessRegistrationsTable,
  earlyAccessEventsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, like } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { vi } from "vitest";

// Resend-confirmation dispatches email: mock the transport so tests never
// produce real Brevo traffic (test-setup.ts also strips transport creds).
vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendEarlyAccessConfirmationEmail: vi.fn(async () => "brevo" as const),
  };
});

import app from "../app";
import { generateToken } from "../lib/auth";
import { LAUNCH_CONSENT_VERSION } from "../lib/early-access-consent";
import { sendEarlyAccessConfirmationEmail } from "../lib/email";
import { hashConfirmationToken } from "../lib/early-access-confirmation";

const confirmSendMock = vi.mocked(sendEarlyAccessConfirmationEmail);

/**
 * Admin Early Access management: server-side authz, stats, search/filters,
 * detail + consent history, manual suppression, and safe CSV export
 * (suppressed excluded by default, full export gated + audited, formula
 * injection neutralised). No email transport is involved in these routes.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `eaadmin-${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];
let adminToken: string;
let customerToken: string;

// Attacker-controlled name that must never survive as a live formula cell.
const FORMULA_NAME = `=HYPERLINK("https://evil.example","x")`;

let subscribedId: number;
let marketingId: number;
let suppressedId: number;
let legacyUnknownId: number;

async function createUser(role: "customer" | "admin") {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`user-${role}-${createdUserIds.length}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `EA Admin Test ${role}`,
      role,
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

async function seedRegistration(
  values: Partial<typeof earlyAccessRegistrationsTable.$inferInsert> & {
    label: string;
  },
) {
  const { label, ...rest } = values;
  const [row] = await db
    .insert(earlyAccessRegistrationsTable)
    .values({
      name: `Person ${label}`,
      email: emailFor(label),
      emailNormalized: emailFor(label),
      audienceType: "customer",
      launchConsentAt: new Date(),
      launchConsentVersion: LAUNCH_CONSENT_VERSION,
      ...rest,
    })
    .returning({ id: earlyAccessRegistrationsTable.id });
  return row.id;
}

async function cleanup() {
  const regs = await db
    .select({ id: earlyAccessRegistrationsTable.id })
    .from(earlyAccessRegistrationsTable)
    .where(like(earlyAccessRegistrationsTable.emailNormalized, `%${SUFFIX}%`));
  const ids = regs.map((r) => r.id);
  if (ids.length) {
    await db
      .delete(earlyAccessEventsTable)
      .where(inArray(earlyAccessEventsTable.registrationId, ids));
    await db
      .delete(earlyAccessRegistrationsTable)
      .where(inArray(earlyAccessRegistrationsTable.id, ids));
  }
  if (createdUserIds.length) {
    await db
      .delete(earlyAccessEventsTable)
      .where(inArray(earlyAccessEventsTable.performedBy, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
}

beforeAll(async () => {
  const adminId = await createUser("admin");
  adminToken = generateToken(adminId, "admin", 1);
  const customerId = await createUser("customer");
  customerToken = generateToken(customerId, "customer", 1);

  subscribedId = await seedRegistration({ label: "subscribed" });
  marketingId = await seedRegistration({
    label: "marketing",
    audienceType: "trader",
    marketingConsentAt: new Date(),
    marketingConsentVersion: "marketing-v1-2026-08-12",
    name: FORMULA_NAME,
  });
  suppressedId = await seedRegistration({
    label: "suppressed",
    unsubscribedAt: new Date(),
    unsubscribeSource: "admin",
  });
  legacyUnknownId = await seedRegistration({
    label: "legacy",
    audienceType: "other",
    launchConsentAt: null,
    launchConsentVersion: null,
  });
  await db.insert(earlyAccessEventsTable).values({
    registrationId: subscribedId,
    kind: "REGISTERED",
  });
});

afterAll(cleanup);

beforeEach(async () => {
  await db.execute(sql`DELETE FROM rate_limit_hits`);
});

function authed(req: request.Test, token?: string) {
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
}

describe("admin early-access authorization", () => {
  const routes: Array<[string, string]> = [
    ["get", "/api/admin/early-access"],
    ["get", "/api/admin/early-access/stats"],
    ["get", "/api/admin/early-access/export"],
    ["get", "/api/admin/early-access/1"],
    ["post", "/api/admin/early-access/1/suppress"],
    ["post", "/api/admin/early-access/1/resend-confirmation"],
  ];

  it("rejects unauthenticated and non-admin callers on every route", async () => {
    for (const [method, path] of routes) {
      const anon = await (request(app) as any)[method](path);
      expect(anon.status, `${method} ${path} anon`).toBe(401);
      const customer = await authed(
        (request(app) as any)[method](path),
        customerToken,
      );
      expect(customer.status, `${method} ${path} customer`).toBe(403);
    }
  });
});

describe("GET /api/admin/early-access/stats", () => {
  it("returns the summary counts", async () => {
    const res = await authed(
      request(app).get("/api/admin/early-access/stats"),
      adminToken,
    );
    expect(res.status).toBe(200);
    // Shared dev DB: assert at-least, not exact.
    expect(res.body.total).toBeGreaterThanOrEqual(4);
    expect(res.body.marketingConsent).toBeGreaterThanOrEqual(1);
    expect(res.body.suppressed).toBeGreaterThanOrEqual(1);
    expect(res.body.unknownLegacyConsent).toBeGreaterThanOrEqual(1);
    // Double opt-in buckets exist (numbers vary on the shared dev DB).
    for (const key of [
      "pendingConfirmation",
      "confirmationExpired",
      "confirmedLaunchOnly",
      "confirmedLaunchMarketing",
      "legacyUnconfirmed",
    ]) {
      expect(typeof res.body[key], key).toBe("number");
    }
  });
});

describe("GET /api/admin/early-access (list, search, filters)", () => {
  it("searches by email fragment", async () => {
    const res = await authed(
      request(app)
        .get("/api/admin/early-access")
        .query({ search: `eaadmin-marketing-${SUFFIX}` }),
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.registrations[0].id).toBe(marketingId);
  });

  it("filters by type, marketing consent and suppression status", async () => {
    const bySuffix = { search: SUFFIX };
    const trader = await authed(
      request(app)
        .get("/api/admin/early-access")
        .query({ ...bySuffix, type: "trader" }),
      adminToken,
    );
    expect(trader.body.registrations.map((r: any) => r.id)).toEqual([
      marketingId,
    ]);

    const marketingYes = await authed(
      request(app)
        .get("/api/admin/early-access")
        .query({ ...bySuffix, marketing: "yes" }),
      adminToken,
    );
    expect(marketingYes.body.registrations.map((r: any) => r.id)).toEqual([
      marketingId,
    ]);

    const suppressed = await authed(
      request(app)
        .get("/api/admin/early-access")
        .query({ ...bySuffix, status: "suppressed" }),
      adminToken,
    );
    expect(suppressed.body.registrations.map((r: any) => r.id)).toEqual([
      suppressedId,
    ]);

    const unknown = await authed(
      request(app)
        .get("/api/admin/early-access")
        .query({ ...bySuffix, launchConsent: "unknown" }),
      adminToken,
    );
    expect(unknown.body.registrations.map((r: any) => r.id)).toEqual([
      legacyUnknownId,
    ]);
  });

  it("rejects invalid dates", async () => {
    const res = await authed(
      request(app)
        .get("/api/admin/early-access")
        .query({ from: "not-a-date" }),
      adminToken,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/early-access/:id (detail + consent history)", () => {
  it("returns the registration with its events and consent wording", async () => {
    const res = await authed(
      request(app).get(`/api/admin/early-access/${subscribedId}`),
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.registration.id).toBe(subscribedId);
    expect(res.body.events.length).toBeGreaterThanOrEqual(1);
    expect(res.body.registration.launchConsentVersion).toBe(
      LAUNCH_CONSENT_VERSION,
    );
  });

  it("404s for a missing id", async () => {
    const res = await authed(
      request(app).get("/api/admin/early-access/999999999"),
      adminToken,
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/early-access/:id/suppress", () => {
  it("suppresses once, writes an audit event, then 409s", async () => {
    const target = await seedRegistration({ label: "to-suppress" });
    const res = await authed(
      request(app)
        .post(`/api/admin/early-access/${target}/suppress`)
        .send({ reason: "Requested via support" }),
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.registration.unsubscribeSource).toBe("admin");

    const events = await db
      .select()
      .from(earlyAccessEventsTable)
      .where(
        and(
          eq(earlyAccessEventsTable.registrationId, target),
          eq(earlyAccessEventsTable.kind, "ADMIN_SUPPRESSED"),
        ),
      );
    expect(events).toHaveLength(1);
    expect((events[0].details as any)?.reason).toBe("Requested via support");
    expect(events[0].performedBy).toBe(createdUserIds[0]);

    const again = await authed(
      request(app).post(`/api/admin/early-access/${target}/suppress`),
      adminToken,
    );
    expect(again.status).toBe(409);
  });
});

describe("double opt-in admin surfaces (Phase 2A)", () => {
  async function seedPending(label: string, expired = false) {
    return seedRegistration({
      label,
      launchConsentAt: null,
      launchConsentVersion: null,
      pendingRequestedAt: new Date(),
      pendingLaunchConsentVersion: LAUNCH_CONSENT_VERSION,
      confirmationTokenHash: hashConfirmationToken(`seed-${label}-${SUFFIX}`),
      confirmationTokenExpiresAt: new Date(
        Date.now() + (expired ? -1 : 1) * 60 * 60 * 1000,
      ),
    });
  }

  it("filters by pending / expired / confirmed status", async () => {
    const pendingId = await seedPending("pending");
    const expiredId = await seedPending("expired", true);
    const confirmedId = await seedRegistration({
      label: "confirmed",
      confirmedAt: new Date(),
    });

    const q = async (status: string) => {
      const res = await authed(
        request(app)
          .get("/api/admin/early-access")
          .query({ search: SUFFIX, status }),
        adminToken,
      );
      expect(res.status).toBe(200);
      return res.body.registrations.map((r: any) => r.id);
    };
    expect(await q("pending")).toEqual([pendingId]);
    expect(await q("expired")).toEqual([expiredId]);
    expect(await q("confirmed")).toEqual([confirmedId]);
  });

  it("never returns the confirmation token hash in list, detail or CSV", async () => {
    const pendingId = await seedPending("nohash");
    const hash = hashConfirmationToken(`seed-nohash-${SUFFIX}`);

    const list = await authed(
      request(app)
        .get("/api/admin/early-access")
        .query({ search: `eaadmin-nohash-${SUFFIX}` }),
      adminToken,
    );
    expect(list.status).toBe(200);
    expect(list.body.registrations[0].id).toBe(pendingId);
    expect(JSON.stringify(list.body)).not.toContain(hash);
    expect(list.body.registrations[0]).not.toHaveProperty(
      "confirmationTokenHash",
    );

    const detail = await authed(
      request(app).get(`/api/admin/early-access/${pendingId}`),
      adminToken,
    );
    expect(JSON.stringify(detail.body)).not.toContain(hash);

    const csv = await authed(
      request(app)
        .get("/api/admin/early-access/export")
        .query({ search: `eaadmin-nohash-${SUFFIX}` }),
      adminToken,
    );
    expect(csv.text).not.toContain(hash);

    // Suppress response must be sanitized too (it echoes the updated row).
    const suppress = await authed(
      request(app).post(`/api/admin/early-access/${pendingId}/suppress`),
      adminToken,
    );
    expect(suppress.status).toBe(200);
    expect(JSON.stringify(suppress.body)).not.toContain(hash);
    expect(suppress.body.registration).not.toHaveProperty(
      "confirmationTokenHash",
    );
  });

  it("resend mints a fresh token, audits the send, and respects the daily cap", async () => {
    confirmSendMock.mockClear();
    const id = await seedPending("resend", true); // expired → resend reopens it
    const oldHash = hashConfirmationToken(`seed-resend-${SUFFIX}`);

    const res = await authed(
      request(app).post(`/api/admin/early-access/${id}/resend-confirmation`),
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(confirmSendMock).toHaveBeenCalledTimes(1);

    const [row] = await db
      .select()
      .from(earlyAccessRegistrationsTable)
      .where(eq(earlyAccessRegistrationsTable.id, id));
    // Fresh token replaces the previous one and the window is reopened.
    expect(row.confirmationTokenHash).not.toBe(oldHash);
    expect(row.confirmationTokenExpiresAt!.getTime()).toBeGreaterThan(
      Date.now(),
    );
    // The emailed URL's token hashes to exactly what was stored.
    const url = new URL(confirmSendMock.mock.calls.at(-1)![0].confirmUrl);
    expect(hashConfirmationToken(url.searchParams.get("token")!)).toBe(
      row.confirmationTokenHash,
    );

    const events = await db
      .select()
      .from(earlyAccessEventsTable)
      .where(
        and(
          eq(earlyAccessEventsTable.registrationId, id),
          eq(earlyAccessEventsTable.kind, "CONFIRMATION_SENT"),
        ),
      );
    expect(events).toHaveLength(1);
    expect((events[0].details as any).resend).toBe(true);
    expect((events[0].details as any).ok).toBe(true);
    expect(events[0].performedBy).toBe(createdUserIds[0]);

    // Daily cap: two more resends allowed, the fourth send is refused.
    for (const expected of [200, 200, 429]) {
      const again = await authed(
        request(app).post(`/api/admin/early-access/${id}/resend-confirmation`),
        adminToken,
      );
      expect(again.status).toBe(expected);
    }
    expect(confirmSendMock).toHaveBeenCalledTimes(3);
  });

  it("refuses resend for suppressed contacts and rows with nothing pending", async () => {
    confirmSendMock.mockClear();
    const suppressed = await authed(
      request(app).post(
        `/api/admin/early-access/${suppressedId}/resend-confirmation`,
      ),
      adminToken,
    );
    expect(suppressed.status).toBe(409);

    // Legacy Phase 1 row: never submitted under double opt-in → no pending.
    const legacy = await authed(
      request(app).post(
        `/api/admin/early-access/${subscribedId}/resend-confirmation`,
      ),
      adminToken,
    );
    expect(legacy.status).toBe(409);
    expect(confirmSendMock).not.toHaveBeenCalled();

    const missing = await authed(
      request(app).post("/api/admin/early-access/999999999/resend-confirmation"),
      adminToken,
    );
    expect(missing.status).toBe(404);
  });
});

describe("GET /api/admin/early-access/export (safe CSV)", () => {
  it("excludes unsubscribed/suppressed contacts by default and audits the export", async () => {
    const res = await authed(
      request(app)
        .get("/api/admin/early-access/export")
        .query({ search: SUFFIX }),
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).not.toContain(emailFor("suppressed"));
    expect(res.text).toContain(emailFor("subscribed"));

    const audit = await db
      .select()
      .from(earlyAccessEventsTable)
      .where(eq(earlyAccessEventsTable.kind, "CSV_EXPORTED"));
    expect(audit.length).toBeGreaterThanOrEqual(1);
    const latest = audit[audit.length - 1];
    // Audit payloads: counts + filters only, never recipient lists.
    expect(JSON.stringify(latest.details)).not.toContain("@example.test");
  });

  it("requires explicit confirmation to include suppressed contacts", async () => {
    const noConfirm = await authed(
      request(app)
        .get("/api/admin/early-access/export")
        .query({ search: SUFFIX, includeSuppressed: "true" }),
      adminToken,
    );
    expect(noConfirm.status).toBe(400);

    const confirmed = await authed(
      request(app)
        .get("/api/admin/early-access/export")
        .query({ search: SUFFIX, includeSuppressed: "true", confirmAll: "true" }),
      adminToken,
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.text).toContain(emailFor("suppressed"));
  });

  it("purpose=marketing exports only subscribed contacts with recorded marketing consent", async () => {
    const res = await authed(
      request(app)
        .get("/api/admin/early-access/export")
        .query({ search: SUFFIX, purpose: "marketing" }),
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain(emailFor("marketing"));
    // No marketing consent → excluded, even though subscribed.
    expect(res.text).not.toContain(emailFor("subscribed"));
    expect(res.text).not.toContain(emailFor("suppressed"));

    // purpose overrides includeSuppressed: opted-out rows can never appear.
    const forced = await authed(
      request(app)
        .get("/api/admin/early-access/export")
        .query({
          search: SUFFIX,
          purpose: "marketing",
          includeSuppressed: "true",
          confirmAll: "true",
        }),
      adminToken,
    );
    expect(forced.status).toBe(200);
    expect(forced.text).not.toContain(emailFor("suppressed"));

    const bad = await authed(
      request(app)
        .get("/api/admin/early-access/export")
        .query({ purpose: "nonsense" }),
      adminToken,
    );
    expect(bad.status).toBe(400);
  });

  it("purpose=launch excludes rows without recorded launch consent", async () => {
    const res = await authed(
      request(app)
        .get("/api/admin/early-access/export")
        .query({ search: SUFFIX, purpose: "launch" }),
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain(emailFor("subscribed"));
    expect(res.text).not.toContain(emailFor("legacy"));
    expect(res.text).not.toContain(emailFor("suppressed"));
  });

  it("neutralises spreadsheet formula payloads in visitor-controlled cells", async () => {
    const res = await authed(
      request(app)
        .get("/api/admin/early-access/export")
        .query({ search: `eaadmin-marketing-${SUFFIX}` }),
      adminToken,
    );
    expect(res.status).toBe(200);
    const dataLine = res.text
      .split("\n")
      .find((l) => l.includes(emailFor("marketing")));
    expect(dataLine).toBeDefined();
    // The raw formula must not appear unprefixed; the escaped form must.
    expect(dataLine!).toContain(`'=HYPERLINK`);
  });
});
