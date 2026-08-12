import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  earlyAccessRegistrationsTable,
  earlyAccessEventsTable,
} from "@workspace/db/schema";
import { and, desc, eq, ilike, isNull, isNotNull, or, sql } from "drizzle-orm";
import { authMiddleware, adminOnly } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { CONSENT_WORDING_BY_VERSION } from "../lib/early-access-consent";

const router: IRouter = Router();

/**
 * Admin-only management of the Early Access list. All permissions are
 * enforced here server-side (authMiddleware + adminOnly on every route) —
 * the admin UI hiding a page is never the security boundary.
 *
 * Subscription status derives from unsubscribedAt + unsubscribeSource:
 * - subscribed:   unsubscribedAt IS NULL
 * - unsubscribed: unsubscribedAt set, source 'user' (self-service, Phase 2)
 * - suppressed:   unsubscribedAt set, source 'admin' (manual suppression)
 * "Unknown legacy consent" = launchConsentAt IS NULL (imported rows without
 * consent evidence — never inferred).
 */

function parseDate(raw: unknown): Date | null | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

type Filters = {
  search?: string;
  type?: string;
  from?: Date;
  to?: Date;
  launchConsent?: "yes" | "unknown";
  marketing?: "yes" | "no";
  status?: "subscribed" | "unsubscribed" | "suppressed";
};

function buildConditions(f: Filters) {
  const conds = [];
  if (f.search) {
    const pattern = `%${f.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(
      or(
        ilike(earlyAccessRegistrationsTable.name, pattern),
        ilike(earlyAccessRegistrationsTable.emailNormalized, pattern),
      ),
    );
  }
  if (f.type) conds.push(eq(earlyAccessRegistrationsTable.audienceType, f.type));
  if (f.from) conds.push(sql`${earlyAccessRegistrationsTable.joinedAt} >= ${f.from}`);
  if (f.to) conds.push(sql`${earlyAccessRegistrationsTable.joinedAt} <= ${f.to}`);
  if (f.launchConsent === "yes")
    conds.push(isNotNull(earlyAccessRegistrationsTable.launchConsentAt));
  if (f.launchConsent === "unknown")
    conds.push(isNull(earlyAccessRegistrationsTable.launchConsentAt));
  if (f.marketing === "yes")
    conds.push(isNotNull(earlyAccessRegistrationsTable.marketingConsentAt));
  if (f.marketing === "no")
    conds.push(isNull(earlyAccessRegistrationsTable.marketingConsentAt));
  if (f.status === "subscribed")
    conds.push(isNull(earlyAccessRegistrationsTable.unsubscribedAt));
  if (f.status === "unsubscribed")
    conds.push(
      and(
        isNotNull(earlyAccessRegistrationsTable.unsubscribedAt),
        eq(earlyAccessRegistrationsTable.unsubscribeSource, "user"),
      ),
    );
  if (f.status === "suppressed")
    conds.push(
      and(
        isNotNull(earlyAccessRegistrationsTable.unsubscribedAt),
        eq(earlyAccessRegistrationsTable.unsubscribeSource, "admin"),
      ),
    );
  return conds;
}

function parseFilters(query: Record<string, unknown>):
  | { ok: true; filters: Filters }
  | { ok: false; error: string } {
  const filters: Filters = {};
  if (typeof query.search === "string" && query.search.trim())
    filters.search = query.search.trim().slice(0, 254);
  if (
    typeof query.type === "string" &&
    ["customer", "trader", "other"].includes(query.type)
  )
    filters.type = query.type;
  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (from === null || to === null)
    return { ok: false, error: "Invalid from/to date." };
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (query.launchConsent === "yes" || query.launchConsent === "unknown")
    filters.launchConsent = query.launchConsent;
  if (query.marketing === "yes" || query.marketing === "no")
    filters.marketing = query.marketing;
  if (
    query.status === "subscribed" ||
    query.status === "unsubscribed" ||
    query.status === "suppressed"
  )
    filters.status = query.status;
  return { ok: true, filters };
}

// GET /api/admin/early-access/stats — summary counts.
router.get(
  "/admin/early-access/stats",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const t = earlyAccessRegistrationsTable;
      const [row] = await db
        .select({
          total: sql<number>`count(*)::int`,
          customers: sql<number>`count(*) filter (where ${t.audienceType} = 'customer')::int`,
          traders: sql<number>`count(*) filter (where ${t.audienceType} = 'trader')::int`,
          other: sql<number>`count(*) filter (where ${t.audienceType} = 'other')::int`,
          launchConsent: sql<number>`count(*) filter (where ${t.launchConsentAt} is not null)::int`,
          marketingConsent: sql<number>`count(*) filter (where ${t.marketingConsentAt} is not null)::int`,
          unsubscribed: sql<number>`count(*) filter (where ${t.unsubscribedAt} is not null)::int`,
          unknownLegacyConsent: sql<number>`count(*) filter (where ${t.launchConsentAt} is null)::int`,
        })
        .from(t);
      res.json(row);
    } catch (error) {
      req.log.error({ err: error }, "Early access stats failed");
      res.status(500).json({ error: "Failed to load stats" });
    }
  },
);

// GET /api/admin/early-access — filterable, searchable, paginated list.
router.get(
  "/admin/early-access",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const parsed = parseFilters(req.query as Record<string, unknown>);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
        200,
      );
      const offset = Math.max(
        parseInt(String(req.query.offset ?? "0"), 10) || 0,
        0,
      );
      const conds = buildConditions(parsed.filters);
      const where = conds.length ? and(...conds) : undefined;

      const [rows, [{ count }]] = await Promise.all([
        db
          .select()
          .from(earlyAccessRegistrationsTable)
          .where(where)
          .orderBy(desc(earlyAccessRegistrationsTable.joinedAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(earlyAccessRegistrationsTable)
          .where(where),
      ]);
      res.json({ registrations: rows, total: count, limit, offset });
    } catch (error) {
      req.log.error({ err: error }, "Early access list failed");
      res.status(500).json({ error: "Failed to load registrations" });
    }
  },
);

// GET /api/admin/early-access/export?format=csv — safe CSV export.
// Excludes unsubscribed/suppressed contacts by DEFAULT; includeSuppressed=true
// requires the extra confirmAll=true acknowledgement and both variants write
// a CSV_EXPORTED audit event (counts + filters only — never recipient lists).
router.get(
  "/admin/early-access/export",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const parsed = parseFilters(req.query as Record<string, unknown>);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const includeSuppressed = req.query.includeSuppressed === "true";
      if (includeSuppressed && req.query.confirmAll !== "true") {
        res.status(400).json({
          error:
            "Exporting unsubscribed/suppressed contacts requires explicit confirmation.",
        });
        return;
      }
      // Consent-purpose modes are enforced SERVER-side so an export intended
      // as a send list can never contain non-consented or opted-out
      // addresses, regardless of what the UI requested:
      // - purpose=launch    → recorded launch consent AND still subscribed
      // - purpose=marketing → recorded marketing consent AND still subscribed
      // - no purpose        → record-keeping export (default excludes
      //                       unsubscribed/suppressed; includeSuppressed
      //                       needs explicit confirmation).
      const purposeRaw = req.query.purpose;
      if (
        purposeRaw !== undefined &&
        purposeRaw !== "launch" &&
        purposeRaw !== "marketing"
      ) {
        res.status(400).json({ error: "Invalid purpose" });
        return;
      }
      const purpose = purposeRaw as "launch" | "marketing" | undefined;
      const conds = buildConditions(parsed.filters);
      if (purpose === "launch") {
        conds.push(isNotNull(earlyAccessRegistrationsTable.launchConsentAt));
        conds.push(isNull(earlyAccessRegistrationsTable.unsubscribedAt));
      } else if (purpose === "marketing") {
        conds.push(isNotNull(earlyAccessRegistrationsTable.marketingConsentAt));
        conds.push(isNull(earlyAccessRegistrationsTable.unsubscribedAt));
      } else if (!includeSuppressed) {
        conds.push(isNull(earlyAccessRegistrationsTable.unsubscribedAt));
      }

      const rows = await db
        .select()
        .from(earlyAccessRegistrationsTable)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(earlyAccessRegistrationsTable.joinedAt))
        .limit(10000);

      await db.insert(earlyAccessEventsTable).values({
        kind: "CSV_EXPORTED",
        performedBy: (req as AuthenticatedRequest).userId!,
        details: {
          rowCount: rows.length,
          purpose: purpose ?? null,
          includeSuppressed,
          filters: parsed.filters
            ? {
                ...parsed.filters,
                from: parsed.filters.from?.toISOString(),
                to: parsed.filters.to?.toISOString(),
              }
            : {},
        },
      });

      // Neutralise spreadsheet formula triggers (=, +, -, @, tab, CR) with a
      // leading single-quote so visitor-controlled text (name, email, town)
      // can't execute as a formula in Excel/LibreOffice (formula injection).
      const escape = (v: unknown): string => {
        if (v === null || v === undefined) return "";
        const s = typeof v === "string" ? v : v instanceof Date ? v.toISOString() : String(v);
        const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
        if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
        return safe;
      };
      const header =
        "id,name,email,type,town,joinedAt,launchConsentAt,launchConsentVersion,marketingConsentAt,marketingConsentVersion,unsubscribedAt,unsubscribeSource";
      const lines = rows.map((r) =>
        [
          r.id,
          r.name,
          r.email,
          r.audienceType,
          r.town,
          r.joinedAt,
          r.launchConsentAt,
          r.launchConsentVersion,
          r.marketingConsentAt,
          r.marketingConsentVersion,
          r.unsubscribedAt,
          r.unsubscribeSource,
        ]
          .map(escape)
          .join(","),
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="early-access-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send([header, ...lines].join("\n"));
    } catch (error) {
      req.log.error({ err: error }, "Early access export failed");
      res.status(500).json({ error: "Failed to export" });
    }
  },
);

// GET /api/admin/early-access/:id — detail view with consent history.
router.get(
  "/admin/early-access/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const [registration] = await db
        .select()
        .from(earlyAccessRegistrationsTable)
        .where(eq(earlyAccessRegistrationsTable.id, id));
      if (!registration) {
        res.status(404).json({ error: "Registration not found" });
        return;
      }
      const events = await db
        .select()
        .from(earlyAccessEventsTable)
        .where(eq(earlyAccessEventsTable.registrationId, id))
        .orderBy(desc(earlyAccessEventsTable.createdAt))
        .limit(200);
      res.json({
        registration,
        events: events.map((e) => ({
          ...e,
          wording: e.wordingVersion
            ? (CONSENT_WORDING_BY_VERSION[e.wordingVersion] ?? null)
            : null,
        })),
      });
    } catch (error) {
      req.log.error({ err: error }, "Early access detail failed");
      res.status(500).json({ error: "Failed to load registration" });
    }
  },
);

// POST /api/admin/early-access/:id/suppress — manual unsubscribe/suppression.
router.post(
  "/admin/early-access/:id/suppress",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const reason =
        typeof req.body?.reason === "string"
          ? req.body.reason.trim().slice(0, 500)
          : "";

      // Conditional UPDATE is the gate — no in-memory check/set race — and
      // the audit event commits atomically with it (suppression must never
      // exist without its ADMIN_SUPPRESSED evidence).
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(earlyAccessRegistrationsTable)
          .set({
            unsubscribedAt: new Date(),
            unsubscribeSource: "admin",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(earlyAccessRegistrationsTable.id, id),
              isNull(earlyAccessRegistrationsTable.unsubscribedAt),
            ),
          )
          .returning();
        if (row) {
          await tx.insert(earlyAccessEventsTable).values({
            registrationId: id,
            kind: "ADMIN_SUPPRESSED",
            performedBy: (req as AuthenticatedRequest).userId!,
            details: reason ? { reason } : null,
          });
        }
        return row;
      });

      if (!updated) {
        const [existing] = await db
          .select({ id: earlyAccessRegistrationsTable.id })
          .from(earlyAccessRegistrationsTable)
          .where(eq(earlyAccessRegistrationsTable.id, id));
        if (!existing) {
          res.status(404).json({ error: "Registration not found" });
          return;
        }
        res.status(409).json({ error: "Contact is already unsubscribed or suppressed." });
        return;
      }

      res.json({ success: true, registration: updated });
    } catch (error) {
      req.log.error({ err: error }, "Early access suppress failed");
      res.status(500).json({ error: "Failed to suppress contact" });
    }
  },
);

export default router;
