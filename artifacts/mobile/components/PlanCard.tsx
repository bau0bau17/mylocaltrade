import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import type { SubscriptionPlan } from '@workspace/api-client-react';

interface PlanCardProps {
  plan: SubscriptionPlan;
  onSelect: (planId: string) => void;
  isLoading?: boolean;
}

const PLAN_ACCENTS: Record<string, { border: string; bg: string; accent: string }> = {
  basic: { border: Colors.light.border, bg: Colors.light.card, accent: Colors.light.textSecondary },
  premium: { border: Colors.light.primary, bg: Colors.light.primaryMuted, accent: Colors.light.primary },
  elite: { border: Colors.light.elite, bg: Colors.light.eliteMuted, accent: Colors.light.elite },
};

export function PlanCard({ plan, onSelect, isLoading }: PlanCardProps) {
  const accent = PLAN_ACCENTS[plan.id] || PLAN_ACCENTS.basic;

  return (
    <View style={[styles.card, { borderColor: accent.border }]}>
      {plan.isPopular && (
        <View style={[styles.popularBadge, { backgroundColor: accent.accent }]}>
          <Feather name="trending-up" size={10} color={Colors.light.white} />
          <Text style={styles.popularText}>Popular</Text>
        </View>
      )}
      <Text style={styles.name}>{plan.name}</Text>
      <View style={styles.priceContainer}>
        <Text style={styles.currency}>{plan.currency?.toUpperCase() === 'GBP' ? '£' : '$'}</Text>
        <Text style={styles.price}>{plan.price}</Text>
        <Text style={styles.interval}>/{plan.interval}</Text>
      </View>
      
      <View style={styles.featuresList}>
        {plan.features.map((feature: string, idx: number) => (
          <View key={idx} style={styles.featureItem}>
            <View style={[styles.checkWrap, { backgroundColor: accent.bg }]}>
              <Feather name="check" size={12} color={accent.accent} />
            </View>
            <Text style={styles.featureText}>{feature}</Text>
          </View>
        ))}
      </View>
      
      <Pressable 
        style={[styles.button, { backgroundColor: accent.accent }]} 
        onPress={() => onSelect(plan.id)}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color={Colors.light.white} />
        ) : (
          <Text style={styles.buttonText}>Select Plan</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
    borderWidth: 1,
    position: 'relative',
  },
  popularBadge: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    zIndex: 1,
  },
  popularText: {
    color: Colors.light.white,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginBottom: 24,
  },
  currency: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 6,
  },
  price: {
    fontSize: 40,
    fontWeight: '700',
    color: Colors.light.text,
    lineHeight: 44,
  },
  interval: {
    fontSize: 14,
    color: Colors.light.textMuted,
    marginBottom: 6,
  },
  featuresList: {
    marginBottom: 24,
    gap: 10,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkWrap: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  featureText: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    flex: 1,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.light.white,
    letterSpacing: 0.3,
  },
});
