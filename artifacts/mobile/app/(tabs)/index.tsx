import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useGetFeaturedTraders } from '@workspace/api-client-react';
import { CategoryCard } from '@/components/CategoryCard';
import { TraderCard } from '@/components/TraderCard';
import type { FeatherIconName } from '@/types/feather-icons';

const CATEGORIES: { name: string; icon: FeatherIconName }[] = [
  { name: 'Plumber', icon: 'droplet' },
  { name: 'Electrician', icon: 'zap' },
  { name: 'Roofer', icon: 'home' },
  { name: 'Cleaner', icon: 'sun' },
  { name: 'Painter', icon: 'edit-2' },
  { name: 'Builder', icon: 'tool' },
  { name: 'Locksmith', icon: 'key' },
  { name: 'Removals', icon: 'truck' },
  { name: 'Handyman', icon: 'settings' },
  { name: 'Heating', icon: 'thermometer' },
];

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: featuredData, isLoading: isLoadingFeatured } = useGetFeaturedTraders({ limit: 5 });

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.appName}>MyLocalTrade</Text>
            <Text style={styles.headerSubtitle}>Find Trusted Tradespeople</Text>
          </View>
          <View style={styles.headerIcon}>
            <Feather name="grid" size={20} color={Colors.light.primary} />
          </View>
        </View>
        
        <Pressable 
          style={styles.searchBar}
          onPress={() => router.push('/(tabs)/search')}
        >
          <View style={styles.searchIconWrap}>
            <Feather name="search" size={18} color={Colors.light.primary} />
          </View>
          <Text style={styles.searchText}>What service do you need?</Text>
          <Feather name="sliders" size={16} color={Colors.light.textMuted} />
        </Pressable>
      </View>

      <ScrollView 
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 84 + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.trustSection}>
          <View style={styles.trustItem}>
            <View style={[styles.trustIconWrap, { backgroundColor: Colors.light.secondaryMuted }]}>
              <Feather name="check-circle" size={18} color={Colors.light.secondary} />
            </View>
            <Text style={styles.trustText}>1000+ Verified</Text>
          </View>
          <View style={styles.trustDivider} />
          <View style={styles.trustItem}>
            <View style={[styles.trustIconWrap, { backgroundColor: Colors.light.primaryMuted }]}>
              <Feather name="shield" size={18} color={Colors.light.primary} />
            </View>
            <Text style={styles.trustText}>UK Trusted</Text>
          </View>
          <View style={styles.trustDivider} />
          <View style={styles.trustItem}>
            <View style={[styles.trustIconWrap, { backgroundColor: Colors.light.featuredMuted }]}>
              <Feather name="star" size={18} color={Colors.light.featured} />
            </View>
            <Text style={styles.trustText}>Top Rated</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Categories</Text>
            <Text style={styles.sectionCount}>{CATEGORIES.length}</Text>
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
              <Text style={styles.seeAll}>See All</Text>
              <Feather name="arrow-right" size={14} color={Colors.light.primary} />
            </Pressable>
          </View>

          {isLoadingFeatured ? (
            <View style={styles.loadingContainer}>
              <View style={styles.loadingDot} />
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
              <Feather name="briefcase" size={28} color={Colors.light.textMuted} style={{ marginBottom: 8 }} />
              <Text style={styles.emptyText}>No featured traders yet</Text>
            </View>
          )}
        </View>

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
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  appName: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    backgroundColor: Colors.light.card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
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
    color: Colors.light.textMuted,
  },
  scrollContent: {
    padding: 16,
  },
  trustSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  trustItem: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  trustDivider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.light.border,
  },
  trustIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    textAlign: 'center',
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
  sectionCount: {
    display: 'none',
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
    padding: 32,
    alignItems: 'center',
    gap: 12,
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.light.primary,
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
  },
  emptyText: {
    color: Colors.light.textSecondary,
    fontSize: 13,
  }
});
