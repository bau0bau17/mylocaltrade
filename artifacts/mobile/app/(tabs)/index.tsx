import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useGetFeaturedTraders } from '@workspace/api-client-react';
import { CategoryCard } from '@/components/CategoryCard';
import { TraderCard } from '@/components/TraderCard';

const CATEGORIES = [
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
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.appName}>MyLocalTrade</Text>
        <Text style={styles.headerSubtitle}>Find Trusted Local Tradespeople</Text>
        
        <Pressable 
          style={styles.searchBar}
          onPress={() => router.push('/(tabs)/search')}
        >
          <Feather name="search" size={20} color={Colors.light.textSecondary} />
          <Text style={styles.searchText}>What service do you need?</Text>
        </Pressable>
      </View>

      <ScrollView 
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 84 + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.trustSection}>
          <View style={styles.trustItem}>
            <Feather name="check-circle" size={24} color={Colors.light.secondary} />
            <Text style={styles.trustText}>1000+ Verified Traders</Text>
          </View>
          <View style={styles.trustItem}>
            <Feather name="shield" size={24} color={Colors.light.secondary} />
            <Text style={styles.trustText}>Trusted by UK Homeowners</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Categories</Text>
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
            <Pressable onPress={() => router.push('/(tabs)/traders')}>
              <Text style={styles.seeAll}>See All</Text>
            </Pressable>
          </View>

          {isLoadingFeatured ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Loading featured traders...</Text>
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
              <Feather name="briefcase" size={32} color={Colors.light.textSecondary} style={{ marginBottom: 8 }} />
              <Text style={styles.emptyText}>No featured traders found.</Text>
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
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 16,
    paddingBottom: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  appName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#E0E7FF',
    marginBottom: 20,
  },
  searchBar: {
    backgroundColor: '#FFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchText: {
    marginLeft: 12,
    fontSize: 16,
    color: Colors.light.textSecondary,
  },
  scrollContent: {
    padding: 16,
  },
  trustSection: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  trustItem: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  trustText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.light.text,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
  },
  seeAll: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.primary,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  categoryWrapper: {
    width: '50%',
  },
  horizontalScroll: {
    paddingRight: 16,
  },
  featuredCardWrapper: {
    width: 280,
    marginRight: 16,
  },
  loadingContainer: {
    padding: 24,
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.light.textSecondary,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  emptyText: {
    color: Colors.light.textSecondary,
    fontSize: 14,
  }
});