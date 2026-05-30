import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, Pressable, ActivityIndicator, ScrollView, Modal } from 'react-native';
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

function FilterChip({ icon, label, active, onPress }: { icon?: FeatherIconName; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={[chipStyles.chip, active && chipStyles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {icon ? (
        <Feather name={icon} size={13} color={active ? Colors.light.white : Colors.light.textSecondary} />
      ) : null}
      <Text style={[chipStyles.chipText, active && chipStyles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Pressable
      onPress={onRemove}
      hitSlop={8}
      style={chipStyles.activeChip}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${label} filter`}
    >
      <Text style={chipStyles.activeChipText}>{label}</Text>
      <Feather name="x" size={13} color={Colors.light.primary} />
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 13,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
  },
  chipActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    letterSpacing: 0.2,
  },
  chipTextActive: {
    color: Colors.light.white,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingLeft: 13,
    paddingRight: 10,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: Colors.light.primary,
    backgroundColor: Colors.light.primaryMuted,
  },
  activeChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.primary,
    letterSpacing: 0.2,
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
  const [showFilters, setShowFilters] = useState(false);

  const activeSpecialism = specialismFilter
    ? SPECIALISMS.find((s) => s.key === specialismFilter) ?? null
    : null;

  const clearAllFilters = () => {
    setVerifiedOnly(false);
    setPlanFilter('all');
    setSpecialismFilter(null);
    setSort('recommended');
  };

  const activeFilters: { key: string; label: string; onRemove: () => void }[] = [
    ...(sort !== 'recommended'
      ? [{ key: 'sort', label: SORT_LABELS[sort], onRemove: () => setSort('recommended') }]
      : []),
    ...(verifiedOnly
      ? [{ key: 'verified', label: 'Verified only', onRemove: () => setVerifiedOnly(false) }]
      : []),
    ...(planFilter === 'premium_plus'
      ? [{ key: 'plan', label: 'Premium+', onRemove: () => setPlanFilter('all') }]
      : []),
    ...(planFilter === 'elite'
      ? [{ key: 'plan', label: 'Elite', onRemove: () => setPlanFilter('all') }]
      : []),
    ...(activeSpecialism
      ? [{ key: 'specialism', label: activeSpecialism.label, onRemove: () => setSpecialismFilter(null) }]
      : []),
  ];
  const activeCount = activeFilters.length;

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
    setHasSearched(true);
    if (searchQuery) saveRecentSearch(searchQuery);
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
          <View style={styles.filterBar}>
            <Pressable
              style={styles.filtersButton}
              onPress={() => setShowFilters(true)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Open filters"
            >
              <Feather name="sliders" size={14} color={Colors.light.white} />
              <Text style={styles.filtersButtonText}>Filters</Text>
              {activeCount > 0 && (
                <View style={styles.filterCountBadge}>
                  <Text style={styles.filterCountText}>{activeCount}</Text>
                </View>
              )}
            </Pressable>
            {activeFilters.length > 0 ? (
              activeFilters.map((f) => (
                <ActiveChip key={f.key + f.label} label={f.label} onRemove={f.onRemove} />
              ))
            ) : (
              <Text style={styles.filterHint}>Sort, verify, plan &amp; specialisms</Text>
            )}
          </View>

          <Modal
            visible={showFilters}
            transparent
            animationType="slide"
            onRequestClose={() => setShowFilters(false)}
          >
            <View style={styles.sheetBackdrop}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowFilters(false)} />
              <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>Filters</Text>
                  <Pressable
                    onPress={() => setShowFilters(false)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Close filters"
                  >
                    <Feather name="x" size={22} color={Colors.light.textSecondary} />
                  </Pressable>
                </View>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
                  <Text style={styles.sheetSection}>Sort by</Text>
                  <View style={styles.sheetGroup}>
                    {(['recommended', 'rating', 'reviews', 'newest'] as const).map((key) => (
                      <FilterChip
                        key={key}
                        label={SORT_LABELS[key]}
                        active={sort === key}
                        onPress={() => setSort(key)}
                      />
                    ))}
                  </View>

                  <Text style={styles.sheetSection}>Verification</Text>
                  <View style={styles.sheetGroup}>
                    <FilterChip
                      icon="check-circle"
                      label="Verified only"
                      active={verifiedOnly}
                      onPress={() => setVerifiedOnly((v) => !v)}
                    />
                  </View>

                  <Text style={styles.sheetSection}>Plan</Text>
                  <View style={styles.sheetGroup}>
                    <FilterChip
                      icon="star"
                      label="Premium+"
                      active={planFilter === 'premium_plus'}
                      onPress={() => setPlanFilter((p) => (p === 'premium_plus' ? 'all' : 'premium_plus'))}
                    />
                    <FilterChip
                      icon="zap"
                      label="Elite"
                      active={planFilter === 'elite'}
                      onPress={() => setPlanFilter((p) => (p === 'elite' ? 'all' : 'elite'))}
                    />
                  </View>

                  <Text style={styles.sheetSection}>Specialism</Text>
                  <View style={styles.sheetGroup}>
                    {SPECIALISMS.map((spec) => (
                      <FilterChip
                        key={spec.key}
                        icon={spec.icon}
                        label={spec.label}
                        active={specialismFilter === spec.key}
                        onPress={() => toggleSpecialism(spec.key)}
                      />
                    ))}
                  </View>
                </ScrollView>
                <View style={styles.sheetFooter}>
                  <Pressable
                    onPress={clearAllFilters}
                    hitSlop={8}
                    disabled={activeCount === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Clear all filters"
                  >
                    <Text style={[styles.sheetClear, activeCount === 0 && styles.sheetClearDisabled]}>
                      Clear all
                    </Text>
                  </Pressable>
                  <Pressable style={styles.sheetApply} onPress={() => setShowFilters(false)}>
                    <Text style={styles.sheetApplyText}>
                      {isLoading ? 'Show results' : `Show ${data?.total ?? 0} results`}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
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
              <Text style={styles.emptySubtitle}>
                {verifiedOnly || planFilter !== 'all' || specialismFilter !== null
                  ? 'No traders match these filters. Try clearing them, or widen your location.'
                  : 'Try adjusting your search or location.'}
              </Text>
              {activeCount > 0 && (
                <Pressable
                  style={styles.emptyAction}
                  onPress={clearAllFilters}
                  accessibilityRole="button"
                  accessibilityLabel="Clear filters"
                >
                  <Feather name="refresh-ccw" size={14} color={Colors.light.primary} />
                  <Text style={styles.emptyActionText}>Clear filters</Text>
                </Pressable>
              )}
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
  filterBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 2,
  },
  filtersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: Colors.light.primary,
  },
  filtersButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.white,
    letterSpacing: 0.2,
  },
  filterCountBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: Colors.light.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.light.primary,
  },
  filterHint: {
    fontSize: 13,
    color: Colors.light.textMuted,
    letterSpacing: 0.2,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.light.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: 20,
    maxHeight: '85%',
    borderTopWidth: 1,
    borderColor: Colors.light.border,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.light.borderLight,
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.3,
  },
  sheetContent: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  sheetSection: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.light.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 10,
  },
  sheetGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  sheetClear: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.textSecondary,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  sheetClearDisabled: {
    color: Colors.light.textMuted,
    opacity: 0.6,
  },
  sheetApply: {
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 24,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetApplyText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.light.white,
    letterSpacing: 0.3,
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
  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.light.primaryMuted,
    borderWidth: 1,
    borderColor: Colors.light.primary,
  },
  emptyActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.primary,
    letterSpacing: 0.2,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    textAlign: 'center',
  },
});
