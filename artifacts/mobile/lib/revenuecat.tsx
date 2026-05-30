import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
//  - Development / preview builds use the RevenueCat Test Store key so the full
//    purchase + paywall flow can be exercised without App Store / Play Store
//    configuration.
//  - Production builds use the platform App Store / Play Store key.
function resolvePlatformApiKey(): string {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return '';
  if (__DEV__ && TEST_API_KEY) return TEST_API_KEY;
  return Platform.OS === 'ios' ? IOS_API_KEY : ANDROID_API_KEY;
}

const platformApiKey = resolvePlatformApiKey();

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
        if (__DEV__) {
          P.setLogLevel(mod.LOG_LEVEL.WARN);
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

  const applyCustomerInfo = useCallback((info: CustomerInfo | null) => {
    setCustomerInfo(info);
  }, []);

  const loadOfferings = useCallback(async () => {
    const P = await ensureConfigured();
    if (!P) return;
    try {
      const offerings = await P.getOfferings();
      setOffering(offerings.current ?? null);
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

  const purchase = useCallback(
    async (pkg: PurchasesPackage): Promise<boolean> => {
      const P = await ensureConfigured();
      if (!P) throw new Error('In-app purchases are not available in this build.');
      const { customerInfo: info } = await P.purchasePackage(pkg);
      applyCustomerInfo(info);
      const active = !!findActiveTraderEntitlement(info);
      if (active) await syncEntitlementWithBackend(token);
      return active;
    },
    [applyCustomerInfo, token],
  );

  const restore = useCallback(async (): Promise<boolean> => {
    const P = await ensureConfigured();
    if (!P) throw new Error('In-app purchases are not available in this build.');
    const info = await P.restorePurchases();
    applyCustomerInfo(info);
    const active = !!findActiveTraderEntitlement(info);
    if (active) await syncEntitlementWithBackend(token);
    return active;
  }, [applyCustomerInfo, token]);

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

  const value: SubscriptionContextValue = {
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
  };

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
