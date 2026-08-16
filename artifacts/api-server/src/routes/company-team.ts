import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import bcryptjs from "bcryptjs";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import {
  companyInvitesTable,
  companyMembersTable,
  traderProfilesTable,
  usersTable,
  traderAuditLogTable,
} from "@workspace/db/schema";
import { and, eq, gt, ne, sql, desc } from "drizzle-orm";
import { authMiddleware, traderOnly, generateToken } from "../lib/auth";
import { generateRevenueCatId } from "../lib/revenuecat-identity";
import type { AuthenticatedRequest } from "../lib/types";
import {
  companyTeamsEnabled,
  getActiveMembership,
  OWNER_ONLY_RESPONSE,
  type CompanyMembership,
} from "../lib/company-membership";
import { sendCompanyInviteEmail } from "../lib/email";
import {
  COMPANY_SEAT_LOCK_NAMESPACE,
  countCompanySeats,
  getCompanyPlanContext,
  resolveInviteSeatLimit,
  teamBillingEnforced,
} from "../lib/team-billing";
import {
  handoverActiveJobsToOwner,
  logJobsHandedToOwner,
  notifyJobsHandedToOwner,
} from "../lib/job-assignment";

// ---------------------------------------------------------------------------
// Company Teams — Phase 1: employee invitations & team management.
//
// Owner-side management routes live under /company/* and are triple-gated:
// feature flag (404 when off — the surface simply does not exist), auth +
// trader role, and OWNER membership. The two public routes (lookup/accept)
// are what the emailed invite link drives; they are flag-gated and rate
// limited (app.ts: companyInviteLimiter) and deliberately collapse every
// failure mode — unknown, expired, cancelled, already-accepted, email taken —
// into ONE generic 400/404 so the endpoint is not a token/state oracle.
//
// Invite tokens: 32 random bytes, base64url. Only the SHA-256 hash is stored;
// the raw token exists in the invitation email alone. Lookup/accept take the
// token in a POST body (never the query string) so it stays out of request
// logs. Single-use is enforced by the atomic conditional UPDATE in accept —
// concurrent taps race on status='PENDING' and exactly one wins.
// ---------------------------------------------------------------------------

const router: IRouter = Router();

const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Same lightweight format check the rest of the API uses. */
const RFC5322_LITE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One generic body for every invalid-invite outcome (no state oracle). */
const INVITE_INVALID = { error: "This invitation is no longer valid." } as const;

// Timing equaliser for public accept failures — mirrors the DUMMY_OTP_HASH
// pattern in routes/auth.ts so the invalid-token path costs roughly the same
// as a real acceptance's bcrypt work.
const DUMMY_PASSWORD_HASH = bcryptjs.hashSync("invite-timing-equaliser", 10);

function sha256Hex(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function newInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function isUniqueViolation(err: unknown): boolean {
  const code =
    (err as { code?: string })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/** Sentinel for "reject with the generic invalid-invite response". */
class InviteInvalidError extends Error {
  constructor() {
    super("invite invalid");
  }
}

/** Sentinel: seat cap would be exceeded (thrown inside the cap-locked tx). */
class CapReachedError extends Error {
  constructor(public readonly max: number) {
    super("member cap reached");
  }
}

/** The owner's plan tier includes no employee seats (every regime). */
class TeamPlanRequiredError extends Error {
  constructor() {
    super("team plan required");
  }
}

const TEAM_PLAN_REQUIRED_RESPONSE = {
  error:
    "Your current plan doesn't include team members. Upgrade to a Team plan to invite employees.",
  code: "TEAM_PLAN_REQUIRED",
} as const;

// Advisory-lock namespace for per-company seat-cap serialisation (pairs with
// the trader_profiles id as the second key). Shared with the reconciliation
// engine in team-billing.ts so subscription-driven seat changes and
// invite/seat operations can never interleave.
const CAP_LOCK_NAMESPACE = COMPANY_SEAT_LOCK_NAMESPACE;

/** Sentinel: valid invite token, but the company has no free seat (enforcement on). */
class SeatUnavailableError extends Error {
  constructor() {
    super("seat unavailable");
  }
}

const SEAT_UNAVAILABLE_RESPONSE = {
  error:
    "This business doesn't have a free team seat right now. Ask the business owner to free up a seat or upgrade their plan, then try the link again.",
  code: "SEAT_UNAVAILABLE",
} as const;

/** Enforcement gate for seat-management routes: they exist only when team
 *  billing is enforced (404 otherwise, mirroring teamsGate — suspensions can
 *  then ONLY come from enforcement-aware code paths, which is what keeps
 *  flag-off behaviour byte-identical). */
function seatEnforcementGate(_req: Request, res: Response, next: NextFunction): void {
  if (!teamBillingEnforced()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

/** Feature-flag gate: while teams are disabled these routes do not exist. */
function teamsGate(_req: Request, res: Response, next: NextFunction): void {
  if (!companyTeamsEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

/**
 * Resolve the caller's membership and require OWNER. Sends the response
 * itself on failure so handlers can simply bail on null.
 */
async function requireOwner(
  req: Request,
  res: Response,
): Promise<{ userId: number; membership: CompanyMembership } | null> {
  const userId = (req as AuthenticatedRequest).userId!;
  const membership = await getActiveMembership(userId);
  if (!membership) {
    res.status(404).json({ error: "Trader profile not found" });
    return null;
  }
  if (membership.role !== "OWNER") {
    res.status(403).json(OWNER_ONLY_RESPONSE);
    return null;
  }
  // Self-heal: owners who registered after the boot backfill resolve via the
  // legacy fallback and have no OWNER membership row yet. Team listing and
  // seat counting read membership rows, so make sure the owner's row exists
  // before any of that runs (no-op when it already does).
  await db
    .insert(companyMembersTable)
    .values({
      traderProfileId: membership.traderProfileId,
      userId: membership.profile.userId,
      role: "OWNER",
      status: "ACTIVE",
    })
    .onConflictDoNothing();
  return { userId, membership };
}

/** PENDING rows past their expiry read as EXPIRED everywhere (lazy expiry, no cron). */
function effectiveInviteStatus(row: { status: string; expiresAt: Date }): string {
  if (row.status === "PENDING" && row.expiresAt.getTime() <= Date.now()) return "EXPIRED";
  return row.status;
}

function serializeInvite(row: typeof companyInvitesTable.$inferSelect) {
  return {
    id: row.id,
    email: row.email,
    status: effectiveInviteStatus(row),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * v1 invites are for BRAND-NEW email addresses only: any non-admin users row
 * with this email blocks the invite — deliberately stricter than signup's
 * planEmailReuse (which lets deletion-lifecycle emails be reclaimed). An
 * address mid-deletion is not "brand new", and keeping invites out of the
 * email-release machinery keeps acceptance simple and safe.
 */
async function emailHasAccount(emailLower: string): Promise<boolean> {
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(sql`lower(${usersTable.email}) = ${emailLower}`, ne(usersTable.role, "admin")),
    )
    .limit(1);
  return rows.length > 0;
}

async function ownerDisplayName(userId: number): Promise<string> {
  const [row] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row?.fullName ?? "The business owner";
}

// ---------------------------------------------------------------------------
// GET /company/team-context — tiny, NOT flag-gated. The mobile account screen
// calls this for every trader to decide which menu rows to show. Flag off →
// {enabled:false} and the UI stays exactly legacy.
// ---------------------------------------------------------------------------
router.get(
  "/company/team-context",
  authMiddleware,
  traderOnly,
  async (req, res) => {
    try {
      if (!companyTeamsEnabled()) {
        res.json({ enabled: false, role: null });
        return;
      }
      const membership = await getActiveMembership(
        (req as AuthenticatedRequest).userId!,
      );
      if (!membership) {
        res.json({ enabled: true, role: null });
        return;
      }
      // Plan-truthful payload for EVERY regime: the seat allowance always
      // derives from the owner's store product, never from the legacy env
      // cap, so the client can never present a seat count the owner hasn't
      // paid for. TEAM_BILLING_ENFORCED only changes whether suspension
      // machinery exists (seatEnforcementActive below).
      const isOwner = membership.role === "OWNER";
      if (!isOwner) {
        // Employees get their own gating state only — never the owner's
        // billing tier or seat utilisation (billing metadata is owner-only).
        // seatSuspended is the employee's OWN state, so it belongs here: it
        // drives the read-only banner and hides purchase/restore prompts.
        const [selfRow] = await db
          .select({ seatSuspendedAt: companyMembersTable.seatSuspendedAt })
          .from(companyMembersTable)
          .where(
            and(
              eq(companyMembersTable.userId, (req as AuthenticatedRequest).userId!),
              eq(companyMembersTable.status, "ACTIVE"),
            ),
          )
          .limit(1);
        res.json({
          enabled: true,
          role: membership.role,
          viewerRole: membership.role,
          viewerCanManageBilling: false,
          viewerCanManageTeam: false,
          viewerCanInvite: false,
          seatSuspended: selfRow?.seatSuspendedAt != null,
        });
        return;
      }
      const plan = await getCompanyPlanContext(membership.traderProfileId);
      res.json({
        enabled: true,
        role: membership.role,
        viewerRole: membership.role,
        effectiveBusinessPlan: plan.effectiveBusinessPlan,
        employeeSeatLimit: plan.employeeSeatLimit,
        effectiveSeatAllowance: plan.effectiveSeatAllowance,
        activeEmployeeCount: plan.activeEmployeeCount,
        suspendedEmployeeCount: plan.suspendedEmployeeCount,
        pendingInviteCount: plan.pendingInviteCount,
        availableSeats: plan.availableSeats,
        overCapacity: plan.overLimit,
        // Grandfathering visibility (owner-only): the exemption that is
        // currently propping up the allowance, if any.
        seatExemption: plan.exemption
          ? {
              seatLimit: plan.exemption.seatLimit,
              expiresAt: plan.exemption.expiresAt?.toISOString() ?? null,
            }
          : null,
        viewerCanManageBilling: true,
        viewerCanManageTeam: true,
        viewerCanInvite:
          plan.effectiveSeatAllowance > 0 && !plan.overLimit && plan.availableSeats > 0,
        // Whether the suspend/reactivate seat routes exist right now — the
        // truthful seat numbers above are always live regardless.
        seatEnforcementActive: teamBillingEnforced(),
      });
    } catch (error) {
      req.log.error({ err: error }, "team-context failed");
      res.status(500).json({ error: "Failed to load team context" });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /company/team — owner dashboard: members + pending invites + seats.
// ---------------------------------------------------------------------------
router.get("/company/team", authMiddleware, traderOnly, teamsGate, async (req, res) => {
  try {
    const ctx = await requireOwner(req, res);
    if (!ctx) return;
    const profileId = ctx.membership.traderProfileId;

    const memberRows = await db
      .select({
        member: companyMembersTable,
        fullName: usersTable.fullName,
        email: usersTable.email,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(companyMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, companyMembersTable.userId))
      .where(
        and(
          eq(companyMembersTable.traderProfileId, profileId),
          eq(companyMembersTable.status, "ACTIVE"),
        ),
      )
      .orderBy(
        sql`case when ${companyMembersTable.role} = 'OWNER' then 0 else 1 end`,
        companyMembersTable.createdAt,
      );

    const inviteRows = await db
      .select()
      .from(companyInvitesTable)
      .where(
        and(
          eq(companyInvitesTable.traderProfileId, profileId),
          eq(companyInvitesTable.status, "PENDING"),
        ),
      )
      .orderBy(desc(companyInvitesTable.createdAt));

    // Seats are ALWAYS plan-truthful: EMPLOYEE-only usage (the owner never
    // occupies a seat) against the plan-derived allowance. The legacy env
    // cap is never presented as a seat allowance — flag off merely means
    // nobody gets suspended for exceeding it (grandfathered members stay).
    const plan = await getCompanyPlanContext(profileId);
    const seatUsage: Record<string, unknown> = {
      used: plan.activeEmployeeCount + plan.pendingInviteCount,
      max: plan.effectiveSeatAllowance,
      // Full owner-facing breakdown: plan / active / reserved / available /
      // suspended / over-capacity.
      plan: plan.effectiveBusinessPlan,
      planActive: plan.active,
      activeEmployees: plan.activeEmployeeCount,
      suspendedEmployees: plan.suspendedEmployeeCount,
      reservedInvites: plan.pendingInviteCount,
      available: plan.availableSeats,
      overCapacity: plan.overLimit,
      exemption: plan.exemption
        ? {
            seatLimit: plan.exemption.seatLimit,
            expiresAt: plan.exemption.expiresAt?.toISOString() ?? null,
          }
        : null,
      // Whether suspend/reactivate routes exist right now.
      enforcement: teamBillingEnforced(),
    };
    if (teamBillingEnforced()) {
      // Older app builds key their seat-management UI on the presence of
      // `allowance`, and those routes 404 while enforcement is off — so the
      // field appears only when the routes do.
      seatUsage["allowance"] = plan.effectiveSeatAllowance;
    }
    res.json({
      members: memberRows.map((r) => ({
        id: r.member.id,
        userId: r.member.userId,
        fullName: r.fullName,
        email: r.email,
        role: r.member.role,
        joinedAt: r.member.createdAt.toISOString(),
        // Each member's OWN personal photo (users.avatarUrl) — never the
        // owner's as a fallback (the client shows initials instead), and
        // never the business logo. Served via the membership-gated
        // avatar-file route only.
        avatarUrl: r.avatarUrl,
        status: r.member.status,
        seatSuspended: r.member.seatSuspendedAt != null,
        seatSuspendedAt: r.member.seatSuspendedAt?.toISOString() ?? null,
        seatSuspensionSource: r.member.seatSuspensionSource ?? null,
      })),
      invites: inviteRows.map(serializeInvite),
      seats: seatUsage,
    });
  } catch (error) {
    req.log.error({ err: error }, "team list failed");
    res.status(500).json({ error: "Failed to load your team" });
  }
});

// ---------------------------------------------------------------------------
// POST /company/invites — invite a brand-new email address as EMPLOYEE.
// ---------------------------------------------------------------------------
const InviteBody = z.object({ email: z.string().min(3).max(255) });

router.post("/company/invites", authMiddleware, traderOnly, teamsGate, async (req, res) => {
  try {
    const ctx = await requireOwner(req, res);
    if (!ctx) return;
    const profileId = ctx.membership.traderProfileId;

    const parsed = InviteBody.safeParse(req.body);
    const email = parsed.success ? parsed.data.email.trim().toLowerCase() : "";
    if (!parsed.success || !RFC5322_LITE.test(email)) {
      res.status(400).json({ error: "Please enter a valid email address." });
      return;
    }

    if (await emailHasAccount(email)) {
      res.status(409).json({
        error: "That email address already has a MyLocalTrade account. In this version, team members need a brand-new email address.",
        code: "EMAIL_IN_USE",
      });
      return;
    }

    const [existingInvite] = await db
      .select()
      .from(companyInvitesTable)
      .where(
        and(
          eq(companyInvitesTable.traderProfileId, profileId),
          eq(companyInvitesTable.email, email),
          eq(companyInvitesTable.status, "PENDING"),
        ),
      )
      .limit(1);
    if (existingInvite) {
      res.status(409).json({
        error: "An invitation for that email is already pending. Use resend to send it again.",
        code: "INVITE_EXISTS",
      });
      return;
    }

    const rawToken = newInviteToken();
    let inviteRow: typeof companyInvitesTable.$inferSelect;
    try {
      // Cap check + insert are serialised per company via an advisory xact
      // lock (released on commit/rollback): two concurrent invites can't both
      // observe the same free seat.
      inviteRow = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${CAP_LOCK_NAMESPACE}, ${profileId})`,
        );
        // Plan-derived seats, ALWAYS: the owner's store product decides the
        // employee seat count; solo/inactive plans have none. Counted
        // per-EMPLOYEE (owner never uses a seat). The legacy env cap is not
        // a seat allowance in any regime.
        const rule = await resolveInviteSeatLimit(profileId, tx);
        if (rule.requiresTeamPlan) {
          throw new TeamPlanRequiredError();
        }
        const counts = await countCompanySeats(profileId, tx);
        if (counts.activeEmployees + counts.pendingInvites >= rule.max) {
          throw new CapReachedError(rule.max);
        }
        const [row] = await tx
          .insert(companyInvitesTable)
          .values({
            traderProfileId: profileId,
            email,
            role: "EMPLOYEE",
            status: "PENDING",
            tokenHash: sha256Hex(rawToken),
            invitedByUserId: ctx.userId,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          })
          .returning();
        return row;
      });
    } catch (err) {
      if (err instanceof TeamPlanRequiredError) {
        res.status(403).json(TEAM_PLAN_REQUIRED_RESPONSE);
        return;
      }
      if (err instanceof CapReachedError) {
        res.status(409).json({
          error: `Your team is limited to ${err.max} members, including pending invitations.`,
          code: "MEMBER_LIMIT_REACHED",
        });
        return;
      }
      if (isUniqueViolation(err)) {
        // Raced a concurrent invite for the same email — same answer as the
        // pre-check above.
        res.status(409).json({
          error: "An invitation for that email is already pending. Use resend to send it again.",
          code: "INVITE_EXISTS",
        });
        return;
      }
      throw err;
    }

    try {
      await sendCompanyInviteEmail({
        toEmail: email,
        businessName: ctx.membership.profile.businessName,
        inviterName: await ownerDisplayName(ctx.userId),
        token: rawToken,
        expiresInDays: INVITE_TTL_DAYS,
      });
    } catch (err) {
      // The invite is useless if the email never went out — remove the row so
      // a retry isn't blocked by the one-pending-per-email index.
      await db.delete(companyInvitesTable).where(eq(companyInvitesTable.id, inviteRow.id));
      req.log.error({ err }, "invite email send failed");
      res.status(502).json({ error: "We couldn't send the invitation email. Please try again." });
      return;
    }

    await db.insert(traderAuditLogTable).values({
      userId: ctx.membership.profile.userId,
      action: "MEMBER_INVITED",
      performedBy: ctx.userId,
      details: { inviteId: inviteRow.id, email },
    });

    res.status(201).json({ invite: serializeInvite(inviteRow) });
  } catch (error) {
    req.log.error({ err: error }, "create invite failed");
    res.status(500).json({ error: "Failed to send the invitation" });
  }
});

// ---------------------------------------------------------------------------
// POST /company/invites/:id/resend — rotate token + expiry, email again.
// Works for expired-but-still-PENDING rows too (that IS the recovery path).
// Every resend re-checks the plan (Solo ⇒ 403); expired rows additionally
// re-check capacity because they re-enter the pending pool.
// ---------------------------------------------------------------------------
router.post(
  "/company/invites/:id/resend",
  authMiddleware,
  traderOnly,
  teamsGate,
  async (req, res) => {
    try {
      const ctx = await requireOwner(req, res);
      if (!ctx) return;
      const inviteId = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(inviteId)) {
        res.status(400).json({ error: "Invalid invitation id" });
        return;
      }

      const [invite] = await db
        .select()
        .from(companyInvitesTable)
        .where(
          and(
            eq(companyInvitesTable.id, inviteId),
            eq(companyInvitesTable.traderProfileId, ctx.membership.traderProfileId),
          ),
        )
        .limit(1);
      if (!invite) {
        res.status(404).json({ error: "Invitation not found" });
        return;
      }
      if (invite.status !== "PENDING") {
        res.status(409).json({ error: "This invitation can no longer be resent." });
        return;
      }

      const rawToken = newInviteToken();
      let updatedRow: typeof companyInvitesTable.$inferSelect | null;
      try {
        updatedRow = await db.transaction(async (tx) => {
          // Every resend re-checks the plan under the same per-company
          // advisory lock the create path uses: a Solo/inactive plan must
          // not keep rotating tokens and emailing invitees it could never
          // seat (403 in every flag regime, same as create).
          await tx.execute(
            sql`select pg_advisory_xact_lock(${CAP_LOCK_NAMESPACE}, ${ctx.membership.traderProfileId})`,
          );
          const rule = await resolveInviteSeatLimit(
            ctx.membership.traderProfileId,
            tx,
          );
          if (rule.requiresTeamPlan) {
            throw new TeamPlanRequiredError();
          }
          if (invite.expiresAt.getTime() <= Date.now()) {
            // Expired invites left the seat count — re-arming one re-enters
            // the pending pool, so only THEN does capacity need headroom for
            // one more (a still-live invite already occupies its slot).
            const counts = await countCompanySeats(
              ctx.membership.traderProfileId,
              tx,
            );
            if (counts.activeEmployees + counts.pendingInvites + 1 > rule.max) {
              throw new CapReachedError(rule.max);
            }
          }
          const updated = await tx
            .update(companyInvitesTable)
            .set({
              tokenHash: sha256Hex(rawToken),
              expiresAt: new Date(Date.now() + INVITE_TTL_MS),
              updatedAt: new Date(),
            })
            .where(
              and(eq(companyInvitesTable.id, invite.id), eq(companyInvitesTable.status, "PENDING")),
            )
            .returning();
          return updated[0] ?? null;
        });
      } catch (err) {
        if (err instanceof TeamPlanRequiredError) {
          res.status(403).json(TEAM_PLAN_REQUIRED_RESPONSE);
          return;
        }
        if (err instanceof CapReachedError) {
          res.status(409).json({
            error: `Your team is limited to ${err.max} members, including pending invitations.`,
            code: "MEMBER_LIMIT_REACHED",
          });
          return;
        }
        throw err;
      }
      if (!updatedRow) {
        res.status(409).json({ error: "This invitation can no longer be resent." });
        return;
      }

      await sendCompanyInviteEmail({
        toEmail: invite.email,
        businessName: ctx.membership.profile.businessName,
        inviterName: await ownerDisplayName(ctx.userId),
        token: rawToken,
        expiresInDays: INVITE_TTL_DAYS,
      });

      await db.insert(traderAuditLogTable).values({
        userId: ctx.membership.profile.userId,
        action: "MEMBER_INVITE_RESENT",
        performedBy: ctx.userId,
        details: { inviteId: invite.id, email: invite.email },
      });

      res.json({ invite: serializeInvite(updatedRow) });
    } catch (error) {
      req.log.error({ err: error }, "resend invite failed");
      res.status(500).json({ error: "Failed to resend the invitation" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /company/invites/:id/cancel — PENDING → CANCELLED (conditional).
// ---------------------------------------------------------------------------
router.post(
  "/company/invites/:id/cancel",
  authMiddleware,
  traderOnly,
  teamsGate,
  async (req, res) => {
    try {
      const ctx = await requireOwner(req, res);
      if (!ctx) return;
      const inviteId = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(inviteId)) {
        res.status(400).json({ error: "Invalid invitation id" });
        return;
      }

      const updated = await db
        .update(companyInvitesTable)
        .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(companyInvitesTable.id, inviteId),
            eq(companyInvitesTable.traderProfileId, ctx.membership.traderProfileId),
            eq(companyInvitesTable.status, "PENDING"),
          ),
        )
        .returning();
      if (updated.length === 0) {
        res.status(404).json({ error: "No pending invitation to cancel." });
        return;
      }

      await db.insert(traderAuditLogTable).values({
        userId: ctx.membership.profile.userId,
        action: "MEMBER_INVITE_CANCELLED",
        performedBy: ctx.userId,
        details: { inviteId: updated[0].id, email: updated[0].email },
      });

      res.json({ ok: true });
    } catch (error) {
      req.log.error({ err: error }, "cancel invite failed");
      res.status(500).json({ error: "Failed to cancel the invitation" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /company/members/:id/remove — EMPLOYEE ACTIVE → REVOKED (conditional).
// Access dies on the member's very next request: getActiveMembership() checks
// status per request, so an existing session token grants nothing afterwards.
// The OWNER row is immutable here — owners cannot remove themselves.
// ---------------------------------------------------------------------------
router.post(
  "/company/members/:id/remove",
  authMiddleware,
  traderOnly,
  teamsGate,
  async (req, res) => {
    try {
      const ctx = await requireOwner(req, res);
      if (!ctx) return;
      const memberId = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(memberId)) {
        res.status(400).json({ error: "Invalid member id" });
        return;
      }

      const [member] = await db
        .select()
        .from(companyMembersTable)
        .where(
          and(
            eq(companyMembersTable.id, memberId),
            eq(companyMembersTable.traderProfileId, ctx.membership.traderProfileId),
          ),
        )
        .limit(1);
      if (!member) {
        res.status(404).json({ error: "Team member not found" });
        return;
      }
      if (member.role === "OWNER") {
        res.status(400).json({
          error: "The business owner cannot be removed from the team.",
          code: "OWNER_IMMUTABLE",
        });
        return;
      }
      if (member.status !== "ACTIVE") {
        res.status(409).json({ error: "This member has already been removed." });
        return;
      }

      // Phase 3: revoke + hand the member's LIVE jobs to the owner in ONE
      // transaction. The conditional ACTIVE→REVOKED flip guarantees at-most-
      // once execution (a retry matches zero rows and changes nothing), and
      // the atomic pairing means a crash can never leave an active job
      // assigned to an inactive member. Completed/cancelled jobs keep their
      // historical assignee; authorship of past messages/quotes is untouched.
      const ownerUserId = ctx.membership.profile.userId;
      const { updated, handedOver } = await db.transaction(async (tx) => {
        const updated = await tx
          .update(companyMembersTable)
          .set({
            status: "REVOKED",
            revokedAt: new Date(),
            revokedByUserId: ctx.userId,
            updatedAt: new Date(),
          })
          .where(
            and(eq(companyMembersTable.id, member.id), eq(companyMembersTable.status, "ACTIVE")),
          )
          .returning();
        if (updated.length === 0) {
          return {
            updated,
            handedOver: [] as Awaited<ReturnType<typeof handoverActiveJobsToOwner>>,
          };
        }
        const handedOver = await handoverActiveJobsToOwner(tx, {
          traderProfileId: ctx.membership.traderProfileId,
          fromUserId: member.userId,
          ownerUserId,
        });
        return { updated, handedOver };
      });
      if (updated.length === 0) {
        res.status(409).json({ error: "This member has already been removed." });
        return;
      }

      // History (messages, quotes, audit trail) is intentionally untouched —
      // the membership row flips status, nothing is deleted, and the startup
      // backfill only ever inserts OWNER rows (ON CONFLICT DO NOTHING), so a
      // revoked employee can never be resurrected by it.
      await db.insert(traderAuditLogTable).values({
        userId: ownerUserId,
        action: "MEMBER_REMOVED",
        performedBy: ctx.userId,
        details: { companyMemberId: member.id, memberUserId: member.userId },
      });
      // One audit row per removal OPERATION (not per job); the tx above ran
      // at most once, so retries can never duplicate it.
      void logJobsHandedToOwner({
        traderProfileId: ctx.membership.traderProfileId,
        conversations: handedOver,
        removedUserId: member.userId,
        ownerUserId,
        actorUserId: ctx.userId,
      }).catch((err) => req.log.warn({ err }, "Handover audit failed"));

      // Customer-facing handover: ONE system message + one notification per
      // affected live job (shared with the account-deletion handover paths).
      // The owner initiated the removal (no notification to self) and the
      // removed member is no longer active (none either).
      void notifyJobsHandedToOwner({
        conversations: handedOver,
        ownerUserId,
        businessName: ctx.membership.profile.businessName,
        onError: (err, conversationId) =>
          req.log.warn({ err, conversationId }, "Handover notification failed"),
      }).catch((err) => req.log.warn({ err }, "Handover notifications failed"));

      res.json({ ok: true });
    } catch (error) {
      req.log.error({ err: error }, "remove member failed");
      res.status(500).json({ error: "Failed to remove the team member" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /company/invites/lookup — PUBLIC. The join screen calls this with the
// token from the emailed link to show "Join <business>" + the invited email.
// POST (not GET) keeps the token out of URLs and request logs.
// ---------------------------------------------------------------------------
const LookupBody = z.object({ token: z.string().min(16).max(200) });

router.post("/company/invites/lookup", teamsGate, async (req, res) => {
  try {
    const parsed = LookupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(404).json(INVITE_INVALID);
      return;
    }
    const [row] = await db
      .select({ invite: companyInvitesTable, businessName: traderProfilesTable.businessName })
      .from(companyInvitesTable)
      .innerJoin(
        traderProfilesTable,
        eq(traderProfilesTable.id, companyInvitesTable.traderProfileId),
      )
      .where(
        and(
          eq(companyInvitesTable.tokenHash, sha256Hex(parsed.data.token)),
          eq(companyInvitesTable.status, "PENDING"),
          gt(companyInvitesTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) {
      res.status(404).json(INVITE_INVALID);
      return;
    }
    res.json({ companyName: row.businessName, email: row.invite.email });
  } catch (error) {
    req.log.error({ err: error }, "invite lookup failed");
    res.status(500).json({ error: "Failed to check the invitation" });
  }
});

// ---------------------------------------------------------------------------
// POST /company/invites/accept — PUBLIC. Creates the employee's own login and
// their ACTIVE EMPLOYEE membership in one transaction, closing the invite.
//
// Atomicity: the conditional UPDATE (status='PENDING' AND unexpired →
// ACCEPTED) is the single-use claim; a concurrent second tap matches zero
// rows and gets the generic failure. Everything after it runs in the same
// transaction, so a later failure (email taken, unique-index race) rolls the
// claim back and no half-created account can exist.
// ---------------------------------------------------------------------------
const AcceptBody = z.object({
  token: z.string().min(16).max(200),
  fullName: z.string().trim().min(1).max(120),
  // Same minimum as account registration (registerCustomerBodyPasswordMin).
  password: z.string().min(8).max(200),
});

router.post("/company/invites/accept", teamsGate, async (req, res) => {
  const parsed = AcceptBody.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({
      error:
        first?.path[0] === "password"
          ? "Password must be at least 8 characters."
          : first?.path[0] === "fullName"
            ? "Please enter your name."
            : INVITE_INVALID.error,
    });
    return;
  }
  const body = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      // Resolve the company BEFORE claiming so the advisory seat lock can be
      // taken first: lock → claim → seat check all inside one transaction.
      // Taking the lock before touching the invite row also avoids a
      // lock-order inversion with resend (which locks first, then updates
      // the row).
      const [pre] = await tx
        .select({ traderProfileId: companyInvitesTable.traderProfileId })
        .from(companyInvitesTable)
        .where(eq(companyInvitesTable.tokenHash, sha256Hex(body.token)))
        .limit(1);
      if (!pre) throw new InviteInvalidError();
      await tx.execute(
        sql`select pg_advisory_xact_lock(${CAP_LOCK_NAMESPACE}, ${pre.traderProfileId})`,
      );

      // Single-use claim: exactly one concurrent accept can flip the row.
      const claimed = await tx
        .update(companyInvitesTable)
        .set({ status: "ACCEPTED", acceptedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(companyInvitesTable.tokenHash, sha256Hex(body.token)),
            eq(companyInvitesTable.status, "PENDING"),
            gt(companyInvitesTable.expiresAt, new Date()),
          ),
        )
        .returning();
      if (claimed.length === 0) throw new InviteInvalidError();
      const invite = claimed[0];

      const [profile] = await tx
        .select()
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.id, invite.traderProfileId))
        .limit(1);
      if (!profile) throw new InviteInvalidError();

      // Seat re-check AT ACCEPT TIME, in every regime: the allowance may
      // have shrunk since the invite was sent (downgrade/expiry), or other
      // invitees may have taken the remaining seats. Throwing rolls the
      // claim back, so the invite stays PENDING and can be accepted later
      // once the owner frees a seat or upgrades. Only SEATED employees
      // count — a suspended seat is free by definition, and other PENDING
      // invites don't block (first to accept wins the seat).
      {
        const rule = await resolveInviteSeatLimit(invite.traderProfileId, tx);
        const counts = await countCompanySeats(invite.traderProfileId, tx);
        if (counts.activeEmployees >= rule.max) {
          throw new SeatUnavailableError();
        }
      }

      // Re-check at accept time: someone may have registered this email since
      // the invite was sent. Rolling back leaves the invite PENDING (visible
      // to the owner), and the response stays generic.
      const existing = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            sql`lower(${usersTable.email}) = ${invite.email}`,
            ne(usersTable.role, "admin"),
          ),
        )
        .limit(1);
      if (existing.length > 0) throw new InviteInvalidError();

      const passwordHash = await bcryptjs.hash(body.password, 12);
      const [user] = await tx
        .insert(usersTable)
        .values({
          email: invite.email, // canonical lowercase from the invite row
          passwordHash,
          fullName: body.fullName.trim(),
          phone: null,
          role: "trader",
          // Possessing the token proves control of the invited mailbox — the
          // invitation email went there. No second verification round.
          emailVerified: true,
          // users.isActive is a login gate only for admin accounts; on OWNER
          // trader accounts it mirrors subscription payment. Employees carry
          // no subscription — their account is operational immediately.
          isActive: true,
          // Canonical RevenueCat customer id — assigned at creation so the
          // identity is never client-influenced (see lib/revenuecat-identity).
          revenuecatId: generateRevenueCatId(),
        })
        .returning();

      const [member] = await tx
        .insert(companyMembersTable)
        .values({
          traderProfileId: invite.traderProfileId,
          userId: user.id,
          role: "EMPLOYEE",
          status: "ACTIVE",
          invitedByUserId: invite.invitedByUserId,
        })
        .returning();

      await tx
        .update(companyInvitesTable)
        .set({ acceptedByUserId: user.id, updatedAt: new Date() })
        .where(eq(companyInvitesTable.id, invite.id));

      await tx.insert(traderAuditLogTable).values({
        userId: profile.userId,
        action: "MEMBER_INVITE_ACCEPTED",
        performedBy: user.id,
        details: { inviteId: invite.id, email: invite.email, companyMemberId: member.id },
      });

      return { user, profile };
    });

    const token = generateToken(result.user.id, result.user.role, result.user.tokenVersion);
    res.status(201).json({
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        fullName: result.user.fullName,
        role: result.user.role,
        isActive: result.user.isActive,
        plan: result.user.plan,
        pushNotificationsEnabled: result.user.pushNotificationsEnabled,
        createdAt: result.user.createdAt.toISOString(),
        deletionStatus: result.user.deletionStatus ?? null,
        deletionRequestedAt: result.user.deletionRequestedAt?.toISOString() ?? null,
      },
      company: { name: result.profile.businessName },
    });
  } catch (err) {
    if (err instanceof SeatUnavailableError) {
      // Deliberately NOT the generic body: the caller proved possession of a
      // VALID token (the claim succeeded before rollback), so telling them
      // the real blocker is safe and actionable — while token-validity
      // failures below stay indistinguishable from each other.
      res.status(409).json(SEAT_UNAVAILABLE_RESPONSE);
      return;
    }
    if (err instanceof InviteInvalidError || isUniqueViolation(err)) {
      // Uniform cost + uniform body for every failure mode.
      await bcryptjs.compare(body.password, DUMMY_PASSWORD_HASH);
      res.status(400).json(INVITE_INVALID);
      return;
    }
    req.log.error({ err }, "invite accept failed");
    res.status(500).json({ error: "Failed to accept the invitation" });
  }
});

// ---------------------------------------------------------------------------
// Owner seat management (TEAM_BILLING_ENFORCED only — 404 otherwise).
//
// Suspend = the member stays in the company with full read access to
// historical work but cannot act (messages/quotes/bookings refuse with
// SEAT_SUSPENDED); their seat is freed for someone else. Reactivate needs a
// free seat. Both are serialised under the company seat lock, so they cannot
// race invites, acceptance, or subscription-driven reconciliation.
// ---------------------------------------------------------------------------

/** Load the profile-scoped ACTIVE EMPLOYEE row or answer 404. */
async function findEmployeeMember(
  res: Response,
  profileId: number,
  memberIdRaw: string,
): Promise<typeof companyMembersTable.$inferSelect | null> {
  const memberId = Number.parseInt(memberIdRaw, 10);
  if (!Number.isFinite(memberId)) {
    res.status(400).json({ error: "Invalid member id" });
    return null;
  }
  const [member] = await db
    .select()
    .from(companyMembersTable)
    .where(
      and(
        eq(companyMembersTable.id, memberId),
        eq(companyMembersTable.traderProfileId, profileId),
        eq(companyMembersTable.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (!member) {
    res.status(404).json({ error: "Team member not found" });
    return null;
  }
  if (member.role === "OWNER") {
    // The owner never occupies a seat and can never be suspended.
    res.status(400).json({ error: "The business owner doesn't use a seat." });
    return null;
  }
  return member;
}

router.post(
  "/company/members/:id/seat-suspend",
  authMiddleware,
  traderOnly,
  teamsGate,
  seatEnforcementGate,
  async (req, res) => {
    try {
      const ctx = await requireOwner(req, res);
      if (!ctx) return;
      const profileId = ctx.membership.traderProfileId;
      const member = await findEmployeeMember(res, profileId, String(req.params.id));
      if (!member) return;

      const updated = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${CAP_LOCK_NAMESPACE}, ${profileId})`,
        );
        // Conditional flip: zero rows = already suspended (idempotent).
        return tx
          .update(companyMembersTable)
          .set({
            seatSuspendedAt: new Date(),
            seatSuspensionSource: "OWNER",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(companyMembersTable.id, member.id),
              eq(companyMembersTable.status, "ACTIVE"),
              sql`${companyMembersTable.seatSuspendedAt} IS NULL`,
            ),
          )
          .returning();
      });

      if (updated.length > 0) {
        await db.insert(traderAuditLogTable).values({
          userId: ctx.membership.profile.userId,
          action: "MEMBER_SEAT_SUSPENDED",
          performedBy: ctx.userId,
          details: { memberUserId: member.userId, source: "OWNER" },
        });
      }
      res.json({ ok: true, alreadySuspended: updated.length === 0 });
    } catch (error) {
      req.log.error({ err: error }, "seat suspend failed");
      res.status(500).json({ error: "Failed to suspend the seat" });
    }
  },
);

router.post(
  "/company/members/:id/seat-reactivate",
  authMiddleware,
  traderOnly,
  teamsGate,
  seatEnforcementGate,
  async (req, res) => {
    try {
      const ctx = await requireOwner(req, res);
      if (!ctx) return;
      const profileId = ctx.membership.traderProfileId;
      const member = await findEmployeeMember(res, profileId, String(req.params.id));
      if (!member) return;

      const outcome = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${CAP_LOCK_NAMESPACE}, ${profileId})`,
        );
        // Free-seat check INSIDE the lock: reactivation takes a seat, so the
        // seated count must be under the allowance right now.
        const plan = await getCompanyPlanContext(profileId, tx);
        if (plan.activeEmployeeCount >= plan.effectiveSeatAllowance) {
          return { kind: "no_seat" as const };
        }
        const rows = await tx
          .update(companyMembersTable)
          .set({ seatSuspendedAt: null, seatSuspensionSource: null, updatedAt: new Date() })
          .where(
            and(
              eq(companyMembersTable.id, member.id),
              eq(companyMembersTable.status, "ACTIVE"),
              sql`${companyMembersTable.seatSuspendedAt} IS NOT NULL`,
            ),
          )
          .returning();
        return { kind: rows.length > 0 ? ("reactivated" as const) : ("noop" as const) };
      });

      if (outcome.kind === "no_seat") {
        res.status(409).json({
          error:
            "No free seat available. Free up another seat or upgrade your plan first.",
          code: "NO_SEAT_AVAILABLE",
        });
        return;
      }
      if (outcome.kind === "reactivated") {
        await db.insert(traderAuditLogTable).values({
          userId: ctx.membership.profile.userId,
          action: "MEMBER_SEAT_REACTIVATED",
          performedBy: ctx.userId,
          details: { memberUserId: member.userId, source: "OWNER" },
        });
      }
      res.json({ ok: true, alreadyActive: outcome.kind === "noop" });
    } catch (error) {
      req.log.error({ err: error }, "seat reactivate failed");
      res.status(500).json({ error: "Failed to reactivate the seat" });
    }
  },
);

export default router;
