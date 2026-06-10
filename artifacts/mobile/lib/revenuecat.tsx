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
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

/**
 * RevenueCat (Apple In-App Purchase) integration for the iOS app.
 *
 * Single entitlement model: one "Trader Subscription" entitlement granted by
 * either a Monthly or an Annual product. There are NO separate plan tiers
 * in the iOS app — that tiered model only exists on the web (Stripe) side.
 *
 * react-native-purchases is a NATIVE module: it is not present in Expo Go nor on
 * web. Everything here degrades to a safe no-op when unsupported so the preview
 * build and Expo Go keep working. Real purchases require an EAS dev/production
 * build with the RevenueCat public SDK key set.
 */

export const TRADER_ENTITLEMENT_ID =
  process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID || 'trader_subscription';

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

async function ensureConfigured(): Promise<PurchasesDefault | null> {
  if (!isPurchasesSupported) return null;
  if (purchases) return purchases;
  if (!configurePromise) {
    configurePromise = (async () => {
      try {
        const mod = await import('react-native-purchases');
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
        await P.configure({ apiKey: platformApiKey });
        purchases = P;
        return P;
      } catch (e) {
        console.warn('RevenueCat configure failed', e);
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

async function syncEntitlementWithBackend(token: string | null): Promise<void> {
  if (!token) return;
  try {
    await fetch(`${getApiUrl()}/api/subscriptions/revenuecat-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (e) {
    // Best-effort: the entitlement is still valid on the device even if the
    // server sync fails; the next refresh/restore will retry.
    console.warn('RevenueCat backend sync failed', e);
  }
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

interface SubscriptionContextValue {
  /** True when IAP can run (native build with API key). */
  isSupported: boolean;
  /** Provider finished its first configure + fetch. */
  isReady: boolean;
  isLoading: boolean;
  monthlyPackage: PurchasesPackage | null;
  annualPackage: PurchasesPackage | null;
  /** True when the trader entitlement is currently active on this device. */
  hasTraderSubscription: boolean;
  /** Store identifier of the active subscription product, if any. */
  activeProductId: string | null;
  /** ISO expiry date of the active entitlement, if known. */
  expiresAt: string | null;
  refresh: () => Promise<void>;
  /** Returns true if the entitlement is active after the purchase. */
  purchase: (pkg: PurchasesPackage) => Promise<boolean>;
  restore: () => Promise<boolean>;
  manageSubscriptions: () => Promise<void>;
  /**
   * Present the native RevenueCat Paywall for the current offering. Resolves to
   * true if the trader entitlement is active once the paywall is dismissed.
   */
  presentPaywall: () => Promise<boolean>;
  /** Present the native RevenueCat Customer Center (manage/cancel/refund). */
  presentCustomerCenter: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(
  undefined,
);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const [isReady, setIsReady] = useState(!isPurchasesSupported);
  const [isLoading, setIsLoading] = useState(false);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const lastUserIdRef = useRef<string | null>(null);
  const lastInfoSigRef = useRef<string | undefined>(undefined);
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

  const loadOfferings = useCallback(async () => {
    const P = await ensureConfigured();
    if (!P) return;
    try {
      const offerings = await P.getOfferings();
      if (DIAGNOSTICS_ENABLED) {
        const cur = offerings.current;
        console.log(
          '[RC] getOfferings ->',
          JSON.stringify({
            allOfferingIds: Object.keys(offerings.all ?? {}),
            currentId: cur?.identifier ?? null,
            currentPackageCount: cur?.availablePackages?.length ?? 0,
            hasMonthlyShortcut: !!cur?.monthly,
            hasAnnualShortcut: !!cur?.annual,
            packages: (cur?.availablePackages ?? []).map((p) => ({
              packageId: p.identifier,
              packageType: p.packageType,
              productId: p.product.identifier,
              priceString: p.product.priceString,
            })),
          }),
        );
      }
      const next = offerings.current ?? null;
      // Skip redundant updates (see offeringSignature): an identical re-fetch
      // must not change state, or it re-renders subscribers and can spin a loop.
      const sig = offeringSignature(next);
      if (sig !== lastOfferingSigRef.current) {
        lastOfferingSigRef.current = sig;
        setOffering(next);
      }
    } catch (e) {
      console.warn('RevenueCat getOfferings failed', e);
    }
  }, []);

  const loadCustomerInfo = useCallback(async () => {
    const P = await ensureConfigured();
    if (!P) return;
    try {
      const info = await P.getCustomerInfo();
      applyCustomerInfo(info);
      // Returning subscribers may already hold an active entitlement before they
      // ever tap purchase/restore. Sync the server so their profile stays live.
      if (findActiveTraderEntitlement(info)) {
        await syncEntitlementWithBackend(token);
      }
    } catch (e) {
      console.warn('RevenueCat getCustomerInfo failed', e);
    }
  }, [applyCustomerInfo, token]);

  // Configure once and load offerings.
  useEffect(() => {
    if (!isPurchasesSupported) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const P = await ensureConfigured();
      if (!P || cancelled) {
        if (!cancelled) {
          setIsReady(true);
          setIsLoading(false);
        }
        return;
      }
      await loadOfferings();
      await loadCustomerInfo();
      if (!cancelled) {
        setIsReady(true);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOfferings, loadCustomerInfo]);

  // Identify the RevenueCat user with our app user id so the server can verify
  // the same subscriber. Runs whenever the signed-in user changes.
  useEffect(() => {
    if (!isPurchasesSupported) return;
    const appUserId = user ? String(user.id) : null;
    if (appUserId === lastUserIdRef.current) return;
    lastUserIdRef.current = appUserId;
    (async () => {
      const P = await ensureConfigured();
      if (!P) return;
      try {
        if (appUserId) {
          const { customerInfo: info } = await P.logIn(appUserId);
          applyCustomerInfo(info);
        } else {
          const info = await P.logOut();
          applyCustomerInfo(info);
        }
      } catch (e) {
        console.warn('RevenueCat identity change failed', e);
      }
    })();
  }, [user, applyCustomerInfo]);

  const refresh = useCallback(async () => {
    if (!isPurchasesSupported) return;
    setIsLoading(true);
    await loadOfferings();
    await loadCustomerInfo();
    setIsLoading(false);
  }, [loadOfferings, loadCustomerInfo]);

  // Guarantee the RevenueCat customer is our signed-in user before a purchase
  // or restore. configure() starts anonymous and the identity effect above may
  // not have completed yet; without this a purchase can land on an
  // $RCAnonymousID, so the server sync and the webhook (both keyed on our
  // numeric user id) never see it and the purchase is orphaned. Throws if the
  // identity can't be set, so we never make an anonymous (unattributable)
  // purchase.
  const ensureIdentified = useCallback(
    async (P: PurchasesDefault): Promise<void> => {
      if (!user) throw new Error('You need to be signed in to manage your subscription.');
      const wantedId = String(user.id);
      const currentId = await P.getAppUserID();
      if (currentId === wantedId) return;
      const { customerInfo: info } = await P.logIn(wantedId);
      applyCustomerInfo(info);
    },
    [user, applyCustomerInfo],
  );

  const purchase = useCallback(
    async (pkg: PurchasesPackage): Promise<boolean> => {
      const P = await ensureConfigured();
      if (!P) throw new Error('In-app purchases are not available in this build.');
      await ensureIdentified(P);
      const { customerInfo: info } = await P.purchasePackage(pkg);
      applyCustomerInfo(info);
      const active = !!findActiveTraderEntitlement(info);
      if (active) await syncEntitlementWithBackend(token);
      return active;
    },
    [applyCustomerInfo, ensureIdentified, token],
  );

  const restore = useCallback(async (): Promise<boolean> => {
    const P = await ensureConfigured();
    if (!P) throw new Error('In-app purchases are not available in this build.');
    await ensureIdentified(P);
    const info = await P.restorePurchases();
    applyCustomerInfo(info);
    const active = !!findActiveTraderEntitlement(info);
    if (active) await syncEntitlementWithBackend(token);
    return active;
  }, [applyCustomerInfo, ensureIdentified, token]);

  const manageSubscriptions = useCallback(async () => {
    const P = await ensureConfigured();
    if (!P) return;
    try {
      await P.showManageSubscriptions();
    } catch (e) {
      console.warn('RevenueCat showManageSubscriptions failed', e);
    }
  }, []);

  const presentPaywall = useCallback(async (): Promise<boolean> => {
    const UI = await ensurePurchasesUI();
    if (!UI) throw new Error('In-app purchases are not available in this build.');
    // Present the current offering's paywall (falls back to the SDK default if
    // no offering is loaded). The result enum is informational; the customer
    // info re-read below is the source of truth for entitlement state.
    await UI.presentPaywall(offering ? { offering } : {});
    const P = await ensureConfigured();
    let active = false;
    if (P) {
      const info = await P.getCustomerInfo();
      applyCustomerInfo(info);
      active = !!findActiveTraderEntitlement(info);
      if (active) await syncEntitlementWithBackend(token);
    }
    return active;
  }, [offering, applyCustomerInfo, token]);

  const presentCustomerCenter = useCallback(async (): Promise<void> => {
    const UI = await ensurePurchasesUI();
    if (!UI) return;
    try {
      await UI.presentCustomerCenter();
      // The user may have cancelled/refunded inside the Customer Center.
      await loadCustomerInfo();
    } catch (e) {
      console.warn('RevenueCat presentCustomerCenter failed', e);
    }
  }, [loadCustomerInfo]);

  const activeEntitlement = findActiveTraderEntitlement(customerInfo);

  // Memoize so the context value only changes when its inputs actually change.
  // Without this the object is rebuilt every render, and any consumer that
  // depends on the whole `subscription` object in effect deps would re-run on
  // every render (a classic infinite-loop footgun).
  const value: SubscriptionContextValue = useMemo(
    () => ({
      isSupported: isPurchasesSupported,
      isReady,
      isLoading,
      monthlyPackage: pickPackage(offering, 'monthly'),
      annualPackage: pickPackage(offering, 'annual'),
      hasTraderSubscription: !!activeEntitlement,
      activeProductId: activeEntitlement?.productIdentifier ?? null,
      expiresAt: activeEntitlement?.expirationDate ?? null,
      refresh,
      purchase,
      restore,
      manageSubscriptions,
      presentPaywall,
      presentCustomerCenter,
    }),
    [
      isReady,
      isLoading,
      offering,
      activeEntitlement,
      refresh,
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
