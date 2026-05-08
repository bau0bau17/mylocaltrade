import React, { useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import Colors from '@/constants/colors';
import { EnquiryCard } from '@/components/EnquiryCard';
import { useGetEnquiries, useGetNewLeadCount, getGetEnquiriesQueryKey } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';

export default function LeadsScreen() {
  const insets = useSafeAreaInsets();
  const { isTrader } = useAuth();

  const { data, isLoading, refetch, isRefetching } = useGetEnquiries({
    query: { enabled: isTrader, queryKey: getGetEnquiriesQueryKey() },
  });
  const { data: newCountData, refetch: refetchNewCount } = useGetNewLeadCount({
    query: { queryKey: ['/api/enquiries/new-count'], enabled: isTrader },
  });
  const newCount = newCountData?.newCount ?? 0;

  // Refresh badge whenever the user returns to the screen — opening a lead
  // stamps `traderViewedAt` server-side, so the count should drop on return.
  useFocusEffect(
    useCallback(() => {
      void refetchNewCount();
    }, [refetchNewCount])
  );

  const handleRefresh = useCallback(() => {
    void refetch();
    void refetchNewCount();
  }, [refetch, refetchNewCount]);

  if (!isTrader) {
    return (
      <View style={[styles.centerContainer, { padding: 32 }]}>
        <Text style={styles.title}>Traders only</Text>
        <Text style={styles.subtitle}>
          Customer enquiries are only visible to verified trader accounts.
        </Text>
      </View>
    );
  }

  if (isLoading && !isRefetching) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {newCount > 0 ? (
        <View style={styles.header}>
          <Text style={styles.subtitle}>{newCount > 99 ? '99+' : `${newCount} new`} enquiries to review</Text>
        </View>
      ) : null}

      <FlatList
        data={data?.enquiries || []}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => <EnquiryCard enquiry={item} />}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No leads yet</Text>
            <Text style={styles.emptySubtitle}>When customers send you enquiries, they will appear here.</Text>
          </View>
        }
      />
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
  },
  header: {
    padding: 20,
    paddingBottom: 12,
    backgroundColor: Colors.light.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.3,
  },
  badge: {
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    color: Colors.light.white,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
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
  },
});