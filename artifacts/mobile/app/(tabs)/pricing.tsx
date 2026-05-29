import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import {
  useGetSubscriptionPlans,
  useGetTraderOnboardingStatus,
} from '@workspace/api-client-react';
import { PlanCard } from '@/components/PlanCard';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'expo-router';
import { getApiUrl } from '@/lib/api-url';
import { useSubscription, isUserCancelledError } from '@/lib/revenuecat';
import type { PurchasesPackage } from 'react-native-purchases';

interface PromoPreview {
  code: string;
  discountGbp: number;
  slotsRemaining: number;
  maxRedemptions: number;
  validForDays: number;
  applicablePlans?: string[];
}

export default function PricingScreen() {
  const insets = useSafeAreaInsets();
  const { data: plansData, isLoading: isLoadingPlans } = useGetSubscriptionPlans();
  const { token, isTrader } = useAuth();
  const router = useRouter();
  const subscription = useSubscription();

  const [promoInput, setPromoInput] = useState('');
  const [promoApplied, setPromoApplied] = useState<PromoPreview | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  const { data: onboardingStatus, isLoading: isLoadingOnboarding } = useGetTraderOnboardingStatus({
    query: {
      queryKey: ['/api/trader/onboarding-status'],
      enabled: Boolean(isTrader && token),
    },
  });
  const verifiedStatus: 'unknown' | 'verified' | 'not_verified' =
    !isTrader || !token
      ? 'not_verified'
      : isLoadingOnboarding
      ? 'unknown'
      : onboardingStatus?.verificationStatus === 'VERIFIED'
      ? 'verified'
      : 'not_verified';

  const handleApplyPromo = async (planIdHint?: string) => {
    const code = promoInput.trim();
    if (!code) {
      setPromoError('Enter a code first.');
      return;
    }
    if (!token) return;
    // We need a planId to validate against — pick the first plan the code
    // could apply to. For UX the user clicks Apply BEFORE choosing a plan,
    // so default to "premium" (£20 → £15) which is the launch promo target.
    const planId = planIdHint || 'premium';
    setPromoChecking(true);
    setPromoError(null);
    try {
      const res = await fetch(`${getApiUrl()}/api/promo/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code, planId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not validate code');
      if (!json.valid) {
        setPromoApplied(null);
        setPromoError(json.reason || 'This code is not valid.');
        return;
      }
      setPromoApplied({
        code: json.code,
        discountGbp: json.discountGbp,
        slotsRemaining: json.slotsRemaining,
        maxRedemptions: json.maxRedemptions,
        validForDays: json.validForDays,
      });
    } catch (e) {
      setPromoError(e instanceof Error ? e.message : 'Could not validate code');
    } finally {
      setPromoChecking(false);
    }
  };

  const handleClearPromo = () => {
    setPromoApplied(null);
    setPromoInput('');
    setPromoError(null);
  };

  const handleSelectPlan = (_planId: string) => {
    // Web / Expo Go fallback: in-app purchasing is only available in the native
    // iOS build via Apple In-App Purchase. No external payment links are shown.
    Alert.alert(
      'Available in the app',
      'Subscriptions are purchased securely through the App Store in the MyLocalTrade iOS app.',
    );
  };

  const handlePurchase = async (pkg: PurchasesPackage) => {
    if (purchasingId) return;
    setPurchasingId(pkg.identifier);
    try {
      const active = await subscription.purchase(pkg);
      if (active) {
        Alert.alert(
          'You are subscribed',
          'Your Trader Subscription is active and your profile is now live for customers.',
        );
        router.push('/trader-dashboard/billing');
      }
    } catch (e) {
      if (!isUserCancelledError(e)) {
        Alert.alert('Purchase failed', e instanceof Error ? e.message : 'Please try again.');
      }
    } finally {
      setPurchasingId(null);
    }
  };

  const handleRestore = async () => {
    try {
      const active = await subscription.restore();
      Alert.alert(
        active ? 'Subscription restored' : 'Nothing to restore',
        active
          ? 'Your Trader Subscription has been restored.'
          : 'We could not find an active subscription for this Apple ID.',
      );
    } catch (e) {
      Alert.alert('Restore failed', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  if (isLoadingPlans || verifiedStatus === 'unknown') {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { 
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24
        }
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.headerIconWrap}>
          <Feather name="trending-up" size={24} color={Colors.light.primary} />
        </View>
        <Text style={styles.title}>Choose Your Plan</Text>
        <Text style={styles.subtitle}>
          Get more local leads, the verified badge and priority placement so customers find your trade business first.
        </Text>
      </View>

      <View style={styles.benefitsCard}>
        <Text style={styles.benefitsTitle}>Why upgrade</Text>
        {[
          { icon: 'users' as const, label: 'More local leads from customers in your area' },
          { icon: 'check-circle' as const, label: 'Verified trader badge displayed on every listing' },
          { icon: 'eye' as const, label: 'Better visibility in search and category results' },
          { icon: 'arrow-up' as const, label: 'Priority placement above unpaid traders' },
          { icon: 'image' as const, label: 'Enhanced profile with photos, services and reviews' },
          { icon: 'star' as const, label: 'Featured placement on the home screen (Elite)' },
          { icon: 'zap' as const, label: 'Specialist visibility for energy and property maintenance work' },
        ].map((b, idx) => (
          <View key={idx} style={styles.benefitRow}>
            <View style={styles.benefitIconWrap}>
              <Feather name={b.icon} size={13} color={Colors.light.primary} />
            </View>
            <Text style={styles.benefitText}>{b.label}</Text>
          </View>
        ))}
      </View>

      {!isTrader && (
        <View style={styles.gateBanner}>
          <Feather name="briefcase" size={18} color={Colors.light.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.gateTitle}>Plans are for trade businesses</Text>
            <Text style={styles.gateBody}>
              These subscriptions are for tradespeople who want to be listed on MyLocalTrade. Customers browse and contact traders for free.
            </Text>
            <Pressable style={styles.gateBtn} onPress={() => router.push('/auth/register-trader')}>
              <Text style={styles.gateBtnText}>Register as a trader</Text>
            </Pressable>
          </View>
        </View>
      )}

      {isTrader && verifiedStatus !== 'verified' && (
        <View style={styles.gateBanner}>
          <Feather name="lock" size={18} color={Colors.light.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.gateTitle}>Verification required</Text>
            <Text style={styles.gateBody}>
              You can browse plans, but you'll need to finish verification before subscribing and going live.
            </Text>
            <Pressable style={styles.gateBtn} onPress={() => router.push('/trader-dashboard')}>
              <Text style={styles.gateBtnText}>Go to dashboard</Text>
            </Pressable>
          </View>
        </View>
      )}

      {!subscription.isSupported && isTrader && verifiedStatus === 'verified' && (
        <View style={styles.promoCard}>
          <Text style={styles.promoLabel}>Have a promo code?</Text>
          {promoApplied ? (
            <View style={styles.promoApplied}>
              <Feather name="check-circle" size={16} color={Colors.light.success ?? '#0a7e3d'} />
              <View style={{ flex: 1 }}>
                <Text style={styles.promoAppliedTitle}>
                  {promoApplied.code} — £{promoApplied.discountGbp} OFF
                </Text>
                <Text style={styles.promoAppliedBody}>
                  Applies for {promoApplied.validForDays} days. {promoApplied.slotsRemaining} of {promoApplied.maxRedemptions} slots left.
                </Text>
              </View>
              <Pressable onPress={handleClearPromo} hitSlop={8}>
                <Feather name="x" size={16} color={Colors.light.textMuted} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.promoRow}>
              <TextInput
                value={promoInput}
                onChangeText={(v) => { setPromoInput(v); setPromoError(null); }}
                placeholder="Enter code"
                placeholderTextColor={Colors.light.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                style={styles.promoInput}
                maxLength={50}
                editable={!promoChecking}
              />
              <Pressable
                style={[styles.promoBtn, (promoChecking || !promoInput.trim()) && { opacity: 0.5 }]}
                onPress={() => handleApplyPromo()}
                disabled={promoChecking || !promoInput.trim()}
              >
                {promoChecking ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.promoBtnText}>Apply</Text>
                )}
              </Pressable>
            </View>
          )}
          {promoError && <Text style={styles.promoErrorText}>{promoError}</Text>}
        </View>
      )}

      {subscription.isSupported ? (
        <View style={styles.plansContainer}>
          {subscription.hasTraderSubscription ? (
            <View style={styles.iapActiveCard}>
              <Feather name="check-circle" size={20} color={Colors.light.secondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.iapActiveTitle}>Trader Subscription active</Text>
                <Text style={styles.iapActiveBody}>
                  Your profile is live for customers. Manage your subscription from Billing in your dashboard.
                </Text>
                <Pressable style={styles.gateBtn} onPress={() => router.push('/trader-dashboard/billing')}>
                  <Text style={styles.gateBtnText}>Go to billing</Text>
                </Pressable>
              </View>
            </View>
          ) : !subscription.isReady ? (
            <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginVertical: 24 }} />
          ) : !subscription.monthlyPackage && !subscription.annualPackage ? (
            <View style={styles.gateBanner}>
              <Feather name="alert-circle" size={18} color={Colors.light.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.gateTitle}>Plans unavailable</Text>
                <Text style={styles.gateBody}>
                  We could not load subscription options right now. Please try again shortly.
                </Text>
                <Pressable style={styles.gateBtn} onPress={() => subscription.refresh()}>
                  <Text style={styles.gateBtnText}>Retry</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.iapHeading}>Trader Subscription</Text>
              {subscription.monthlyPackage && (
                <IapPlanButton
                  label="Monthly"
                  priceLabel={subscription.monthlyPackage.product.priceString}
                  cadence="per month"
                  disabled={!isTrader || verifiedStatus !== 'verified' || !!purchasingId}
                  loading={purchasingId === subscription.monthlyPackage.identifier}
                  onPress={() => {
                    if (!isTrader) {
                      Alert.alert('Trade account needed', 'Register as a tradesperson to subscribe to a plan.');
                      return;
                    }
                    if (verifiedStatus !== 'verified') {
                      Alert.alert('Get verified first', 'Finish your trader verification before subscribing.');
                      return;
                    }
                    handlePurchase(subscription.monthlyPackage!);
                  }}
                />
              )}
              {subscription.annualPackage && (
                <IapPlanButton
                  label="Annual"
                  priceLabel={subscription.annualPackage.product.priceString}
                  cadence="per year"
                  highlight
                  disabled={!isTrader || verifiedStatus !== 'verified' || !!purchasingId}
                  loading={purchasingId === subscription.annualPackage.identifier}
                  onPress={() => {
                    if (!isTrader) {
                      Alert.alert('Trade account needed', 'Register as a tradesperson to subscribe to a plan.');
                      return;
                    }
                    if (verifiedStatus !== 'verified') {
                      Alert.alert('Get verified first', 'Finish your trader verification before subscribing.');
                      return;
                    }
                    handlePurchase(subscription.annualPackage!);
                  }}
                />
              )}
              <Pressable style={styles.restoreBtn} onPress={handleRestore} disabled={!!purchasingId}>
                <Text style={styles.restoreBtnText}>Restore purchases</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : (
        <View style={styles.plansContainer}>
          {plansData?.plans.map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onSelect={(planId) => {
                if (!isTrader) {
                  Alert.alert('Trade account needed', 'Register as a tradesperson to subscribe to a plan.');
                  return;
                }
                if (verifiedStatus !== 'verified') {
                  Alert.alert('Get verified first', 'Finish your trader verification before subscribing.');
                  return;
                }
                handleSelectPlan(planId);
              }}
            />
          ))}
        </View>
      )}

      <View style={styles.faqSection}>
        <Text style={styles.faqTitle}>FAQ</Text>
        <View style={styles.faqItem}>
          <Text style={styles.faqQuestion}>Can I cancel anytime?</Text>
          <Text style={styles.faqAnswer}>Yes, all plans are monthly with no penalty for cancellation.</Text>
        </View>
        <View style={styles.faqItem}>
          <Text style={styles.faqQuestion}>How do verified reviews work?</Text>
          <Text style={styles.faqAnswer}>Only customers who have contacted you through MyLocalTrade and received a response can leave a review, and only one review per enquiry.</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function IapPlanButton({
  label,
  priceLabel,
  cadence,
  onPress,
  disabled,
  loading,
  highlight,
}: {
  label: string;
  priceLabel: string;
  cadence: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  highlight?: boolean;
}) {
  return (
    <Pressable
      style={[
        styles.iapPlanBtn,
        highlight && styles.iapPlanBtnHighlight,
        disabled && { opacity: 0.6 },
      ]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.iapPlanLabel}>{label}</Text>
        <Text style={styles.iapPlanCadence}>{cadence}</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={highlight ? '#fff' : Colors.light.primary} />
      ) : (
        <Text style={[styles.iapPlanPrice, highlight && styles.iapPlanPriceHighlight]}>
          {priceLabel}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
  },
  content: {
    paddingHorizontal: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  headerIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  plansContainer: {
    marginBottom: 32,
  },
  iapHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 12,
  },
  iapPlanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
    marginBottom: 12,
  },
  iapPlanBtnHighlight: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  iapPlanLabel: { fontSize: 16, fontWeight: '700', color: Colors.light.text },
  iapPlanCadence: { fontSize: 12, color: Colors.light.textSecondary, marginTop: 2 },
  iapPlanPrice: { fontSize: 16, fontWeight: '700', color: Colors.light.primary },
  iapPlanPriceHighlight: { color: '#fff' },
  restoreBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  restoreBtnText: { fontSize: 14, fontWeight: '600', color: Colors.light.primary },
  iapActiveCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.light.secondaryMuted,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  iapActiveTitle: { fontSize: 15, fontWeight: '700', color: Colors.light.text, marginBottom: 4 },
  iapActiveBody: { fontSize: 13, color: Colors.light.textSecondary, lineHeight: 18, marginBottom: 10 },
  promoCard: {
    marginBottom: 20,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
  },
  promoLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.light.textMuted,
    marginBottom: 10,
  },
  promoRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  promoInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
    fontSize: 14,
    color: Colors.light.text,
    letterSpacing: 1,
  },
  promoBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.light.primary,
    minWidth: 72,
    alignItems: 'center',
  },
  promoBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  promoApplied: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    paddingVertical: 6,
  },
  promoAppliedTitle: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  promoAppliedBody: { fontSize: 12, color: Colors.light.textSecondary, marginTop: 2 },
  promoErrorText: { fontSize: 12, color: Colors.light.error, marginTop: 8 },
  gateBanner: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.light.primaryMuted,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  gateTitle: { fontSize: 14, fontWeight: '700', color: Colors.light.text, marginBottom: 4 },
  gateBody: { fontSize: 13, color: Colors.light.textSecondary, lineHeight: 18, marginBottom: 10 },
  gateBtn: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: Colors.light.primary, borderRadius: 10 },
  gateBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  benefitsCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  benefitsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  benefitIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  benefitText: {
    flex: 1,
    fontSize: 13,
    color: Colors.light.text,
    lineHeight: 18,
  },
  faqSection: {
    paddingHorizontal: 8,
  },
  faqTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginBottom: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  faqItem: {
    marginBottom: 16,
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  faqQuestion: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 6,
  },
  faqAnswer: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    lineHeight: 20,
  },
});
