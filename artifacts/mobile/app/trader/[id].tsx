import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useGetTrader } from '@workspace/api-client-react';

export default function TraderProfileScreen() {
  const { id } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: trader, isLoading, error } = useGetTrader(Number(id));

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  if (error || !trader) {
    return (
      <View style={styles.centerContainer}>
        <Feather name="alert-circle" size={48} color={Colors.light.error} style={{ marginBottom: 16 }} />
        <Text style={styles.errorText}>Could not load trader profile.</Text>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView 
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerCover}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>{trader.businessName.charAt(0)}</Text>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.titleSection}>
            <Text style={styles.businessName}>{trader.businessName}</Text>
            <View style={styles.badges}>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryText}>{trader.mainCategory}</Text>
              </View>
              {trader.plan === 'elite' && (
                <View style={[styles.planBadge, { backgroundColor: Colors.light.elite }]}>
                  <Feather name="star" size={12} color="#FFF" />
                  <Text style={styles.planText}>Elite Trader</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Feather name="star" size={20} color={Colors.light.featured} />
              <Text style={styles.statValue}>{trader.rating || 'New'}</Text>
              <Text style={styles.statLabel}>{trader.reviewCount} Reviews</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Feather name="map-pin" size={20} color={Colors.light.textSecondary} />
              <Text style={styles.statValue}>{trader.town}</Text>
              <Text style={styles.statLabel}>Location</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Feather name="check-circle" size={20} color={Colors.light.secondary} />
              <Text style={styles.statValue}>Verified</Text>
              <Text style={styles.statLabel}>Business</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About Us</Text>
            <Text style={styles.description}>
              {trader.businessDescription || `${trader.businessName} is a professional ${trader.mainCategory.toLowerCase()} operating in ${trader.town} and surrounding areas.`}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Services</Text>
            <View style={styles.servicesList}>
              <View style={styles.serviceItem}>
                <Feather name="check" size={16} color={Colors.light.primary} />
                <Text style={styles.serviceText}>{trader.mainCategory}</Text>
              </View>
              {trader.additionalServices?.map((service, idx) => (
                <View key={idx} style={styles.serviceItem}>
                  <Feather name="check" size={16} color={Colors.light.primary} />
                  <Text style={styles.serviceText}>{service}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact Information</Text>
            <View style={styles.contactCard}>
              <View style={styles.contactRow}>
                <Feather name="user" size={18} color={Colors.light.textSecondary} />
                <Text style={styles.contactText}>{trader.contactName}</Text>
              </View>
              <Pressable style={styles.contactRow} onPress={() => Linking.openURL(`tel:${trader.phone}`)}>
                <Feather name="phone" size={18} color={Colors.light.primary} />
                <Text style={[styles.contactText, { color: Colors.light.primary }]}>{trader.phone}</Text>
              </Pressable>
              {trader.website && (
                <Pressable style={styles.contactRow} onPress={() => Linking.openURL(trader.website!)}>
                  <Feather name="globe" size={18} color={Colors.light.primary} />
                  <Text style={[styles.contactText, { color: Colors.light.primary }]}>{trader.website}</Text>
                </Pressable>
              )}
              {trader.businessAddress && (
                <View style={styles.contactRow}>
                  <Feather name="map" size={18} color={Colors.light.textSecondary} />
                  <Text style={styles.contactText}>{trader.businessAddress}</Text>
                </View>
              )}
            </View>
          </View>

        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom || 24 }]}>
        <Pressable 
          style={styles.contactButton}
          onPress={() => router.push(`/enquiry/${trader.id}`)}
        >
          <Feather name="message-square" size={20} color="#FFF" style={{ marginRight: 8 }} />
          <Text style={styles.contactButtonText}>Request a Quote</Text>
        </Pressable>
      </View>
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
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: Colors.light.text,
    marginBottom: 24,
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: Colors.light.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
  },
  headerCover: {
    height: 120,
    backgroundColor: Colors.light.primary,
    position: 'relative',
  },
  avatarContainer: {
    position: 'absolute',
    bottom: -40,
    left: 20,
    width: 80,
    height: 80,
    borderRadius: 16,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Colors.light.background,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  content: {
    padding: 20,
    paddingTop: 52,
  },
  titleSection: {
    marginBottom: 24,
  },
  businessName: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 8,
  },
  badges: {
    flexDirection: 'row',
    gap: 8,
  },
  categoryBadge: {
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  categoryText: {
    fontSize: 14,
    color: '#4338CA',
    fontWeight: '500',
  },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  planText: {
    fontSize: 14,
    color: '#FFF',
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.light.border,
    marginVertical: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    marginTop: 8,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
    color: Colors.light.text,
  },
  servicesList: {
    gap: 12,
  },
  serviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serviceText: {
    fontSize: 15,
    color: Colors.light.text,
    marginLeft: 12,
  },
  contactCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 16,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactText: {
    fontSize: 15,
    color: Colors.light.text,
    marginLeft: 12,
    flex: 1,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.light.card,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  contactButton: {
    backgroundColor: Colors.light.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    borderRadius: 12,
  },
  contactButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
});