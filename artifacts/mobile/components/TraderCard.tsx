import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { TraderProfile } from '@workspace/api-client-react/src/generated/api.schemas';

export function TraderCard({ trader }: { trader: TraderProfile }) {
  const router = useRouter();

  return (
    <Pressable style={styles.card} onPress={() => router.push(`/trader/${trader.id}`)}>
      <View style={styles.header}>
        <View style={styles.avatarPlaceholder}>
          <Feather name="image" size={24} color={Colors.light.textSecondary} />
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.businessName}>{trader.businessName}</Text>
          <View style={styles.badgeRow}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{trader.mainCategory}</Text>
            </View>
            {trader.plan === 'elite' && (
              <View style={[styles.planBadge, { backgroundColor: Colors.light.elite }]}>
                <Feather name="star" size={12} color="#FFF" />
                <Text style={styles.planText}>Elite</Text>
              </View>
            )}
            {trader.plan === 'premium' && (
              <View style={[styles.planBadge, { backgroundColor: '#9333EA' }]}>
                <Text style={styles.planText}>Premium</Text>
              </View>
            )}
            {trader.plan === 'basic' && (
              <View style={[styles.planBadge, { backgroundColor: Colors.light.primary }]}>
                <Text style={styles.planText}>Basic</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      <View style={styles.detailsRow}>
        <Feather name="map-pin" size={14} color={Colors.light.textSecondary} />
        <Text style={styles.detailsText}>{trader.town}, {trader.postcode}</Text>
      </View>
      <View style={styles.detailsRow}>
        <Feather name="star" size={14} color={Colors.light.featured} />
        <Text style={styles.detailsText}>{trader.rating || 'New'} ({trader.reviewCount} reviews)</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  avatarPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  businessName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryBadge: {
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  categoryText: {
    fontSize: 12,
    color: '#4338CA',
    fontWeight: '500',
  },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    gap: 4,
  },
  planText: {
    fontSize: 12,
    color: '#FFF',
    fontWeight: '500',
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  detailsText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginLeft: 6,
  },
});