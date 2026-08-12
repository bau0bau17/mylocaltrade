import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  earlyAccessRegistrationsTable,
  earlyAccessCampaignsTable,
  earlyAccessCampaignRecipientsTable,
  earlyAccessCampaignBatchesTable,
  earlyAccessCampaignEventsTable,
  outreachContactsTable,
  outreachSuppressionsTable,
  outreachEventsTable,
} from "@workspace/db/schema";
import { eq, inArray, like, sql } from "drizzle-orm";

// No real Brevo traffic in tests, ever.
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
import {
  marketingSendingStatus,
  upsertContactsIntoList,
} from "../lib/brevo-marketing";
import {
  evaluateOutreachEligibility,
  csvCell,
  parseCsv,
  outreachCsvTemplate,
  OUTREACH_CSV_COLUMNS,
} from "../lib/outreach-contacts";
import { renderCampaignEmail } from "../lib/early-access-campaigns";
import { buildOutreachUnsubscribeToken } from "../lib/early-access-unsubscribe";
import { runCampaignBatch } from "../lib/early-access-campaign-batch";

const statusMock = vi.mocked(marketingSendingStatus);
const upsertMock = vi.mocked(upsertContactsIntoList);

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `oc-${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];
let adminToken: string;
let adminUserId: number;
let customerToken: string;

const LIA =
  "LIA documented 2026-08-01 ref LIA-001: balancing test passed for one B2B recruitment message with clear opt-out.";
const COMPANY_EVIDENCE =
  "Verified on Companies House register 2026-08-01, active status, name matches website.";
const RELEVANCE =
  "UK trade business relevant to MyLocalTrade trader recruitment services.";
const CONSENT_EVIDENCE =
  "Signed form: 'Email me about MyLocalTrade trader services' — scanned, ref TS-0715-042.";

/** Valid corporate-B2B contact fields (eligible). */
function b2bFields(label: string, overrides: Record<string, string> = {}) {
  return {
    email: emailFor(label),
    contact_name: "Jane Smith",
    company_name: `Example ${label} Ltd`,
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
    ...overrides,
  };
}

function csvFrom(rows: Record<string, string>[]): string {
  const header = OUTREACH_CSV_COLUMNS.join(",");
  const lines = rows.map((row) =>
    OUTREACH_CSV_COLUMNS.map((col) => csvCell(row[col] ?? "")).join(","),
  );
  return `${header}\n${lines.join("\n")}\n`;
}

async function addContact(fields: Record<string, string>) {
  return request(app)
    .post("/api/admin/outreach-contacts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(fields);
}

async function createOutreachDraft(): Promise<number> {
  const res = await request(app)
    .post("/api/admin/early-access/campaigns")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      type: "marketing",
      audience: "outreach",
      name: `Outreach campaign ${SUFFIX}`,
      subject: "A note for your business",
      previewText: "One-off business message",
      heading: "Working with local trades",
      bodyText: "Hello!\n\nWe built something for UK trade businesses.",
      ctaLabel: "See more",
      ctaUrl: "https://mylocaltrade.co.uk/traders",
    });
  expect(res.status).toBe(201);
  expect(res.body.campaign.audience).toBe("outreach");
  return res.body.campaign.id as number;
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
  await db
    .delete(earlyAccessRegistrationsTable)
    .where(like(earlyAccessRegistrationsTable.emailNormalized, `%${SUFFIX}%`));
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
      fullName: "Outreach Test Admin",
      role: "admin",
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(admin.id);
  adminUserId = admin.id;
  adminToken = generateToken(admin.id, "admin", 1);
  const [customer] = await db
    .insert(usersTable)
    .values({
      email: emailFor("customer"),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: "Outreach Test Customer",
      role: "customer",
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(customer.id);
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
  // eslint-disable-next-line drizzle/enforce-delete-with-where
  await db.execute(
    sql`DELETE FROM rate_limit_hits WHERE key LIKE 'api%' OR key LIKE 'early-access%' OR key LIKE 'brevo-webhook%'`,
  );
});

// ---------------------------------------------------------------------------
// Eligibility engine (unit)
// ---------------------------------------------------------------------------

describe("evaluateOutreachEligibility", () => {
  const base = {
    businessType: "limited_company" as const,
    lawfulRoute: "none" as const,
    companyNumber: null,
    sourceName: "Companies House",
    sourceDetail: "https://example.test/ch",
    consentAt: null,
    consentEvidence: null,
    soiSaleEvidence: null,
    soiRelevanceEvidence: null,
    soiOptOutEvidence: null,
    b2bCompanyEvidence: null,
    b2bRelevanceEvidence: null,
    b2bLiaEvidence: null,
    unsubscribedAt: null,
    emailSuppressedAt: null,
  };

  it("blocks sole traders, partnerships and individuals without consent or soft opt-in", () => {
    for (const businessType of ["sole_trader", "partnership", "individual"] as const) {
      for (const lawfulRoute of ["none", "corporate_b2b"] as const) {
        const verdict = evaluateOutreachEligibility({
          ...base,
          businessType,
          lawfulRoute,
          companyNumber: "12345678",
          b2bCompanyEvidence: COMPANY_EVIDENCE,
          b2bRelevanceEvidence: RELEVANCE,
          b2bLiaEvidence: LIA,
        });
        expect(verdict.status).toBe("blocked");
        expect(verdict.category).toBe("SOLE_TRADER_OR_INDIVIDUAL");
      }
    }
  });

  it("blocks unknown business types on every route except valid consent/soft opt-in", () => {
    expect(
      evaluateOutreachEligibility({ ...base, businessType: "unknown" }).status,
    ).toBe("blocked");
    expect(
      evaluateOutreachEligibility({
        ...base,
        businessType: "unknown",
        lawfulRoute: "corporate_b2b",
        companyNumber: "12345678",
        b2bCompanyEvidence: COMPANY_EVIDENCE,
        b2bRelevanceEvidence: RELEVANCE,
        b2bLiaEvidence: LIA,
      }).status,
    ).toBe("blocked");
  });

  it("rejects consent claims with missing or trivial evidence, missing date, or future date", () => {
    const claim = { ...base, lawfulRoute: "confirmed_consent" as const };
    expect(evaluateOutreachEligibility(claim).status).toBe("blocked");
    expect(
      evaluateOutreachEligibility({
        ...claim,
        consentAt: new Date("2026-07-01"),
        consentEvidence: "yes", // a tick is not evidence
      }).status,
    ).toBe("blocked");
    expect(
      evaluateOutreachEligibility({
        ...claim,
        consentAt: new Date(Date.now() + 86_400_000),
        consentEvidence: CONSENT_EVIDENCE,
      }).status,
    ).toBe("blocked");
    const valid = evaluateOutreachEligibility({
      ...claim,
      businessType: "sole_trader",
      consentAt: new Date("2026-07-01"),
      consentEvidence: CONSENT_EVIDENCE,
    });
    expect(valid.status).toBe("eligible");
    expect(valid.category).toBe("CONFIRMED_CONSENT");
  });

  it("requires ALL three soft opt-in evidences", () => {
    const claim = {
      ...base,
      businessType: "sole_trader" as const,
      lawfulRoute: "soft_opt_in" as const,
      soiSaleEvidence: "Bought a Premium trader subscription on 2026-05-02, order #991.",
      soiRelevanceEvidence: "Campaign is about the same trader services they bought.",
    };
    expect(evaluateOutreachEligibility(claim).status).toBe("blocked");
    expect(
      evaluateOutreachEligibility({
        ...claim,
        soiOptOutEvidence: "Opt-out checkbox shown at checkout; not ticked. Screenshot ref SO-1.",
      }).status,
    ).toBe("eligible");
  });

  it("corporate B2B needs Ltd/LLP + company number + all three evidences", () => {
    const claim = { ...base, lawfulRoute: "corporate_b2b" as const };
    expect(evaluateOutreachEligibility(claim).status).toBe("blocked");
    expect(
      evaluateOutreachEligibility({
        ...claim,
        companyNumber: "12345678",
        b2bCompanyEvidence: COMPANY_EVIDENCE,
        b2bRelevanceEvidence: RELEVANCE,
      }).status,
    ).toBe("blocked"); // missing LIA
    expect(
      evaluateOutreachEligibility({
        ...claim,
        companyNumber: "not-a-number",
        b2bCompanyEvidence: COMPANY_EVIDENCE,
        b2bRelevanceEvidence: RELEVANCE,
        b2bLiaEvidence: LIA,
      }).status,
    ).toBe("blocked"); // invalid company number
    const valid = evaluateOutreachEligibility({
      ...claim,
      companyNumber: "12345678",
      b2bCompanyEvidence: COMPANY_EVIDENCE,
      b2bRelevanceEvidence: RELEVANCE,
      b2bLiaEvidence: LIA,
    });
    expect(valid.status).toBe("eligible");
    expect(valid.category).toBe("CORPORATE_B2B");
  });

  it("unsubscribe and suppression override every eligible route", () => {
    const eligible = {
      ...base,
      lawfulRoute: "corporate_b2b" as const,
      companyNumber: "12345678",
      b2bCompanyEvidence: COMPANY_EVIDENCE,
      b2bRelevanceEvidence: RELEVANCE,
      b2bLiaEvidence: LIA,
    };
    expect(evaluateOutreachEligibility(eligible).status).toBe("eligible");
    expect(
      evaluateOutreachEligibility({ ...eligible, unsubscribedAt: new Date() }).status,
    ).toBe("blocked");
    expect(
      evaluateOutreachEligibility({ ...eligible, emailSuppressedAt: new Date() })
        .status,
    ).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// CSV safety (unit)
// ---------------------------------------------------------------------------

describe("CSV handling", () => {
  it("neutralises formula-injection characters on export cells", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe('"\'=SUM(A1:A9)"');
    expect(csvCell("+1234")).toBe('"\'+1234"');
    expect(csvCell("-cmd")).toBe('"\'-cmd"');
    expect(csvCell("@import")).toBe('"\'@import"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("plain")).toBe('"plain"');
  });

  it("parses quoted cells and rejects malformed CSV", () => {
    expect(parseCsv('a,"b,c",d\n1,2,3')).toEqual([
      ["a", "b,c", "d"],
      ["1", "2", "3"],
    ]);
    expect(parseCsv('a,"unterminated\n1,2')).toBeNull();
  });

  it("template parses against its own column contract", () => {
    const parsed = parseCsv(outreachCsvTemplate());
    expect(parsed).not.toBeNull();
    expect(parsed![0]).toEqual([...OUTREACH_CSV_COLUMNS]);
    expect(parsed!.length).toBe(3); // header + 2 example rows
  });
});

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

describe("admin authz", () => {
  it("rejects anonymous and non-admin access", async () => {
    expect((await request(app).get("/api/admin/outreach-contacts")).status).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/admin/outreach-contacts")
          .set("Authorization", `Bearer ${customerToken}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/admin/outreach-contacts/import/commit")
          .set("Authorization", `Bearer ${customerToken}`)
          .send({ csv: "x" })
      ).status,
    ).toBe(403);
  });
});

describe("manual add", () => {
  it("saves an eligible B2B contact with server-computed eligibility", async () => {
    const res = await addContact(b2bFields("manual-b2b"));
    expect(res.status).toBe(201);
    expect(res.body.contact.eligibilityStatus).toBe("eligible");
    expect(res.body.contact.eligibilityCategory).toBe("CORPORATE_B2B");
  });

  it("ignores client-asserted eligibility fields entirely", async () => {
    const res = await addContact({
      ...b2bFields("manual-forced", {
        business_type: "sole_trader",
        lawful_route: "none",
      }),
      eligibility_status: "eligible",
      eligibilityStatus: "eligible",
    } as Record<string, string>);
    expect(res.status).toBe(201);
    expect(res.body.contact.eligibilityStatus).toBe("blocked");
    expect(res.body.contact.eligibilityCategory).toBe("SOLE_TRADER_OR_INDIVIDUAL");
  });

  it("rejects an address already on the Early Access list (cross-list dedupe)", async () => {
    const email = emailFor("cross-list");
    await db.insert(earlyAccessRegistrationsTable).values({
      name: "EA Person",
      email,
      emailNormalized: email,
      audienceType: "trader",
    });
    const res = await addContact(b2bFields("cross-list", { email }));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Early Access/i);
  });

  it("rejects an address on the permanent suppression list", async () => {
    const email = emailFor("suppressed-add");
    await db.insert(outreachSuppressionsTable).values({
      emailNormalized: email,
      reason: "unsubscribed",
      source: "user_link",
    });
    const res = await addContact(b2bFields("suppressed-add", { email }));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/suppression/i);
  });
});

describe("import validate + commit", () => {
  it("classifies accepted/invalid/duplicate rows with per-row reasons and saves nothing on validate", async () => {
    const dupEmail = emailFor("imp-dup");
    const csv = csvFrom([
      b2bFields("imp-ok"),
      { ...b2bFields("imp-dup"), email: dupEmail },
      { ...b2bFields("imp-dup2"), email: dupEmail }, // duplicate in file
      b2bFields("imp-bad", { email: "not-an-email" }),
      b2bFields("imp-soletrader", {
        business_type: "sole_trader",
        lawful_route: "none",
      }),
    ]);
    const res = await request(app)
      .post("/api/admin/outreach-contacts/import/validate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ csv });
    expect(res.status).toBe(200);
    const byRow = new Map(
      (res.body.results as { rowNumber: number; status: string; reason: string }[]).map(
        (r) => [r.rowNumber, r],
      ),
    );
    expect(byRow.get(2)!.status).toBe("accepted");
    expect(byRow.get(3)!.status).toBe("accepted");
    expect(byRow.get(4)!.status).toBe("duplicate_in_file");
    expect(byRow.get(5)!.status).toBe("invalid");
    expect(byRow.get(5)!.reason).toMatch(/email/i);
    // Sole trader without consent: SAVED but blocked — reason must say so.
    expect(byRow.get(6)!.status).toBe("accepted");
    expect(byRow.get(6)!.reason).toMatch(/BLOCKED/);
    // Validation never writes.
    const saved = await db
      .select({ id: outreachContactsTable.id })
      .from(outreachContactsTable)
      .where(eq(outreachContactsTable.emailNormalized, dupEmail));
    expect(saved.length).toBe(0);
  });

  it("rejects a CSV with a wrong header instead of guessing", async () => {
    const res = await request(app)
      .post("/api/admin/outreach-contacts/import/validate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ csv: "email,name\na@b.test,A\n" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing required columns/i);
  });

  it("commits accepted rows, revalidating server-side (suppression added between preview and commit blocks the row)", async () => {
    const email = emailFor("imp-commit-suppressed");
    const csv = csvFrom([
      b2bFields("imp-commit-ok"),
      { ...b2bFields("imp-commit-suppressed"), email },
    ]);
    const preview = await request(app)
      .post("/api/admin/outreach-contacts/import/validate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ csv });
    expect(preview.status).toBe(200);
    expect(preview.body.summary.accepted).toBe(2);
    // Suppression arrives AFTER the preview…
    await db.insert(outreachSuppressionsTable).values({
      emailNormalized: email,
      reason: "unsubscribed",
      source: "user_link",
    });
    const commit = await request(app)
      .post("/api/admin/outreach-contacts/import/commit")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ csv });
    expect(commit.status).toBe(200);
    expect(commit.body.inserted).toBe(1);
    const rows = await db
      .select({ emailNormalized: outreachContactsTable.emailNormalized })
      .from(outreachContactsTable)
      .where(eq(outreachContactsTable.emailNormalized, email));
    expect(rows.length).toBe(0);
  });

  it("stores formula-looking values inertly and re-neutralises them on export", async () => {
    const res = await addContact(
      b2bFields("formula", { contact_name: "=HYPERLINK(evil)" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.contact.contactName).toBe("=HYPERLINK(evil)"); // stored verbatim
    const exportRes = await request(app)
      .get("/api/admin/outreach-contacts/export")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.text).toContain('"\'=HYPERLINK(evil)"');
    expect(exportRes.text).not.toContain(',"=HYPERLINK(evil)"');
  });

  it("concurrent identical imports never create duplicate rows", async () => {
    const csv = csvFrom([b2bFields("imp-race")]);
    const [a, b] = await Promise.all([
      request(app)
        .post("/api/admin/outreach-contacts/import/commit")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ csv }),
      request(app)
        .post("/api/admin/outreach-contacts/import/commit")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ csv }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.inserted + b.body.inserted).toBe(1);
    const rows = await db
      .select({ id: outreachContactsTable.id })
      .from(outreachContactsTable)
      .where(eq(outreachContactsTable.emailNormalized, emailFor("imp-race")));
    expect(rows.length).toBe(1);
  });
});

describe("edit, suppress, delete", () => {
  it("PATCH recomputes eligibility from evidence and rejects eligibility flags", async () => {
    const created = await addContact(
      b2bFields("edit", { b2b_lia_evidence: "" }), // missing LIA → blocked
    );
    expect(created.body.contact.eligibilityStatus).toBe("blocked");
    const id = created.body.contact.id as number;
    const patched = await request(app)
      .patch(`/api/admin/outreach-contacts/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ b2b_lia_evidence: LIA, eligibility_status: "blocked" });
    expect(patched.status).toBe(200);
    expect(patched.body.contact.eligibilityStatus).toBe("eligible");
  });

  it("suppress records the objection and the permanent suppression row", async () => {
    const created = await addContact(b2bFields("objection"));
    const id = created.body.contact.id as number;
    const res = await request(app)
      .post(`/api/admin/outreach-contacts/${id}/suppress`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "objection" });
    expect(res.status).toBe(200);
    expect(res.body.contact.unsubscribedAt).not.toBeNull();
    expect(res.body.contact.eligibilityStatus).toBe("blocked");
    const [supp] = await db
      .select()
      .from(outreachSuppressionsTable)
      .where(
        eq(outreachSuppressionsTable.emailNormalized, emailFor("objection")),
      );
    expect(supp.reason).toBe("objection");
  });

  it("deleting an opted-out contact keeps the minimal suppression record and blocks re-import", async () => {
    const created = await addContact(b2bFields("del-optout"));
    const id = created.body.contact.id as number;
    await request(app)
      .post(`/api/admin/outreach-contacts/${id}/suppress`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "objection" });
    const del = await request(app)
      .delete(`/api/admin/outreach-contacts/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
    const rows = await db
      .select({ id: outreachContactsTable.id })
      .from(outreachContactsTable)
      .where(eq(outreachContactsTable.id, id));
    expect(rows.length).toBe(0);
    // Personal data gone; suppression record retained; re-import blocked.
    const reAdd = await addContact(b2bFields("del-optout"));
    expect(reAdd.status).toBe(409);
    expect(reAdd.body.error).toMatch(/suppression/i);
  });

  it("deleting a never-opted-out contact retains nothing and allows re-add", async () => {
    const created = await addContact(b2bFields("del-clean"));
    const id = created.body.contact.id as number;
    await request(app)
      .delete(`/api/admin/outreach-contacts/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const reAdd = await addContact(b2bFields("del-clean"));
    expect(reAdd.status).toBe(201);
  });

  it("literal sibling routes are never swallowed by :id (template + non-numeric)", async () => {
    const template = await request(app)
      .get("/api/admin/outreach-contacts/template")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(template.status).toBe(200);
    expect(template.headers["content-type"]).toMatch(/text\/csv/);
    const bogus = await request(app)
      .get("/api/admin/outreach-contacts/definitely-not-an-id")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(bogus.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Campaign integration
// ---------------------------------------------------------------------------

describe("outreach campaigns", () => {
  it("audience counts only live-recheck-eligible contacts and dedupes against Early Access", async () => {
    await addContact(b2bFields("aud-ok"));
    await addContact(
      b2bFields("aud-blocked", { business_type: "sole_trader", lawful_route: "none" }),
    );
    // Eligible contact whose email later appears on the EA list.
    const dupEmail = emailFor("aud-ea-dup");
    const dupAdd = await addContact(b2bFields("aud-ea-dup", { email: dupEmail }));
    expect(dupAdd.status).toBe(201);
    expect(dupAdd.body.contact.eligibilityStatus).toBe("eligible");
    await db.insert(earlyAccessRegistrationsTable).values({
      name: "EA Dup",
      email: dupEmail,
      emailNormalized: dupEmail,
      audienceType: "trader",
    });
    const id = await createOutreachDraft();
    const aud = await request(app)
      .get(`/api/admin/early-access/campaigns/${id}/audience`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(aud.status).toBe(200);
    expect(aud.body.audienceKind).toBe("outreach");
    expect(aud.body.audience.excludedEarlyAccessDuplicate).toBeGreaterThanOrEqual(1);
    expect(aud.body.confirmationPhrase).toMatch(/^SEND TO \d+ OUTREACH CONTACTS$/);
    // Cancel the draft so later audience-based tests aren't affected.
    await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);
  });

  it("queue snapshots outreach contacts and does not trust import-time status (evidence edited to invalid → excluded)", async () => {
    const okRes = await addContact(b2bFields("q-ok"));
    const staleRes = await addContact(b2bFields("q-stale"));
    // Sabotage: make the stored evidence invalid WITHOUT touching the
    // eligibility flag (as if rules changed after import).
    await db
      .update(outreachContactsTable)
      .set({ b2bLiaEvidence: null })
      .where(eq(outreachContactsTable.id, staleRes.body.contact.id));
    const id = await createOutreachDraft();
    const aud = await request(app)
      .get(`/api/admin/early-access/campaigns/${id}/audience`)
      .set("Authorization", `Bearer ${adminToken}`);
    const phrase = aud.body.confirmationPhrase as string;
    const queue = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/queue`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirmation: phrase });
    expect(queue.status).toBe(200);
    const recipients = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(eq(earlyAccessCampaignRecipientsTable.campaignId, id));
    const emails = recipients.map((r) => r.emailNormalized);
    expect(emails).toContain(emailFor("q-ok"));
    expect(emails).not.toContain(emailFor("q-stale"));
    for (const r of recipients) {
      expect(r.registrationId).toBeNull();
      expect(r.outreachContactId).not.toBeNull();
    }
    expect(recipients.find((r) => r.emailNormalized === emailFor("q-ok"))!
      .outreachContactId).toBe(okRes.body.contact.id);
    await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);
  });

  it("send-time recheck skips contacts whose eligibility died after queueing; batch carries outreach tokens + per-contact source", async () => {
    const keep = await addContact(b2bFields("send-keep"));
    const lose = await addContact(b2bFields("send-lose"));
    const id = await createOutreachDraft();
    const aud = await request(app)
      .get(`/api/admin/early-access/campaigns/${id}/audience`)
      .set("Authorization", `Bearer ${adminToken}`);
    const queue = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/queue`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirmation: aud.body.confirmationPhrase });
    expect(queue.status).toBe(200);
    // After queueing: one contact objects.
    await request(app)
      .post(`/api/admin/outreach-contacts/${lose.body.contact.id}/suppress`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "objection" });
    statusMock.mockReturnValue({ enabled: true });
    const result = await runCampaignBatch(id, adminUserId);
    expect(result.ok).toBe(true);
    const upserted = upsertMock.mock.calls.flatMap((call) => call[1]);
    const keepRow = upserted.find(
      (row) => row.email === emailFor("send-keep"),
    );
    expect(keepRow).toBeDefined();
    expect(keepRow!.unsubscribeToken.startsWith("o1.")).toBe(true);
    expect(keepRow!.sourceNote).toContain("Companies House");
    expect(
      upserted.find((row) => row.email === emailFor("send-lose")),
    ).toBeUndefined();
    const [loseRecipient] = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(
        eq(
          earlyAccessCampaignRecipientsTable.outreachContactId,
          lose.body.contact.id,
        ),
      );
    // Suppress sets unsubscribedAt, so the recheck records it as an
    // unsubscribe (the stronger, permanent signal) rather than a skip.
    expect(loseRecipient.status).toBe("unsubscribed");
  });

  it("send-time recheck excludes contacts that joined the Early Access list after queueing", async () => {
    await addContact(b2bFields("send-ea-keep"));
    const dup = await addContact(b2bFields("send-ea-dup"));
    const id = await createOutreachDraft();
    const aud = await request(app)
      .get(`/api/admin/early-access/campaigns/${id}/audience`)
      .set("Authorization", `Bearer ${adminToken}`);
    const queue = await request(app)
      .post(`/api/admin/early-access/campaigns/${id}/queue`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirmation: aud.body.confirmationPhrase });
    expect(queue.status).toBe(200);
    // AFTER queueing: the address joins the Early Access list. Cross-list
    // rule: EA addresses are only ever contacted through EA campaigns, so
    // the queued outreach recipient must be dropped at send time.
    await db.insert(earlyAccessRegistrationsTable).values({
      name: "Late EA Signup",
      email: emailFor("send-ea-dup"),
      emailNormalized: emailFor("send-ea-dup"),
      audienceType: "trader",
    });
    statusMock.mockReturnValue({ enabled: true });
    const result = await runCampaignBatch(id, adminUserId);
    expect(result.ok).toBe(true);
    const upserted = upsertMock.mock.calls.flatMap((call) => call[1]);
    expect(
      upserted.find((row) => row.email === emailFor("send-ea-keep")),
    ).toBeDefined();
    expect(
      upserted.find((row) => row.email === emailFor("send-ea-dup")),
    ).toBeUndefined();
    const [dupRecipient] = await db
      .select()
      .from(earlyAccessCampaignRecipientsTable)
      .where(
        eq(
          earlyAccessCampaignRecipientsTable.outreachContactId,
          dup.body.contact.id,
        ),
      );
    expect(dupRecipient.status).toBe("suppressed");
    expect(dupRecipient.statusDetail).toBe("batch_recheck");
  });

  it("outreach emails include how-obtained wording, right to object, unsubscribe, privacy and contact links", () => {
    const campaign = {
      type: "marketing",
      subject: "Subject",
      previewText: "Preview",
      heading: "Heading",
      bodyText: "Body",
      ctaLabel: "Go",
      ctaUrl: "https://mylocaltrade.co.uk/x",
    };
    const { html, text } = renderCampaignEmail(campaign, {
      brevoMergeTags: true,
      audience: "outreach",
    });
    for (const content of [html, text]) {
      expect(content).toContain("business message from MyLocalTrade");
      expect(content).toContain("contact.OC_SOURCE");
      expect(content).toContain("right to object");
      expect(content).toContain("/unsubscribe?token={{ contact.EA_UNSUB_TOKEN }}");
      expect(content).toContain("https://mylocaltrade.co.uk/privacy-policy");
      expect(content).toContain("https://mylocaltrade.co.uk/contact");
      expect(content).toContain("Service Provider LTD");
      expect(content).not.toContain("Early Access list");
    }
    // Early Access rendering is unchanged.
    const ea = renderCampaignEmail(campaign, { brevoMergeTags: true });
    expect(ea.html).toContain("Early Access list");
    expect(ea.html).not.toContain("OC_SOURCE");
  });
});

// ---------------------------------------------------------------------------
// Unsubscribe + webhook suppression
// ---------------------------------------------------------------------------

describe("outreach unsubscribe + webhook", () => {
  it("signed outreach token unsubscribes the contact, adds the permanent suppression row and is idempotent", async () => {
    const created = await addContact(b2bFields("unsub"));
    const id = created.body.contact.id as number;
    const token = buildOutreachUnsubscribeToken(id);
    const first = await request(app)
      .post("/api/early-access/unsubscribe")
      .send({ token });
    expect(first.status).toBe(200);
    const [contact] = await db
      .select()
      .from(outreachContactsTable)
      .where(eq(outreachContactsTable.id, id));
    expect(contact.unsubscribedAt).not.toBeNull();
    expect(contact.eligibilityStatus).toBe("blocked");
    const [supp] = await db
      .select()
      .from(outreachSuppressionsTable)
      .where(eq(outreachSuppressionsTable.emailNormalized, emailFor("unsub")));
    expect(supp).toBeDefined();
    // Idempotent + tampered tokens collapse to generic 400.
    expect((await request(app).post("/api/early-access/unsubscribe").send({ token })).status).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/early-access/unsubscribe")
          .send({ token: token.slice(0, -2) })
      ).status,
    ).toBe(400);
    // An outreach token can never unsubscribe an EA registration id.
    expect(token.startsWith("o1.")).toBe(true);
  });

  it("Brevo webhook events suppress matching outreach contacts immediately", async () => {
    process.env.BREVO_WEBHOOK_SECRET = "test-webhook-secret";
    const created = await addContact(b2bFields("webhook-bounce"));
    const res = await request(app)
      .post("/api/early-access/brevo-events")
      .set("X-Webhook-Secret", "test-webhook-secret")
      .send({ event: "hardBounce", email: emailFor("webhook-bounce") });
    expect(res.status).toBe(200);
    const [contact] = await db
      .select()
      .from(outreachContactsTable)
      .where(eq(outreachContactsTable.id, created.body.contact.id));
    expect(contact.emailSuppressedAt).not.toBeNull();
    expect(contact.eligibilityStatus).toBe("blocked");
    const [supp] = await db
      .select()
      .from(outreachSuppressionsTable)
      .where(
        eq(
          outreachSuppressionsTable.emailNormalized,
          emailFor("webhook-bounce"),
        ),
      );
    expect(supp.reason).toBe("hard_bounce");
  });
});
