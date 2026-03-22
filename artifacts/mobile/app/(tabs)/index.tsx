import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useGetFeaturedTraders } from '@workspace/api-client-react';
import { CategoryCard } from '@/components/CategoryCard';
import { TraderCard } from '@/components/TraderCard';
import { CompanyFooter } from '@/components/CompanyFooter';
import type { FeatherIconName } from '@/types/feather-icons';

const CATEGORIES: { name: string; icon: FeatherIconName }[] = [
  { name: 'Plumbing', icon: 'droplet' },
  { name: 'Electrical', icon: 'zap' },
  { name: 'Roofing', icon: 'home' },
  { name: 'Cleaning', icon: 'sun' },
  { name: 'Painting', icon: 'edit-2' },
  { name: 'Building', icon: 'tool' },
  { name: 'Locksmith', icon: 'key' },
  { name: 'Removals', icon: 'truck' },
  { name: 'Handyman', icon: 'settings' },
  { name: 'Heating & Gas', icon: 'thermometer' },
];

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: featuredData, isLoading: isLoadingFeatured } = useGetFeaturedTraders({ limit: 5 });

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerBrand}>
            <View style={styles.brandDot} />
            <View>
              <Text style={styles.appName}>MyLocalTrade</Text>
              <Text style={styles.headerSubtitle}>Find trusted local tradespeople across the UK</Text>
            </View>
          </View>
          <Pressable style={styles.headerIcon} onPress={() => router.push('/(tabs)/account')}>
            <Feather name="user" size={18} color={Colors.light.primary} />
          </Pressable>
        </View>

        <View style={styles.locationBar}>
          <Feather name="map-pin" size={13} color={Colors.light.secondary} />
          <Text style={styles.locationText}>Near you · Enter postcode to refine</Text>
          <Pressable style={styles.locationChange} onPress={() => router.push('/(tabs)/search')}>
            <Text style={styles.locationChangeText}>Change</Text>
          </Pressable>
        </View>

        <Pressable
          style={styles.searchBar}
          onPress={() => router.push('/(tabs)/search')}
        >
          <View style={styles.searchIconWrap}>
            <Feather name="search" size={17} color={Colors.light.primary} />
          </View>
          <Text style={styles.searchText}>Search plumber, electrician, roofer...</Text>
          <View style={styles.filterBtn}>
            <Feather name="sliders" size={15} color={Colors.light.primary} />
          </View>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.trustSection}>
          <View style={styles.trustItem}>
            <View style={[styles.trustIconWrap, { backgroundColor: Colors.light.secondaryMuted }]}>
              <Feather name="check-circle" size={17} color={Colors.light.secondary} />
            </View>
            <Text style={styles.trustLabel}>Verified</Text>
            <Text style={styles.trustSub}>Traders</Text>
          </View>
          <View style={styles.trustDivider} />
          <View style={styles.trustItem}>
            <View style={[styles.trustIconWrap, { backgroundColor: Colors.light.primaryMuted }]}>
              <Feather name="shield" size={17} color={Colors.light.primary} />
            </View>
            <Text style={styles.trustLabel}>UK</Text>
            <Text style={styles.trustSub}>Trusted</Text>
          </View>
          <View style={styles.trustDivider} />
          <View style={styles.trustItem}>
            <View style={[styles.trustIconWrap, { backgroundColor: Colors.light.featuredMuted }]}>
              <Feather name="star" size={17} color={Colors.light.featured} />
            </View>
            <Text style={styles.trustLabel}>Top</Text>
            <Text style={styles.trustSub}>Rated</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Categories</Text>
            <Pressable onPress={() => router.push('/(tabs)/search')} style={styles.seeAllBtn}>
              <Text style={styles.seeAll}>Browse all</Text>
              <Feather name="arrow-right" size={13} color={Colors.light.primary} />
            </Pressable>
          </View>
          <View style={styles.categoriesGrid}>
            {CATEGORIES.map((cat, index) => (
              <View key={index} style={styles.categoryWrapper}>
                <CategoryCard name={cat.name} icon={cat.icon} />
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Featured Traders</Text>
            <Pressable onPress={() => router.push('/(tabs)/traders')} style={styles.seeAllBtn}>
              <Text style={styles.seeAll}>See all</Text>
              <Feather name="arrow-right" size={13} color={Colors.light.primary} />
            </Pressable>
          </View>

          {isLoadingFeatured ? (
            <View style={styles.loadingContainer}>
              <View style={styles.loadingPulse} />
              <Text style={styles.loadingText}>Loading traders...</Text>
            </View>
          ) : featuredData?.traders && featuredData.traders.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {featuredData.traders.map((trader) => (
                <View key={trader.id} style={styles.featuredCardWrapper}>
                  <TraderCard trader={trader} />
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconWrap}>
                <Feather name="award" size={28} color={Colors.light.featured} />
              </View>
              <Text style={styles.emptyTitle}>Featured traders coming soon</Text>
              <Text style={styles.emptySubtext}>Be the first to get featured in your area</Text>
              <Pressable style={styles.emptyCtaBtn} onPress={() => router.push('/subscription')}>
                <Text style={styles.emptyCtaText}>Get featured · from £20/month</Text>
              </Pressable>
            </View>
          )}
        </View>

        <Pressable style={styles.traderCtaBanner} onPress={() => router.push('/subscription')}>
          <View style={styles.traderCtaLeft}>
            <View style={styles.traderCtaBadge}>
              <Text style={styles.traderCtaBadgeText}>FOR TRADERS</Text>
            </View>
            <Text style={styles.traderCtaTitle}>List your business</Text>
            <Text style={styles.traderCtaSub}>Join MyLocalTrade from £10/month</Text>
          </View>
          <View style={styles.traderCtaArrow}>
            <Feather name="arrow-right" size={18} color={Colors.light.primary} />
          </View>
        </Pressable>

        <CompanyFooter />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    backgroundColor: Colors.light.surface,
    paddingHorizontal: 20,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    flex: 1,
  },
  brandDot: {
    width: 4,
    height: 36,
    borderRadius: 2,
    backgroundColor: Colors.light.primary,
    marginTop: 2,
  },
  appName: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.light.text,
    letterSpacing: 0.3,
    lineHeight: 28,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
    letterSpacing: 0.2,
    lineHeight: 16,
    flexShrink: 1,
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginLeft: 12,
  },
  locationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.light.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  locationText: {
    flex: 1,
    fontSize: 12,
    color: Colors.light.textSecondary,
    letterSpacing: 0.2,
  },
  locationChange: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: Colors.light.primaryMuted,
    borderRadius: 6,
  },
  locationChangeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.primary,
    letterSpacing: 0.3,
  },
  searchBar: {
    backgroundColor: Colors.light.card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.borderLight,
  },
  searchIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  searchText: {
    flex: 1,
    fontSize: 13,
    color: Colors.light.textMuted,
    letterSpacing: 0.1,
  },
  filterBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: `${Colors.light.primary}33`,
  },
  scrollContent: {
    padding: 16,
  },
  trustSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 8,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  trustItem: {
    alignItems: 'center',
    flex: 1,
    gap: 5,
  },
  trustDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.light.border,
  },
  trustIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.2,
  },
  trustSub: {
    fontSize: 10,
    fontWeight: '500',
    color: Colors.light.textMuted,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.3,
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.primary,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
    rowGap: 4,
  },
  categoryWrapper: {
    width: '20%',
  },
  horizontalScroll: {
    paddingRight: 16,
  },
  featuredCardWrapper: {
    width: 260,
    marginRight: 12,
  },
  loadingContainer: {
    padding: 36,
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  loadingPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.light.primary,
    opacity: 0.7,
  },
  loadingText: {
    color: Colors.light.textSecondary,
    fontSize: 13,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 8,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.light.featuredMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyCtaBtn: {
    marginTop: 8,
    backgroundColor: Colors.light.primaryMuted,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${Colors.light.primary}44`,
  },
  emptyCtaText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  traderCtaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 18,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: Colors.light.borderLight,
    borderLeftWidth: 3,
    borderLeftColor: Colors.light.primary,
  },
  traderCtaLeft: {
    flex: 1,
    gap: 4,
  },
  traderCtaBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.light.primaryMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 2,
  },
  traderCtaBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.light.primary,
    letterSpacing: 1,
  },
  traderCtaTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.2,
  },
  traderCtaSub: {
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  traderCtaArrow: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
});
