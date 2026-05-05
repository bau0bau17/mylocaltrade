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
        <View style={styles.errorIconWrap}>
          <Feather name="alert-circle" size={32} color={Colors.light.error} />
        </View>
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
        <View style={[styles.headerCover, { paddingTop: Math.max(insets.top, 50) + 12 }]}>
          <Pressable style={styles.backNav} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={Colors.light.text} />
          </Pressable>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>{trader.businessName.charAt(0)}</Text>
          </View>
          <Text style={styles.businessName}>{trader.businessName}</Text>
          <View style={styles.badges}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{trader.mainCategory}</Text>
            </View>
            {trader.plan === 'elite' && (
              <View style={[styles.planBadge, { backgroundColor: Colors.light.eliteMuted }]}>
                <Feather name="zap" size={10} color={Colors.light.elite} />
                <Text style={[styles.planTextColored, { color: Colors.light.elite }]}>Elite</Text>
              </View>
            )}
            {trader.plan === 'premium' && (
              <View style={[styles.planBadge, { backgroundColor: Colors.light.primaryMuted }]}>
                <Text style={[styles.planTextColored, { color: Colors.light.primary }]}>Premium</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <View style={[styles.statIconWrap, { backgroundColor: Colors.light.featuredMuted }]}>
                <Feather name="star" size={16} color={Colors.light.featured} />
              </View>
              <Text style={styles.statValue}>{trader.rating || 'New'}</Text>
              <Text style={styles.statLabel}>{trader.reviewCount} Reviews</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <View style={[styles.statIconWrap, { backgroundColor: Colors.light.primaryMuted }]}>
                <Feather name="map-pin" size={16} color={Colors.light.primary} />
              </View>
              <Text style={styles.statValue}>{trader.town}</Text>
              <Text style={styles.statLabel}>Location</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <View style={[styles.statIconWrap, { backgroundColor: Colors.light.secondaryMuted }]}>
                <Feather name="check-circle" size={16} color={Colors.light.secondary} />
              </View>
              <Text style={styles.statValue}>Verified</Text>
              <Text style={styles.statLabel}>Business</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.description}>
              {trader.businessDescription || `${trader.businessName} is a professional ${trader.mainCategory.toLowerCase()} operating in ${trader.town} and surrounding areas.`}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Services</Text>
            <View style={styles.servicesList}>
              <View style={styles.serviceItem}>
                <View style={styles.serviceCheck}>
                  <Feather name="check" size={12} color={Colors.light.primary} />
                </View>
                <Text style={styles.serviceText}>{trader.mainCategory}</Text>
              </View>
              {trader.additionalServices?.map((service, idx) => (
                <View key={idx} style={styles.serviceItem}>
                  <View style={styles.serviceCheck}>
                    <Feather name="check" size={12} color={Colors.light.primary} />
                  </View>
                  <Text style={styles.serviceText}>{service}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact</Text>
            <View style={styles.contactCard}>
              <View style={styles.contactRow}>
                <View style={styles.contactIconWrap}>
                  <Feather name="user" size={14} color={Colors.light.textSecondary} />
                </View>
                <Text style={styles.contactText}>{trader.contactName}</Text>
              </View>
              <Pressable style={styles.contactRow} onPress={() => Linking.openURL(`tel:${trader.phone}`)}>
                <View style={styles.contactIconWrap}>
                  <Feather name="phone" size={14} color={Colors.light.primary} />
                </View>
                <Text style={[styles.contactText, { color: Colors.light.primary }]}>{trader.phone}</Text>
              </Pressable>
              {trader.website && (
                <Pressable style={styles.contactRow} onPress={() => Linking.openURL(trader.website!)}>
                  <View style={styles.contactIconWrap}>
                    <Feather name="globe" size={14} color={Colors.light.primary} />
                  </View>
                  <Text style={[styles.contactText, { color: Colors.light.primary }]}>{trader.website}</Text>
                </Pressable>
              )}
              {trader.businessAddress && (
                <View style={styles.contactRow}>
                  <View style={styles.contactIconWrap}>
                    <Feather name="map" size={14} color={Colors.light.textSecondary} />
                  </View>
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
          <Feather name="message-square" size={18} color={Colors.light.white} style={{ marginRight: 8 }} />
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
    backgroundColor: Colors.light.background,
  },
  errorIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.light.errorMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorText: {
    fontSize: 15,
    color: Colors.light.textSecondary,
    marginBottom: 24,
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
  },
  headerCover: {
    backgroundColor: Colors.light.surface,
    paddingHorizontal: 20,
    paddingBottom: 24,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backNav: {
    alignSelf: 'flex-start',
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  avatarContainer: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  businessName: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  badges: {
    flexDirection: 'row',
    gap: 8,
  },
  categoryBadge: {
    backgroundColor: Colors.light.primaryMuted,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  categoryText: {
    fontSize: 12,
    color: Colors.light.primary,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
  },
  planTextColored: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  content: {
    padding: 20,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.light.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.light.border,
    marginVertical: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.light.textMuted,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginBottom: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
    color: Colors.light.textSecondary,
  },
  servicesList: {
    gap: 8,
  },
  serviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serviceCheck: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  serviceText: {
    fontSize: 14,
    color: Colors.light.text,
  },
  contactCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 12,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.light.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginLeft: 10,
    flex: 1,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.light.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  contactButton: {
    backgroundColor: Colors.light.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 16,
  },
  contactButtonText: {
    color: Colors.light.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
