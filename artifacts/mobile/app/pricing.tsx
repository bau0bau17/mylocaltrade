import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useGetSubscriptionPlans, useCreateCheckoutSession } from '@workspace/api-client-react';
import { PlanCard } from '@/components/PlanCard';
import type { CreateCheckoutRequestPlanId } from '@workspace/api-client-react';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

export default function PricingScreen() {
  const insets = useSafeAreaInsets();
  const { data: plansData, isLoading: isLoadingPlans } = useGetSubscriptionPlans();
  const { mutateAsync: createCheckout } = useCreateCheckoutSession();
  const { token } = useAuth();
  
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const handleSelectPlan = async (planId: string) => {
    setSelectedPlanId(planId);
    try {
      const response = await createCheckout({ 
        data: { planId: planId as CreateCheckoutRequestPlanId } 
      });

      const responseData = response as { url: string; sessionId: string; demoActivationUrl?: string };
      if (responseData.url === 'DEMO_MODE' && responseData.demoActivationUrl) {
        const baseUrl = getApiUrl();
        const activateRes = await fetch(`${baseUrl}${responseData.demoActivationUrl}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        const activateData = await activateRes.json();
        if (activateData.success) {
          Alert.alert('Success', `Your ${planId} plan has been activated! (Demo Mode)`);
        } else {
          Alert.alert('Error', activateData.error || 'Activation failed');
        }
      } else if (responseData.url && responseData.url !== 'DEMO_MODE') {
        await WebBrowser.openBrowserAsync(responseData.url);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not start checkout process';
      Alert.alert('Checkout Failed', message);
    } finally {
      setSelectedPlanId(null);
    }
  };

  if (isLoadingPlans) {
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

      <View style={styles.plansContainer}>
        {plansData?.plans.map(plan => (
          <PlanCard 
            key={plan.id} 
            plan={plan} 
            onSelect={handleSelectPlan}
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
