import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  companySeatExemptionsTable,
  companyMembersTable,
  traderProfilesTable,
  traderAuditLogTable,
  usersTable,
} from "@workspace/db/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { authMiddleware, adminOnly } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import {
  ABSOLUTE_MAX_EMPLOYEE_SEATS,
  reconcileCompanySeats,
} from "../lib/team-billing";

// ---------------------------------------------------------------------------
// Admin: company seat exemptions (Team billing grandfathering).
//
// Purpose: when TEAM_BILLING_ENFORCED flips on, companies that already had
// employees must not have people silently suspended. An admin grants a
// time-boundable, revocable seat exemption sized to the existing headcount
// (≤ 20 — the absolute operational ceiling). Every grant/revoke is audited
// and immediately reconciled, so revoking an exemption applies the normal
// deterministic suspension rule right away.
//
// Rows are never deleted; at most one live (unrevoked) exemption per company.
// ---------------------------------------------------------------------------

const router: IRouter = Router();

const GrantBody = z.object({
  traderProfileId: z.number().int().positive(),
  seatLimit: z.number().int().min(1).max(ABSOLUTE_MAX_EMPLOYEE_SEATS),
  reason: z.string().trim().min(5).max(1000),
  // Optional ISO date-time; must be in the future when provided.
  expiresAt: z.string().datetime().nullish(),
});

function serializeExemption(
  row: typeof companySeatExemptionsTable.$inferSelect,
  extra?: { businessName?: string | null; activeEmployees?: number },
) {
  return {
    id: row.id,
    traderProfileId: row.traderProfileId,
    businessName: extra?.businessName ?? null,
    activeEmployees: extra?.activeEmployees ?? null,
    seatLimit: row.seatLimit,
    reason: row.reason,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    expired: row.expiresAt != null && row.expiresAt.getTime() <= Date.now(),
    createdByAdminId: row.createdByAdminId,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedByAdminId: row.revokedByAdminId,
    createdAt: row.createdAt.toISOString(),
  };
}

async function ownerUserIdForProfile(profileId: number): Promise<number | null> {
  const [row] = await db
    .select({ userId: traderProfilesTable.userId })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.id, profileId))
    .limit(1);
  return row?.userId ?? null;
}

// GET /admin/seat-exemptions?includeRevoked=1 — newest first, with company
// name and current seated-employee count for sizing decisions.
router.get("/admin/seat-exemptions", authMiddleware, adminOnly, async (req, res) => {
  try {
    const includeRevoked = req.query.includeRevoked === "1";
    const rows = await db
      .select({
        exemption: companySeatExemptionsTable,
        businessName: traderProfilesTable.businessName,
      })
      .from(companySeatExemptionsTable)
      .innerJoin(
        traderProfilesTable,
        eq(traderProfilesTable.id, companySeatExemptionsTable.traderProfileId),
      )
      .where(includeRevoked ? undefined : isNull(companySeatExemptionsTable.revokedAt))
      .orderBy(desc(companySeatExemptionsTable.createdAt))
      .limit(200);

    const profileIds = [...new Set(rows.map((r) => r.exemption.traderProfileId))];
    const counts = new Map<number, number>();
    if (profileIds.length > 0) {
      const countRows = await db
        .select({
          traderProfileId: companyMembersTable.traderProfileId,
          n: sql<number>`count(*) filter (where ${companyMembersTable.role} = 'EMPLOYEE' and ${companyMembersTable.seatSuspendedAt} is null)::int`,
        })
        .from(companyMembersTable)
        .where(
          and(
            inArray(companyMembersTable.traderProfileId, profileIds),
            eq(companyMembersTable.status, "ACTIVE"),
          ),
        )
        .groupBy(companyMembersTable.traderProfileId);
      for (const r of countRows) counts.set(r.traderProfileId, r.n);
    }

    res.json({
      exemptions: rows.map((r) =>
        serializeExemption(r.exemption, {
          businessName: r.businessName,
          activeEmployees: counts.get(r.exemption.traderProfileId) ?? 0,
        }),
      ),
    });
  } catch (error) {
    req.log.error({ err: error }, "list seat exemptions failed");
    res.status(500).json({ error: "Failed to load seat exemptions" });
  }
});

// POST /admin/seat-exemptions — grant. One live exemption per company (the
// partial unique index is the arbiter under concurrency).
router.post("/admin/seat-exemptions", authMiddleware, adminOnly, async (req, res) => {
  try {
    const adminId = (req as AuthenticatedRequest).userId!;
    const parsed = GrantBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          "traderProfileId, seatLimit (1-20) and a reason (min 5 chars) are required; expiresAt must be an ISO date-time.",
      });
      return;
    }
    const body = parsed.data;
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      res.status(400).json({ error: "expiresAt must be in the future." });
      return;
    }

    const ownerUserId = await ownerUserIdForProfile(body.traderProfileId);
    if (ownerUserId === null) {
      res.status(404).json({ error: "Trader profile not found" });
      return;
    }

    let row: typeof companySeatExemptionsTable.$inferSelect;
    try {
      const [inserted] = await db
        .insert(companySeatExemptionsTable)
        .values({
          traderProfileId: body.traderProfileId,
          seatLimit: body.seatLimit,
          reason: body.reason,
          expiresAt,
          createdByAdminId: adminId,
        })
        .returning();
      row = inserted;
    } catch (err) {
      // Drizzle may surface the pg error directly or wrapped (cause chain).
      const code =
        (err as { code?: string })?.code ??
        ((err as { cause?: { code?: string } })?.cause?.code);
      if (code === "23505") {
        res.status(409).json({
          error:
            "This company already has a live exemption. Revoke it first — the trail stays linear on purpose.",
          code: "EXEMPTION_EXISTS",
        });
        return;
      }
      throw err;
    }

    await db.insert(traderAuditLogTable).values({
      userId: ownerUserId,
      action: "SEAT_EXEMPTION_GRANTED",
      performedBy: adminId,
      details: {
        exemptionId: row.id,
        seatLimit: row.seatLimit,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        reason: row.reason,
      },
    });

    // A larger allowance may reactivate SYSTEM-suspended employees right away.
    await reconcileCompanySeats(body.traderProfileId, "admin:exemption-granted").catch(
      (err) => req.log.error({ err }, "reconcile after exemption grant failed"),
    );

    res.status(201).json({ exemption: serializeExemption(row) });
  } catch (error) {
    req.log.error({ err: error }, "grant seat exemption failed");
    res.status(500).json({ error: "Failed to grant the exemption" });
  }
});

// POST /admin/seat-exemptions/:id/revoke — conditional flip (idempotent-safe:
// second revoke answers 409, nothing changes twice).
router.post(
  "/admin/seat-exemptions/:id/revoke",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const adminId = (req as AuthenticatedRequest).userId!;
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid exemption id" });
        return;
      }
      const [updated] = await db
        .update(companySeatExemptionsTable)
        .set({ revokedAt: new Date(), revokedByAdminId: adminId, updatedAt: new Date() })
        .where(
          and(
            eq(companySeatExemptionsTable.id, id),
            isNull(companySeatExemptionsTable.revokedAt),
          ),
        )
        .returning();
      if (!updated) {
        res.status(409).json({ error: "Exemption not found or already revoked." });
        return;
      }

      const ownerUserId = await ownerUserIdForProfile(updated.traderProfileId);
      if (ownerUserId !== null) {
        await db.insert(traderAuditLogTable).values({
          userId: ownerUserId,
          action: "SEAT_EXEMPTION_REVOKED",
          performedBy: adminId,
          details: { exemptionId: updated.id, seatLimit: updated.seatLimit },
        });
      }

      // Shrinking the allowance may suspend newest employees (deterministic
      // rule) — apply it now rather than waiting for the next billing event.
      await reconcileCompanySeats(updated.traderProfileId, "admin:exemption-revoked").catch(
        (err) => req.log.error({ err }, "reconcile after exemption revoke failed"),
      );

      res.json({ exemption: serializeExemption(updated) });
    } catch (error) {
      req.log.error({ err: error }, "revoke seat exemption failed");
      res.status(500).json({ error: "Failed to revoke the exemption" });
    }
  },
);

export default router;
