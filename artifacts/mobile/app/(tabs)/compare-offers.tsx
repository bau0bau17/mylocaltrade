import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

type Offer = {
  enquiryId: number;
  enquiryStatus: string;
  enquiryCreatedAt: string;
  traderProfileId: number;
  traderUserId: number;
  traderBusinessName: string;
  traderTown: string | null;
  traderRating: number | null;
  traderReviewCount: number;
  conversationId: number | null;
  traderStatus: 'NEW' | 'CONTACTED' | 'QUOTED' | 'COMPLETED' | null;
  conversationStatus: string | null;
  lastMessageAt: string | null;
  lastTraderReplyPreview: string | null;
  lastTraderReplyAt: string | null;
  hasTraderReply: boolean;
};

type Group = { serviceRequired: string; offers: Offer[] };

export default function CompareOffersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, isAdmin } = useAuth();
  const apiUrl = getApiUrl();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      const res = await fetch(`${apiUrl}/api/enquiries/compare`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { groups: Group[] };
      setGroups(data.groups);
    } catch (e: any) {
      setError(e?.message || 'Failed to load offers');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiUrl, token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isAdmin) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Not available for admins</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Couldn't load offers</Text>
        <Text style={styles.emptySubtitle}>{error}</Text>
        <Pressable style={styles.retryBtn} onPress={() => { setLoading(true); void load(); }}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (groups.length === 0) {
    return (
      <View style={styles.centered}>
        <Feather name="inbox" size={42} color={Colors.light.textSecondary} />
        <Text style={styles.emptyTitle}>No offers to compare yet</Text>
        <Text style={styles.emptySubtitle}>
          Send enquiries to a few traders for the same job and they'll appear here
          side by side so you can compare their replies.
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
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); void load(); }}
          tintColor={Colors.light.primary}
        />
      }
    >
      <Text style={styles.intro}>
        Each card below groups the traders you've contacted for the same job.
        Swipe horizontally inside a card to compare their responses.
      </Text>

      {groups.map((group) => (
        <View key={group.serviceRequired} style={styles.groupCard}>
          <View style={styles.groupHeader}>
            <Feather name="briefcase" size={14} color={Colors.light.primary} />
            <Text style={styles.groupTitle} numberOfLines={2}>{group.serviceRequired}</Text>
            <Text style={styles.groupCount}>{group.offers.length} {group.offers.length === 1 ? 'trader' : 'traders'}</Text>
          </View>

          {group.offers.length === 1 ? (
            <View style={styles.singleHintBox}>
              <Text style={styles.singleHint}>
                Only one trader contacted so far. Send the same enquiry to a few
                more from the same trade so you can compare quotes here.
              </Text>
              <Pressable
                style={styles.singleHintCta}
                onPress={() => router.push('/(tabs)/search')}
                accessibilityRole="button"
                accessibilityLabel="Find more traders"
              >
                <Feather name="search" size={12} color={Colors.light.primary} />
                <Text style={styles.singleHintCtaText}>Find more traders</Text>
              </Pressable>
            </View>
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.offersRow}
          >
            {group.offers.map((offer) => (
              <OfferCard
                key={offer.enquiryId}
                offer={offer}
                onOpenChat={
                  offer.conversationId
                    ? () => router.push(`/messages/${offer.conversationId}`)
                    : null
                }
                onViewProfile={() => router.push(`/trader/${offer.traderProfileId}`)}
                onLeaveReview={() =>
                  router.push(
                    `/write-review/${offer.traderProfileId}?enquiryId=${offer.enquiryId}`,
                  )
                }
              />
            ))}
          </ScrollView>
        </View>
      ))}
    </ScrollView>
  );
}

function OfferCard({
  offer,
  onOpenChat,
  onViewProfile,
  onLeaveReview,
}: {
  offer: Offer;
  onOpenChat: (() => void) | null;
  onViewProfile: () => void;
  onLeaveReview: () => void;
}) {
  const ratingIsNumber = offer.traderRating != null && Number.isFinite(offer.traderRating);
  const reviewWord = offer.traderReviewCount === 1 ? 'review' : 'reviews';
  const ratingPhrase =
    ratingIsNumber && offer.traderReviewCount > 0
      ? `${offer.traderRating!.toFixed(1)} stars from ${offer.traderReviewCount} ${reviewWord}`
      : ratingIsNumber
      ? `${offer.traderRating!.toFixed(1)} stars`
      : offer.traderReviewCount > 0
      ? `${offer.traderReviewCount} ${reviewWord}`
      : 'no rating yet';
  const replyPhrase = offer.hasTraderReply
    ? `trader replied${offer.lastTraderReplyAt ? ` ${formatRelative(offer.lastTraderReplyAt)}` : ''}`
    : `awaiting trader reply, enquiry sent ${formatRelative(offer.enquiryCreatedAt)}`;
  const summaryLabel = [
    offer.traderBusinessName,
    offer.traderTown ? `in ${offer.traderTown}` : null,
    resolvePill(offer.traderStatus, offer.hasTraderReply).label.toLowerCase(),
    ratingPhrase,
    replyPhrase,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.offerCard}>
      <View accessible accessibilityLabel={summaryLabel}>
        <View style={styles.offerTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.traderName} numberOfLines={1}>{offer.traderBusinessName}</Text>
            {offer.traderTown ? (
              <Text style={styles.traderTown} numberOfLines={1}>
                <Feather name="map-pin" size={10} color={Colors.light.textSecondary} /> {offer.traderTown}
              </Text>
            ) : null}
          </View>
          <TraderStatusPill status={offer.traderStatus} hasReply={offer.hasTraderReply} />
        </View>

        <View style={styles.ratingRow}>
          <Feather name="star" size={12} color={Colors.light.featured} />
          <Text style={styles.ratingText}>
            {offer.traderRating != null ? offer.traderRating.toFixed(1) : 'No rating'}
          </Text>
          <Text style={styles.reviewCount}>
            ({offer.traderReviewCount} {offer.traderReviewCount === 1 ? 'review' : 'reviews'})
          </Text>
        </View>

        <View style={styles.replyBox}>
          <Text style={styles.replyLabel}>
            {offer.hasTraderReply ? 'Trader reply' : 'Awaiting reply'}
          </Text>
          {offer.hasTraderReply ? (
            <>
              <Text style={styles.replyBody} numberOfLines={5}>
                {offer.lastTraderReplyPreview}
              </Text>
              <Text style={styles.replyTime}>
                {offer.lastTraderReplyAt ? formatRelative(offer.lastTraderReplyAt) : ''}
              </Text>
            </>
          ) : (
            <Text style={styles.replyMuted}>
              Sent {formatRelative(offer.enquiryCreatedAt)}. The trader has not
              responded yet.
            </Text>
          )}
        </View>
      </View>

      <View style={styles.ctaCol}>
        {onOpenChat ? (
          <Pressable
            style={styles.primaryCta}
            onPress={onOpenChat}
            accessibilityRole="button"
            accessibilityLabel={`Open chat with ${offer.traderBusinessName}`}
          >
            <Feather name="message-circle" size={14} color="#fff" />
            <Text style={styles.primaryCtaText}>Open chat</Text>
          </Pressable>
        ) : (
          <View style={styles.awaitingChat}>
            <Feather name="clock" size={12} color={Colors.light.textSecondary} />
            <Text style={styles.awaitingChatText}>Chat opens when trader replies</Text>
          </View>
        )}
        <Pressable
          style={styles.secondaryCta}
          onPress={onViewProfile}
          accessibilityRole="button"
          accessibilityLabel={`View ${offer.traderBusinessName}'s profile`}
        >
          <Feather name="user" size={14} color={Colors.light.primary} />
          <Text style={styles.secondaryCtaText}>View profile</Text>
        </Pressable>
        {offer.enquiryStatus !== 'pending' && offer.hasTraderReply ? (
          <Pressable
            style={styles.reviewCta}
            onPress={onLeaveReview}
            accessibilityRole="button"
            accessibilityLabel={`Leave a review for ${offer.traderBusinessName}`}
          >
            <Feather name="star" size={14} color={Colors.light.featured} />
            <Text style={styles.reviewCtaText}>Leave review</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const PILL_MAP: Record<string, { label: string; bg: string; fg: string }> = {
  NEW: { label: 'New', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
  CONTACTED: { label: 'Contacted', bg: 'rgba(59, 130, 246, 0.14)', fg: '#1D4ED8' },
  QUOTED: { label: 'Quoted', bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' },
  COMPLETED: { label: 'Completed', bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' },
};
const AWAITING_PILL = { label: 'Awaiting', bg: 'rgba(245, 158, 11, 0.14)', fg: '#B45309' };

function resolvePill(status: Offer['traderStatus'], hasReply: boolean) {
  if (status && PILL_MAP[status]) return PILL_MAP[status];
  if (hasReply) return PILL_MAP.CONTACTED;
  return AWAITING_PILL;
}

function TraderStatusPill({
  status,
  hasReply,
}: {
  status: Offer['traderStatus'];
  hasReply: boolean;
}) {
  const v = resolvePill(status, hasReply);
  return (
    <View style={[styles.pill, { backgroundColor: v.bg }]}>
      <Text style={[styles.pillText, { color: v.fg }]}>{v.label}</Text>
    </View>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.light.text, marginTop: 8 },
  emptySubtitle: { fontSize: 14, color: Colors.light.textSecondary, textAlign: 'center', lineHeight: 20 },
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
    alignSelf: 'center',
  },
  emptyCtaText: { fontSize: 14, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
  awaitingChat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  awaitingChatText: { fontSize: 11, color: Colors.light.textSecondary, fontStyle: 'italic' },
  retryBtn: { marginTop: 12, paddingHorizontal: 18, height: 40, borderRadius: 10, backgroundColor: Colors.light.primary, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  intro: { fontSize: 13, color: Colors.light.textSecondary, lineHeight: 18, marginBottom: 14 },

  groupCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.light.text },
  groupCount: { fontSize: 11, fontWeight: '700', color: Colors.light.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },

  singleHintBox: { gap: 8 },
  singleHint: { fontSize: 12, color: Colors.light.textSecondary, lineHeight: 17, fontStyle: 'italic' },
  singleHintCta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.primary,
    backgroundColor: 'transparent',
  },
  singleHintCtaText: { fontSize: 12, fontWeight: '700', color: Colors.light.primary, letterSpacing: 0.2 },

  offersRow: { gap: 12, paddingVertical: 4 },
  offerCard: {
    width: 280,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
    padding: 12,
    gap: 10,
  },
  offerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  traderName: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  traderTown: { fontSize: 11, color: Colors.light.textSecondary, marginTop: 2 },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ratingText: { fontSize: 12, fontWeight: '700', color: Colors.light.text },
  reviewCount: { fontSize: 11, color: Colors.light.textSecondary },

  replyBox: { borderRadius: 10, backgroundColor: Colors.light.surface ?? '#F9FAFB', padding: 10, gap: 4 },
  replyLabel: { fontSize: 10, fontWeight: '700', color: Colors.light.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  replyBody: { fontSize: 12, color: Colors.light.text, lineHeight: 17 },
  replyTime: { fontSize: 10, color: Colors.light.textSecondary, marginTop: 2 },
  replyMuted: { fontSize: 12, color: Colors.light.textSecondary, fontStyle: 'italic' },

  ctaCol: { gap: 6 },
  primaryCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, borderRadius: 9, backgroundColor: Colors.light.primary },
  primaryCtaText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  secondaryCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 32, borderRadius: 9, backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.light.primary },
  secondaryCtaText: { color: Colors.light.primary, fontWeight: '700', fontSize: 12 },
  reviewCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 32, borderRadius: 9, backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.light.featured },
  reviewCtaText: { color: Colors.light.featured, fontWeight: '700', fontSize: 12 },

  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7 },
  pillText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
});
