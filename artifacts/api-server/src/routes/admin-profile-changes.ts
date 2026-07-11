import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  profileChangeRequestsTable,
  profileChangeRequestEventsTable,
  usersTable,
  traderProfilesTable,
} from "@workspace/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { authMiddleware, adminOnly } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { logAudit } from "../lib/trader-status";
import { sendPushToUser } from "../lib/push-notifications";
import { SENSITIVE_FIELDS, fieldLabel } from "../lib/profile-change";
import { toUkE164 } from "../lib/twilio-verify";

const router: IRouter = Router();

// Which live column each protected field maps to, per role. The approve
// handler refuses anything outside this map, so a corrupted request row can
// never write an arbitrary column.
const TRADER_FIELD_COLUMNS = new Set([
  "businessName",
  "contactName",
  "phone",
  "website",
  "businessDescription",
]);
const CUSTOMER_FIELD_COLUMNS = new Set(["fullName", "phone"]);

type RequestRow = typeof profileChangeRequestsTable.$inferSelect;

async function serializeAdminRequest(r: RequestRow) {
  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      fullName: usersTable.fullName,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.id, r.userId))
    .limit(1);

  let businessName: string | null = null;
  if (r.traderProfileId) {
    const [profile] = await db
      .select({ businessName: traderProfilesTable.businessName })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.id, r.traderProfileId))
      .limit(1);
    businessName = profile?.businessName ?? null;
  }

  let decidedByEmail: string | null = null;
  if (r.decidedByAdminId) {
    const [admin] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, r.decidedByAdminId))
      .limit(1);
    decidedByEmail = admin?.email ?? null;
  }

  return {
    id: r.id,
    userId: r.userId,
    role: r.role,
    traderProfileId: r.traderProfileId,
    user: user
      ? { id: user.id, email: user.email, fullName: user.fullName }
      : null,
    businessName,
    field: r.field,
    fieldLabel: fieldLabel(r.field),
    sensitive: SENSITIVE_FIELDS.has(r.field),
    currentValue: r.currentValue,
    proposedValue: r.proposedValue,
    status: r.status,
    phoneOtpVerified: r.phoneOtpVerified,
    phoneOtpVerifiedAt: r.phoneOtpVerifiedAt ? r.phoneOtpVerifiedAt.toISOString() : null,
    adminInfoRequest: r.adminInfoRequest,
    decisionReason: r.decisionReason,
    decidedByAdminId: r.decidedByAdminId,
    decidedByEmail,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/profile-change-requests?role=&status=
// ---------------------------------------------------------------------------
router.get(
  "/admin/profile-change-requests",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const roleFilter = typeof req.query.role === "string" ? req.query.role : "";
      const statusFilter = typeof req.query.status === "string" ? req.query.status : "";

      const conditions = [];
      if (roleFilter === "trader" || roleFilter === "customer") {
        conditions.push(eq(profileChangeRequestsTable.role, roleFilter));
      }
      if (statusFilter === "ACTIVE") {
        conditions.push(
          inArray(profileChangeRequestsTable.status, ["PENDING", "NEEDS_INFO"]),
        );
      } else if (
        ["PENDING", "NEEDS_INFO", "APPROVED", "REJECTED", "CANCELLED"].includes(statusFilter)
      ) {
        conditions.push(eq(profileChangeRequestsTable.status, statusFilter));
      }

      const rows = await db
        .select()
        .from(profileChangeRequestsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(profileChangeRequestsTable.createdAt))
        .limit(200);

      const requests = await Promise.all(rows.map(serializeAdminRequest));
      res.json({ requests });
    } catch (error) {
      req.log.error({ err: error }, "Admin list profile change requests failed");
      res.status(500).json({ error: "Failed to load profile change requests" });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/admin/profile-change-requests/:id — detail + full event history
// ---------------------------------------------------------------------------
router.get(
  "/admin/profile-change-requests/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid request id" });
        return;
      }
      const [row] = await db
        .select()
        .from(profileChangeRequestsTable)
        .where(eq(profileChangeRequestsTable.id, id))
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "Change request not found" });
        return;
      }

      const events = await db
        .select({
          id: profileChangeRequestEventsTable.id,
          actorUserId: profileChangeRequestEventsTable.actorUserId,
          actorRole: profileChangeRequestEventsTable.actorRole,
          eventType: profileChangeRequestEventsTable.eventType,
          note: profileChangeRequestEventsTable.note,
          createdAt: profileChangeRequestEventsTable.createdAt,
          actorEmail: usersTable.email,
        })
        .from(profileChangeRequestEventsTable)
        .leftJoin(usersTable, eq(usersTable.id, profileChangeRequestEventsTable.actorUserId))
        .where(eq(profileChangeRequestEventsTable.requestId, id))
        .orderBy(desc(profileChangeRequestEventsTable.createdAt));

      res.json({
        request: await serializeAdminRequest(row),
        events: events.map((e) => ({
          id: e.id,
          actorUserId: e.actorUserId,
          actorRole: e.actorRole,
          actorEmail: e.actorEmail,
          eventType: e.eventType,
          note: e.note,
          createdAt: e.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      req.log.error({ err: error }, "Admin get profile change request failed");
      res.status(500).json({ error: "Failed to load change request" });
    }
  },
);

async function loadActiveRequest(id: number): Promise<RequestRow | null> {
  const [row] = await db
    .select()
    .from(profileChangeRequestsTable)
    .where(
      and(
        eq(profileChangeRequestsTable.id, id),
        inArray(profileChangeRequestsTable.status, ["PENDING", "NEEDS_INFO"]),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// POST /api/admin/profile-change-requests/:id/approve
// Atomically applies the proposed value to the live record and closes the
// request. Sensitive fields (names, phone) require a reason/confirmation.
// ---------------------------------------------------------------------------
router.post(
  "/admin/profile-change-requests/:id/approve",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { userId: adminId } = req as AuthenticatedRequest;
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid request id" });
        return;
      }
      const reason =
        typeof (req.body as { reason?: unknown })?.reason === "string"
          ? (req.body as { reason: string }).reason.trim()
          : "";

      const row = await loadActiveRequest(id);
      if (!row) {
        res.status(404).json({ error: "No active change request found" });
        return;
      }

      if (SENSITIVE_FIELDS.has(row.field) && reason.length < 3) {
        res.status(400).json({
          error: `Approving a ${fieldLabel(row.field).toLowerCase()} change requires a reason/confirmation note.`,
          code: "REASON_REQUIRED",
        });
        return;
      }

      const isTraderField = row.role === "trader";
      if (isTraderField && !TRADER_FIELD_COLUMNS.has(row.field)) {
        res.status(400).json({ error: "This field cannot be applied automatically." });
        return;
      }
      if (!isTraderField && !CUSTOMER_FIELD_COLUMNS.has(row.field)) {
        res.status(400).json({ error: "This field cannot be applied automatically." });
        return;
      }
      if (row.field === "phone" && !row.phoneOtpVerified) {
        res.status(400).json({
          error: "This phone number was never OTP-verified and cannot be approved.",
        });
        return;
      }
      // businessName/contactName/businessDescription must not be emptied.
      if (
        row.proposedValue == null &&
        !["website"].includes(row.field)
      ) {
        res.status(400).json({ error: "The proposed value is empty and cannot be applied." });
        return;
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        // Close the request first with a status guard so two admins cannot
        // both apply it.
        const [closed] = await tx
          .update(profileChangeRequestsTable)
          .set({
            status: "APPROVED",
            decisionReason: reason || null,
            decidedByAdminId: adminId,
            decidedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(profileChangeRequestsTable.id, id),
              inArray(profileChangeRequestsTable.status, ["PENDING", "NEEDS_INFO"]),
            ),
          )
          .returning();
        if (!closed) {
          throw new Error("REQUEST_ALREADY_DECIDED");
        }

        if (isTraderField) {
          const update: Record<string, unknown> = {
            [row.field]: row.proposedValue,
            updatedAt: now,
          };
          if (row.field === "phone" && row.proposedValue) {
            // The proposed number passed the Twilio Verify check before
            // submission, so it becomes the account's verified number now.
            update.phone = toUkE164(row.proposedValue) ?? row.proposedValue;
            update.phoneVerified = true;
            update.phoneVerifiedAt = row.phoneOtpVerifiedAt ?? now;
          }
          await tx
            .update(traderProfilesTable)
            .set(update)
            .where(eq(traderProfilesTable.userId, row.userId));
        } else {
          const update: Record<string, unknown> = {
            [row.field]: row.proposedValue,
            updatedAt: now,
          };
          if (row.field === "phone" && row.proposedValue) {
            update.phone = toUkE164(row.proposedValue) ?? row.proposedValue;
          }
          await tx
            .update(usersTable)
            .set(update)
            .where(eq(usersTable.id, row.userId));
        }

        await tx.insert(profileChangeRequestEventsTable).values({
          requestId: id,
          actorUserId: adminId,
          actorRole: "admin",
          eventType: "APPROVED",
          note: reason || null,
        });
      });

      // Website changes affect the advisory domain check; refresh it.
      if (isTraderField && row.field === "website") {
        const [profile] = await db
          .select({
            businessEmailDomain: traderProfilesTable.businessEmailDomain,
            website: traderProfilesTable.website,
          })
          .from(traderProfilesTable)
          .where(eq(traderProfilesTable.userId, row.userId))
          .limit(1);
        if (profile) {
          const { triggerDomainCheck } = await import("../lib/domain-check");
          triggerDomainCheck({
            userId: row.userId,
            businessEmailDomain: profile.businessEmailDomain,
            website: profile.website,
          });
        }
      }
      // Business-name changes affect the Companies House / AI cross-check.
      if (isTraderField && row.field === "businessName") {
        const [profile] = await db
          .select()
          .from(traderProfilesTable)
          .where(eq(traderProfilesTable.userId, row.userId))
          .limit(1);
        if (profile) {
          const { triggerAiVerification } = await import("../lib/trader-ai-verification");
          triggerAiVerification({
            userId: row.userId,
            businessName: profile.businessName,
            businessAddress: profile.businessAddress,
            town: profile.town,
            postcode: profile.postcode,
            companyNumber: profile.companyNumber,
            businessRole: profile.businessRole,
          });
        }
      }

      logAudit({
        userId: row.userId,
        action: "PROFILE_CHANGE_APPROVED",
        details: { requestId: id, field: row.field, adminId },
        notes: `Change to ${fieldLabel(row.field).toLowerCase()} approved by admin.`,
      });
      sendPushToUser(row.userId, {
        title: "Profile change approved",
        body: `Your ${fieldLabel(row.field).toLowerCase()} change has been approved and is now live.`,
        data: { type: "profile_change", requestId: id, status: "APPROVED" },
      }).catch(() => {});

      const [updated] = await db
        .select()
        .from(profileChangeRequestsTable)
        .where(eq(profileChangeRequestsTable.id, id))
        .limit(1);
      res.json({ request: await serializeAdminRequest(updated) });
    } catch (error) {
      if ((error as Error).message === "REQUEST_ALREADY_DECIDED") {
        res.status(409).json({ error: "This request has already been decided." });
        return;
      }
      req.log.error({ err: error }, "Admin approve profile change failed");
      res.status(500).json({ error: "Failed to approve change request" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/admin/profile-change-requests/:id/reject — reason is mandatory.
// ---------------------------------------------------------------------------
router.post(
  "/admin/profile-change-requests/:id/reject",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { userId: adminId } = req as AuthenticatedRequest;
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid request id" });
        return;
      }
      const reason =
        typeof (req.body as { reason?: unknown })?.reason === "string"
          ? (req.body as { reason: string }).reason.trim()
          : "";
      if (reason.length < 3) {
        res.status(400).json({ error: "A rejection reason is required.", code: "REASON_REQUIRED" });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(profileChangeRequestsTable)
        .set({
          status: "REJECTED",
          decisionReason: reason,
          decidedByAdminId: adminId,
          decidedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(profileChangeRequestsTable.id, id),
            inArray(profileChangeRequestsTable.status, ["PENDING", "NEEDS_INFO"]),
          ),
        )
        .returning();
      if (!updated) {
        res.status(404).json({ error: "No active change request found" });
        return;
      }

      await db.insert(profileChangeRequestEventsTable).values({
        requestId: id,
        actorUserId: adminId,
        actorRole: "admin",
        eventType: "REJECTED",
        note: reason,
      });
      logAudit({
        userId: updated.userId,
        action: "PROFILE_CHANGE_REJECTED",
        details: { requestId: id, field: updated.field, adminId },
        notes: reason,
      });
      sendPushToUser(updated.userId, {
        title: "Profile change rejected",
        body: `Your ${fieldLabel(updated.field).toLowerCase()} change was not approved. Your current details remain unchanged.`,
        data: { type: "profile_change", requestId: id, status: "REJECTED" },
      }).catch(() => {});

      res.json({ request: await serializeAdminRequest(updated) });
    } catch (error) {
      req.log.error({ err: error }, "Admin reject profile change failed");
      res.status(500).json({ error: "Failed to reject change request" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/admin/profile-change-requests/:id/request-info
// ---------------------------------------------------------------------------
router.post(
  "/admin/profile-change-requests/:id/request-info",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { userId: adminId } = req as AuthenticatedRequest;
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid request id" });
        return;
      }
      const message =
        typeof (req.body as { message?: unknown })?.message === "string"
          ? (req.body as { message: string }).message.trim()
          : "";
      if (message.length < 3) {
        res.status(400).json({ error: "Please describe what information is needed." });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(profileChangeRequestsTable)
        .set({ status: "NEEDS_INFO", adminInfoRequest: message, updatedAt: now })
        .where(
          and(
            eq(profileChangeRequestsTable.id, id),
            inArray(profileChangeRequestsTable.status, ["PENDING", "NEEDS_INFO"]),
          ),
        )
        .returning();
      if (!updated) {
        res.status(404).json({ error: "No active change request found" });
        return;
      }

      await db.insert(profileChangeRequestEventsTable).values({
        requestId: id,
        actorUserId: adminId,
        actorRole: "admin",
        eventType: "INFO_REQUESTED",
        note: message,
      });
      logAudit({
        userId: updated.userId,
        action: "PROFILE_CHANGE_INFO_REQUESTED",
        details: { requestId: id, field: updated.field, adminId },
        notes: message,
      });
      sendPushToUser(updated.userId, {
        title: "More information required",
        body: `We need more information about your ${fieldLabel(updated.field).toLowerCase()} change. Open the app to see the details.`,
        data: { type: "profile_change", requestId: id, status: "NEEDS_INFO" },
      }).catch(() => {});

      res.json({ request: await serializeAdminRequest(updated) });
    } catch (error) {
      req.log.error({ err: error }, "Admin request info on profile change failed");
      res.status(500).json({ error: "Failed to request more information" });
    }
  },
);

export default router;
