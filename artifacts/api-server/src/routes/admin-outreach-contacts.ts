import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  outreachContactsTable,
  outreachSuppressionsTable,
  outreachEventsTable,
  earlyAccessRegistrationsTable,
  OUTREACH_BUSINESS_TYPES,
  OUTREACH_ELIGIBILITY_CATEGORIES,
  type OutreachContact,
} from "@workspace/db/schema";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { authMiddleware, adminOnly } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import {
  csvCell,
  evaluateOutreachEligibility,
  outreachCsvTemplate,
  parseContactFields,
  validateImport,
  OUTREACH_CSV_COLUMNS,
} from "../lib/outreach-contacts";

const router: IRouter = Router();

/**
 * Admin-only Outreach Contacts (legally controlled contact import).
 *
 * Separation guarantees:
 * - outreach rows are NEVER Early Access registrations — separate tables,
 *   separate stats, separate exports, separate audit trail;
 * - eligibility is server-computed from stored evidence on EVERY write and
 *   re-checked again at campaign preview/queue/send time — the UI cannot
 *   assert eligibility and no admin override unblocks UNKNOWN contacts;
 * - the permanent suppression list survives contact deletion, so an
 *   opted-out address can never be re-imported or contacted again.
 *
 * Events hold counts, reasons and flags — never bulk lists or email bodies.
 */

const oc = outreachContactsTable;
const os = outreachSuppressionsTable;
const oe = outreachEventsTable;

router.use("/admin/outreach-contacts", authMiddleware, adminOnly);

function sanitizeContact(contact: OutreachContact) {
  return contact; // admin-only surface; all fields are admin-entered.
}

async function recordEvent(
  executor: Pick<typeof db, "insert">,
  contactId: number | null,
  kind: string,
  performedBy: number | null,
  details: Record<string, unknown>,
): Promise<void> {
  await executor.insert(oe).values({ contactId, kind, performedBy, details });
}

/** Insert-or-keep suppression row (first reason wins; never lifted here). */
async function ensureSuppression(
  executor: Pick<typeof db, "insert">,
  emailNormalized: string,
  reason: string,
  source: string,
): Promise<void> {
  await executor
    .insert(os)
    .values({ emailNormalized, reason, source })
    .onConflictDoNothing();
}

// --------------------------- static paths first -----------------------------
// (Every literal path is declared BEFORE /:id, and /:id also falls through
// on non-numeric segments — both guards, so a new literal route can never be
// swallowed. See the campaigns-list route-collision regression.)

router.get("/admin/outreach-contacts", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const eligibility =
    typeof req.query.eligibility === "string" ? req.query.eligibility : "";
  const category = typeof req.query.category === "string" ? req.query.category : "";
  const businessType =
    typeof req.query.businessType === "string" ? req.query.businessType : "";
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    200,
  );
  const offset = Math.max(
    Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0,
  );

  const conditions = [];
  if (q) {
    conditions.push(
      or(
        ilike(oc.emailNormalized, `%${q.toLowerCase()}%`),
        ilike(oc.companyName, `%${q}%`),
        ilike(oc.contactName, `%${q}%`),
      ),
    );
  }
  if (eligibility === "eligible" || eligibility === "blocked") {
    conditions.push(eq(oc.eligibilityStatus, eligibility));
  }
  if ((OUTREACH_ELIGIBILITY_CATEGORIES as readonly string[]).includes(category)) {
    conditions.push(eq(oc.eligibilityCategory, category));
  }
  if ((OUTREACH_BUSINESS_TYPES as readonly string[]).includes(businessType)) {
    conditions.push(eq(oc.businessType, businessType));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [contacts, [{ total }]] = await Promise.all([
    db
      .select()
      .from(oc)
      .where(where)
      .orderBy(desc(oc.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(oc).where(where),
  ]);
  res.json({ contacts: contacts.map(sanitizeContact), total, limit, offset });
});

router.get("/admin/outreach-contacts/stats", async (_req, res) => {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      eligible: sql<number>`count(*) filter (where ${oc.eligibilityStatus} = 'eligible' and ${oc.unsubscribedAt} is null and ${oc.emailSuppressedAt} is null)::int`,
      blocked: sql<number>`count(*) filter (where ${oc.eligibilityStatus} = 'blocked')::int`,
      unsubscribed: sql<number>`count(*) filter (where ${oc.unsubscribedAt} is not null)::int`,
      suppressed: sql<number>`count(*) filter (where ${oc.emailSuppressedAt} is not null)::int`,
    })
    .from(oc);
  const [suppressionRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(os);
  const byCategory = await db
    .select({
      category: oc.eligibilityCategory,
      count: sql<number>`count(*)::int`,
    })
    .from(oc)
    .groupBy(oc.eligibilityCategory);
  res.json({
    ...row,
    suppressionList: suppressionRow.count,
    byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r.count])),
  });
});

router.get("/admin/outreach-contacts/template", (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="outreach-contacts-template.csv"',
  );
  res.send(outreachCsvTemplate());
});

router.get("/admin/outreach-contacts/export", async (_req, res) => {
  const contacts = await db.select().from(oc).orderBy(oc.id);
  const header = [
    ...OUTREACH_CSV_COLUMNS,
    "eligibility_status",
    "eligibility_category",
    "eligibility_reason",
    "unsubscribed_at",
    "email_suppressed_at",
    "imported_at",
  ].join(",");
  const lines = contacts.map((contact) =>
    [
      contact.email,
      contact.contactName,
      contact.companyName,
      contact.businessType,
      contact.companyNumber,
      contact.website,
      contact.sourceName,
      contact.sourceDetail,
      contact.obtainedAt.toISOString().slice(0, 10),
      contact.country,
      contact.lawfulRoute,
      contact.consentAt ? contact.consentAt.toISOString().slice(0, 10) : "",
      contact.consentEvidence,
      contact.soiSaleEvidence,
      contact.soiRelevanceEvidence,
      contact.soiOptOutEvidence,
      contact.b2bCompanyEvidence,
      contact.b2bRelevanceEvidence,
      contact.b2bLiaEvidence,
      contact.notes,
      contact.eligibilityStatus,
      contact.eligibilityCategory,
      contact.eligibilityReason,
      contact.unsubscribedAt ? contact.unsubscribedAt.toISOString() : "",
      contact.emailSuppressedAt ? contact.emailSuppressedAt.toISOString() : "",
      contact.importedAt.toISOString(),
    ]
      .map((v) => csvCell(typeof v === "string" ? v : (v ?? "")))
      .join(","),
  );
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="outreach-contacts-export.csv"',
  );
  res.send([header, ...lines].join("\n") + "\n");
});

// --------------------------- import ----------------------------------------

router.post("/admin/outreach-contacts/import/validate", async (req, res) => {
  const csvText = (req.body as Record<string, unknown>)?.csv;
  if (typeof csvText !== "string") {
    res.status(400).json({ error: "Provide the CSV content as `csv`." });
    return;
  }
  const validation = await validateImport(csvText);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  // Preview only — never echo back full parsed rows.
  res.json({
    summary: validation.summary,
    results: validation.results.map(({ row: _row, ...rest }) => rest),
  });
});

router.post("/admin/outreach-contacts/import/commit", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const csvText = (req.body as Record<string, unknown>)?.csv;
  if (typeof csvText !== "string") {
    res.status(400).json({ error: "Provide the CSV content as `csv`." });
    return;
  }
  // Full revalidation at commit time — the earlier preview is never trusted.
  const validation = await validateImport(csvText);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const accepted = validation.results.filter(
    (r) => r.status === "accepted" && r.row && r.eligibility,
  );
  let inserted = 0;
  let racedDuplicates = 0;
  await db.transaction(async (tx) => {
    for (const item of accepted) {
      const row = item.row!;
      const verdict = item.eligibility!;
      // Concurrent-import safety: the unique index decides; a lost race is
      // reported as a duplicate, never a crash or a second row.
      const insertedRows = await tx
        .insert(oc)
        .values({
          ...row,
          importedBy: authReq.userId,
          eligibilityStatus: verdict.status,
          eligibilityCategory: verdict.category,
          eligibilityReason: verdict.reason.slice(0, 400),
        })
        .onConflictDoNothing({ target: oc.emailNormalized })
        .returning({ id: oc.id });
      if (insertedRows.length === 0) {
        racedDuplicates += 1;
        item.status = "duplicate_existing";
        item.reason = "Already exists in Outreach Contacts (added concurrently).";
        continue;
      }
      inserted += 1;
      await recordEvent(tx, insertedRows[0].id, "CONTACT_IMPORTED", authReq.userId, {
        eligibilityStatus: verdict.status,
        eligibilityCategory: verdict.category,
      });
    }
    await recordEvent(tx, null, "IMPORT_COMMITTED", authReq.userId, {
      total: validation.summary.total,
      inserted,
      racedDuplicates,
      invalid: validation.summary.invalid,
      duplicates: validation.summary.duplicates,
      suppressed: validation.summary.suppressed,
    });
  });
  res.json({
    success: true,
    inserted,
    summary: { ...validation.summary, accepted: inserted },
    results: validation.results.map(({ row: _row, ...rest }) => rest),
  });
});

// --------------------------- manual add -------------------------------------

router.post("/admin/outreach-contacts", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const fields: Record<string, string | undefined> = {};
  for (const col of OUTREACH_CSV_COLUMNS) {
    const value = body[col];
    fields[col] = typeof value === "string" ? value : undefined;
  }
  const parsed = parseContactFields(fields);
  if (!parsed.row) {
    res.status(400).json({
      error: "Contact is invalid.",
      issues: parsed.issues,
    });
    return;
  }
  const row = parsed.row;

  const [suppression] = await db
    .select({ reason: os.reason })
    .from(os)
    .where(eq(os.emailNormalized, row.emailNormalized));
  if (suppression) {
    res.status(409).json({
      error: `This address is on the outreach suppression list (${suppression.reason}) — it opted out or bounced and cannot be contacted again.`,
    });
    return;
  }
  const [earlyAccessRow] = await db
    .select({ id: earlyAccessRegistrationsTable.id })
    .from(earlyAccessRegistrationsTable)
    .where(eq(earlyAccessRegistrationsTable.emailNormalized, row.emailNormalized));
  if (earlyAccessRow) {
    res.status(409).json({
      error:
        "This address is already on the Early Access list — that list and its own consent state govern it. Do not add it as an outreach contact.",
    });
    return;
  }

  const verdict = evaluateOutreachEligibility({
    ...row,
    unsubscribedAt: null,
    emailSuppressedAt: null,
  });
  const [insertedRow] = await db
    .insert(oc)
    .values({
      ...row,
      importedBy: authReq.userId,
      eligibilityStatus: verdict.status,
      eligibilityCategory: verdict.category,
      eligibilityReason: verdict.reason.slice(0, 400),
    })
    .onConflictDoNothing({ target: oc.emailNormalized })
    .returning();
  if (!insertedRow) {
    res.status(409).json({ error: "This address already exists in Outreach Contacts." });
    return;
  }
  await recordEvent(db, insertedRow.id, "CONTACT_ADDED", authReq.userId, {
    eligibilityStatus: verdict.status,
    eligibilityCategory: verdict.category,
  });
  res.status(201).json({ contact: sanitizeContact(insertedRow), eligibility: verdict });
});

// --------------------------- :id routes -------------------------------------

/** Non-numeric ids fall through so literal sibling paths are never swallowed. */
router.use("/admin/outreach-contacts/:id", (req, res, next) => {
  if (!/^\d+$/.test(String(req.params.id))) {
    next("router");
    return;
  }
  next();
});

async function loadContact(id: number): Promise<OutreachContact | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [contact] = await db.select().from(oc).where(eq(oc.id, id));
  return contact ?? null;
}

router.get("/admin/outreach-contacts/:id", async (req, res) => {
  const contact = await loadContact(Number(req.params.id));
  if (!contact) {
    res.status(404).json({ error: "Contact not found." });
    return;
  }
  const events = await db
    .select()
    .from(oe)
    .where(eq(oe.contactId, contact.id))
    .orderBy(desc(oe.createdAt))
    .limit(200);
  res.json({ contact: sanitizeContact(contact), events });
});

/**
 * Edit evidence/details. Eligibility is ALWAYS recomputed server-side from
 * the resulting stored fields — an edit can move a contact between blocked
 * and eligible ONLY because the evidence now satisfies (or no longer
 * satisfies) a lawful route, never because a flag was flipped.
 */
router.patch("/admin/outreach-contacts/:id", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const contact = await loadContact(Number(req.params.id));
  if (!contact) {
    res.status(404).json({ error: "Contact not found." });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const fields: Record<string, string | undefined> = {
    // Email is immutable — changing the address would dodge dedupe and
    // suppression history. Delete + re-import to change an address.
    email: contact.email,
    contact_name: pick(body, "contact_name") ?? contact.contactName ?? undefined,
    company_name: pick(body, "company_name") ?? contact.companyName ?? undefined,
    business_type: pick(body, "business_type") ?? contact.businessType,
    company_number: pick(body, "company_number") ?? contact.companyNumber ?? undefined,
    website: pick(body, "website") ?? contact.website ?? undefined,
    source_name: pick(body, "source_name") ?? contact.sourceName,
    source_detail: pick(body, "source_detail") ?? contact.sourceDetail,
    date_obtained:
      pick(body, "date_obtained") ?? contact.obtainedAt.toISOString().slice(0, 10),
    country: pick(body, "country") ?? contact.country,
    lawful_route: pick(body, "lawful_route") ?? contact.lawfulRoute,
    consent_date:
      pick(body, "consent_date") ??
      (contact.consentAt ? contact.consentAt.toISOString().slice(0, 10) : undefined),
    consent_evidence: pick(body, "consent_evidence") ?? contact.consentEvidence ?? undefined,
    soi_sale_evidence: pick(body, "soi_sale_evidence") ?? contact.soiSaleEvidence ?? undefined,
    soi_relevance_evidence:
      pick(body, "soi_relevance_evidence") ?? contact.soiRelevanceEvidence ?? undefined,
    soi_opt_out_evidence:
      pick(body, "soi_opt_out_evidence") ?? contact.soiOptOutEvidence ?? undefined,
    b2b_company_evidence:
      pick(body, "b2b_company_evidence") ?? contact.b2bCompanyEvidence ?? undefined,
    b2b_relevance_evidence:
      pick(body, "b2b_relevance_evidence") ?? contact.b2bRelevanceEvidence ?? undefined,
    b2b_lia_evidence: pick(body, "b2b_lia_evidence") ?? contact.b2bLiaEvidence ?? undefined,
    notes: pick(body, "notes") ?? contact.notes ?? undefined,
  };
  const parsed = parseContactFields(fields);
  if (!parsed.row) {
    res.status(400).json({ error: "Contact is invalid.", issues: parsed.issues });
    return;
  }
  const row = parsed.row;
  const verdict = evaluateOutreachEligibility({
    ...row,
    unsubscribedAt: contact.unsubscribedAt,
    emailSuppressedAt: contact.emailSuppressedAt,
  });
  const now = new Date();
  const [updated] = await db
    .update(oc)
    .set({
      contactName: row.contactName,
      companyName: row.companyName,
      businessType: row.businessType,
      companyNumber: row.companyNumber,
      website: row.website,
      sourceName: row.sourceName,
      sourceDetail: row.sourceDetail,
      obtainedAt: row.obtainedAt,
      country: row.country,
      lawfulRoute: row.lawfulRoute,
      consentAt: row.consentAt,
      consentEvidence: row.consentEvidence,
      soiSaleEvidence: row.soiSaleEvidence,
      soiRelevanceEvidence: row.soiRelevanceEvidence,
      soiOptOutEvidence: row.soiOptOutEvidence,
      b2bCompanyEvidence: row.b2bCompanyEvidence,
      b2bRelevanceEvidence: row.b2bRelevanceEvidence,
      b2bLiaEvidence: row.b2bLiaEvidence,
      notes: row.notes,
      eligibilityStatus: verdict.status,
      eligibilityCategory: verdict.category,
      eligibilityReason: verdict.reason.slice(0, 400),
      updatedAt: now,
    })
    .where(eq(oc.id, contact.id))
    .returning();
  await recordEvent(db, contact.id, "CONTACT_UPDATED", authReq.userId, {
    eligibilityStatus: verdict.status,
    eligibilityCategory: verdict.category,
    eligibilityChanged: verdict.status !== contact.eligibilityStatus,
  });
  res.json({ contact: sanitizeContact(updated), eligibility: verdict });
});

/**
 * Record an objection / complaint / admin opt-out. Immediately updates the
 * permanent suppression list — future imports and sends are blocked at once.
 */
router.post("/admin/outreach-contacts/:id/suppress", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const contact = await loadContact(Number(req.params.id));
  if (!contact) {
    res.status(404).json({ error: "Contact not found." });
    return;
  }
  const reasonRaw = (req.body as Record<string, unknown>)?.reason;
  const reason =
    reasonRaw === "objection" || reasonRaw === "complaint" ? reasonRaw : "admin";
  const now = new Date();
  await db.transaction(async (tx) => {
    if (contact.unsubscribedAt === null) {
      await tx
        .update(oc)
        .set({
          unsubscribedAt: now,
          unsubscribeSource: reason === "admin" ? "admin" : reason,
          eligibilityStatus: "blocked",
          eligibilityReason:
            reason === "objection"
              ? "Objected to direct marketing — permanently excluded."
              : reason === "complaint"
                ? "Complained — permanently excluded."
                : "Suppressed by admin.",
          updatedAt: now,
        })
        .where(and(eq(oc.id, contact.id), isNull(oc.unsubscribedAt)));
    }
    await ensureSuppression(tx, contact.emailNormalized, reason, "admin");
    await recordEvent(
      tx,
      contact.id,
      reason === "objection"
        ? "CONTACT_OBJECTED"
        : reason === "complaint"
          ? "CONTACT_SUPPRESSED"
          : "CONTACT_UNSUBSCRIBED",
      authReq.userId,
      { reason },
    );
  });
  const refreshed = await loadContact(contact.id);
  res.json({ contact: refreshed ? sanitizeContact(refreshed) : null });
});

/**
 * Deletion / retention control. Deletes the contact's stored personal data
 * but — when the contact had opted out, objected or bounced — RETAINS the
 * minimal suppression record (emailNormalized + reason only) so the address
 * can never be accidentally re-imported or contacted again.
 */
router.delete("/admin/outreach-contacts/:id", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const contact = await loadContact(Number(req.params.id));
  if (!contact) {
    res.status(404).json({ error: "Contact not found." });
    return;
  }
  await db.transaction(async (tx) => {
    if (contact.unsubscribedAt !== null || contact.emailSuppressedAt !== null) {
      await ensureSuppression(
        tx,
        contact.emailNormalized,
        contact.unsubscribedAt !== null
          ? (contact.unsubscribeSource === "objection" ? "objection" : "unsubscribed")
          : (contact.emailSuppressionReason ?? "hard_bounce"),
        "contact_deletion",
      );
    }
    await tx.delete(oc).where(eq(oc.id, contact.id));
    await recordEvent(tx, contact.id, "CONTACT_DELETED", authReq.userId, {
      hadOptOut: contact.unsubscribedAt !== null,
      hadSuppression: contact.emailSuppressedAt !== null,
      suppressionRetained:
        contact.unsubscribedAt !== null || contact.emailSuppressedAt !== null,
    });
  });
  res.json({ success: true });
});

function pick(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

export default router;
