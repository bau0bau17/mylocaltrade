import React from 'react';
import { View, Text, StyleSheet, FlatList, ScrollView, ActivityIndicator, Pressable, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import {
  useGetEnquiries,
  getGetEnquiriesQueryKey,
  useGetEligibleEnquiriesForReview,
} from '@workspace/api-client-react';
import { EnquiryCard } from '@/components/EnquiryCard';
import { useAuth } from '@/contexts/AuthContext';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

export default function MyEnquiriesScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const { data, isLoading, refetch: refetchEnquiries } = useGetEnquiries({
    query: { enabled: !isAdmin, queryKey: getGetEnquiriesQueryKey() },
  });
  // A review can only be left once the customer has confirmed the job is done
  // (and not on cancelled or already-reviewed jobs). The eligible endpoint is
  // the single source of truth, so we only surface the review button for
  // enquiries it returns.
  const { data: eligibleData, refetch: refetchEligible } = useGetEligibleEnquiriesForReview({
    query: { enabled: !isAdmin, queryKey: ['/api/reviews/eligible'] },
  });
  const { refreshing, onRefresh } = usePullToRefresh(refetchEnquiries, refetchEligible);
  const eligibleIds = React.useMemo(
    () => new Set((eligibleData?.enquiries ?? []).map((e) => e.enquiryId)),
    [eligibleData],
  );

  if (isAdmin) {
    return (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIconWrap}>
          <Feather name="slash" size={24} color={Colors.light.textMuted} />
        </View>
        <Text style={styles.emptyTitle}>Not available for admins</Text>
        <Text style={styles.emptySubtitle}>
          Admin accounts don't send enquiries. Use a customer account for this.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      ) : data?.enquiries && data.enquiries.length > 0 ? (
        <FlatList
          data={data.enquiries}
          keyExtractor={(item) => String(item.id)}
          ListHeaderComponent={
            <Pressable
              style={styles.compareBtn}
              onPress={() => router.push('/compare-offers')}
            >
              <Feather name="bar-chart-2" size={16} color="#fff" />
              <Text style={styles.compareBtnText}>Compare offers side-by-side</Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <View>
              <EnquiryCard enquiry={item} viewerRole="customer" />
              {item.conversationId != null ? (
                <Pressable
                  style={styles.openConvBtn}
                  onPress={() => router.push(`/messages/${item.conversationId}`)}
                >
                  <Feather name="message-circle" size={14} color={Colors.light.primary} />
                  <Text style={styles.openConvBtnText}>Open conversation</Text>
                </Pressable>
              ) : (
                <View style={styles.awaitingHint}>
                  <Feather name="clock" size={13} color={Colors.light.textSecondary} />
                  <Text style={styles.awaitingHintText}>
                    Conversation opens when the trader replies
                  </Text>
                </View>
              )}
              {eligibleIds.has(item.id) && (
                <Pressable
                  style={styles.reviewBtn}
                  onPress={() =>
                    router.push(`/write-review/${item.traderId}?enquiryId=${item.id}`)
                  }
                >
                  <Feather name="star" size={14} color={Colors.light.featured} />
                  <Text style={styles.reviewBtnText}>Leave a review for this trader</Text>
                </Pressable>
              )}
            </View>
          )}
          contentContainerStyle={{ padding: 16, paddingBottom: tabBarHeight + insets.bottom + 20 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.light.primary} />
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.light.primary} />
          }
        >
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIconWrap}>
              <Feather name="inbox" size={24} color={Colors.light.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No enquiries yet</Text>
            <Text style={styles.emptySubtitle}>
              When you send enquiries to traders, they will appear here.
            </Text>
            <Pressable
              style={[styles.compareBtn, styles.emptyCta]}
              onPress={() => router.push('/(tabs)/search')}
              accessibilityRole="button"
              accessibilityLabel="Find a trader"
            >
              <Feather name="search" size={16} color="#fff" />
              <Text style={styles.compareBtnText}>Find a trader</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  // Empty/blocked states anchor in the upper portion of the screen (shared
  // app pattern) instead of floating in the middle of a blank area.
  emptyWrap: { flex: 1, alignItems: 'center', paddingHorizontal: 32, paddingTop: 48 },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: Colors.light.text, marginBottom: 4 },
  emptySubtitle: { fontSize: 13, color: Colors.light.textSecondary, textAlign: 'center', lineHeight: 19 },
  reviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: -6,
    marginBottom: 14,
    paddingVertical: 10,
    backgroundColor: Colors.light.featuredMuted,
    borderRadius: 12,
  },
  reviewBtnText: { fontSize: 13, fontWeight: '700', color: Colors.light.featured, letterSpacing: 0.2 },
  openConvBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: -6,
    marginBottom: 8,
    paddingVertical: 10,
    backgroundColor: Colors.light.primaryMuted,
    borderRadius: 12,
  },
  openConvBtnText: { fontSize: 13, fontWeight: '700', color: Colors.light.primary, letterSpacing: 0.2 },
  awaitingHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: -6,
    marginBottom: 8,
    paddingVertical: 8,
  },
  awaitingHintText: { fontSize: 12, color: Colors.light.textSecondary, fontStyle: 'italic' },
  compareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    paddingVertical: 12,
    backgroundColor: Colors.light.primary,
    borderRadius: 12,
  },
  compareBtnText: { fontSize: 14, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
  emptyCta: { marginTop: 20, marginHorizontal: 0, paddingHorizontal: 24, alignSelf: 'center' },
});
