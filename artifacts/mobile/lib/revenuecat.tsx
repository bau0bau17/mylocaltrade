import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';
import {
  refreshTeamBillingQueries,
} from '@/lib/team-billing-queries';

/**
 * RevenueCat (Apple In-App Purchase) integration for the iOS app.
 *
 * Single entitlement model: one "Trader Subscription" entitlement granted by
 * either a Monthly or an Annual product. There are NO separate plan tiers —
 * Apple In-App Purchase via RevenueCat is the only billing system.
 *
 * react-native-purchases is a NATIVE module: it is not present in Expo Go nor on
 * web. Everything here degrades to a safe no-op when unsupported so the preview
 * build and Expo Go keep working. Real purchases require an EAS dev/production
 * build with the RevenueCat public SDK key set.
 */

export const TRADER_ENTITLEMENT_ID =
  process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID || 'trader_subscription';

export function isSubscriptionReconciliationNotification(
  data: unknown,
  userId: number | null | undefined,
): boolean {
  if (!data || typeof data !== 'object' || userId == null) return false;
  const payload = data as {
    type?: unknown;
    status?: unknown;
    subscriptionSync?: unknown;
    recipientUserId?: unknown;
  };
  return (
    payload.type === 'verification_update' &&
    payload.status === 'VERIFIED' &&
    payload.subscriptionSync === true &&
    String(payload.recipientUserId) === String(userId)
  );
}

const TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY ?? '';
const IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '';
const ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? '';

// Pick the right RevenueCat SDK key for this build:
//  - Debug builds (__DEV__, i.e. the EAS "development"/dev-client profile) use
//    the RevenueCat Test Store key so the full purchase + paywall flow can be
//    exercised without App Store / Play Store configuration.
//  - Release builds (preview / production) use the platform App Store / Play
//    Store key. The Test Store key (test_...) MUST NOT be used in a release
//    build: RevenueCat's native SDK deliberately raises a fatal error and
//    crashes the app on configure if a test_ key is seen in a Release build.
function resolvePlatformApiKey(): string {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return '';
  if (__DEV__ && TEST_API_KEY) return TEST_API_KEY;
  return Platform.OS === 'ios' ? IOS_API_KEY : ANDROID_API_KEY;
}

const platformApiKey = resolvePlatformApiKey();

// Diagnostics run in dev AND preview (both ship the Test Store key in their EAS
// env) but never in production (which omits the Test Store key). This lets us
// see RevenueCat's native logs and the resolved offering on a real preview
// device via Console.app / Xcode "Devices & Simulators" — release builds still
// emit console.* to the system log.
const DIAGNOSTICS_ENABLED = TEST_API_KEY.length > 0;

// RevenueCat enforces entitlement lookup keys case/punctuation-insensitively, so
// the identifier the SDK reports back may differ in casing/spacing from our
// configured id (e.g. a dashboard-created "Trader Subscription" vs
// "trader_subscription"). Normalise before comparing.
function normalizeEntitlementKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const TARGET_ENTITLEMENT_NORM = normalizeEntitlementKey(TRADER_ENTITLEMENT_ID);

/** Find the active trader entitlement regardless of key casing/spacing. */
function findActiveTraderEntitlement(
  info: CustomerInfo | null,
): PurchasesEntitlementInfo | null {
  if (!info) return null;
  const active = info.entitlements.active;
  if (active[TRADER_ENTITLEMENT_ID]) return active[TRADER_ENTITLEMENT_ID];
  for (const key of Object.keys(active)) {
    if (normalizeEntitlementKey(key) === TARGET_ENTITLEMENT_NORM) return active[key];
  }
  return null;
}

/**
 * True when this RevenueCat account has EVER held the trader entitlement
 * (active or not). Used to decide whether a no-active-entitlement state is a
 * lapsed subscription worth reporting to the backend (provider-confirmed
 * downgrade) vs. a user who never subscribed (no point pinging the server).
 */
function hadTraderEntitlement(info: CustomerInfo | null): boolean {
  if (!info) return false;
  const all = info.entitlements.all;
  if (all[TRADER_ENTITLEMENT_ID]) return true;
  for (const key of Object.keys(all)) {
    if (normalizeEntitlementKey(key) === TARGET_ENTITLEMENT_NORM) return true;
  }
  return false;
}

// getCustomerInfo()/purchase()/restore() each return a BRAND NEW CustomerInfo
// object every call (and the requestDate inside it changes every time). Setting
// state with each one re-renders all subscribers even when nothing meaningful
// changed, which can drive a render→refresh→setState loop in consumers. We
// compare a stable signature of the fields the app actually cares about so
// repeated identical refreshes become no-ops.
function customerInfoSignature(info: CustomerInfo | null): string {
  if (!info) return 'null';
  const active = info.entitlements.active;
  const ents = Object.keys(active)
    .sort()
    .map((k) => {
      const e = active[k];
      return `${k}:${e.productIdentifier}:${e.expirationDate ?? ''}:${e.isActive}:${e.willRenew}`;
    });
  return JSON.stringify({
    ents,
    subs: [...(info.activeSubscriptions ?? [])].sort(),
    products: [...(info.allPurchasedProductIdentifiers ?? [])].sort(),
    mgmt: info.managementURL ?? '',
  });
}

// getOfferings() likewise returns a fresh PurchasesOffering object every call.
// Same loop risk as customer info, so we set state only when the meaningful
// shape (offering id + each package's id/product/price) actually changes.
function offeringSignature(offering: PurchasesOffering | null): string {
  if (!offering) return 'null';
  return JSON.stringify({
    id: offering.identifier,
    pkgs: (offering.availablePackages ?? []).map(
      (p) => `${p.identifier}:${p.product.identifier}:${p.product.priceString}`,
    ),
  });
}

// Expo Go ships as the "storeClient" execution environment and has no native
// RevenueCat module. dev/production builds report "standalone" or "bare".
const isExpoGo = Constants.executionEnvironment === 'storeClient';

/**
 * Whether in-app purchases can run in this build. False on web, in Expo Go, or
 * when no platform API key is configured.
 */
export const isPurchasesSupported =
  (Platform.OS === 'ios' || Platform.OS === 'android') &&
  !isExpoGo &&
  platformApiKey.length > 0;

// Native module is loaded lazily so web/Expo Go bundles never evaluate it.
type PurchasesDefault = typeof import('react-native-purchases').default;
let purchases: PurchasesDefault | null = null;
let configurePromise: Promise<PurchasesDefault | null> | null = null;
const REVENUECAT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Native SDK calls do not expose cancellation. Bound every readiness request so
 * a stalled native bridge or network request becomes an explicit retryable
 * state instead of leaving a mounted subscription screen loading forever.
 */
async function withRevenueCatTimeout<T>(
  promise: Promise<T>,
  operation: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${operation} timed out. Please try again.`)),
          REVENUECAT_REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function ensureConfigured(): Promise<PurchasesDefault | null> {
  if (!isPurchasesSupported) return null;
  if (purchases) return purchases;
  if (!configurePromise) {
    configurePromise = (async () => {
      try {
        // Keep the native module inside the support guard. A deferred require
        // remains lazy in Metro (so web/Expo Go never evaluates it), while also
        // allowing Jest's normal native-module mock to exercise readiness.
        const mod = require('react-native-purchases') as typeof import('react-native-purchases');
        const P = mod.default;
        P.setLogLevel(
          DIAGNOSTICS_ENABLED ? mod.LOG_LEVEL.VERBOSE : mod.LOG_LEVEL.WARN,
        );
        // The native SDK logs a user dismissing the purchase sheet at ERROR
        // level ("Purchase was cancelled."), which the default log handler
        // routes to console.error and surfaces as a red LogBox in dev. A
        // cancellation is a normal user action, not a failure, so demote it.
        // Genuine errors are still reported as errors.
        P.setLogHandler((logLevel, message) => {
          const text = `[RevenueCat] ${message}`;
          // Match only the SDK's user-cancellation message, not any log that
          // happens to mention "cancel" (e.g. a real cancellation failure).
          if (/purchase was cancelled/i.test(message)) {
            if (DIAGNOSTICS_ENABLED) console.log(text);
            return;
          }
          if (logLevel === mod.LOG_LEVEL.ERROR) {
            console.error(text);
          } else if (logLevel === mod.LOG_LEVEL.WARN) {
            console.warn(text);
          } else if (DIAGNOSTICS_ENABLED) {
            console.log(text);
          }
        });
        if (DIAGNOSTICS_ENABLED) {
          console.log(
            `[RC] configure platform=${Platform.OS} __DEV__=${__DEV__} ` +
              `keyPrefix=${platformApiKey.slice(0, 5)} ` +
              `usingTestKey=${__DEV__ && TEST_API_KEY.length > 0}`,
          );
        }
        // The installed RevenueCat SDK declares configure() as synchronous; it
        // can still throw and is handled by this surrounding catch.
        P.configure({ apiKey: platformApiKey });
        purchases = P;
        return P;
      } catch (e) {
        console.warn('RevenueCat configure failed', e);
        // A timed-out configuration promise cannot be safely reused on Retry.
        // The native SDK may finish in the background, but the next foreground
        // attempt must run a fresh configuration/readiness cycle.
        configurePromise = null;
        return null;
      }
    })();
  }
  return configurePromise;
}

// react-native-purchases-ui (native paywall + customer center) is also a
// native-only module. Load it lazily and only after the core SDK is configured.
type PurchasesUIDefault = typeof import('react-native-purchases-ui').default;

async function ensurePurchasesUI(): Promise<PurchasesUIDefault | null> {
  const P = await ensureConfigured();
  if (!P) return null;
  try {
    const mod = await import('react-native-purchases-ui');
    return mod.default;
  } catch (e) {
    console.warn('RevenueCatUI load failed', e);
    return null;
  }
}

export type BackendSyncResult = {
  confirmed: boolean;
  active: boolean | null;
  productId: string | null;
};

export type SubscriptionActionResult = {
  /** The native RevenueCat SDK sees an active trader entitlement. */
  active: boolean;
  /** The API independently confirmed and refreshed server-owned plan state. */
  confirmed: boolean;
};

/**
 * The state of the current account's RevenueCat readiness cycle. `isReady`
 * means this cycle settled; consumers use this detail to distinguish a usable
 * offering from an empty or retryable failure state.
 */
export type RevenueCatReadinessState =
  | 'initializing'
  | 'ready'
  | 'offerings-empty'
  | 'offerings-error'
  | 'provider-error';

function defaultSyncRetryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, attempt * 250));
}

/**
 * Confirm the backend observed the same product as the native RevenueCat SDK.
 * A successful HTTP status alone is not enough: the provider API can briefly
 * return the previous product while a StoreKit plan switch propagates.
 */
export async function confirmBackendSubscriptionSync(
  expectedProductId: string | null,
  sync: () => Promise<BackendSyncResult>,
  wait: (attempt: number) => Promise<void> = defaultSyncRetryDelay,
): Promise<boolean> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await sync();
    const matches = expectedProductId
      ? result.confirmed && result.active === true && result.productId === expectedProductId
      : result.confirmed && result.active === false;
    if (matches) return true;
    if (attempt < maxAttempts) await wait(attempt);
  }
  return false;
}

async function syncEntitlementWithBackend(
  token: string | null,
  willRenew?: boolean,
): Promise<BackendSyncResult> {
  if (!token) return { confirmed: false, active: null, productId: null };
  try {
    const res = await fetch(`${getApiUrl()}/api/subscriptions/revenuecat-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // willRenew lets the server mirror an App Store cancellation into its
      // cancelAtPeriodEnd flag immediately, without waiting for the webhook.
      body: JSON.stringify(willRenew === undefined ? {} : { willRenew }),
    });
    if (!res.ok) {
      console.warn('RevenueCat backend sync was not accepted', res.status);
      return { confirmed: false, active: null, productId: null };
    }
    const body = (await res.json().catch(() => null)) as
      | { active?: unknown; productId?: unknown }
      | null;
    return {
      confirmed: body?.active === true || body?.active === false,
      active: typeof body?.active === 'boolean' ? body.active : null,
      productId: typeof body?.productId === 'string' ? body.productId : null,
    };
  } catch (e) {
    // The entitlement can still be valid on-device, but Team seats and
    // business authorization are server-owned. Callers surface a retry instead
    // of treating this as a confirmed server-side plan change.
    console.warn('RevenueCat backend sync failed', e);
    return { confirmed: false, active: null, productId: null };
  }
}

/**
 * Phase C Team packages — matched by their custom package identifiers in the
 * RevenueCat `default` offering (confirmed configuration):
 *   team_5_annual / team_10_annual / team_20_annual.
 * A package that is absent from the current offering (Test Store offering, a
 * stale cached offering from before the Team launch, or a partial rollout)
 * resolves to null and the UI simply omits that plan — never a crash and
 * never a hardcoded price. Seat ENFORCEMENT is server-side only: the backend
 * derives the seat limit from the purchased product identifier, so these
 * constants are display/purchase plumbing, not authorization.
 */
const TEAM_PACKAGE_IDS = {
  team5: 'team_5_annual',
  team10: 'team_10_annual',
  team20: 'team_20_annual',
} as const;

export type TeamTierKey = keyof typeof TEAM_PACKAGE_IDS;

function pickTeamPackage(
  offering: PurchasesOffering | null,
  tier: TeamTierKey,
): PurchasesPackage | null {
  if (!offering) return null;
  return (
    offering.availablePackages.find(
      (p) => p.identifier === TEAM_PACKAGE_IDS[tier],
    ) ?? null
  );
}

/**
 * EXACT known Team product ids, for when the offering isn't loaded: the three
 * confirmed App Store Connect products plus the dev Test Store ids (the Test
 * Store key never ships in a Release build, so the bare ids are unambiguous).
 * Anything else — team50, team15, suffixed variants — resolves to null and
 * the UI falls back to the generic "Premium" label: display fails CLOSED,
 * mirroring the server's seat resolver.
 */
const KNOWN_TEAM_PRODUCT_TIERS: Record<string, TeamTierKey> = {
  'com.mylocaltrade.app.trader.team5.yearly': 'team5',
  'com.mylocaltrade.app.trader.team10.yearly': 'team10',
  'com.mylocaltrade.app.trader.team20.yearly': 'team20',
  team5: 'team5',
  team10: 'team10',
  team20: 'team20',
};

/**
 * Which Team tier (if any) the active product belongs to — for DISPLAY labels
 * only (the server derives real seat limits from the product id itself).
 * Matches the current offering's team packages first, then EXACT known ids.
 * Never guesses from id shape: unknown products must not borrow a tier label.
 */
export function resolveTeamTier(
  productId: string | null,
  offering: PurchasesOffering | null,
): TeamTierKey | null {
  if (!productId) return null;
  for (const tier of ['team20', 'team10', 'team5'] as const) {
    const pkg = pickTeamPackage(offering, tier);
    if (pkg && productId === pkg.product.identifier) return tier;
  }
  return KNOWN_TEAM_PRODUCT_TIERS[productId] ?? null;
}

function pickPackage(
  offering: PurchasesOffering | null,
  preferred: 'monthly' | 'annual',
): PurchasesPackage | null {
  if (!offering) return null;
  if (preferred === 'monthly') {
    return (
      offering.monthly ??
      offering.availablePackages.find((p) => p.packageType === 'MONTHLY') ??
      null
    );
  }
  return (
    offering.annual ??
    offering.availablePackages.find((p) => p.packageType === 'ANNUAL') ??
    null
  );
}

/**
 * Work out whether the active subscription is billed monthly or yearly. The
 * backend only stores a single "premium" plan id, so the cadence (used for the
 * exact "Premium Monthly" / "Premium Yearly" label) is derived here from the
 * active store product. We match the active product id against the current
 * offering's packages first, then fall back to a heuristic on the product id
 * for products that aren't in the current offering (e.g. a legacy purchase).
 */
function resolveCadence(
  productId: string | null,
  offering: PurchasesOffering | null,
): 'monthly' | 'annual' | null {
  if (!productId) return null;
  const monthly = pickPackage(offering, 'monthly');
  const annual = pickPackage(offering, 'annual');
  if (annual && productId === annual.product.identifier) return 'annual';
  if (monthly && productId === monthly.product.identifier) return 'monthly';
  // Every Team plan is annual (there are no monthly Team products).
  if (resolveTeamTier(productId, offering)) return 'annual';
  const p = productId.toLowerCase();
  if (/year|annual|yr|12m/.test(p)) return 'annual';
  if (/month|monthly|1m/.test(p)) return 'monthly';
  return null;
}

interface SubscriptionContextValue {
  /** True when IAP can run (native build with API key). */
  isSupported: boolean;
  /** True once the current RevenueCat identity cycle has reached a terminal state. */
  isReady: boolean;
  /** True only while the current identity's offerings/customer-info cycle runs. */
  isLoading: boolean;
  /** Detailed terminal/loading state for plan-selection UI. */
  offeringsState: RevenueCatReadinessState;
  /** Safe user-facing message for an offerings or provider readiness failure. */
  offeringsError: string | null;
  /** True while RevenueCat changes from one canonical app identity to another. */
  isIdentityTransitioning: boolean;
  monthlyPackage: PurchasesPackage | null;
  annualPackage: PurchasesPackage | null;
  /**
   * Team packages from the active offering (live StoreKit prices). Null when
   * the offering doesn't carry that package — the UI must omit the plan, not
   * invent one.
   */
  team5Package: PurchasesPackage | null;
  team10Package: PurchasesPackage | null;
  team20Package: PurchasesPackage | null;
  /** Team tier of the ACTIVE subscription, for display labels only. */
  activeTeamTier: TeamTierKey | null;
  /** True when the trader entitlement is currently active on this device. */
  hasTraderSubscription: boolean;
  /** Store identifier of the active subscription product, if any. */
  activeProductId: string | null;
  /** Billing cadence of the active subscription, if determinable. */
  activeCadence: 'monthly' | 'annual' | null;
  /** ISO expiry date of the active entitlement, if known. */
  expiresAt: string | null;
  /**
   * Auto-renew state of the active subscription: false = cancelled but still
   * active until expiry; true = renewing; null = no active subscription (or
   * unknown, e.g. unsupported build).
   */
  willRenew: boolean | null;
  refresh: () => Promise<void>;
  /** True while the app confirms a provider change with the API and Team queries. */
  isServerStateUpdating: boolean;
  /** Safe user-facing message when confirmation could not be completed. */
  serverStateError: string | null;
  /** Re-read RevenueCat, retry the backend sync, and refresh server-owned Team data. */
  retryServerState: () => Promise<boolean>;
  /** Native entitlement plus backend confirmation after a purchase. */
  purchase: (pkg: PurchasesPackage) => Promise<SubscriptionActionResult>;
  /** Native entitlement plus backend confirmation after a restore. */
  restore: () => Promise<SubscriptionActionResult>;
  manageSubscriptions: () => Promise<void>;
  /**
   * Present the native RevenueCat Paywall for the current offering. Resolves to
   * true if the trader entitlement is active once the paywall is dismissed.
   */
  presentPaywall: () => Promise<SubscriptionActionResult>;
  /** Present the native RevenueCat Customer Center (manage/cancel/refund). */
  presentCustomerCenter: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(
  undefined,
);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const [offeringsState, setOfferingsState] = useState<RevenueCatReadinessState>(
    isPurchasesSupported ? 'initializing' : 'ready',
  );
  const [offeringsError, setOfferingsError] = useState<string | null>(null);
  const [isIdentityTransitioning, setIsIdentityTransitioning] = useState(false);
  const [isServerStateUpdating, setIsServerStateUpdating] = useState(false);
  const [serverStateError, setServerStateError] = useState<string | null>(null);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const lastUserIdRef = useRef<string | null>(null);
  // Every identity transition gets a generation. Async native SDK calls from a
  // prior account must not overwrite the new account's provider state.
  const identityGenerationRef = useRef(0);
  // A Retry can start another read for the same account. Only the most recent
  // current-generation cycle may settle the shared provider state.
  const readinessCycleRef = useRef(0);
  // Retry and offer-dependent actions wait for a canonical logIn/logOut to
  // finish; they must never read or purchase against the prior SDK account.
  const identityTransitionPromiseRef = useRef<Promise<void> | null>(null);
  const lastInfoSigRef = useRef<string | undefined>(undefined);
  // Once-per-session guard for the "former subscriber, no active entitlement"
  // sync below: without it every foreground refresh of an already-downgraded
  // ex-subscriber would trigger a server-side RevenueCat API call. Reset
  // whenever an active entitlement is seen so a mid-session expiry still syncs.
  const syncedInactiveRef = useRef(false);
  const lastOfferingSigRef = useRef<string | undefined>(undefined);

  const applyCustomerInfo = useCallback((info: CustomerInfo | null) => {
    // Skip redundant updates: RevenueCat returns a fresh object on every fetch,
    // so without this guard an identical refresh still re-renders subscribers
    // and can spin a render→refresh→setState loop.
    const sig = customerInfoSignature(info);
    if (sig === lastInfoSigRef.current) return;
    lastInfoSigRef.current = sig;
    setCustomerInfo(info);
  }, []);

  const applyCustomerInfoIfCurrent = useCallback(
    (info: CustomerInfo | null, identityGeneration: number): boolean => {
      if (identityGeneration !== identityGenerationRef.current) return false;
      applyCustomerInfo(info);
      return true;
    },
    [applyCustomerInfo],
  );

  /**
   * Identity changes can chain (A → B → C) while an earlier caller is waiting.
   * Keep waiting until the latest transition has settled, not just the promise
   * that happened to be current when the caller started.
   */
  const waitForIdentityTransition = useCallback(async (): Promise<void> => {
    while (identityTransitionPromiseRef.current) {
      await identityTransitionPromiseRef.current;
    }
  }, []);

  /**
   * Confirms an App Store change with our API, then refreshes every piece of
   * server-owned billing/Team state that a mounted screen can show. RevenueCat
   * entitlement data is never used to grant seats locally; it only tells us
   * when to ask the backend to derive the authoritative allowance.
   */
  const refreshServerState = useCallback(
    async (
      providedInfo?: CustomerInfo | null,
      {
        forceSync = false,
        identityGeneration: requestedGeneration,
      }: { forceSync?: boolean; identityGeneration?: number } = {},
    ): Promise<boolean> => {
      await waitForIdentityTransition();
      if (!token || user?.id == null) return false;
      const requestGeneration = requestedGeneration ?? identityGenerationRef.current;
      if (requestGeneration !== identityGenerationRef.current) return false;

      let beganServerUpdate = false;
      try {
        let info = providedInfo ?? null;
        if (!info) {
          const P = await withRevenueCatTimeout(
            ensureConfigured(),
            'RevenueCat setup',
          );
          if (!P) return false;
          try {
            info = await withRevenueCatTimeout(
              P.getCustomerInfo(),
              'RevenueCat customer information',
            );
            if (!applyCustomerInfoIfCurrent(info, requestGeneration)) return false;
          } catch (e) {
            console.warn('RevenueCat confirmation refresh failed', e);
            if (requestGeneration === identityGenerationRef.current) {
              setServerStateError('We could not confirm your latest plan. Please try again.');
            }
            return false;
          }
        }

        const entitlement = findActiveTraderEntitlement(info);
        const syncInactive = hadTraderEntitlement(info) && !syncedInactiveRef.current;
        if (!entitlement && !syncInactive && !forceSync) return true;

        if (entitlement) syncedInactiveRef.current = false;
        beganServerUpdate = true;
        setIsServerStateUpdating(true);

        const confirmed = await withRevenueCatTimeout(
          confirmBackendSubscriptionSync(
            entitlement?.productIdentifier ?? null,
            () => syncEntitlementWithBackend(token, entitlement?.willRenew),
          ),
          'Plan confirmation',
        );
        if (requestGeneration !== identityGenerationRef.current) return false;
        if (confirmed) {
          if (!entitlement) syncedInactiveRef.current = true;
          try {
            await withRevenueCatTimeout(
              refreshTeamBillingQueries(queryClient, user.id),
              'Team seat refresh',
            );
          } catch (error) {
            console.warn('RevenueCat Team query refresh failed', error);
            if (requestGeneration === identityGenerationRef.current) {
              setServerStateError(
                'Your plan was confirmed, but we could not refresh your Team seats. Please try again.',
              );
            }
            return false;
          }
          if (requestGeneration !== identityGenerationRef.current) return false;
          // Keep a previous warning visible while a recovery is in-flight. It is
          // cleared only once RevenueCat, the server, and server-owned Team
          // queries all agree on the new state.
          setServerStateError(null);
          return true;
        }

        setServerStateError(
          'We could not confirm your latest plan. Your previous Team seats are still shown.',
        );
        return false;
      } catch (error) {
        console.warn('RevenueCat server-state refresh failed', error);
        if (requestGeneration === identityGenerationRef.current) {
          setServerStateError('We could not confirm your latest plan. Please try again.');
        }
        return false;
      } finally {
        if (beganServerUpdate && requestGeneration === identityGenerationRef.current) {
          setIsServerStateUpdating(false);
        }
      }
    },
    [
      applyCustomerInfoIfCurrent,
      queryClient,
      token,
      user?.id,
      waitForIdentityTransition,
    ],
  );

  const beginReadinessCycle = useCallback(
    (identityGeneration: number, identityTransition: boolean): number => {
      const cycle = ++readinessCycleRef.current;
      if (identityGeneration === identityGenerationRef.current) {
        setOfferingsState('initializing');
        setOfferingsError(null);
        setIsIdentityTransitioning(identityTransition);
      }
      return cycle;
    },
    [],
  );

  const settleReadinessCycle = useCallback(
    (
      identityGeneration: number,
      cycle: number,
      state: Exclude<RevenueCatReadinessState, 'initializing'>,
      error: string | null,
    ): boolean => {
      if (
        identityGeneration !== identityGenerationRef.current ||
        cycle !== readinessCycleRef.current
      ) {
        return false;
      }
      setOfferingsState(state);
      setOfferingsError(error);
      setIsIdentityTransitioning(false);
      return true;
    },
    [],
  );

  /**
   * Read the current identity's offering and customer info as one bounded,
   * generation-owned cycle. A stale cycle never settles shared state: its
   * successor has already begun and is responsible for the terminal state.
   */
  const runReadinessCycle = useCallback(
    async (
      identityGeneration: number,
      cycle: number,
      providedInfo?: CustomerInfo | null,
      isCancelled: () => boolean = () => false,
    ): Promise<void> => {
      const isCurrent = () =>
        !isCancelled() &&
        identityGeneration === identityGenerationRef.current &&
        cycle === readinessCycleRef.current;
      const settle = (
        state: Exclude<RevenueCatReadinessState, 'initializing'>,
        error: string | null,
      ) => settleReadinessCycle(identityGeneration, cycle, state, error);

      try {
        const P = await withRevenueCatTimeout(
          ensureConfigured(),
          'RevenueCat setup',
        );
        if (!isCurrent()) return;
        if (!P) {
          settle(
            'provider-error',
            'Subscription services are temporarily unavailable. Please retry.',
          );
          return;
        }

        let offerings;
        try {
          offerings = await withRevenueCatTimeout(
            P.getOfferings(),
            'Subscription options',
          );
        } catch (error) {
          console.warn('RevenueCat getOfferings failed', error);
          if (isCurrent()) {
            settle(
              'offerings-error',
              'We could not load subscription options. Please retry.',
            );
          }
          return;
        }
        if (!isCurrent()) return;

        if (DIAGNOSTICS_ENABLED) {
          const currentOffering = offerings.current;
          console.log(
            '[RC] getOfferings ->',
            JSON.stringify({
              allOfferingIds: Object.keys(offerings.all ?? {}),
              currentId: currentOffering?.identifier ?? null,
              currentPackageCount: currentOffering?.availablePackages?.length ?? 0,
              hasMonthlyShortcut: !!currentOffering?.monthly,
              hasAnnualShortcut: !!currentOffering?.annual,
              packages: (currentOffering?.availablePackages ?? []).map((p) => ({
                packageId: p.identifier,
                packageType: p.packageType,
                productId: p.product.identifier,
                priceString: p.product.priceString,
              })),
            }),
          );
        }
        const nextOffering = offerings.current ?? null;
        const offeringSig = offeringSignature(nextOffering);
        if (offeringSig !== lastOfferingSigRef.current) {
          lastOfferingSigRef.current = offeringSig;
          setOffering(nextOffering);
        }

        let info = providedInfo ?? null;
        if (!info) {
          try {
            info = await withRevenueCatTimeout(
              P.getCustomerInfo(),
              'RevenueCat customer information',
            );
          } catch (error) {
            console.warn('RevenueCat customer-info readiness failed', error);
            if (isCurrent()) {
              settle(
                'provider-error',
                'We could not refresh your subscription. Please retry.',
              );
            }
            return;
          }
        }
        if (!isCurrent() || !applyCustomerInfoIfCurrent(info, identityGeneration)) return;

        const hasPackages = (nextOffering?.availablePackages?.length ?? 0) > 0;
        if (!settle(hasPackages ? 'ready' : 'offerings-empty', null)) return;

        // Server reconciliation remains authoritative for seats, but it must
        // never hold the plan selector hostage. It has its own visible pending
        // or retry state while this successfully-read offering stays usable.
        void refreshServerState(info, { identityGeneration });
      } catch (error) {
        console.warn('RevenueCat readiness cycle failed', error);
        if (isCurrent()) {
          settle(
            'provider-error',
            'Subscription services are temporarily unavailable. Please retry.',
          );
        }
      }
    },
    [applyCustomerInfoIfCurrent, refreshServerState, settleReadinessCycle],
  );

  // Configure and read the initially active (anonymous or already signed-in)
  // RevenueCat identity. If identity setup advances the generation while this
  // is pending, that newer cycle owns terminal readiness.
  useEffect(() => {
    if (!isPurchasesSupported) return;
    let cancelled = false;
    const identityGeneration = identityGenerationRef.current;
    const cycle = beginReadinessCycle(identityGeneration, false);
    void runReadinessCycle(identityGeneration, cycle, undefined, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [beginReadinessCycle, runReadinessCycle]);

  // Identify the RevenueCat user with the CANONICAL app user id so the server
  // can verify the same subscriber. The id is an opaque server-generated
  // token ("rc_..."), received only from authenticated responses — never the
  // numeric user id, and never constructed on the device. Runs whenever the
  // signed-in user changes. A signed-in user without the id (stale cached
  // profile from an older app version) stays anonymous until /auth/me
  // refreshes the profile; purchases are blocked by ensureIdentified below.
  useEffect(() => {
    if (!isPurchasesSupported) return;
    const appUserId = user?.revenuecatId ?? null;
    if (appUserId === lastUserIdRef.current) return;
    lastUserIdRef.current = appUserId;
    const identityGeneration = ++identityGenerationRef.current;
    const cycle = beginReadinessCycle(identityGeneration, true);
    let cancelled = false;
    // Do not expose prior account state while the new SDK identity resolves.
    syncedInactiveRef.current = false;
    lastInfoSigRef.current = undefined;
    lastOfferingSigRef.current = undefined;
    setCustomerInfo(null);
    setOffering(null);
    setServerStateError(null);
    setIsServerStateUpdating(false);
    // Native logIn/logOut cannot be cancelled. Keep a serialization barrier
    // until the actual SDK call settles even if the UI-facing 15s timeout
    // fires, otherwise a late old-account completion could corrupt a Retry.
    const priorIdentityTransition = identityTransitionPromiseRef.current;
    const nativeIdentityOperation = (async () => {
      if (priorIdentityTransition) await priorIdentityTransition;
      if (identityGeneration !== identityGenerationRef.current) {
        return { status: 'stale' as const };
      }
      const P = await withRevenueCatTimeout(
        ensureConfigured(),
        'RevenueCat setup',
      );
      if (!P) return { status: 'unavailable' as const };
      if (appUserId) {
        const result = await P.logIn(appUserId);
        return { status: 'ready' as const, info: result.customerInfo };
      }
      const info = await P.logOut();
      return { status: 'ready' as const, info };
    })();
    const identityBarrier = nativeIdentityOperation.then(
      () => undefined,
      () => undefined,
    );
    identityTransitionPromiseRef.current = identityBarrier;
    void identityBarrier.finally(() => {
      if (identityTransitionPromiseRef.current === identityBarrier) {
        identityTransitionPromiseRef.current = null;
      }
    });

    const transition = (async () => {
      try {
        const result = await withRevenueCatTimeout(
          nativeIdentityOperation,
          'RevenueCat account setup',
        );
        if (
          cancelled ||
          identityGeneration !== identityGenerationRef.current ||
          result.status === 'stale'
        ) {
          return;
        }
        if (result.status === 'unavailable') {
          settleReadinessCycle(
            identityGeneration,
            cycle,
            'provider-error',
            'Subscription services are temporarily unavailable. Please retry.',
          );
          return;
        }

        const info = result.info;
        if (cancelled || identityGeneration !== identityGenerationRef.current) return;
        if (!applyCustomerInfoIfCurrent(info, identityGeneration)) return;
        await runReadinessCycle(
          identityGeneration,
          cycle,
          info,
          () => cancelled,
        );
      } catch (e) {
        console.warn('RevenueCat identity change failed', e);
        if (!cancelled) {
          settleReadinessCycle(
            identityGeneration,
            cycle,
            'provider-error',
            'We could not switch subscription accounts. Please retry.',
          );
        }
      }
    })();
    void transition;
    return () => {
      cancelled = true;
    };
  }, [
    user?.revenuecatId,
    applyCustomerInfoIfCurrent,
    beginReadinessCycle,
    runReadinessCycle,
    settleReadinessCycle,
  ]);

  const refresh = useCallback(async () => {
    if (!isPurchasesSupported) return;
    await waitForIdentityTransition();
    const identityGeneration = identityGenerationRef.current;
    const cycle = beginReadinessCycle(identityGeneration, false);
    await runReadinessCycle(identityGeneration, cycle);
  }, [beginReadinessCycle, runReadinessCycle, waitForIdentityTransition]);

  // Refresh entitlement state whenever the app returns to the foreground —
  // e.g. after the user cancels or changes the subscription in the App Store
  // app / management sheet. Event-driven (no polling): the signature guard in
  // applyCustomerInfo makes identical refreshes no-ops.
  useEffect(() => {
    if (!isPurchasesSupported) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const identityGeneration = identityGenerationRef.current;
        void refreshServerState(undefined, { identityGeneration });
      }
    });
    return () => sub.remove();
  }, [refreshServerState]);

  // Reapproval can happen while the trader is already using the app. The
  // server has reconciled the entitlement, but this mounted provider still
  // owns a previous "unconfirmed" warning until it re-checks RevenueCat and
  // refreshes server-owned Team queries. Only accept the centrally-bound push
  // for the current account; stale device notifications must not trigger work.
  useEffect(() => {
    if (!isPurchasesSupported || Platform.OS === 'web' || user?.id == null) return;
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      if (
        !isSubscriptionReconciliationNotification(
          notification.request.content.data,
          user.id,
        )
      ) {
        return;
      }
      void refreshServerState(undefined, {
        forceSync: true,
        identityGeneration: identityGenerationRef.current,
      });
    });
    return () => sub.remove();
  }, [refreshServerState, user?.id]);

  // Guarantee the RevenueCat customer is our signed-in user before a purchase
  // or restore. configure() starts anonymous and the identity effect above may
  // not have completed yet; without this a purchase can land on an
  // $RCAnonymousID, so the server sync and the webhook (both keyed on the
  // canonical server-issued id) never see it and the purchase is orphaned.
  // Throws if the identity can't be set, so we never make an anonymous
  // (unattributable) purchase.
  const ensureIdentified = useCallback(
    async (P: PurchasesDefault, identityGeneration: number): Promise<void> => {
      if (identityGeneration !== identityGenerationRef.current) {
        throw new Error('Your account changed. Please try again.');
      }
      if (!user) throw new Error('You need to be signed in to manage your subscription.');
      const wantedId = user.revenuecatId;
      if (!wantedId) {
        // Server hasn't supplied the canonical id yet (stale cached profile).
        // Never fall back to a locally constructed id.
        throw new Error(
          'Your account is still syncing. Please try again in a moment, or sign out and back in.',
        );
      }
      const currentId = await P.getAppUserID();
      if (identityGeneration !== identityGenerationRef.current) {
        throw new Error('Your account changed. Please try again.');
      }
      if (currentId === wantedId) return;
      const { customerInfo: info } = await P.logIn(wantedId);
      if (!applyCustomerInfoIfCurrent(info, identityGeneration)) {
        throw new Error('Your account changed. Please try again.');
      }
    },
    [user, applyCustomerInfoIfCurrent],
  );

  const purchase = useCallback(
    async (pkg: PurchasesPackage): Promise<SubscriptionActionResult> => {
      await waitForIdentityTransition();
      const identityGeneration = identityGenerationRef.current;
      const P = await ensureConfigured();
      if (!P) throw new Error('In-app purchases are not available in this build.');
      await ensureIdentified(P, identityGeneration);
      const { customerInfo: info } = await P.purchasePackage(pkg);
      if (!applyCustomerInfoIfCurrent(info, identityGeneration)) {
        return { active: false, confirmed: false };
      }
      const ent = findActiveTraderEntitlement(info);
      const confirmed = ent
        ? await refreshServerState(info, { forceSync: true, identityGeneration })
        : false;
      return { active: !!ent, confirmed };
    },
    [
      applyCustomerInfoIfCurrent,
      ensureIdentified,
      refreshServerState,
      waitForIdentityTransition,
    ],
  );

  const restore = useCallback(async (): Promise<SubscriptionActionResult> => {
    await waitForIdentityTransition();
    const identityGeneration = identityGenerationRef.current;
    const P = await ensureConfigured();
    if (!P) throw new Error('In-app purchases are not available in this build.');
    await ensureIdentified(P, identityGeneration);
    const info = await P.restorePurchases();
    if (!applyCustomerInfoIfCurrent(info, identityGeneration)) {
      return { active: false, confirmed: false };
    }
    const ent = findActiveTraderEntitlement(info);
    let confirmed = false;
    if (ent) {
      syncedInactiveRef.current = false;
      confirmed = await refreshServerState(info, { forceSync: true, identityGeneration });
    } else if (hadTraderEntitlement(info)) {
      // Explicit user action: always let the server re-verify and downgrade
      // a lapsed subscription, even if the session guard already fired.
      confirmed = await refreshServerState(info, { forceSync: true, identityGeneration });
    }
    return { active: !!ent, confirmed };
  }, [
    applyCustomerInfoIfCurrent,
    ensureIdentified,
    refreshServerState,
    waitForIdentityTransition,
  ]);

  const manageSubscriptions = useCallback(async () => {
    await waitForIdentityTransition();
    const identityGeneration = identityGenerationRef.current;
    const P = await ensureConfigured();
    if (!P || identityGeneration !== identityGenerationRef.current) return;
    try {
      await P.showManageSubscriptions();
      // The user may have cancelled or changed their plan in the App Store
      // sheet — re-read customer info as soon as it closes (this also syncs
      // the fresh willRenew state to the backend).
      await refreshServerState(undefined, { identityGeneration });
    } catch (e) {
      console.warn('RevenueCat showManageSubscriptions failed', e);
    }
  }, [refreshServerState, waitForIdentityTransition]);

  const presentPaywall = useCallback(async (): Promise<SubscriptionActionResult> => {
    await waitForIdentityTransition();
    const identityGeneration = identityGenerationRef.current;
    const UI = await ensurePurchasesUI();
    if (!UI) throw new Error('In-app purchases are not available in this build.');
    if (identityGeneration !== identityGenerationRef.current) {
      return { active: false, confirmed: false };
    }
    // Present the current offering's paywall (falls back to the SDK default if
    // no offering is loaded). The result enum is informational; the customer
    // info re-read below is the source of truth for entitlement state.
    await UI.presentPaywall(offering ? { offering } : {});
    const P = await ensureConfigured();
    let active = false;
    let confirmed = false;
    if (P) {
      const info = await P.getCustomerInfo();
      if (!applyCustomerInfoIfCurrent(info, identityGeneration)) {
        return { active: false, confirmed: false };
      }
      const ent = findActiveTraderEntitlement(info);
      active = !!ent;
      if (ent) {
        confirmed = await refreshServerState(info, { forceSync: true, identityGeneration });
      }
    }
    return { active, confirmed };
  }, [
    offering,
    applyCustomerInfoIfCurrent,
    refreshServerState,
    waitForIdentityTransition,
  ]);

  const presentCustomerCenter = useCallback(async (): Promise<void> => {
    await waitForIdentityTransition();
    const identityGeneration = identityGenerationRef.current;
    const UI = await ensurePurchasesUI();
    if (!UI || identityGeneration !== identityGenerationRef.current) return;
    try {
      await UI.presentCustomerCenter();
      // The user may have cancelled/refunded inside the Customer Center.
      await refreshServerState(undefined, { identityGeneration });
    } catch (e) {
      console.warn('RevenueCat presentCustomerCenter failed', e);
    }
  }, [refreshServerState, waitForIdentityTransition]);

  const activeEntitlement = findActiveTraderEntitlement(customerInfo);
  const isReady = offeringsState !== 'initializing';
  const isLoading = offeringsState === 'initializing';

  // Memoize so the context value only changes when its inputs actually change.
  // Without this the object is rebuilt every render, and any consumer that
  // depends on the whole `subscription` object in effect deps would re-run on
  // every render (a classic infinite-loop footgun).
  const value: SubscriptionContextValue = useMemo(
    () => ({
      isSupported: isPurchasesSupported,
      isReady,
      isLoading,
      offeringsState,
      offeringsError,
      isIdentityTransitioning,
      monthlyPackage: pickPackage(offering, 'monthly'),
      annualPackage: pickPackage(offering, 'annual'),
      team5Package: pickTeamPackage(offering, 'team5'),
      team10Package: pickTeamPackage(offering, 'team10'),
      team20Package: pickTeamPackage(offering, 'team20'),
      activeTeamTier: resolveTeamTier(
        activeEntitlement?.productIdentifier ?? null,
        offering,
      ),
      hasTraderSubscription: !!activeEntitlement,
      activeProductId: activeEntitlement?.productIdentifier ?? null,
      activeCadence: resolveCadence(
        activeEntitlement?.productIdentifier ?? null,
        offering,
      ),
      expiresAt: activeEntitlement?.expirationDate ?? null,
      willRenew: activeEntitlement ? activeEntitlement.willRenew : null,
      refresh,
      isServerStateUpdating,
      serverStateError,
      retryServerState: refreshServerState,
      purchase,
      restore,
      manageSubscriptions,
      presentPaywall,
      presentCustomerCenter,
    }),
    [
      isReady,
      isLoading,
      offeringsState,
      offeringsError,
      isIdentityTransitioning,
      isServerStateUpdating,
      serverStateError,
      offering,
      activeEntitlement,
      refresh,
      refreshServerState,
      purchase,
      restore,
      manageSubscriptions,
      presentPaywall,
      presentCustomerCenter,
    ],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (ctx === undefined) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return ctx;
}

/** True when a purchase error is the user dismissing the Apple sheet. */
export function isUserCancelledError(err: unknown): boolean {
  return !!(
    err &&
    typeof err === 'object' &&
    'userCancelled' in err &&
    (err as { userCancelled?: boolean }).userCancelled === true
  );
}
