import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useGetSubscriptionStatus } from '@workspace/api-client-react';

export default function BillingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: status, isLoading } = useGetSubscriptionStatus();

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  const isPremiumOrElite = status?.plan === 'premium' || status?.plan === 'elite';

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 20,
      }}
    >
      <Text style={styles.title}>Billing & Plan</Text>

      <View style={styles.card}>
        <View style={styles.planHeader}>
          <View>
            <Text style={styles.cardLabel}>Current Plan</Text>
            <Text style={styles.planName}>
              {status?.plan ? status.plan.charAt(0).toUpperCase() + status.plan.slice(1) : 'Basic'} Plan
            </Text>
          </View>
          <View style={[styles.statusBadge, status?.status === 'active' ? styles.statusActive : styles.statusInactive]}>
            <Text style={[styles.statusText, status?.status === 'active' ? styles.statusTextActive : styles.statusTextInactive]}>
              {status?.status ? status.status.toUpperCase() : 'FREE'}
            </Text>
          </View>
        </View>

        {status?.currentPeriodEnd && (
          <View style={styles.billingInfo}>
            <Text style={styles.billingText}>
              Next billing date: {new Date(status.currentPeriodEnd).toLocaleDateString()}
            </Text>
          </View>
        )}

        <View style={styles.divider} />

        <Pressable 
          style={styles.actionButton}
          onPress={() => router.push('/pricing')}
        >
          <Feather name="arrow-up-circle" size={20} color={Colors.light.primary} />
          <Text style={styles.actionText}>Upgrade Plan</Text>
        </Pressable>
      </View>

      <View style={styles.featuresSection}>
        <Text style={styles.sectionTitle}>Your Plan Features</Text>
        <View style={styles.featuresCard}>
          <FeatureItem included={true} text="Public business profile" />
          <FeatureItem included={true} text="Receive customer enquiries" />
          <FeatureItem included={isPremiumOrElite} text="Appear higher in search results" />
          <FeatureItem included={isPremiumOrElite} text="Add gallery images" />
          <FeatureItem included={status?.plan === 'elite'} text="Elite Trader badge" />
        </View>
      </View>

    </ScrollView>
  );
}

function FeatureItem({ included, text }: { included: boolean, text: string }) {
  return (
    <View style={styles.featureItem}>
      <Feather 
        name={included ? "check" : "x"} 
        size={20} 
        color={included ? Colors.light.secondary : Colors.light.textSecondary} 
      />
      <Text style={[styles.featureText, !included && styles.featureTextDisabled]}>
        {text}
      </Text>
    </View>
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
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 20,
    letterSpacing: 0.3,
  },
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 24,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  cardLabel: {
    fontSize: 11,
    color: Colors.light.textMuted,
    marginBottom: 4,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  planName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.light.text,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  statusActive: {
    backgroundColor: Colors.light.secondaryMuted,
  },
  statusInactive: {
    backgroundColor: Colors.light.surface,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statusTextActive: {
    color: Colors.light.secondary,
  },
  statusTextInactive: {
    color: Colors.light.textMuted,
  },
  billingInfo: {
    marginBottom: 16,
  },
  billingText: {
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.light.border,
    marginBottom: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    backgroundColor: Colors.light.primaryMuted,
    borderRadius: 14,
  },
  actionText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.light.primary,
    marginLeft: 8,
  },
  featuresSection: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginBottom: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  featuresCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 14,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    fontSize: 14,
    color: Colors.light.text,
    marginLeft: 12,
  },
  featureTextDisabled: {
    color: Colors.light.textMuted,
    textDecorationLine: 'line-through',
  },
});