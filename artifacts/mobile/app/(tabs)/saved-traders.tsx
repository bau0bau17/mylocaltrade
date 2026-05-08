import React from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { useGetSavedTraders } from '@workspace/api-client-react';
import { TraderCard } from '@/components/TraderCard';

export default function SavedTradersScreen() {
  const insets = useSafeAreaInsets();
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
});
