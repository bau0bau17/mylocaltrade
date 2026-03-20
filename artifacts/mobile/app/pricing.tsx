import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { useGetSubscriptionPlans, useCreateCheckoutSession } from '@workspace/api-client-react';
import { PlanCard } from '@/components/PlanCard';
import { CreateCheckoutRequestPlanId } from '@workspace/api-client-react/src/generated/api.schemas';
import * as WebBrowser from 'expo-web-browser';

export default function PricingScreen() {
  const insets = useSafeAreaInsets();
  const { data: plansData, isLoading: isLoadingPlans } = useGetSubscriptionPlans();
  const { mutateAsync: createCheckout } = useCreateCheckoutSession();
  
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const handleSelectPlan = async (planId: string) => {
    setSelectedPlanId(planId);
    try {
      const response = await createCheckout({ 
        data: { planId: planId as CreateCheckoutRequestPlanId } 
      });
      if (response.url) {
        await WebBrowser.openBrowserAsync(response.url);
      }
    } catch (error: any) {
      Alert.alert('Checkout Failed', error.message || 'Could not start checkout process');
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
        <Text style={styles.faqTitle}>Frequently Asked Questions</Text>
        <View style={styles.faqItem}>
          <Text style={styles.faqQuestion}>Can I cancel anytime?</Text>
          <Text style={styles.faqAnswer}>Yes, all our plans are billed monthly and you can cancel your subscription at any time without penalty.</Text>
        </View>
        <View style={styles.faqItem}>
          <Text style={styles.faqQuestion}>How do verified reviews work?</Text>
          <Text style={styles.faqAnswer}>Only customers who have hired you through MyLocalTrade can leave a verified review on your profile.</Text>
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
  },
  content: {
    paddingHorizontal: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  plansContainer: {
    marginBottom: 32,
  },
  faqSection: {
    marginTop: 16,
    paddingHorizontal: 8,
  },
  faqTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 16,
  },
  faqItem: {
    marginBottom: 20,
  },
  faqQuestion: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 8,
  },
  faqAnswer: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    lineHeight: 22,
  },
});