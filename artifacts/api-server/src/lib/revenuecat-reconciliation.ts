import { db } from "@workspace/db";
import {
  subscriptionsTable,
  traderProfilesTable,
  usersTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  listCustomerActiveEntitlements,
  listEntitlements,
} from "@replit/revenuecat-sdk";
import type { Logger } from "pino";
import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { getOrCreateRevenueCatId } from "./revenuecat-identity";
import { sendPushToUser } from "./push-notifications";
import { reconcileCompanySeats } from "./team-billing";
import { logAudit, TRADER_STATUS } from "./trader-status";

const REVENUECAT_ENTITLEMENT_ID =
  process.env.REVENUECAT_ENTITLEMENT_ID || "trader_subscription";
const REVENUECAT_PROJECT_ID = process.env.REVENUECAT_PROJECT_ID;
const RC_PLAN_ID = "premium";

interface RevenueCatActiveEntitlement {
  entitlement_id?: string;
  expires_at?: number | null;
  product_identifier?: string;
}

export type RevenueCatReconciliationResult =
  | { status: "not_configured" }
  | { status: "user_not_found" }
  | { status: "not_verified" }
  | { status: "provider_error" }
  | {
      status: "synced";
      active: boolean;
      productId: string | null;
      currentPeriodEnd?: string;
    };

type ReapprovalDependencies = {
  reconcile?: (
    userId: number,
    log: Pick<Logger, "error" | "warn">,
  ) => Promise<RevenueCatReconciliationResult>;
  notify?: typeof sendPushToUser;
};

/**
 * Complete the reconciliation and notification part of an approval after the
 * approval transaction has committed. The marker is deliberately absent on a
 * provider failure, so mounted clients only trigger their follow-up sync from
 * an already-converged server state.
 */
export async function reconcileApprovedTraderSubscription(
  userId: number,
  log: Pick<Logger, "error" | "warn">,
  dependencies: ReapprovalDependencies = {},
): Promise<RevenueCatReconciliationResult | null> {
  const reconcile = dependencies.reconcile ?? reconcileRevenueCatEntitlement;
  const notify = dependencies.notify ?? sendPushToUser;
  let outcome: RevenueCatReconciliationResult | null = null;
  try {
    outcome = await reconcile(userId, log);
    if (outcome.status !== "synced") {
      log.warn(
        { outcome: outcome.status, traderUserId: userId },
        "Post-approval RevenueCat reconciliation did not complete",
      );
    }
  } catch (error) {
    log.warn(
      { err: error, traderUserId: userId },
      "Post-approval RevenueCat reconciliation failed",
    );
  }

  await notify(userId, {
    title: "You're verified",
    body: "Your details have been verified. Your trader profile is now live in search.",
    data: {
      type: "verification_update",
      status: "VERIFIED",
      ...(outcome?.status === "synced" ? { subscriptionSync: true } : {}),
    },
  });
  return outcome;
}

function normalizeEntitlementKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Revoke Premium perks for a lapsed RevenueCat subscriber. Verification still
// controls listing visibility, so this intentionally never changes isActive.
export async function downgradeExpiredSubscription(userId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ plan: null })
      .where(eq(usersTable.id, userId));
    await tx
      .update(traderProfilesTable)
      .set({ plan: null, isFeatured: false, updatedAt: new Date() })
      .where(eq(traderProfilesTable.userId, userId));
    await tx
      .update(subscriptionsTable)
      .set({ status: "cancelled", cancelAtPeriodEnd: false, updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, userId));
  });
}

/**
 * Reconcile one trader's entitlement from RevenueCat using only their
 * server-owned canonical customer id. Both device-triggered syncs and an
 * admin reapproval call this path, so the verification check belongs here
 * rather than only at the HTTP boundary.
 */
export async function reconcileRevenueCatEntitlement(
  userId: number,
  log: Pick<Logger, "error" | "warn">,
  willRenew?: boolean,
): Promise<RevenueCatReconciliationResult> {
  if (!REVENUECAT_PROJECT_ID) return { status: "not_configured" };

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return { status: "user_not_found" };

  const [profile] = await db
    .select()
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.userId, userId))
    .limit(1);
  if (!profile || profile.verificationStatus !== TRADER_STATUS.VERIFIED) {
    return { status: "not_verified" };
  }

  // No caller may choose the RevenueCat identity. This preserves account
  // isolation for both the authenticated route and the admin-triggered path.
  const rcCustomerId = await getOrCreateRevenueCatId(userId);
  const wanted = normalizeEntitlementKey(REVENUECAT_ENTITLEMENT_ID);

  let activeEntitlements: RevenueCatActiveEntitlement[];
  let targetEntitlementId: string | null = null;
  let targetLookupKey: string | null = null;
  try {
    const client = await getUncachableRevenueCatClient();
    const { data: entlData } = await listEntitlements({
      client,
      path: { project_id: REVENUECAT_PROJECT_ID },
    });
    const target = (entlData?.items ?? []).find(
      (e) =>
        e.id === REVENUECAT_ENTITLEMENT_ID ||
        (!!e.lookup_key && normalizeEntitlementKey(e.lookup_key) === wanted) ||
        (!!e.display_name && normalizeEntitlementKey(e.display_name) === wanted),
    );
    targetEntitlementId = target?.id ?? null;
    targetLookupKey = target?.lookup_key ?? null;

    const { data, error } = await listCustomerActiveEntitlements({
      client,
      path: { project_id: REVENUECAT_PROJECT_ID, customer_id: rcCustomerId },
    });
    if (error) {
      log.error({ err: error }, "RevenueCat lookup failed");
      return { status: "provider_error" };
    }
    activeEntitlements = (data?.items ?? []) as RevenueCatActiveEntitlement[];
  } catch (error) {
    log.error({ err: error }, "RevenueCat request error");
    return { status: "provider_error" };
  }

  const entitlement = activeEntitlements.find((item) => {
    if (!item.entitlement_id) return false;
    if (targetEntitlementId && item.entitlement_id === targetEntitlementId) return true;
    const normalized = normalizeEntitlementKey(item.entitlement_id);
    if (targetLookupKey && normalized === normalizeEntitlementKey(targetLookupKey)) return true;
    return normalized === wanted;
  });
  const expiresAt = entitlement?.expires_at ? new Date(entitlement.expires_at) : null;

  if (!entitlement) {
    const [existing] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);
    if (existing?.status === "active") {
      await downgradeExpiredSubscription(userId);
      await reconcileCompanySeats(profile.id, "revenuecat-sync:no_active_entitlement").catch((error) =>
        log.error({ err: error }, "seat reconciliation after sync downgrade failed"),
      );
      await logAudit({
        userId,
        action: "SUBSCRIPTION_CANCELLED",
        details: { source: "revenuecat-sync", reason: "no_active_entitlement" },
      });
      void sendPushToUser(userId, {
        title: "Premium ended",
        body: "Your Premium subscription has ended. Your free Basic listing stays live.",
        data: { type: "subscription_update", status: "cancelled" },
      }).catch((error) => log.warn({ err: error }, "Failed to send subscription-ended push"));
    }
    return { status: "synced", active: false, productId: null };
  }

  const periodEnd = expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  let newlyActivated = false;
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);
    newlyActivated = !existing || existing.status !== "active";

    if (existing) {
      await tx
        .update(subscriptionsTable)
        .set({
          status: "active",
          planId: RC_PLAN_ID,
          // A repeated confirmation is not a new purchase. Keep the original
          // period start stable; only RevenueCat's authoritative period end may
          // move forward on renewal.
          currentPeriodStart: existing.currentPeriodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: willRenew !== undefined ? !willRenew : existing.cancelAtPeriodEnd,
          originalPurchaseAt: existing.originalPurchaseAt ?? new Date(),
          productIdentifier: entitlement.product_identifier ?? existing.productIdentifier ?? null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptionsTable.userId, userId));
    } else {
      await tx.insert(subscriptionsTable).values({
        userId,
        planId: RC_PLAN_ID,
        status: "active",
        currentPeriodStart: new Date(),
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: willRenew === false,
        originalPurchaseAt: new Date(),
        productIdentifier: entitlement.product_identifier ?? null,
      });
    }

    await tx.update(usersTable).set({ plan: RC_PLAN_ID }).where(eq(usersTable.id, userId));
    await tx
      .update(traderProfilesTable)
      .set({ plan: RC_PLAN_ID, isFeatured: true, updatedAt: new Date() })
      .where(eq(traderProfilesTable.userId, userId));
  });

  await reconcileCompanySeats(profile.id, "revenuecat-sync:grant").catch((error) =>
    log.error({ err: error }, "seat reconciliation after sync grant failed"),
  );
  if (newlyActivated) {
    // These are transition notifications/audits, not routine entitlement
    // confirmations. Reapproval can safely repeat this sync without
    // generating duplicate activation history.
    await logAudit({
      userId,
      action: "SUBSCRIPTION_ACTIVATED",
      details: { plan: RC_PLAN_ID, source: "revenuecat", productId: entitlement.product_identifier },
    });
    await logAudit({
      userId,
      action: "PROFILE_WENT_LIVE",
      details: { plan: RC_PLAN_ID, source: "revenuecat" },
    });
    void sendPushToUser(userId, {
      title: "Premium active",
      body: "Your Premium subscription is now active. Your premium perks are live.",
      data: { type: "subscription_update", status: "active" },
    }).catch((error) => log.warn({ err: error }, "Failed to send subscription-activated push"));
  }

  return {
    status: "synced",
    active: true,
    productId: entitlement.product_identifier ?? null,
    currentPeriodEnd: periodEnd.toISOString(),
  };
}