import {
  useGetSubscriptionPlans,
  getGetSubscriptionPlansQueryKey,
} from '@workspace/api-client-react';
import { useSubscription } from '@/lib/revenuecat';

function currencySymbol(currency: string | undefined): string {
  switch (currency?.toUpperCase()) {
    case 'GBP':
      return '£';
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    default:
      return currency ? `${currency.toUpperCase()} ` : '';
  }
}

/**
 * Returns a display price for the Premium monthly plan, e.g. "£9.99", or
 * null while no price data is available yet. Prefers the real App Store
 * price from RevenueCat (native iOS); falls back to the API plans endpoint
 * (which is driven by the shared PLAN_PRICING_GBP constant) on web/Expo Go
 * or before offerings load. Never hardcodes a price.
 */
export function usePremiumMonthlyPriceLabel(enabled: boolean = true): string | null {
  const { monthlyPackage } = useSubscription();
  const rcPrice = monthlyPackage?.product.priceString ?? null;

  const { data: plansData } = useGetSubscriptionPlans({
    query: {
      enabled: enabled && !rcPrice,
      queryKey: getGetSubscriptionPlansQueryKey(),
    },
  });

  if (rcPrice) return rcPrice;

  const premiumMonthly = plansData?.plans.find(
    (p) => p.id === 'premium' && p.interval === 'month',
  );
  if (!premiumMonthly || typeof premiumMonthly.price !== 'number') return null;

  return `${currencySymbol(premiumMonthly.currency)}${premiumMonthly.price.toFixed(2)}`;
}
