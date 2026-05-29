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
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

/**
 * RevenueCat (Apple In-App Purchase) integration for the iOS app.
 *
 * Single entitlement model: one "Trader Subscription" entitlement granted by
 * either a Monthly or an Annual product. There are NO basic/premium/elite tiers
 * in the iOS app — that tiered model only exists on the web (Stripe) side.
 *
 * react-native-purchases is a NATIVE module: it is not present in Expo Go nor on
 * web. Everything here degrades to a safe no-op when unsupported so the preview
 * build and Expo Go keep working. Real purchases require an EAS dev/production
 * build with the RevenueCat public SDK key set.
 */

export const TRADER_ENTITLEMENT_ID =
  process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID || 'trader_subscription';

const IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '';
const ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? '';

const platformApiKey =
  Platform.OS === 'ios'
    ? IOS_API_KEY
    : Platform.OS === 'android'
    ? ANDROID_API_KEY
    : '';

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
      if (info.entitlements.active[TRADER_ENTITLEMENT_ID]) {
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
      const active = !!info.entitlements.active[TRADER_ENTITLEMENT_ID];
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
    const active = !!info.entitlements.active[TRADER_ENTITLEMENT_ID];
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

  const activeEntitlement = customerInfo?.entitlements.active[TRADER_ENTITLEMENT_ID] ?? null;

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
