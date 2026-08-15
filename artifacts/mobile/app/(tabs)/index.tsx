import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, useWindowDimensions, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import {
  useGetFeaturedTraders,
  useGetEnquiries,
  useGetSavedTraders,
  getGetEnquiriesQueryKey,
  getGetSavedTradersQueryKey,
} from '@workspace/api-client-react';
import { CategoryCard } from '@/components/CategoryCard';
import { TraderCard } from '@/components/TraderCard';
import { HomeFooter } from '@/components/HomeFooter';
import { useLocation } from '@/hooks/useLocation';
import { useSearchRadius } from '@/contexts/SearchRadiusContext';
import { radiusRowLabel } from '@/constants/searchRadius';
import { RadiusSheet } from '@/components/RadiusSheet';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { usePremiumMonthlyPriceLabel } from '@/hooks/usePremiumMonthlyPriceLabel';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamContext } from '@/hooks/useTeamContext';
import { useSubscription } from '@/lib/revenuecat';
import type { FeatherIconName } from '@/types/feather-icons';

// `name` is the CANONICAL category value sent to search (never change it —
// it drives category routing and the server-side synonym mapping). `label`
// is only what's painted on the Home tile; keep it concise so nothing
// truncates with an ellipsis on 4/5-column grids.
type CategoryDef = {
  name: string;
  label?: string;
  icon: string;
  iconSet?: 'feather' | 'mci';
};

const CATEGORIES: CategoryDef[] = [
  { name: 'Plumbing', icon: 'droplet' },
  { name: 'Electrical', icon: 'zap' },
  { name: 'Roofing', icon: 'home' },
  { name: 'Gas engineers', icon: 'fire', iconSet: 'mci' },
  { name: 'Heating', icon: 'thermometer' },
  { name: 'Solar panels', icon: 'sun' },
  { name: 'EV chargers', icon: 'battery-charging' },
  { name: 'Heat pumps', icon: 'wind' },
  { name: 'Insulation', icon: 'layers' },
  { name: 'EPC improvements', label: 'EPC upgrades', icon: 'bar-chart-2' },
  { name: 'Damp & mould', icon: 'cloud-drizzle' },
  { name: 'Cladding & remediation', label: 'Cladding repairs', icon: 'shield' },
  { name: 'General maintenance', label: 'Maintenance', icon: 'tool' },
  { name: 'Leasehold repairs', label: 'Leasehold repairs', icon: 'file-text' },
  { name: 'Locksmiths', icon: 'key' },
  { name: 'Cleaning', icon: 'broom', iconSet: 'mci' },
  { name: 'Gardening & landscaping', label: 'Gardening', icon: 'scissors' },
  { name: 'Painting', icon: 'brush', iconSet: 'mci' },
  { name: 'Building', icon: 'wall', iconSet: 'mci' },
  { name: 'Handyman', icon: 'hammer-wrench', iconSet: 'mci' },
];

const STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting reply',
  responded: 'Replied',
  completed: 'Completed',
  rejected: 'Declined',
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  // 4 columns on standard iPhone widths; 5 only where labels stay readable
  // and tiles keep comfortable tap targets (Plus/Max-class widths, tablets).
  const categoryColumns = width >= 430 ? 5 : 4;
  const location = useLocation();
  const { radius, setRadius } = useSearchRadius();
  const [radiusSheetVisible, setRadiusSheetVisible] = useState(false);
  const { isAuthenticated, isCustomer, isTrader } = useAuth();
  const { hasTraderSubscription } = useSubscription();
  const showCustomerSections = isAuthenticated && isCustomer;
  // Trader-conversion promos (Get featured, Premium promotion banner,
  // Premium pricing) are only shown to logged-out visitors and trader
  // accounts — never to logged-in customers (or any other signed-in
  // non-trader role). Company Teams: invited EMPLOYEES are traders too but
  // billing is owner-only, so they never see Premium upsells either — and
  // while their role is still loading we fail closed (no paywall flash).
  const { isEmployee, roleUnknown } = useTeamContext();
  const showTraderPromos = !isAuthenticated || (isTrader && !isEmployee && !roleUnknown);
  const premiumMonthlyPrice = usePremiumMonthlyPriceLabel(showTraderPromos);

  const { data: featuredData, isLoading: isLoadingFeatured, refetch: refetchFeatured } = useGetFeaturedTraders({ limit: 5 });
  const featuredTraders = featuredData?.traders ?? [];
  // Customers still see real featured listings; when there are none, the
  // whole section is hidden for them instead of showing a trader CTA.
  const showFeaturedSection = isLoadingFeatured || featuredTraders.length > 0 || showTraderPromos;
  const { data: enquiriesData, refetch: refetchEnquiries } = useGetEnquiries({
    query: { enabled: showCustomerSections, queryKey: getGetEnquiriesQueryKey() },
  });
  const { data: savedData, refetch: refetchSaved } = useGetSavedTraders({
    query: { enabled: showCustomerSections, queryKey: getGetSavedTradersQueryKey() },
  });
  const { refreshing, onRefresh } = usePullToRefresh(refetchFeatured, refetchEnquiries, refetchSaved);
  const recentEnquiries = (enquiriesData?.enquiries ?? []).slice(0, 2);
  const savedTraders = (savedData?.traders ?? []).slice(0, 5);

  const handleLocationPress = () => {
    if (location.permissionDenied) {
      location.refresh();
    } else {
      router.push('/(tabs)/search');
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 50) + 6 }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerBrand}>
            <View style={styles.brandDot} />
            <View>
              <Text style={styles.appName}>MyLocalTrade</Text>
              <Text style={styles.headerSubtitle}>Find independent local tradespeople across the UK</Text>
            </View>
          </View>
          <Pressable style={styles.headerIcon} onPress={() => router.push('/(tabs)/account')}>
            <Feather name="user" size={18} color={Colors.light.primary} />
          </Pressable>
        </View>

        <Pressable style={styles.locationBar} onPress={handleLocationPress}>
          {location.isLoading ? (
            <ActivityIndicator size="small" color={Colors.light.secondary} style={{ marginRight: 4 }} />
          ) : (
            <Feather
              name={(location.permissionDenied ? 'map-pin-off' : 'map-pin') as FeatherIconName}
              size={13}
              color={location.permissionDenied ? Colors.light.textMuted : Colors.light.secondary}
            />
          )}
          <Text style={[styles.locationText, location.permissionDenied && styles.locationTextMuted]}>
            {location.isLoading ? 'Detecting your location...' : location.label}
          </Text>
          {!location.isLoading && (
            <Pressable
              style={styles.locationChange}
              onPress={location.permissionDenied ? location.refresh : () => router.push('/(tabs)/search')}
              hitSlop={8}
            >
              <Text style={styles.locationChangeText}>
                {location.permissionDenied ? 'Enable' : 'Change'}
              </Text>
            </Pressable>
          )}
        </Pressable>

        {/* Search radius, tucked under the location row (no permanent slider
            or extra controls — tapping opens the options sheet). Hidden while
            the location is loading/unavailable: with no resolvable anchor the
            radius has no effect, so showing it would mislead. */}
        {!location.isLoading && !location.permissionDenied && (location.city || location.postalCode) ? (
          <Pressable
            style={styles.radiusRow}
            onPress={() => setRadiusSheetVisible(true)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Search radius: ${radiusRowLabel(radius)}`}
          >
            <Feather name="crosshair" size={12} color={Colors.light.secondary} />
            <Text style={styles.radiusRowText}>{radiusRowLabel(radius)}</Text>
            <Feather name="chevron-down" size={13} color={Colors.light.textSecondary} />
          </Pressable>
        ) : null}

        {/* One clean search entry point. Advanced filters live ONLY on the
            Search screen, so no filter icon here. The `reset` nonce tells
            Search this is a fresh open: it must show an empty query and no
            stale results (the tab screen stays mounted between visits). */}
        <Pressable
          style={({ pressed }) => [styles.searchBar, pressed && styles.searchBarPressed]}
          accessibilityRole="search"
          accessibilityLabel="Search for a trade or service"
          onPress={() =>
            router.push({ pathname: '/(tabs)/search', params: { reset: String(Date.now()) } })
          }
        >
          <View style={styles.searchIconWrap}>
            <Feather name="search" size={17} color={Colors.light.primary} />
          </View>
          <Text style={styles.searchText}>Search plumber, electrician, roofer...</Text>
        </Pressable>
      </View>

      <ScrollView
        // The tab bar is absolutely positioned (49pt row + bottom inset), so
        // content needs enough bottom padding to scroll fully above it.
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 110 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.light.primary} />
        }
      >
        <View style={styles.trustSection}>
          <View style={styles.trustItem}>
            <View style={[styles.trustIconWrap, { backgroundColor: Colors.light.secondaryMuted }]}>
              <Feather name="check-circle" size={17} color={Colors.light.secondary} />
            </View>
            <Text style={styles.trustLabel}>Verified</Text>
            <Text style={styles.trustSub}>Traders</Text>
          </View>
          <View style={styles.trustItem}>
            <View style={[styles.trustIconWrap, { backgroundColor: Colors.light.primaryMuted }]}>
              <Feather name="map" size={17} color={Colors.light.primary} />
            </View>
            <Text style={styles.trustLabel}>UK-wide</Text>
            <Text style={styles.trustSub}>Coverage</Text>
          </View>
          <View style={styles.trustItem}>
            <View style={[styles.trustIconWrap, { backgroundColor: Colors.light.featuredMuted }]}>
              <FontAwesome name="star" size={17} color={Colors.light.featured} />
            </View>
            <Text style={styles.trustLabel}>Top rated</Text>
            <Text style={styles.trustSub}>Reviews</Text>
          </View>
        </View>

        {/* Customer-only CTA: traders never request quotes, so hide it for
            logged-in trader accounts (guests + customers still see it). */}
        {!(isAuthenticated && isTrader) && (
          <Pressable
            style={({ pressed }) => [styles.quoteCta, pressed && styles.quoteCtaPressed]}
            accessibilityRole="button"
            accessibilityLabel="Request a quote"
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              }
              router.push('/(tabs)/search');
            }}
          >
            <View style={styles.quoteCtaIcon}>
              <Feather name="message-square" size={19} color={Colors.light.white} />
            </View>
            <View style={{ flex: 1 }}>
              {/* Text wraps freely (no numberOfLines) and the banner sizes from
                  padding, so larger Dynamic Type grows the card instead of
                  clipping; the multiplier cap keeps the row readable between
                  the fixed icon and arrow at accessibility sizes. */}
              <Text style={styles.quoteCtaTitle} maxFontSizeMultiplier={1.5}>Request a quote</Text>
              <Text style={styles.quoteCtaSub} maxFontSizeMultiplier={1.5}>
                Find local traders with verified details and send your job details for free.
              </Text>
            </View>
            <View style={styles.quoteCtaArrow}>
              <Feather name="arrow-right" size={17} color={Colors.light.white} />
            </View>
          </Pressable>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Popular categories</Text>
            <Pressable onPress={() => router.push('/(tabs)/search')} style={styles.seeAllBtn}>
              <Text style={styles.seeAll}>Browse all</Text>
              <Feather name="arrow-right" size={13} color={Colors.light.primary} />
            </Pressable>
          </View>
          <View style={styles.categoriesGrid}>
            {CATEGORIES.map((cat) => (
              <View key={cat.name} style={{ width: `${100 / categoryColumns}%` }}>
                <CategoryCard
                  name={cat.name}
                  label={cat.label}
                  icon={cat.icon as never}
                  iconSet={cat.iconSet}
                />
              </View>
            ))}
          </View>
        </View>

        {showCustomerSections && recentEnquiries.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent enquiries</Text>
              <Pressable onPress={() => router.push('/(tabs)/my-enquiries')} style={styles.seeAllBtn}>
                <Text style={styles.seeAll}>See all</Text>
                <Feather name="arrow-right" size={13} color={Colors.light.primary} />
              </Pressable>
            </View>
            <View style={{ gap: 10 }}>
              {recentEnquiries.map((enq) => (
                <Pressable
                  key={enq.id}
                  style={styles.enquiryRow}
                  onPress={() => router.push('/(tabs)/my-enquiries')}
                >
                  <View style={styles.enquiryRowIcon}>
                    <Feather name="send" size={14} color={Colors.light.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.enquiryRowTitle} numberOfLines={1}>
                      {enq.traderBusinessName}
                    </Text>
                    <Text style={styles.enquiryRowSub} numberOfLines={1}>
                      {enq.serviceRequired}
                    </Text>
                  </View>
                  <Text style={styles.enquiryRowStatus}>
                    {STATUS_LABEL[enq.status] ?? enq.status}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {showCustomerSections && savedTraders.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Saved traders</Text>
              <Pressable onPress={() => router.push('/(tabs)/saved-traders')} style={styles.seeAllBtn}>
                <Text style={styles.seeAll}>See all</Text>
                <Feather name="arrow-right" size={13} color={Colors.light.primary} />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {savedTraders.map((trader) => (
                <View key={trader.id} style={styles.featuredCardWrapper}>
                  <TraderCard trader={trader} />
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {showFeaturedSection && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Featured Traders
                {location.city && !location.isLoading && (
                  <Text style={styles.sectionLocation}> in {location.city}</Text>
                )}
              </Text>
              <Pressable onPress={() => router.push('/(tabs)/traders')} style={styles.seeAllBtn}>
                <Text style={styles.seeAll}>See all</Text>
                <Feather name="arrow-right" size={13} color={Colors.light.primary} />
              </Pressable>
            </View>

            {isLoadingFeatured ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={Colors.light.primary} />
                <Text style={styles.loadingText}>Loading traders...</Text>
              </View>
            ) : featuredTraders.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
                {featuredTraders.map((trader) => (
                  <View key={trader.id} style={styles.featuredCardWrapper}>
                    {/* Section is headed "Featured Traders in {city}", so show
                        the matching service area when the trader serves that
                        city (falls back to their town when there's no match). */}
                    <TraderCard trader={trader} searchLocation={location.city} />
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}>
                  <Feather name="award" size={28} color={Colors.light.featured} />
                </View>
                <Text style={styles.emptyTitle}>Featured traders coming soon</Text>
                <Text style={styles.emptySubtext}>
                  {location.city
                    ? `Be the first featured trader in ${location.city}`
                    : 'Be the first to get featured in your area'}
                </Text>
                <Pressable style={styles.emptyCtaBtn} onPress={() => router.push('/pricing')}>
                  <Text style={styles.emptyCtaText}>
                    {premiumMonthlyPrice ? `Get featured · from ${premiumMonthlyPrice}/month` : 'Get featured'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* Trader upsell — never shown to logged-in customers, and hidden
            once the trader already has an active Premium subscription
            (nothing left to upsell). */}
        {showTraderPromos && !hasTraderSubscription ? (
          <Pressable style={styles.traderCtaBanner} onPress={() => router.push('/pricing')}>
            <View style={styles.traderCtaLeft}>
              <View style={styles.traderCtaBadge}>
                <Text style={styles.traderCtaBadgeText}>PROMOTE YOUR BUSINESS</Text>
              </View>
              <Text style={styles.traderCtaTitle}>Stand out in local searches</Text>
              <Text style={styles.traderCtaSub}>
                {premiumMonthlyPrice ? `Get featured from ${premiumMonthlyPrice}/month` : 'Explore Premium promotion'}
              </Text>
            </View>
            <View style={styles.traderCtaArrow}>
              <Feather name="arrow-right" size={18} color={Colors.light.primary} />
            </View>
          </Pressable>
        ) : null}

        <HomeFooter />
      </ScrollView>

      <RadiusSheet
        visible={radiusSheetVisible}
        selected={radius}
        onSelect={(value) => {
          setRadius(value);
          setRadiusSheetVisible(false);
        }}
        onClose={() => setRadiusSheetVisible(false)}
      />
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
    color: Colors.light.textSecondaryStrong,
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
    color: Colors.light.textSecondaryStrong,
    letterSpacing: 0.2,
  },
  locationTextMuted: {
    color: Colors.light.textMuted,
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
  radiusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: -6,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  radiusRowText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.textSecondaryStrong,
    letterSpacing: 0.2,
  },
  searchBar: {
    backgroundColor: Colors.light.card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.borderLight,
  },
  searchBarPressed: {
    backgroundColor: Colors.light.cardElevated,
    borderColor: `${Colors.light.primary}55`,
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
    fontSize: 14,
    color: Colors.light.textSecondaryStrong,
    letterSpacing: 0.1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  trustSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  trustItem: {
    alignItems: 'center',
    flex: 1,
    gap: 5,
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
    color: Colors.light.textSecondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  section: {
    marginBottom: 24,
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
    flexShrink: 1,
  },
  sectionLocation: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.light.textSecondaryStrong,
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
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
    rowGap: 8,
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
  loadingText: {
    color: Colors.light.textSecondaryStrong,
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
    color: Colors.light.textSecondaryStrong,
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
    color: Colors.light.textSecondaryStrong,
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
  quoteCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.light.primary,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  quoteCtaPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
  quoteCtaIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quoteCtaArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quoteCtaTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.light.white,
    letterSpacing: 0.2,
  },
  quoteCtaSub: {
    fontSize: 12,
    color: Colors.light.white,
    opacity: 0.92,
    marginTop: 2,
    lineHeight: 16,
  },
  enquiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  enquiryRowIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enquiryRowTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.text,
  },
  enquiryRowSub: {
    fontSize: 12,
    color: Colors.light.textSecondaryStrong,
    marginTop: 2,
  },
  enquiryRowStatus: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.primary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
