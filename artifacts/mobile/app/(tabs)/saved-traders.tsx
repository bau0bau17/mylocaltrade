import React from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useGetSavedTraders } from '@workspace/api-client-react';
import { TraderCard } from '@/components/TraderCard';

export default function SavedTradersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, isLoading } = useGetSavedTraders();

  return (
    <View style={styles.container}>
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      ) : data?.traders && data.traders.length > 0 ? (
        <FlatList
          data={data.traders}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <TraderCard trader={item} />}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
        />
      ) : (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No saved traders</Text>
          <Text style={styles.emptySubtitle}>
            Browse traders and tap the bookmark icon to save them here.
          </Text>
          <Pressable
            style={styles.emptyCta}
            onPress={() => router.push('/(tabs)/search')}
            accessibilityRole="button"
            accessibilityLabel="Find a trader"
          >
            <Feather name="search" size={16} color="#fff" />
            <Text style={styles.emptyCtaText}>Find a trader</Text>
          </Pressable>
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
  centered: {
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
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: Colors.light.primary,
    borderRadius: 12,
  },
  emptyCtaText: { fontSize: 14, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
});
