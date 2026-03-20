import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { SubscriptionPlan } from '@workspace/api-client-react/src/generated/api.schemas';

interface PlanCardProps {
  plan: SubscriptionPlan;
  onSelect: (planId: string) => void;
  isLoading?: boolean;
}

export function PlanCard({ plan, onSelect, isLoading }: PlanCardProps) {
  const isPremiumOrElite = plan.id === 'premium' || plan.id === 'elite';

  return (
    <View style={[styles.card, isPremiumOrElite && styles.cardPopular]}>
      {plan.isPopular && (
        <View style={styles.popularBadge}>
          <Text style={styles.popularText}>Most Popular</Text>
        </View>
      )}
      <Text style={styles.name}>{plan.name}</Text>
      <View style={styles.priceContainer}>
        <Text style={styles.currency}>{plan.currency?.toUpperCase() === 'GBP' ? '£' : '$'}</Text>
        <Text style={styles.price}>{plan.price}</Text>
        <Text style={styles.interval}>/{plan.interval}</Text>
      </View>
      
      <View style={styles.featuresList}>
        {plan.features.map((feature, idx) => (
          <View key={idx} style={styles.featureItem}>
            <Feather name="check" size={16} color={Colors.light.secondary} />
            <Text style={styles.featureText}>{feature}</Text>
          </View>
        ))}
      </View>
      
      <Pressable 
        style={[styles.button, isPremiumOrElite ? styles.buttonPrimary : styles.buttonSecondary]} 
        onPress={() => onSelect(plan.id)}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color={isPremiumOrElite ? '#FFF' : Colors.light.primary} />
        ) : (
          <Text style={[styles.buttonText, isPremiumOrElite && styles.buttonTextPrimary]}>
            Select Plan
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    position: 'relative',
  },
  cardPopular: {
    borderColor: Colors.light.primary,
    borderWidth: 2,
    shadowOpacity: 0.1,
  },
  popularBadge: {
    position: 'absolute',
    top: -12,
    alignSelf: 'center',
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    zIndex: 1,
  },
  popularText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginBottom: 24,
  },
  currency: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 4,
  },
  price: {
    fontSize: 36,
    fontWeight: '700',
    color: Colors.light.text,
  },
  interval: {
    fontSize: 16,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  featuresList: {
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  featureText: {
    fontSize: 14,
    color: Colors.light.text,
    marginLeft: 8,
    flex: 1,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: Colors.light.primary,
  },
  buttonSecondary: {
    backgroundColor: '#EFF6FF',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.primary,
  },
  buttonTextPrimary: {
    color: '#FFF',
  },
});