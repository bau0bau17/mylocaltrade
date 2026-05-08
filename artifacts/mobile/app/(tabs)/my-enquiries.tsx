import React from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useGetEnquiries, getGetEnquiriesQueryKey } from '@workspace/api-client-react';
import { EnquiryCard } from '@/components/EnquiryCard';
import { useAuth } from '@/contexts/AuthContext';

export default function MyEnquiriesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const { data, isLoading } = useGetEnquiries({
    query: { enabled: !isAdmin, queryKey: getGetEnquiriesQueryKey() },
  });

  if (isAdmin) {
    return (
      <View style={[styles.centered, { padding: 32 }]}>
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
              <EnquiryCard enquiry={item} />
              <Pressable
                style={styles.openConvBtn}
                onPress={() => router.push('/messages')}
              >
                <Feather name="message-circle" size={14} color={Colors.light.primary} />
                <Text style={styles.openConvBtnText}>Open conversation</Text>
              </Pressable>
              {item.status !== 'pending' && (
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
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
        />
      ) : (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No enquiries yet</Text>
          <Text style={styles.emptySubtitle}>
            When you send enquiries to traders, they will appear here.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: Colors.light.text, marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: Colors.light.textSecondary, textAlign: 'center', lineHeight: 20 },
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
});
