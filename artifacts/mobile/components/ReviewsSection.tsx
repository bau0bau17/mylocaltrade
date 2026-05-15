import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useGetTraderReviews, type Review } from '@workspace/api-client-react';

type SortKey = 'recent' | 'high' | 'low';
type RatingFilter = 'all' | '5' | '4' | '3low';

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'recent', label: 'Most recent' },
  { key: 'high', label: 'Highest' },
  { key: 'low', label: 'Lowest' },
];

const FILTER_OPTIONS: Array<{ key: RatingFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: '5', label: '5★' },
  { key: '4', label: '4★' },
  { key: '3low', label: '3★ & below' },
];

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

  const [sort, setSort] = useState<SortKey>('recent');
  const [filter, setFilter] = useState<RatingFilter>('all');

  const all: Review[] = data?.reviews ?? [];
  const avg = data?.averageRating ?? null;
  const count = data?.totalCount ?? 0;

  const filterCounts = useMemo(() => {
    let five = 0;
    let four = 0;
    let threeOrLower = 0;
    for (const r of all) {
      if (r.rating === 5) five += 1;
      else if (r.rating === 4) four += 1;
      else if (r.rating <= 3) threeOrLower += 1;
    }
    return { all: all.length, '5': five, '4': four, '3low': threeOrLower } as Record<RatingFilter, number>;
  }, [all]);

  const distribution = useMemo(() => {
    const buckets: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of all) {
      const k = Math.max(1, Math.min(5, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
      buckets[k] += 1;
    }
    return buckets;
  }, [all]);

  const visible = useMemo(() => {
    let list = [...all];
    if (filter === '5') list = list.filter((r) => r.rating === 5);
    else if (filter === '4') list = list.filter((r) => r.rating === 4);
    else if (filter === '3low') list = list.filter((r) => r.rating <= 3);

    if (sort === 'recent') {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sort === 'high') {
      list.sort((a, b) => b.rating - a.rating || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else {
      list.sort((a, b) => a.rating - b.rating || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return list;
  }, [all, sort, filter]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.light.primary} />
      </View>
    );
  }

  return (
    <View>
      <View style={styles.summary}>
        <Text style={styles.avgValue}>{avg != null ? avg.toFixed(1) : '—'}</Text>
        <Stars rating={Math.round(avg ?? 0)} size={16} />
        <Text style={styles.avgLabel}>
          {count === 0 ? 'No reviews yet' : `${count} review${count === 1 ? '' : 's'}`}
        </Text>
      </View>

      {count > 0 && (
        <View style={styles.distribution}>
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const n = distribution[star];
            const pct = count > 0 ? Math.round((n / count) * 100) : 0;
            return (
              <View key={star} style={styles.distRow}>
                <Text style={styles.distStar}>{star}★</Text>
                <View style={styles.distTrack}>
                  <View style={[styles.distFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.distCount}>{n}</Text>
              </View>
            );
          })}
        </View>
      )}

      {count > 0 && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {SORT_OPTIONS.map((opt) => {
              const active = sort === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setSort(opt.key)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {FILTER_OPTIONS.map((opt) => {
              const active = filter === opt.key;
              const bucketCount = filterCounts[opt.key];
              const empty = bucketCount === 0;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    if (empty) return;
                    setFilter(opt.key);
                  }}
                  disabled={empty}
                  style={[
                    styles.chip,
                    styles.filterChip,
                    active && styles.chipActive,
                    empty && styles.chipEmpty,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      active && styles.chipTextActive,
                      empty && styles.chipTextEmpty,
                    ]}
                  >
                    {opt.label} ({bucketCount})
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      )}

      {count === 0 ? (
        <View style={styles.emptyBox}>
          <Feather name="message-circle" size={20} color={Colors.light.textMuted} />
          <Text style={styles.emptyText}>
            Be the first to leave a review after this trader responds to your enquiry.
          </Text>
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.emptyBox}>
          <Feather name="filter" size={18} color={Colors.light.textMuted} />
          <Text style={styles.emptyText}>No reviews match the selected filter.</Text>
        </View>
      ) : (
        visible.map((r) => (
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
  summary: { paddingVertical: 12, gap: 4 },
  avgValue: { fontSize: 28, fontWeight: '700', color: Colors.light.text, marginBottom: 4 },
  avgLabel: { fontSize: 12, color: Colors.light.textMuted, marginTop: 4 },
  distribution: { gap: 4, paddingVertical: 8, marginBottom: 4 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  distStar: { width: 22, fontSize: 11, fontWeight: '600', color: Colors.light.textSecondary },
  distTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.light.surface, overflow: 'hidden' },
  distFill: { height: '100%', backgroundColor: Colors.light.featured, borderRadius: 3 },
  distCount: { width: 28, textAlign: 'right', fontSize: 11, color: Colors.light.textMuted, fontVariant: ['tabular-nums'] },
  chipRow: { flexDirection: 'row', gap: 6, paddingVertical: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: Colors.light.border, backgroundColor: Colors.light.card },
  filterChip: { backgroundColor: Colors.light.surface },
  chipActive: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  chipEmpty: { opacity: 0.45 },
  chipText: { fontSize: 11, fontWeight: '600', color: Colors.light.text },
  chipTextActive: { color: '#fff' },
  chipTextEmpty: { color: Colors.light.textMuted },
  emptyBox: { padding: 16, borderRadius: 12, backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border, alignItems: 'center', gap: 6, marginTop: 8 },
  emptyText: { fontSize: 13, color: Colors.light.textMuted, textAlign: 'center', lineHeight: 18 },
  reviewCard: { backgroundColor: Colors.light.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.light.border, marginTop: 8 },
  reviewHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  reviewer: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  reviewDate: { fontSize: 11, color: Colors.light.textMuted, marginTop: 2 },
  reviewText: { fontSize: 13, color: Colors.light.text, lineHeight: 19 },
  replyBox: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: Colors.light.primaryMuted },
  replyHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  replyLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: Colors.light.primary },
  replyText: { fontSize: 12, color: Colors.light.text, lineHeight: 17 },
});
