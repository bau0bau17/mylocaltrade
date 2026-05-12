import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import {
  useGetSubscriptionPlans,
  useCreateCheckoutSession,
  useDemoActivateSubscription,
  useGetTraderOnboardingStatus,
} from '@workspace/api-client-react';
import { PlanCard } from '@/components/PlanCard';
import type { CreateCheckoutRequestPlanId, DemoActivateSubscriptionParams } from '@workspace/api-client-react';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'expo-router';
import { getApiUrl } from '@/lib/api-url';

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
  const { mutateAsync: createCheckout } = useCreateCheckoutSession();
  const { mutateAsync: demoActivate } = useDemoActivateSubscription();
  const { token, isTrader } = useAuth();
  const router = useRouter();

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promoApplied, setPromoApplied] = useState<PromoPreview | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

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

  const handleSelectPlan = async (planId: string) => {
    setSelectedPlanId(planId);
    try {
      const promoCode = promoApplied?.code;
      const response = await createCheckout({
        data: {
          planId: planId as CreateCheckoutRequestPlanId,
          // promoCode isn't in the OpenAPI type yet — cast through unknown.
          ...(promoCode ? ({ promoCode } as Record<string, unknown>) : {}),
        } as Parameters<typeof createCheckout>[0]['data'],
      });

      // Demo mode: backend returns the sentinel `url: "DEMO_MODE"` and a
      // demoActivationUrl we can call instantly to flip the subscription
      // active without going through Stripe.
      if (response.url === 'DEMO_MODE' && response.demoActivationUrl) {
        const params: DemoActivateSubscriptionParams = {
          sessionId: response.sessionId,
          planId: planId as CreateCheckoutRequestPlanId,
        };
        const activateData = await demoActivate({ params });
        if (activateData.success) {
          const promoNote = (response as { promo?: { discountGbp: number; validForDays: number } }).promo;
          const baseMsg = `Your ${planId} plan has been activated! (Demo Mode)`;
          const promoMsg = promoNote
            ? `\n\n£${promoNote.discountGbp} OFF applied for ${promoNote.validForDays} days.`
            : '';
          Alert.alert('Success', baseMsg + promoMsg);
          handleClearPromo();
        } else {
          Alert.alert('Error', activateData.error || 'Activation failed');
        }
      } else if (response.url && response.url !== 'DEMO_MODE') {
        await WebBrowser.openBrowserAsync(response.url);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not start checkout process';
      Alert.alert('Checkout Failed', message);
    } finally {
      setSelectedPlanId(null);
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
          Select the right plan to grow your trade business and reach more local customers.
        </Text>
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

      {isTrader && verifiedStatus === 'verified' && (
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
            isLoading={selectedPlanId === plan.id}
          />
        ))}
      </View>

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
