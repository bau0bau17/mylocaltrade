import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useGetTraderReviews, type Review } from '@workspace/api-client-react';

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Feather
          key={n}
          name="star"
          size={size}
          color={n <= rating ? Colors.light.featured : Colors.light.border}
        />
      ))}
    </View>
  );
}

export function ReviewsSection({ traderId }: { traderId: number }) {
  const { data, isLoading } = useGetTraderReviews(traderId, {
    query: { queryKey: [`/api/traders/${traderId}/reviews`] },
  });

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.light.primary} />
      </View>
    );
  }

  const reviews: Review[] = data?.reviews ?? [];
  const avg = data?.averageRating ?? null;
  const count = data?.totalCount ?? 0;

  return (
    <View>
      <View style={styles.summary}>
        <View>
          <Text style={styles.avgValue}>{avg != null ? avg.toFixed(1) : '—'}</Text>
          <Stars rating={Math.round(avg ?? 0)} size={16} />
          <Text style={styles.avgLabel}>
            {count === 0 ? 'No reviews yet' : `${count} review${count === 1 ? '' : 's'}`}
          </Text>
        </View>
      </View>
      {reviews.length === 0 ? (
        <View style={styles.emptyBox}>
          <Feather name="message-circle" size={20} color={Colors.light.textMuted} />
          <Text style={styles.emptyText}>
            Be the first to leave a review after this trader responds to your enquiry.
          </Text>
        </View>
      ) : (
        reviews.map((r) => (
          <View key={r.id} style={styles.reviewCard}>
            <View style={styles.reviewHead}>
              <View>
                <Text style={styles.reviewer}>{r.customerName}</Text>
                <Text style={styles.reviewDate}>
                  {new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </Text>
              </View>
              <Stars rating={r.rating} />
            </View>
            <Text style={styles.reviewText}>{r.text}</Text>
            {r.traderReply ? (
              <View style={styles.replyBox}>
                <View style={styles.replyHead}>
                  <Feather name="corner-down-right" size={12} color={Colors.light.primary} />
                  <Text style={styles.replyLabel}>Trader's reply</Text>
                </View>
                <Text style={styles.replyText}>{r.traderReply}</Text>
              </View>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 24, alignItems: 'center' },
  summary: { paddingVertical: 12 },
  avgValue: { fontSize: 28, fontWeight: '700', color: Colors.light.text, marginBottom: 4 },
  avgLabel: { fontSize: 12, color: Colors.light.textMuted, marginTop: 4 },
  emptyBox: { padding: 16, borderRadius: 12, backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border, alignItems: 'center', gap: 6 },
  emptyText: { fontSize: 13, color: Colors.light.textMuted, textAlign: 'center', lineHeight: 18 },
  reviewCard: { backgroundColor: Colors.light.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.light.border },
  reviewHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  reviewer: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  reviewDate: { fontSize: 11, color: Colors.light.textMuted, marginTop: 2 },
  reviewText: { fontSize: 13, color: Colors.light.text, lineHeight: 19 },
  replyBox: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: Colors.light.primaryMuted },
  replyHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  replyLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: Colors.light.primary },
  replyText: { fontSize: 12, color: Colors.light.text, lineHeight: 17 },
});
