import { Router, type IRouter } from "express";
import bcryptjs from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, traderProfilesTable, subscriptionsTable } from "@workspace/db/schema";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import {
  RegisterCustomerBody,
  RegisterTraderBody,
  LoginBody,
  UpdateNotificationSettingsBody,
  UpdateLeadReminderSettingsBody,
  UpdateAvatarBody,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import { DEFAULT_REMINDER_MINUTES } from "../lib/lead-reminders";
import {
  generateToken,
  authMiddleware,
  authMiddlewareAllowDeletion,
  generatePollToken,
  verifyPollToken,
} from "../lib/auth";
import { sendVerificationEmail, sendPasswordResetEmail, generateVerificationToken } from "../lib/email";
import type { AuthenticatedRequest } from "../lib/types";
import { TRADER_STATUS, logAudit, buildOnboardingChecklist, statusMessage, isTraderProfilePublic, evaluateBusinessProfileComplete, evaluateDocumentsComplete } from "../lib/trader-status";
import { ACCOUNT_DELETION_STATUSES, type User } from "@workspace/db/schema";
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION, evaluateLegalAcceptance } from "../lib/legal";
import { getCompanyProfile, formatChAddress } from "../lib/companies-house";
import type { AiVerificationResult } from "../lib/trader-ai-verification";
import { normaliseVatNumber } from "../lib/hmrc-vat";
import { traderDocumentsTable } from "@workspace/db/schema";

const RESEND_COOLDOWN_MS = 60 * 1000;

// In-app email verification code (OTP). Mirrors the trader phone OTP policy.
const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;
const EMAIL_OTP_TTL_MINUTES = EMAIL_OTP_TTL_MS / 60000;
const EMAIL_OTP_MAX_ATTEMPTS = 5;

// Fixed dummy hash compared against on the "no real OTP" branches so the
// timing of an unknown / already-verified / expired email stays close to a
// real code comparison (mitigates account-enumeration via response latency).
const DUMMY_OTP_HASH = bcryptjs.hashSync("000000", 10);

function generateEmailOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Mint a fresh 6-digit email OTP and its bcrypt hash + expiry. */
async function createEmailOtp(): Promise<{ code: string; hash: string; expiresAt: Date }> {
  const code = generateEmailOtp();
  const hash = await bcryptjs.hash(code, 10);
  const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_MS);
  return { code, hash, expiresAt };
}

// Password reset code (OTP). Mirrors the email verification OTP policy.
const PASSWORD_RESET_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_TTL_MINUTES = PASSWORD_RESET_TTL_MS / 60000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;

/** Mint a fresh 6-digit password reset OTP and its bcrypt hash + expiry. */
async function createPasswordResetOtp(): Promise<{ code: string; hash: string; expiresAt: Date }> {
  const code = generateEmailOtp();
  const hash = await bcryptjs.hash(code, 10);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  return { code, hash, expiresAt };
}

/**
 * True for accounts that have been irreversibly anonymised or finalised —
 * there is no meaningful password to reset on these, so the reset flow treats
 * them as if the account does not exist.
 */
function isAccountUnreachable(user: User): boolean {
  return (
    !!user.deletedAt ||
    user.deletionStatus === "ANONYMISED" ||
    user.deletionStatus === "COMPLETED"
  );
}

/**
 * Marks a user's email as verified and applies every downstream side effect.
 * Shared by BOTH verification paths — the web-link GET and the in-app code
 * POST — so the two can never drift:
 *   - clears the verification link token + OTP fields
 *   - activates customers (isActive); traders stay inactive until payment
 *   - transitions trader PENDING_EMAIL_VERIFICATION -> PENDING_PHONE_VERIFICATION
 *     (idempotent, never downgrades)
 *   - writes the EMAIL_VERIFIED audit log
 * Callers must guard on `user.emailVerified` before invoking.
 */
async function finalizeEmailVerification(user: User): Promise<void> {
  // Customers are activated immediately upon email verification. Traders are
  // NOT activated here — trader activation only happens after a successful
  // subscription payment webhook. Until then their account exists and they can
  // sign in to complete onboarding, but `isActive` stays false so the profile
  // is not publicly listed.
  const activateOnVerify = user.role === "customer";

  await db.update(usersTable)
    .set({
      emailVerified: true,
      emailVerificationToken: null,
      emailOtpHash: null,
      emailOtpExpiresAt: null,
      emailOtpAttempts: 0,
      ...(activateOnVerify ? { isActive: true } : {}),
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, user.id));

  if (user.role === "trader") {
    const [profile] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, user.id))
      .limit(1);
    if (profile && profile.verificationStatus === TRADER_STATUS.PENDING_EMAIL_VERIFICATION) {
      await db
        .update(traderProfilesTable)
        .set({
          verificationStatus: TRADER_STATUS.PENDING_PHONE_VERIFICATION,
          updatedAt: new Date(),
        })
        .where(eq(traderProfilesTable.userId, user.id));
    }
  }

  logAudit({ userId: user.id, action: "EMAIL_VERIFIED" });
}

/**
 * Returns reopen context if `existing` refers to a user that has previously
 * been put through the account-deletion lifecycle (requested, retained,
 * anonymised or completed). In that case we let the email be re-used by a
 * fresh registration. Returns null if there is no prior user, or if the prior
 * user is a normal, in-use account (then the caller should 409 as before).
 */
function pickReopenContext(
  existing: User | undefined,
): { priorUserId: number; priorRole: string; priorStatus: string | null } | null {
  if (!existing) return null;
  const inLifecycle =
    !!existing.deletionStatus &&
    (ACCOUNT_DELETION_STATUSES as readonly string[]).includes(existing.deletionStatus);
  if (!inLifecycle && !existing.deletedAt) return null;
  return {
    priorUserId: existing.id,
    priorRole: existing.role,
    priorStatus: existing.deletionStatus ?? null,
  };
}

/**
 * Decide whether an email can be (re)used for a fresh registration, looking
 * at EVERY case-variant row that matches (legacy data may hold the same email
 * more than once with different casing). The email is blocked if ANY matching
 * row is a normal in-use account; otherwise every prior deletion-lifecycle
 * row is reopened (its email released) so the new registration can claim it.
 */
function planEmailReuse(existingRows: User[]):
  | { blocked: true }
  | {
      blocked: false;
      reopens: { priorUserId: number; priorRole: string; priorStatus: string | null }[];
    } {
  const reopens: { priorUserId: number; priorRole: string; priorStatus: string | null }[] = [];
  for (const row of existingRows) {
    const ctx = pickReopenContext(row);
    if (!ctx) return { blocked: true };
    reopens.push(ctx);
  }
  return { blocked: false, reopens };
}

/**
 * Thrown when a prior account that was reopenable at check time is no longer
 * in the deletion lifecycle at write time (e.g. the deletion was cancelled
 * concurrently). Registration must abort and report the email as taken.
 */
class EmailReuseConflictError extends Error {
  constructor() {
    super("Prior account left the deletion lifecycle during registration");
    this.name = "EmailReuseConflictError";
  }
}

/**
 * Frees up the email on a prior deletion-lifecycle user so that a new
 * registration can claim it. The prior row is preserved (audit, reviews,
 * conversations and FK references stay intact) — only the unique email
 * column and the trader_profiles mirror are rewritten to a placeholder.
 *
 * The lifecycle state is re-validated in the UPDATE itself so a concurrent
 * deletion-cancel between the eligibility check and this write can never
 * strip the email from a re-activated account (TOCTOU guard). If the row no
 * longer qualifies, EmailReuseConflictError aborts the whole transaction.
 */
async function releasePriorEmail(
  // The drizzle tx type is intentionally inferred from db.transaction; using
  // a typeof argument here would tie us to private drizzle types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  priorUserId: number,
  priorRole: string,
): Promise<void> {
  const released = `released-${priorUserId}-${Date.now()}@released.mylocaltrade.invalid`;
  const updated = await tx
    .update(usersTable)
    .set({ email: released, updatedAt: new Date() })
    .where(
      and(
        eq(usersTable.id, priorUserId),
        or(
          isNotNull(usersTable.deletionStatus),
          isNotNull(usersTable.deletedAt),
        ),
      ),
    )
    .returning({ id: usersTable.id });
  if (updated.length === 0) {
    throw new EmailReuseConflictError();
  }
  if (priorRole === "trader") {
    await tx
      .update(traderProfilesTable)
      .set({ email: released, updatedAt: new Date() })
      .where(eq(traderProfilesTable.userId, priorUserId));
  }
}

/** Postgres unique-violation (e.g. two concurrent registrations racing on the
 * same email). Drizzle surfaces the pg error directly or as `cause`. */
function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string } | null)?.code ??
    ((error as { cause?: { code?: string } } | null)?.cause?.code);
  return code === "23505";
}

const router: IRouter = Router();

// Case-insensitive email lookup. Registration historically stored emails with
// whatever casing the user typed (e.g. "Lucian.Dpd@..."), so every lookup by
// email must compare lower(stored) = lower(input) or logins/resets silently
// fail for users who type a different casing than they registered with.
const emailEquals = (email: string) =>
  sql`lower(${usersTable.email}) = ${email.trim().toLowerCase()}`;

// Resolve a single user by email, tolerating legacy rows where the same email
// exists more than once with different casing (created before duplicate checks
// became case-insensitive). Deterministic preference order:
//   1. exact casing as typed (legacy accounts keep working exactly as before),
//   2. the canonical all-lowercase row,
//   3. oldest account.
// `kind` scopes the lookup: admin-portal accounts (role "admin") are a
// separate identity space from app accounts (customer/trader) even though
// they share the users table — the same email may exist once in each space.
// App flows must pass "app" so they can never touch an admin-portal row;
// the admin portal passes "admin".
async function findUserByEmail(email: string, kind: "app" | "admin") {
  const typed = email.trim();
  const kindFilter =
    kind === "admin"
      ? sql`${usersTable.role} = 'admin'`
      : sql`${usersTable.role} <> 'admin'`;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(emailEquals(typed), kindFilter))
    .orderBy(
      sql`(${usersTable.email} = ${typed}) DESC`,
      sql`(${usersTable.email} = lower(${usersTable.email})) DESC`,
      usersTable.id,
    )
    .limit(1);
  return user;
}


router.post("/auth/register/customer", async (req, res) => {
  try {
    const body = RegisterCustomerBody.parse(req.body);

    // Admin-portal rows (role "admin") are a separate identity space and
    // never block an app registration with the same email.
    const existingRows = await db
      .select()
      .from(usersTable)
      .where(and(emailEquals(body.email), sql`${usersTable.role} <> 'admin'`));
    const reuse = planEmailReuse(existingRows);
    if (reuse.blocked) {
      // Active (non-deleted) account already owns this email.
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await bcryptjs.hash(body.password, 12);
    const verificationToken = generateVerificationToken();
    const emailOtp = await createEmailOtp();

    const user = await db.transaction(async (tx) => {
      for (const reopen of reuse.reopens) {
        await releasePriorEmail(tx, reopen.priorUserId, reopen.priorRole);
      }
      const [created] = await tx.insert(usersTable).values({
        // Stored lowercased so new accounts are already canonical; lookups
        // remain case-insensitive (emailEquals) for legacy mixed-case rows.
        email: body.email.toLowerCase(),
        passwordHash,
        fullName: body.fullName,
        phone: body.phone || null,
        role: "customer",
        isActive: false,
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationSentAt: new Date(),
        emailOtpHash: emailOtp.hash,
        emailOtpExpiresAt: emailOtp.expiresAt,
        emailOtpAttempts: 0,
      }).returning();
      return created;
    });

    for (const reopen of reuse.reopens) {
      void logAudit({
        userId: reopen.priorUserId,
        action: "ACCOUNT_REOPENED",
        details: {
          newUserId: user.id,
          newEmail: user.email,
          newRole: "customer",
          priorRole: reopen.priorRole,
          priorDeletionStatus: reopen.priorStatus,
        },
      });
    }

    sendVerificationEmail(user.email, user.fullName, verificationToken, emailOtp.code, EMAIL_OTP_TTL_MINUTES).catch((err) =>
      req.log.error({ err }, "Failed to send verification email")
    );

    res.status(201).json({
      message: "Account created. Please check your email to verify your address before logging in.",
      email: user.email,
      pollToken: generatePollToken(user.id),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    if (error instanceof EmailReuseConflictError || isUniqueViolation(error)) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    req.log.error({ err: error }, "Customer registration failed");
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/auth/register/trader", async (req, res) => {
  try {
    const body = RegisterTraderBody.parse(req.body);

    // confirmPassword / termsAccepted / privacyAccepted are now part of the
    // OpenAPI contract and validated by the generated zod schema above. We
    // still need the cross-field equality + truthiness checks here, since
    // those aren't expressible in the field-level schema.
    if (body.confirmPassword !== body.password) {
      res.status(400).json({ error: "Passwords do not match" });
      return;
    }
    if (body.termsAccepted !== true || body.privacyAccepted !== true) {
      res.status(400).json({ error: "You must accept the Terms and Privacy Policy to continue." });
      return;
    }

    // Admin-portal rows (role "admin") are a separate identity space and
    // never block an app registration with the same email.
    const existingRows = await db
      .select()
      .from(usersTable)
      .where(and(emailEquals(body.email), sql`${usersTable.role} <> 'admin'`));
    const reuse = planEmailReuse(existingRows);
    if (reuse.blocked) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await bcryptjs.hash(body.password, 12);
    const verificationToken = generateVerificationToken();
    const emailOtp = await createEmailOtp();
    const now = new Date();

    // If the trader picked a confirmed match from the Companies House live
    // search, server-side re-verify against Companies House before persisting
    // any "MATCH" signal. We trust nothing from the client beyond the company
    // number itself, and we reject obviously malformed numbers.
    let aiVerificationStatus: string | null = null;
    let aiVerificationData: AiVerificationResult | null = null;
    let aiVerificationCheckedAt: Date | null = null;
    let companyNumber: string | null = null;
    // Normalise the optional VAT number to the canonical 9-digit VRN; store
    // null when it's absent or malformed. It's validated against HMRC during
    // review (see register-check), not at signup.
    const vatNumber: string | null = normaliseVatNumber(body.vatNumber);
    const rawCompanyNumber = body.companyNumber?.trim().toUpperCase() ?? "";
    if (rawCompanyNumber && /^[A-Z0-9]{6,10}$/.test(rawCompanyNumber)) {
      try {
        const ch = await getCompanyProfile(rawCompanyNumber);
        if (ch?.company_number) {
          // Reject signup if Companies House reports the company is not
          // currently trading. Only "active" companies may onboard. Any
          // other state (dissolved, liquidation, administration, etc.)
          // means the business cannot legally operate and must not be
          // listed on the marketplace.
          const status = (ch.company_status ?? "").toLowerCase();
          if (status && status !== "active") {
            res.status(400).json({
              error:
                `This business cannot create a trader account because Companies House lists it as "${ch.company_status}". ` +
                `Only companies with status "active" can be onboarded. ` +
                `If you believe this is incorrect, please update your status with Companies House first.`,
              code: "COMPANY_NOT_ACTIVE",
              companyStatus: ch.company_status,
              companyName: ch.company_name,
              companyNumber: ch.company_number,
            });
            return;
          }
          // Require the submitted business name to look like the registered
          // name; otherwise we store the company number for the admin to see
          // but do NOT assign a MATCH verdict (avoids spoofing).
          const norm = (s: string | undefined | null) =>
            (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const submittedNorm = norm(body.businessName);
          const chNorm = norm(ch.company_name);
          const namesAlign =
            submittedNorm.length > 0 &&
            chNorm.length > 0 &&
            (submittedNorm === chNorm ||
              chNorm.startsWith(submittedNorm) ||
              submittedNorm.startsWith(chNorm));

          companyNumber = ch.company_number;
          aiVerificationCheckedAt = now;
          aiVerificationData = {
            verdict: namesAlign ? "MATCH" : "PARTIAL_MATCH",
            reasoning: namesAlign
              ? "Trader selected this company from the live Companies House search during signup. Server re-verified the company number against Companies House and the submitted business name aligns with the registered name."
              : "Trader supplied a Companies House number that resolves to a real record, but the submitted business name does not align with the registered name. Flagged for manual review.",
            submitted: {
              businessName: body.businessName,
              address: [body.businessAddress, body.town].filter(Boolean).join(", "),
              postcode: body.postcode,
            },
            companiesHouse: {
              companyNumber: ch.company_number,
              companyName: ch.company_name,
              address: formatChAddress(ch),
              postcode: ch.registered_office_address?.postal_code,
              status: ch.company_status,
              sicCodes: ch.sic_codes,
            },
          };
          aiVerificationStatus = aiVerificationData.verdict;
        }
      } catch (err) {
        req.log.warn({ err, rawCompanyNumber }, "Companies House confirmation lookup failed at signup");
      }
    }

    const result = await db.transaction(async (tx) => {
      for (const reopen of reuse.reopens) {
        await releasePriorEmail(tx, reopen.priorUserId, reopen.priorRole);
      }
      const [user] = await tx.insert(usersTable).values({
        // Stored lowercased so new accounts are already canonical; lookups
        // remain case-insensitive (emailEquals) for legacy mixed-case rows.
        email: body.email.toLowerCase(),
        passwordHash,
        fullName: body.contactName,
        phone: body.phone,
        role: "trader",
        isActive: false,
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationSentAt: now,
        emailOtpHash: emailOtp.hash,
        emailOtpExpiresAt: emailOtp.expiresAt,
        emailOtpAttempts: 0,
      }).returning();

      await tx.insert(traderProfilesTable).values({
        userId: user.id,
        businessName: body.businessName,
        companyNumber,
        vatNumber,
        contactName: body.contactName,
        email: body.email,
        phone: body.phone,
        mainCategory: body.mainCategory,
        businessAddress: body.businessAddress,
        town: body.town,
        postcode: body.postcode,
        isActive: false,
        verificationStatus: TRADER_STATUS.PENDING_EMAIL_VERIFICATION,
        termsAcceptedAt: now,
        termsVersion: CURRENT_TERMS_VERSION,
        privacyAcceptedAt: now,
        privacyVersion: CURRENT_PRIVACY_VERSION,
        aiVerificationStatus,
        aiVerificationData,
        aiVerificationCheckedAt,
      });

      return user;
    });

    logAudit({
      userId: result.id,
      action: "TRADER_ACCOUNT_CREATED",
      details: {
        email: result.email,
        businessName: body.businessName,
        mainCategory: body.mainCategory,
        companyNumber: companyNumber ?? undefined,
        autoVerifiedByCompaniesHouse: aiVerificationStatus === "MATCH",
      },
    });

    for (const reopen of reuse.reopens) {
      void logAudit({
        userId: reopen.priorUserId,
        action: "ACCOUNT_REOPENED",
        details: {
          newUserId: result.id,
          newEmail: result.email,
          newRole: "trader",
          priorRole: reopen.priorRole,
          priorDeletionStatus: reopen.priorStatus,
        },
      });
    }

    sendVerificationEmail(result.email, result.fullName, verificationToken, emailOtp.code, EMAIL_OTP_TTL_MINUTES).catch((err) =>
      req.log.error({ err }, "Failed to send verification email")
    );

    res.status(201).json({
      message: "Account created. Please check your email to verify your address before logging in.",
      email: result.email,
      pollToken: generatePollToken(result.id),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    if (error instanceof EmailReuseConflictError || isUniqueViolation(error)) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    req.log.error({ err: error }, "Trader registration failed");
    res.status(500).json({ error: "Registration failed" });
  }
});

// Per-account login lockout thresholds. These are enforced in the database so
// they hold across all instances in an autoscaled deployment, closing the
// credential-stuffing gap that exists when relying solely on per-instance
// IP-based rate limiting.
const LOGIN_MAX_FAILED_ATTEMPTS = 10;
const LOGIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

router.post("/auth/login", async (req, res) => {
  try {
    const body = LoginBody.parse(req.body);

    // The admin portal sends { portal: "admin" } so login matches only
    // admin-portal accounts; the mobile app (no flag) matches only app
    // accounts. This is a row-selection scope, not a privilege: whichever
    // row is matched still requires its own password, and the issued token
    // carries that row's role.
    const portal = (req.body as { portal?: unknown })?.portal === "admin";
    const user = await findUserByEmail(body.email, portal ? "admin" : "app");
    if (!user) {
      // Return the same response as a bad password to avoid account enumeration.
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    if (user.deletedAt) {
      res.status(403).json({ error: "This account has been deleted." });
      return;
    }
    if (
      user.deletionStatus === "ANONYMISED" ||
      user.deletionStatus === "COMPLETED"
    ) {
      // Account has been irreversibly anonymised or finalised — there is
      // nothing meaningful left to sign in to.
      res.status(403).json({
        error: "This account has been deleted.",
        code: "ACCOUNT_DELETED",
      });
      return;
    }
    // REQUESTED / DISABLED_PENDING_RETENTION: login is allowed so the user
    // can view their deletion status and cancel from the mobile app. The
    // mobile client routes them to the deletion-status screen instead of
    // the normal app shell based on the deletionStatus field below.

    // Per-account lockout check — DB-backed so it is enforced globally across
    // all instances, not just the one handling this request. Check this before
    // bcrypt.compare() so locked-out requests incur no extra CPU cost.
    if (
      user.loginLockedUntil !== null &&
      user.loginLockedUntil !== undefined &&
      user.loginLockedUntil > new Date()
    ) {
      res.status(429).json({
        error: "Too many failed login attempts. Please try again in 15 minutes.",
        code: "ACCOUNT_LOCKED",
      });
      return;
    }

    const valid = await bcryptjs.compare(body.password, user.passwordHash);
    if (!valid) {
      // Atomically increment the per-account failed-attempt counter using a
      // SELECT FOR UPDATE transaction so that concurrent bad-password bursts
      // from distributed requests cannot race past the lockout threshold.
      // Each concurrent request serialises on the row lock: the second reader
      // sees the counter already incremented by the first, so the real cap is
      // always honoured regardless of how many instances handle the requests.
      //
      // Lockout expiry is also handled here: if a previous lockout has since
      // expired, reset the counter to 1 (this is the first bad guess in the
      // new window) rather than adding to a stale total, which would cause an
      // immediate re-lock on the very first post-expiry failure.
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            loginFailedAttempts: usersTable.loginFailedAttempts,
            loginLockedUntil: usersTable.loginLockedUntil,
          })
          .from(usersTable)
          .where(eq(usersTable.id, user.id))
          .for("update");

        if (!row) return;

        const now = new Date();
        const lockoutExpired =
          row.loginLockedUntil !== null &&
          row.loginLockedUntil !== undefined &&
          row.loginLockedUntil <= now;

        // If a prior lockout has expired, treat this as the first failure in
        // a fresh window rather than adding to the stale counter.
        const baseAttempts = lockoutExpired ? 0 : (row.loginFailedAttempts ?? 0);
        const newAttempts = baseAttempts + 1;
        const shouldLock = newAttempts >= LOGIN_MAX_FAILED_ATTEMPTS;

        await tx
          .update(usersTable)
          .set({
            loginFailedAttempts: newAttempts,
            loginLockedUntil: shouldLock
              ? new Date(now.getTime() + LOGIN_LOCKOUT_DURATION_MS)
              : lockoutExpired
              ? null
              : row.loginLockedUntil,
            updatedAt: now,
          })
          .where(eq(usersTable.id, user.id));
      });

      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Deactivated STAFF accounts (admin whose access was removed or who is
    // suspended) must be rejected at the login boundary, not merely by
    // downstream route middleware — this mirrors loadActiveUser. For
    // non-admin roles isActive reflects subscription/onboarding state and
    // login is intentionally allowed.
    if (user.role === "admin" && !user.isActive) {
      res.status(403).json({ error: "This account has been deactivated." });
      return;
    }

    if (!user.emailVerified) {
      res.status(403).json({
        error: "Please verify your email address before logging in.",
        code: "EMAIL_NOT_VERIFIED",
        email: user.email,
      });
      return;
    }

    // Successful authentication — reset the failed-attempt counter so the
    // account is not unfairly locked after previous bad guesses.
    if ((user.loginFailedAttempts ?? 0) > 0 || user.loginLockedUntil !== null) {
      await db
        .update(usersTable)
        .set({ loginFailedAttempts: 0, loginLockedUntil: null, updatedAt: new Date() })
        .where(eq(usersTable.id, user.id));
    }

    const token = generateToken(user.id, user.role, user.tokenVersion);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin,
        isActive: user.isActive,
        plan: user.plan,
        pushNotificationsEnabled: user.pushNotificationsEnabled,
        createdAt: user.createdAt.toISOString(),
        deletionStatus: user.deletionStatus ?? null,
        deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    req.log.error({ err: error }, "Login failed");
    res.status(500).json({ error: "Login failed" });
  }
});

router.get("/auth/verify-email", async (req, res) => {
  const { token } = req.query as { token?: string };

  if (!token) {
    res.status(400).send(verifyPage("Invalid Link", "No verification token provided.", false));
    return;
  }

  try {
    const [user] = await db.select().from(usersTable)
      .where(eq(usersTable.emailVerificationToken, token))
      .limit(1);

    if (!user) {
      res.status(404).send(verifyPage("Link Expired", "This verification link is invalid or has already been used.", false));
      return;
    }

    if (user.emailVerified) {
      res.send(verifyPage("Already Verified", "Your email is already verified. You can log in to the app.", true));
      return;
    }

    await finalizeEmailVerification(user);

    res.send(verifyPage("Email Verified!", "Your email has been verified. You can now log in to MyLocalTrade.", true));
  } catch (error) {
    req.log.error({ err: error }, "Email verification failed");
    res.status(500).send(verifyPage("Error", "Something went wrong. Please try again.", false));
  }
});

router.post("/auth/resend-verification", async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const GENERIC_RESPONSE = { message: "If an account exists with that email, a verification email has been sent." };

    const user = await findUserByEmail(email, "app");
    if (!user) {
      res.json(GENERIC_RESPONSE);
      return;
    }

    if (user.emailVerified) {
      res.json(GENERIC_RESPONSE);
      return;
    }

    // Rate limit: 60s cooldown between resends — enforced server-side but not
    // exposed to the caller to avoid leaking account/verification state.
    if (user.emailVerificationSentAt) {
      const elapsed = Date.now() - new Date(user.emailVerificationSentAt).getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        res.json(GENERIC_RESPONSE);
        return;
      }
    }

    const newToken = generateVerificationToken();
    const newOtp = await createEmailOtp();
    await db.update(usersTable)
      .set({
        emailVerificationToken: newToken,
        emailVerificationSentAt: new Date(),
        emailOtpHash: newOtp.hash,
        emailOtpExpiresAt: newOtp.expiresAt,
        emailOtpAttempts: 0,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    sendVerificationEmail(user.email, user.fullName, newToken, newOtp.code, EMAIL_OTP_TTL_MINUTES).catch((err) =>
      req.log.error({ err }, "Failed to send verification email")
    );

    logAudit({ userId: user.id, action: "EMAIL_VERIFICATION_RESENT" });

    res.json(GENERIC_RESPONSE);
  } catch (error) {
    req.log.error({ err: error }, "Resend verification failed");
    res.status(500).json({ error: "Failed to resend verification email" });
  }
});

/**
 * In-app email verification by 6-digit code. This is the primary mobile flow:
 * the user enters the code from their email and is signed in immediately, so
 * the UX never depends on bouncing out to the browser. The web-link path
 * (GET /auth/verify-email) remains as a fallback. Both call the same
 * finalizeEmailVerification helper.
 *
 * On success returns the same { token, user } shape as /auth/login.
 */
router.post("/auth/verify-email-code", async (req, res) => {
  try {
    const { email, code } = req.body as { email?: string; code?: string };
    if (!email || typeof email !== "string" || !code || typeof code !== "string") {
      res.status(400).json({ error: "Email and code are required" });
      return;
    }
    const normalisedCode = code.trim();
    if (!/^\d{6}$/.test(normalisedCode)) {
      res.status(400).json({ error: "Enter the 6-digit code from your email.", code: "INVALID_CODE" });
      return;
    }

    const user = await findUserByEmail(email, "app");

    // Uniform failure response. We deliberately do NOT distinguish between an
    // unknown email, an already-verified account, a missing/expired code, or a
    // wrong code — they all return the same generic 400 — so this unauthenticated
    // endpoint cannot be used to enumerate which emails are registered or
    // verified. The only state-specific response is the 429 lockout, which a
    // caller can reach only for an account whose OTP attempts they are actively
    // exhausting (after EMAIL_OTP_MAX_ATTEMPTS tries). A dummy bcrypt compare
    // on the no-real-hash branches keeps response timing close to a real
    // comparison, mitigating enumeration via latency.
    const INVALID = { error: "That code is invalid or has expired. Please request a new one.", code: "INVALID_CODE" };

    const hasActiveOtp =
      !!user &&
      !user.emailVerified &&
      !!user.emailOtpHash &&
      !!user.emailOtpExpiresAt &&
      Date.now() <= new Date(user.emailOtpExpiresAt).getTime();

    if (!user || !hasActiveOtp) {
      await bcryptjs.compare(normalisedCode, DUMMY_OTP_HASH);
      res.status(400).json(INVALID);
      return;
    }

    if ((user.emailOtpAttempts ?? 0) >= EMAIL_OTP_MAX_ATTEMPTS) {
      res.status(429).json({
        error: "Too many incorrect attempts. Please request a new code.",
        code: "TOO_MANY_ATTEMPTS",
      });
      return;
    }

    const matches = await bcryptjs.compare(normalisedCode, user.emailOtpHash!);
    if (!matches) {
      const attempts = (user.emailOtpAttempts ?? 0) + 1;
      await db.update(usersTable)
        .set({ emailOtpAttempts: attempts, updatedAt: new Date() })
        .where(eq(usersTable.id, user.id));
      if (attempts >= EMAIL_OTP_MAX_ATTEMPTS) {
        res.status(429).json({
          error: "Too many incorrect attempts. Please request a new code.",
          code: "TOO_MANY_ATTEMPTS",
        });
        return;
      }
      res.status(400).json(INVALID);
      return;
    }

    await finalizeEmailVerification(user);

    const token = generateToken(user.id, user.role, user.tokenVersion);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        // finalizeEmailVerification activates customers; traders stay inactive
        // until subscription payment.
        isActive: user.role === "customer" ? true : user.isActive,
        plan: user.plan,
        pushNotificationsEnabled: user.pushNotificationsEnabled,
        createdAt: user.createdAt.toISOString(),
        deletionStatus: user.deletionStatus ?? null,
        deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    req.log.error({ err: error }, "Email code verification failed");
    res.status(500).json({ error: "Verification failed" });
  }
});

/**
 * Step 1 of password reset: request a 6-digit reset code by email. Works for
 * every account type (customer, trader, admin). Always responds with a generic
 * 200 — it never reveals whether the email is registered (account-enumeration
 * resistance) and is rate-limited (60s cooldown per account, plus the
 * resendLimiter at the app layer).
 */
router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const GENERIC_RESPONSE = {
      message: "If an account exists with that email, a password reset code has been sent.",
    };

    // Pass the email as typed (trim only) so the helper's exact-casing
    // precedence still applies for legacy duplicate accounts. The admin
    // portal sends { portal: "admin" } so its reset targets the admin row.
    const portal = (req.body as { portal?: unknown })?.portal === "admin";
    const user = await findUserByEmail(email, portal ? "admin" : "app");

    // Unknown email or an irreversibly deleted/anonymised account: respond
    // generically without sending anything.
    if (!user || isAccountUnreachable(user)) {
      res.json(GENERIC_RESPONSE);
      return;
    }

    // 60s cooldown between reset requests — enforced server-side but not
    // surfaced, to avoid leaking account state.
    if (user.passwordResetSentAt) {
      const elapsed = Date.now() - new Date(user.passwordResetSentAt).getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        res.json(GENERIC_RESPONSE);
        return;
      }
    }

    const otp = await createPasswordResetOtp();
    await db
      .update(usersTable)
      .set({
        passwordResetOtpHash: otp.hash,
        passwordResetOtpExpiresAt: otp.expiresAt,
        passwordResetOtpAttempts: 0,
        passwordResetSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    sendPasswordResetEmail(user.email, user.fullName, otp.code, PASSWORD_RESET_TTL_MINUTES).catch((err) =>
      req.log.error({ err }, "Failed to send password reset email"),
    );

    logAudit({ userId: user.id, action: "PASSWORD_RESET_REQUESTED" });

    res.json(GENERIC_RESPONSE);
  } catch (error) {
    req.log.error({ err: error }, "Forgot password failed");
    res.status(500).json({ error: "Failed to process password reset request" });
  }
});

/**
 * Step 2 of password reset: verify the 6-digit code and set a new password.
 * On success the password is changed, every existing session is revoked
 * (tokenVersion bump) and a fresh session is issued (same { token, user }
 * shape as /auth/login), so the user is signed in immediately. A successful
 * reset also verifies the email if it wasn't already (the emailed code proves
 * control of the inbox). Uniform 400 INVALID response on any bad/expired code
 * to avoid disclosing account state; per-account attempt cap mirrors the email
 * verification flow.
 */
router.post("/auth/reset-password", async (req, res) => {
  try {
    const { email, code, newPassword } = req.body as {
      email?: string;
      code?: string;
      newPassword?: string;
    };

    if (!email || typeof email !== "string" || !code || typeof code !== "string") {
      res.status(400).json({ error: "Email and code are required" });
      return;
    }
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      res.status(400).json({ error: "New password must be at least 8 characters." });
      return;
    }

    const INVALID = { error: "Invalid or expired code." };
    const normalisedCode = code.trim();

    // Pass the email as typed (trim only) so the helper's exact-casing
    // precedence still applies for legacy duplicate accounts. Same portal
    // scoping as /auth/forgot-password.
    const portal = (req.body as { portal?: unknown })?.portal === "admin";
    const user = await findUserByEmail(email, portal ? "admin" : "app");

    const hasActiveOtp =
      !!user &&
      !isAccountUnreachable(user) &&
      !!user.passwordResetOtpHash &&
      !!user.passwordResetOtpExpiresAt &&
      new Date(user.passwordResetOtpExpiresAt).getTime() > Date.now();

    if (!user || !hasActiveOtp) {
      // Keep the timing close to a real comparison (enumeration resistance).
      await bcryptjs.compare(normalisedCode, DUMMY_OTP_HASH);
      res.status(400).json(INVALID);
      return;
    }

    if ((user.passwordResetOtpAttempts ?? 0) >= PASSWORD_RESET_MAX_ATTEMPTS) {
      res.status(429).json({
        error: "Too many incorrect attempts. Please request a new code.",
        code: "TOO_MANY_ATTEMPTS",
      });
      return;
    }

    const matches = await bcryptjs.compare(normalisedCode, user.passwordResetOtpHash!);
    if (!matches) {
      const attempts = (user.passwordResetOtpAttempts ?? 0) + 1;
      await db
        .update(usersTable)
        .set({ passwordResetOtpAttempts: attempts, updatedAt: new Date() })
        .where(eq(usersTable.id, user.id));
      if (attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
        res.status(429).json({
          error: "Too many incorrect attempts. Please request a new code.",
          code: "TOO_MANY_ATTEMPTS",
        });
        return;
      }
      res.status(400).json(INVALID);
      return;
    }

    const newPasswordHash = await bcryptjs.hash(newPassword, 12);
    const newTokenVersion = (user.tokenVersion ?? 1) + 1;

    // Set the new password, clear the reset OTP, and revoke every existing
    // session by bumping tokenVersion (the fresh JWT below uses the new one).
    await db
      .update(usersTable)
      .set({
        passwordHash: newPasswordHash,
        passwordResetOtpHash: null,
        passwordResetOtpExpiresAt: null,
        passwordResetOtpAttempts: 0,
        passwordResetSentAt: null,
        tokenVersion: newTokenVersion,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    // A valid emailed code proves control of the inbox, so verify the email if
    // it wasn't already (activates customers / advances trader onboarding).
    if (!user.emailVerified) {
      await finalizeEmailVerification(user);
    }

    logAudit({ userId: user.id, action: "PASSWORD_RESET_COMPLETED" });

    // Re-read for an accurate response (finalizeEmailVerification may have
    // flipped isActive / emailVerified).
    const [fresh] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);
    const result = fresh ?? user;

    const token = generateToken(result.id, result.role, newTokenVersion);
    res.json({
      token,
      user: {
        id: result.id,
        email: result.email,
        fullName: result.fullName,
        role: result.role,
        isActive: result.isActive,
        plan: result.plan,
        pushNotificationsEnabled: result.pushNotificationsEnabled,
        createdAt: result.createdAt.toISOString(),
        deletionStatus: result.deletionStatus ?? null,
        deletionRequestedAt: result.deletionRequestedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    req.log.error({ err: error }, "Password reset failed");
    res.status(500).json({ error: "Password reset failed" });
  }
});

router.get("/auth/verification-status", async (req, res) => {
  try {
    const { token } = req.query as { token?: string };
    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
    }
    let userId: number;
    try {
      ({ userId } = verifyPollToken(token));
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.json({ verified: false });
      return;
    }
    res.json({ verified: !!user.emailVerified });
  } catch (error) {
    req.log.error({ err: error }, "Check verification status failed");
    res.status(500).json({ error: "Failed to check status" });
  }
});

router.get("/auth/me", authMiddlewareAllowDeletion, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (user.deletedAt) {
      res.status(401).json({ error: "Account is no longer active" });
      return;
    }

    // Note: this route is reachable while deletionStatus is REQUESTED or
    // DISABLED_PENDING_RETENTION (the cancellable states) so the mobile
    // client can render the deletion-pending UI without losing the session.
    // ANONYMISED / COMPLETED are blocked at the middleware level.
    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl ?? null,
      role: user.role,
      isSuperAdmin: user.isSuperAdmin,
      isActive: user.isActive,
      phone: user.phone ?? null,
      // Customer phone verification status — drives the "verify your mobile"
      // gate in the app before contacting traders. Traders' phone
      // verification lives on trader_profiles, not here.
      phoneVerified: user.phoneVerified,
      plan: user.plan,
      pushNotificationsEnabled: user.pushNotificationsEnabled,
      createdAt: user.createdAt.toISOString(),
      deletionStatus: user.deletionStatus ?? null,
      deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
    });
  } catch (error) {
    req.log.error({ err: error }, "Get user failed");
    res.status(500).json({ error: "Failed to get user" });
  }
});

// PATCH /auth/me/avatar — set or remove the caller's PERSONAL profile photo
// (headshot). Trader-only for now (Phase 1A): the photo appears in the
// trader's own account area and the conversation header, never on public
// trader cards, and is entirely separate from the business logo on the
// trader profile. Pass objectPath from the customer-uploads presigned flow,
// or null to remove. Ownership + image type are verified server-side.
router.patch("/auth/me/avatar", authMiddleware, async (req, res) => {
  try {
    const { userId, userRole } = req as AuthenticatedRequest;
    if (userRole !== "trader") {
      res.status(403).json({ error: "Only trader accounts can set a personal profile photo." });
      return;
    }
    const body = UpdateAvatarBody.parse(req.body);

    let avatarUrl: string | null = null;
    if (body.objectPath !== null) {
      const storage = new ObjectStorageService();
      try {
        avatarUrl = await storage.verifyCustomerUploadObject(body.objectPath, userId, {
          maxBytes: 8 * 1024 * 1024,
          allowedMimes: new Set([
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/heic",
            "image/heif",
          ]),
          label: "profile photo",
        });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
    }

    const [updated] = await db
      .update(usersTable)
      .set({ avatarUrl, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning({ avatarUrl: usersTable.avatarUrl });
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ ok: true, avatarUrl: updated.avatarUrl ?? null });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    req.log.error({ err: error }, "Update avatar failed");
    res.status(500).json({ error: "Failed to update profile photo" });
  }
});

router.patch("/auth/me/notification-settings", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const body = UpdateNotificationSettingsBody.parse(req.body);
    const [updated] = await db
      .update(usersTable)
      .set({ pushNotificationsEnabled: body.pushNotificationsEnabled, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning({ pushNotificationsEnabled: usersTable.pushNotificationsEnabled });
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ ok: true, pushNotificationsEnabled: updated.pushNotificationsEnabled });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    req.log.error({ err: error }, "Update notification settings failed");
    res.status(500).json({ error: "Failed to update notification settings" });
  }
});

router.get("/trader/lead-reminder-settings", authMiddleware, async (req, res) => {
  try {
    const { userId, userRole } = req as AuthenticatedRequest;
    if (userRole !== "trader") {
      res.status(403).json({ error: "Only traders can view lead-reminder settings." });
      return;
    }
    const [profile] = await db
      .select({
        leadReminderMinutes: traderProfilesTable.leadReminderMinutes,
        leadReminderEmailEnabled: traderProfilesTable.leadReminderEmailEnabled,
      })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    if (!profile) {
      res.status(404).json({ error: "Trader profile not found." });
      return;
    }
    res.json({
      leadReminderMinutes: profile.leadReminderMinutes,
      defaultMinutes: DEFAULT_REMINDER_MINUTES,
      leadReminderEmailEnabled: profile.leadReminderEmailEnabled,
    });
  } catch (error) {
    req.log.error({ err: error }, "Get lead-reminder settings failed");
    res.status(500).json({ error: "Failed to get lead-reminder settings" });
  }
});

router.patch("/trader/lead-reminder-settings", authMiddleware, async (req, res) => {
  try {
    const { userId, userRole } = req as AuthenticatedRequest;
    if (userRole !== "trader") {
      res.status(403).json({ error: "Only traders can update lead-reminder settings." });
      return;
    }
    const body = UpdateLeadReminderSettingsBody.parse(req.body);
    const updates: {
      leadReminderMinutes?: number | null;
      leadReminderEmailEnabled?: boolean;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (Object.prototype.hasOwnProperty.call(body, "leadReminderMinutes")) {
      updates.leadReminderMinutes = body.leadReminderMinutes ?? null;
    }
    if (typeof body.leadReminderEmailEnabled === "boolean") {
      updates.leadReminderEmailEnabled = body.leadReminderEmailEnabled;
    }
    if (
      updates.leadReminderMinutes === undefined &&
      updates.leadReminderEmailEnabled === undefined
    ) {
      res.status(400).json({ error: "No settings provided." });
      return;
    }
    const [updated] = await db
      .update(traderProfilesTable)
      .set(updates)
      .where(eq(traderProfilesTable.userId, userId))
      .returning({
        leadReminderMinutes: traderProfilesTable.leadReminderMinutes,
        leadReminderEmailEnabled: traderProfilesTable.leadReminderEmailEnabled,
      });
    if (!updated) {
      res.status(404).json({ error: "Trader profile not found." });
      return;
    }
    res.json({
      leadReminderMinutes: updated.leadReminderMinutes,
      defaultMinutes: DEFAULT_REMINDER_MINUTES,
      leadReminderEmailEnabled: updated.leadReminderEmailEnabled,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    req.log.error({ err: error }, "Update lead-reminder settings failed");
    res.status(500).json({ error: "Failed to update lead-reminder settings" });
  }
});

router.get("/trader/onboarding-status", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user || user.role !== "trader") {
      res.status(403).json({ error: "Only traders can view onboarding status." });
      return;
    }
    const [profile] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    if (!profile) {
      res.status(404).json({ error: "Trader profile not found." });
      return;
    }

    const businessProfile = evaluateBusinessProfileComplete(profile);
    const docs = await db
      .select()
      .from(traderDocumentsTable)
      .where(eq(traderDocumentsTable.userId, userId));
    const documents = evaluateDocumentsComplete(docs, {
      businessRole: profile.businessRole,
      authorisedRepresentative: profile.authorisedRepresentative,
    });
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);
    const subscription = sub
      ? {
          status: sub.status,
          planId: sub.planId,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          currentPeriodEnd: sub.currentPeriodEnd,
        }
      : null;

    res.json({
      verificationStatus: profile.verificationStatus,
      message: statusMessage(profile),
      isPublic: isTraderProfilePublic(user, profile, subscription, docs),
      emailVerified: user.emailVerified,
      phoneVerified: profile.phoneVerified,
      businessProfileCompleted: profile.businessProfileCompleted,
      documentsSubmitted: profile.documentsSubmitted,
      isActive: profile.isActive,
      rejectionReason: profile.rejectionReason,
      adminNotes: profile.adminNotes,
      needsMoreInfoReason: profile.needsMoreInfoReason,
      businessRole: profile.businessRole,
      authorisedRepresentative: profile.authorisedRepresentative,
      revalidationDueAt: profile.revalidationDueAt
        ? profile.revalidationDueAt.toISOString()
        : null,
      revalidationRemindedAt: profile.revalidationRemindedAt
        ? profile.revalidationRemindedAt.toISOString()
        : null,
      revalidationOverdue: profile.revalidationOverdue,
      checklist: buildOnboardingChecklist(user, profile, subscription),
      businessProfile,
      documents,
      subscription,
      legal: evaluateLegalAcceptance(profile),
      email: user.email,
      businessName: profile.businessName,
    });
  } catch (error) {
    req.log.error({ err: error }, "Get onboarding status failed");
    res.status(500).json({ error: "Failed to get onboarding status" });
  }
});

// Phase 8: re-accept latest terms / privacy after a version bump.
router.post("/trader/accept-terms", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const body = req.body as { acceptTerms?: boolean; acceptPrivacy?: boolean };
    if (body.acceptTerms !== true && body.acceptPrivacy !== true) {
      res.status(400).json({ error: "Nothing to accept." });
      return;
    }
    const [profile] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    if (!profile) {
      res.status(404).json({ error: "Trader profile not found." });
      return;
    }
    const now = new Date();
    const update: Record<string, unknown> = { updatedAt: now };
    if (body.acceptTerms) {
      update.termsVersion = CURRENT_TERMS_VERSION;
      update.termsAcceptedAt = now;
    }
    if (body.acceptPrivacy) {
      update.privacyVersion = CURRENT_PRIVACY_VERSION;
      update.privacyAcceptedAt = now;
    }
    const [updated] = await db
      .update(traderProfilesTable)
      .set(update)
      .where(eq(traderProfilesTable.userId, userId))
      .returning();
    await logAudit({
      userId,
      action: "BUSINESS_PROFILE_UPDATED",
      details: {
        legal: {
          terms: body.acceptTerms ? CURRENT_TERMS_VERSION : undefined,
          privacy: body.acceptPrivacy ? CURRENT_PRIVACY_VERSION : undefined,
        },
      },
    });
    res.json({ legal: evaluateLegalAcceptance(updated) });
  } catch (error) {
    req.log.error({ err: error }, "Accept terms failed");
    res.status(500).json({ error: "Failed to record acceptance" });
  }
});

function verifyPage(title: string, message: string, success: boolean): string {
  const icon = success ? "✅" : "❌";
  const color = success ? "#06D6A0" : "#EF4444";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — MyLocalTrade</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0B1120; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;">
  <div style="max-width: 420px; width: 100%; background: #111827; border-radius: 16px; padding: 48px 40px; text-align: center; border: 1px solid #1F2937;">
    <div style="font-size: 48px; margin-bottom: 16px;">${icon}</div>
    <h1 style="color: #F9FAFB; font-size: 24px; font-weight: 700; margin: 0 0 12px;">${title}</h1>
    <p style="color: #9CA3AF; font-size: 16px; line-height: 1.6; margin: 0 0 32px;">${message}</p>
    ${success ? `<a href="/open" style="display: inline-block; background: #00B4D8; color: #0B1120; font-weight: 700; font-size: 15px; padding: 13px 30px; border-radius: 12px; text-decoration: none;">Open the MyLocalTrade app</a>` : `<p style="color: #6B7280; font-size: 14px; margin: 0;">Please request a new verification email from the app.</p>`}
    <hr style="border: none; border-top: 1px solid #1F2937; margin: 32px 0 16px;">
    <p style="color: #374151; font-size: 12px; margin: 0;">MyLocalTrade · Service Provider LTD</p>
  </div>
</body>
</html>`;
}

export default router;
