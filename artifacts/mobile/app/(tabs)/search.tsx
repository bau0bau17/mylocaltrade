import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Colors from '@/constants/colors';
import { TraderCard } from '@/components/TraderCard';
import { useListTraders } from '@workspace/api-client-react';

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  
  const [searchQuery, setSearchQuery] = useState(params.category as string || '');
  const [locationQuery, setLocationQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(!!params.category);

  useEffect(() => {
    loadRecentSearches();
  }, []);

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

  const { data, isLoading } = useListTraders({
    search: searchQuery,
    location: locationQuery,
  }, {
    query: {
      enabled: hasSearched,
    }
  });

  const handleSearch = () => {
    if (searchQuery || locationQuery) {
      setHasSearched(true);
      if (searchQuery) saveRecentSearch(searchQuery);
    }
  };

  const applyRecentSearch = (query: string) => {
    setSearchQuery(query);
    setHasSearched(true);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
        
        <View style={styles.searchForm}>
          <View style={styles.inputContainer}>
            <Feather name="search" size={20} color={Colors.light.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="What service do you need?"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')}>
                <Feather name="x-circle" size={16} color={Colors.light.textSecondary} />
              </Pressable>
            )}
          </View>
          
          <View style={styles.inputContainer}>
            <Feather name="map-pin" size={20} color={Colors.light.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="Town or Postcode"
              value={locationQuery}
              onChangeText={setLocationQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
          </View>

          <Pressable style={styles.searchButton} onPress={handleSearch}>
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
                <Feather name="clock" size={16} color={Colors.light.textSecondary} />
                <Text style={styles.recentText}>{search}</Text>
                <Feather name="arrow-up-left" size={16} color={Colors.light.textSecondary} />
              </Pressable>
            ))
          ) : (
            <Text style={styles.emptyText}>No recent searches</Text>
          )}
        </View>
      ) : (
        <View style={styles.resultsContainer}>
          <Text style={styles.resultsCount}>
            {isLoading ? 'Searching...' : `${data?.total || 0} results found`}
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
              <Feather name="search" size={48} color={Colors.light.textSecondary} style={{ marginBottom: 16 }} />
              <Text style={styles.emptyTitle}>No traders found</Text>
              <Text style={styles.emptySubtitle}>Try adjusting your search terms or location to find more results.</Text>
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
    padding: 16,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 16,
  },
  searchForm: {
    gap: 12,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 48,
  },
  input: {
    flex: 1,
    height: '100%',
    marginLeft: 8,
    fontSize: 16,
    color: Colors.light.text,
  },
  searchButton: {
    backgroundColor: Colors.light.primary,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  searchButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  recentSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 16,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  recentText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    color: Colors.light.text,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    fontStyle: 'italic',
  },
  resultsContainer: {
    flex: 1,
  },
  resultsCount: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.textSecondary,
    paddingHorizontal: 16,
    paddingTop: 16,
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
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  }
});