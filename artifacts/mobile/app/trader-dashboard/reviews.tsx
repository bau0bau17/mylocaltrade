import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import {
  useGetMyTraderReviews,
  useReplyToReview,
  type Review,
} from '@workspace/api-client-react';

const STATUS_STYLES: Record<Review['status'], { bg: string; fg: string; label: string }> = {
  PENDING: { bg: 'rgba(245, 158, 11, 0.14)', fg: '#B45309', label: 'Pending review' },
  APPROVED: { bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857', label: 'Public' },
  REJECTED: { bg: 'rgba(239, 68, 68, 0.14)', fg: '#B91C1C', label: 'Rejected' },
  FLAGGED: { bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151', label: 'Flagged' },
};

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Feather key={n} name="star" size={size} color={n <= rating ? Colors.light.featured : Colors.light.border} />
      ))}
    </View>
  );
}

export default function TraderReviewsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useGetMyTraderReviews({
    query: { queryKey: ['/api/trader/reviews'] },
  });
  const { mutateAsync: replyToReview, isPending: replying } = useReplyToReview();

  const [replyOpen, setReplyOpen] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');

  const submitReply = async (reviewId: number) => {
    const text = replyText.trim();
    if (text.length < 1) {
      Alert.alert('Empty reply', 'Please enter a reply before posting.');
      return;
    }
    try {
      await replyToReview({ id: reviewId, data: { reply: text } });
      setReplyOpen(null);
      setReplyText('');
      await refetch();
    } catch (e) {
      Alert.alert('Could not post reply', e instanceof Error ? e.message : 'Try again later.');
    }
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.light.primary} />
      </View>
    );
  }

  const reviews: Review[] = data?.reviews ?? [];
  const avg = data?.averageRating ?? null;
  const count = data?.totalCount ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <View style={[styles.headerRow, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={Colors.light.text} />
        </Pressable>
        <Text style={styles.headerTitle}>My reviews</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={Colors.light.primary} />}
      >
        <View style={styles.summary}>
          <Text style={styles.avgValue}>{avg != null ? avg.toFixed(1) : '—'}</Text>
          <Stars rating={Math.round(avg ?? 0)} size={18} />
          <Text style={styles.avgLabel}>
            {count === 0 ? 'No public reviews yet' : `${count} public review${count === 1 ? '' : 's'}`}
          </Text>
        </View>

        {reviews.length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="message-circle" size={22} color={Colors.light.textMuted} />
            <Text style={styles.emptyText}>
              You haven't received any reviews yet. They'll appear here once customers leave feedback.
            </Text>
          </View>
        ) : (
          reviews.map((r) => {
            const status = STATUS_STYLES[r.status];
            const isReplyOpen = replyOpen === r.id;
            return (
              <View key={r.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewer}>{r.customerName}</Text>
                    <Text style={styles.reviewDate}>
                      {new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                    <Text style={[styles.statusText, { color: status.fg }]}>{status.label}</Text>
                  </View>
                </View>

                <Stars rating={r.rating} />
                <Text style={styles.reviewText}>{r.text}</Text>

                {r.status === 'REJECTED' && r.moderationNotes ? (
                  <View style={styles.modNote}>
                    <Text style={styles.modNoteLabel}>Moderator's note</Text>
                    <Text style={styles.modNoteText}>{r.moderationNotes}</Text>
                  </View>
                ) : null}

                {r.traderReply ? (
                  <View style={styles.replyBox}>
                    <View style={styles.replyHead}>
                      <Feather name="corner-down-right" size={12} color={Colors.light.primary} />
                      <Text style={styles.replyLabel}>Your reply</Text>
                      {r.status === 'APPROVED' && (
                        <Pressable
                          onPress={() => {
                            setReplyOpen(r.id);
                            setReplyText(r.traderReply ?? '');
                          }}
                          hitSlop={8}
                        >
                          <Text style={styles.editLink}>Edit</Text>
                        </Pressable>
                      )}
                    </View>
                    <Text style={styles.replyText}>{r.traderReply}</Text>
                  </View>
                ) : r.status === 'APPROVED' && !isReplyOpen ? (
                  <Pressable
                    style={styles.replyBtn}
                    onPress={() => {
                      setReplyOpen(r.id);
                      setReplyText('');
                    }}
                  >
                    <Feather name="message-square" size={13} color={Colors.light.primary} />
                    <Text style={styles.replyBtnText}>Reply publicly</Text>
                  </Pressable>
                ) : null}

                {isReplyOpen && (
                  <View style={styles.replyEditor}>
                    <TextInput
                      value={replyText}
                      onChangeText={setReplyText}
                      placeholder="Thank the customer or address their feedback constructively..."
                      placeholderTextColor={Colors.light.textMuted}
                      multiline
                      numberOfLines={4}
                      maxLength={2000}
                      style={styles.replyInput}
                    />
                    <View style={styles.replyActions}>
                      <Pressable
                        style={styles.cancelBtn}
                        onPress={() => {
                          setReplyOpen(null);
                          setReplyText('');
                        }}
                      >
                        <Text style={styles.cancelBtnText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.postBtn, replying && { opacity: 0.6 }]}
                        onPress={() => submitReply(r.id)}
                        disabled={replying}
                      >
                        {replying ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.postBtnText}>Post reply</Text>}
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.light.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: Colors.light.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.border },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.text },
  summary: { padding: 16, marginBottom: 16, backgroundColor: Colors.light.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.light.border, alignItems: 'flex-start', gap: 6 },
  avgValue: { fontSize: 32, fontWeight: '700', color: Colors.light.text },
  avgLabel: { fontSize: 12, color: Colors.light.textMuted, marginTop: 4 },
  emptyBox: { padding: 18, borderRadius: 12, backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 13, color: Colors.light.textMuted, textAlign: 'center', lineHeight: 18 },
  card: { backgroundColor: Colors.light.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.light.border, marginBottom: 12, gap: 10 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  reviewer: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  reviewDate: { fontSize: 11, color: Colors.light.textMuted, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  reviewText: { fontSize: 13, color: Colors.light.text, lineHeight: 19 },
  modNote: { padding: 10, borderRadius: 10, backgroundColor: Colors.light.errorMuted, borderWidth: 1, borderColor: Colors.light.error },
  modNoteLabel: { fontSize: 10, fontWeight: '700', color: Colors.light.error, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 },
  modNoteText: { fontSize: 12, color: Colors.light.error, lineHeight: 17 },
  replyBox: { padding: 10, borderRadius: 10, backgroundColor: Colors.light.primaryMuted },
  replyHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  replyLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: Colors.light.primary, flex: 1 },
  editLink: { fontSize: 11, fontWeight: '700', color: Colors.light.primary },
  replyText: { fontSize: 12, color: Colors.light.text, lineHeight: 17 },
  replyBtn: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: Colors.light.primary, backgroundColor: Colors.light.primaryMuted },
  replyBtnText: { fontSize: 12, fontWeight: '700', color: Colors.light.primary },
  replyEditor: { gap: 8 },
  replyInput: { backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 10, padding: 10, color: Colors.light.text, fontSize: 13, minHeight: 90, textAlignVertical: 'top' },
  replyActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: Colors.light.border, backgroundColor: Colors.light.surface },
  cancelBtnText: { fontSize: 12, fontWeight: '600', color: Colors.light.text },
  postBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.light.primary, minWidth: 90, alignItems: 'center' },
  postBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
});
