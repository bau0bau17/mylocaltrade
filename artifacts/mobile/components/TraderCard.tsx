import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import type { TraderProfile } from '@workspace/api-client-react';

const PLAN_STYLES = {
  elite: { bg: Colors.light.eliteMuted, color: Colors.light.elite, label: 'Elite' },
  premium: { bg: Colors.light.primaryMuted, color: Colors.light.primary, label: 'Premium' },
  basic: { bg: Colors.light.border, color: Colors.light.textSecondary, label: 'Basic' },
};

export function TraderCard({ trader }: { trader: TraderProfile }) {
  const router = useRouter();
  const planStyle = PLAN_STYLES[trader.plan as keyof typeof PLAN_STYLES];

  return (
    <Pressable style={styles.card} onPress={() => router.push(`/trader/${trader.id}`)}>
      <View style={styles.header}>
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarLetter}>{trader.businessName.charAt(0)}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.businessName} numberOfLines={1}>{trader.businessName}</Text>
          <View style={styles.badgeRow}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{trader.mainCategory}</Text>
            </View>
            {planStyle && (
              <View style={[styles.planBadge, { backgroundColor: planStyle.bg }]}>
                {trader.plan === 'elite' && <Feather name="zap" size={10} color={planStyle.color} />}
                <Text style={[styles.planText, { color: planStyle.color }]}>{planStyle.label}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      <View style={styles.footer}>
        <View style={styles.footerItem}>
          <Feather name="map-pin" size={12} color={Colors.light.textMuted} />
          <Text style={styles.footerText}>{trader.town}</Text>
        </View>
        <View style={styles.footerItem}>
          <Feather name="star" size={12} color={Colors.light.featured} />
          <Text style={styles.footerText}>{trader.rating || 'New'} ({trader.reviewCount})</Text>
        </View>
        <Feather name="chevron-right" size={16} color={Colors.light.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  header: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarLetter: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  headerInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  businessName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryBadge: {
    backgroundColor: Colors.light.primaryMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  categoryText: {
    fontSize: 11,
    color: Colors.light.primary,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 3,
  },
  planText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
    gap: 4,
  },
  footerText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
});
