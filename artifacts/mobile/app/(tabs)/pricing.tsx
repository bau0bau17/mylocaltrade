import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Pressable } from 'react-native';
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

export default function PricingScreen() {
  const insets = useSafeAreaInsets();
  const { data: plansData, isLoading: isLoadingPlans } = useGetSubscriptionPlans();
  const { mutateAsync: createCheckout } = useCreateCheckoutSession();
  const { mutateAsync: demoActivate } = useDemoActivateSubscription();
  const { token, isTrader } = useAuth();
  const router = useRouter();

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

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

  const handleSelectPlan = async (planId: string) => {
    setSelectedPlanId(planId);
    try {
      const response = await createCheckout({
        data: { planId: planId as CreateCheckoutRequestPlanId },
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
          Alert.alert('Success', `Your ${planId} plan has been activated! (Demo Mode)`);
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
          <Text style={styles.faqAnswer}>Only customers who hire through MyLocalTrade can leave verified reviews.</Text>
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
