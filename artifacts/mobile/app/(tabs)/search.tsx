import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Colors from '@/constants/colors';
import { TraderCard } from '@/components/TraderCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  useListTraders,
  getListTradersQueryKey,
  type ListTradersParams,
} from '@workspace/api-client-react';
import { useLocation } from '@/hooks/useLocation';
import type { FeatherIconName } from '@/types/feather-icons';
import { SPECIALISMS, type SpecialismKey } from '@/constants/specialisms';

const SORT_LABELS: Record<'recommended' | 'rating' | 'reviews' | 'newest', string> = {
  recommended: 'Recommended',
  rating: 'Top rated',
  reviews: 'Most reviewed',
  newest: 'Newest',
};

function FilterChip({ icon, label, active, onPress }: { icon: FeatherIconName; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[chipStyles.chip, active && chipStyles.chipActive]}
    >
      <Feather name={icon} size={12} color={active ? Colors.light.white : Colors.light.textSecondary} />
      <Text style={[chipStyles.chipText, active && chipStyles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    letterSpacing: 0.2,
  },
  chipTextActive: {
    color: Colors.light.white,
  },
});

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const location = useLocation();

  const [searchQuery, setSearchQuery] = useState(params.category as string || '');
  const [locationQuery, setLocationQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(!!params.category);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [planFilter, setPlanFilter] = useState<'all' | 'premium_plus' | 'elite'>('all');
  const [specialismFilter, setSpecialismFilter] = useState<SpecialismKey | null>(null);
  const [sort, setSort] = useState<'recommended' | 'rating' | 'reviews' | 'newest'>('recommended');

  const activeSpecialism = specialismFilter
    ? SPECIALISMS.find((s) => s.key === specialismFilter) ?? null
    : null;

  useEffect(() => {
    loadRecentSearches();
  }, []);

  useEffect(() => {
    if (!location.isLoading && locationQuery === '' && !location.permissionDenied) {
      const autoLocation = location.city || location.postalCode || '';
      if (autoLocation) {
        setLocationQuery(autoLocation);
      }
    }
  }, [location.isLoading, location.city, location.postalCode, location.permissionDenied]);

  const loadRecentSearches = async () => {
    try {
      const stored = await AsyncStorage.getItem('recent_searches');
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const saveRecentSearch = async (query: string) => {
    if (!query.trim()) return;
    try {
      const newSearches = [query, ...recentSearches.filter(s => s !== query)].slice(0, 5);
      setRecentSearches(newSearches);
      await AsyncStorage.setItem('recent_searches', JSON.stringify(newSearches));
    } catch (e) {
      console.error(e);
    }
  };

  const searchParams: ListTradersParams = {
    search: searchQuery,
    location: locationQuery,
    sort,
    ...(verifiedOnly ? { verified: true } : {}),
    ...(planFilter !== 'all' ? { plan: planFilter } : {}),
    ...(activeSpecialism ? { specialism: activeSpecialism.keywords[0] } : {}),
  };
  const { data, isLoading } = useListTraders(searchParams, {
    query: {
      queryKey: getListTradersQueryKey(searchParams),
      enabled: hasSearched || !!activeSpecialism,
    },
  });

  const handleSearch = () => {
    if (searchQuery || locationQuery || activeSpecialism) {
      setHasSearched(true);
      if (searchQuery) saveRecentSearch(searchQuery);
    }
  };

  const toggleSpecialism = (key: SpecialismKey) => {
    setSpecialismFilter((prev) => (prev === key ? null : key));
    setHasSearched(true);
  };

  const applyRecentSearch = (query: string) => {
    setSearchQuery(query);
    setHasSearched(true);
  };

  const locationIcon: FeatherIconName = location.permissionDenied
    ? 'map-pin'
    : location.isLoading
    ? 'loader'
    : 'map-pin';
  const locationPlaceholder = location.isLoading
    ? 'Detecting location...'
    : location.permissionDenied
    ? 'Town or Postcode'
    : `Near ${location.label}`;

  return (
    <View style={styles.container}>
      <ScreenHeader variant="tab" title="Search" />
      <View style={styles.header}>
        <View style={styles.searchForm}>
          <View style={styles.inputContainer}>
            <Feather name="search" size={18} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Search plumber, electrician, roofer..."
              placeholderTextColor={Colors.light.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <Feather name="x-circle" size={16} color={Colors.light.textMuted} />
              </Pressable>
            )}
          </View>

          <View style={styles.inputContainer}>
            <Feather
              name={locationIcon}
              size={18}
              color={location.isLoading ? Colors.light.primary : Colors.light.secondary}
            />
            <TextInput
              style={styles.input}
              placeholder={locationPlaceholder}
              placeholderTextColor={location.isLoading ? Colors.light.primary : Colors.light.textMuted}
              value={locationQuery}
              onChangeText={setLocationQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            {locationQuery.length > 0 && (
              <Pressable onPress={() => setLocationQuery('')} hitSlop={8}>
                <Feather name="x-circle" size={16} color={Colors.light.textMuted} />
              </Pressable>
            )}
            {location.permissionDenied && (
              <Pressable onPress={location.refresh} hitSlop={8}>
                <Feather name="crosshair" size={16} color={Colors.light.primary} />
              </Pressable>
            )}
          </View>

          <Pressable style={styles.searchButton} onPress={handleSearch}>
            <Feather name="search" size={18} color={Colors.light.white} style={{ marginRight: 8 }} />
            <Text style={styles.searchButtonText}>Find Traders</Text>
          </Pressable>
        </View>
      </View>

      {!hasSearched ? (
        <View style={styles.recentSection}>
          <Text style={styles.sectionTitle}>Recent Searches</Text>
          {recentSearches.length > 0 ? (
            recentSearches.map((search, idx) => (
              <Pressable
                key={idx}
                style={styles.recentItem}
                onPress={() => applyRecentSearch(search)}
              >
                <View style={styles.recentIconWrap}>
                  <Feather name="clock" size={14} color={Colors.light.textMuted} />
                </View>
                <Text style={styles.recentText}>{search}</Text>
                <Feather name="arrow-up-left" size={14} color={Colors.light.textMuted} />
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyRecent}>
              <Feather name="search" size={32} color={Colors.light.textMuted} style={{ marginBottom: 8 }} />
              <Text style={styles.emptyText}>No recent searches</Text>
              {!location.isLoading && !location.permissionDenied && location.city && (
                <Text style={styles.emptySubText}>Searching near {location.city}</Text>
              )}
            </View>
          )}
        </View>
      ) : (
        <View style={styles.resultsContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersRow}
          >
            <FilterChip
              icon="sliders"
              label={`Sort: ${SORT_LABELS[sort]}`}
              active={sort !== 'recommended'}
              onPress={() => {
                const order: typeof sort[] = ['recommended', 'rating', 'reviews', 'newest'];
                setSort(order[(order.indexOf(sort) + 1) % order.length]);
              }}
            />
            <FilterChip
              icon="check-circle"
              label="Verified only"
              active={verifiedOnly}
              onPress={() => setVerifiedOnly(v => !v)}
            />
            <FilterChip
              icon="star"
              label="Premium+"
              active={planFilter === 'premium_plus'}
              onPress={() => setPlanFilter(p => p === 'premium_plus' ? 'all' : 'premium_plus')}
            />
            <FilterChip
              icon="zap"
              label="Elite"
              active={planFilter === 'elite'}
              onPress={() => setPlanFilter(p => p === 'elite' ? 'all' : 'elite')}
            />
            {SPECIALISMS.map((spec) => (
              <FilterChip
                key={spec.key}
                icon={spec.icon}
                label={spec.label}
                active={specialismFilter === spec.key}
                onPress={() => toggleSpecialism(spec.key)}
              />
            ))}
          </ScrollView>
          <Text style={styles.resultsCount}>
            {isLoading ? 'Searching...' : `${data?.total || 0} results found`}
            {!isLoading && locationQuery ? ` near ${locationQuery}` : ''}
          </Text>

          {isLoading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={Colors.light.primary} />
            </View>
          ) : data?.traders && data.traders.length > 0 ? (
            <FlatList
              data={data.traders}
              keyExtractor={item => item.id.toString()}
              renderItem={({ item }) => <TraderCard trader={item} />}
              contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 84 + 20 }}
              showsVerticalScrollIndicator={false}
            />
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Feather name="search" size={32} color={Colors.light.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>No traders found</Text>
              <Text style={styles.emptySubtitle}>Try adjusting your search or location</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    padding: 20,
    backgroundColor: Colors.light.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 16,
    letterSpacing: 0.3,
  },
  searchForm: {
    gap: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    gap: 10,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    color: Colors.light.text,
  },
  searchButton: {
    backgroundColor: Colors.light.primary,
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonText: {
    color: Colors.light.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  recentSection: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.light.textSecondary,
    marginBottom: 16,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  recentIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 15,
    color: Colors.light.text,
  },
  emptyRecent: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.light.textMuted,
  },
  emptySubText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    letterSpacing: 0.2,
  },
  resultsContainer: {
    flex: 1,
  },
  filtersRow: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  resultsCount: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.textMuted,
    paddingHorizontal: 20,
    paddingTop: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    textAlign: 'center',
  },
});
