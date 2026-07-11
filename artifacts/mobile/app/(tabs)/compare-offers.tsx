import React from 'react';
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
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import {
  useCompareEnquiries,
  useGetEligibleEnquiriesForReview,
  getCompareEnquiriesQueryKey,
  type CompareOffer,
  type CompareGroup,
} from '@workspace/api-client-react';

function fmtPounds(amountPence: number) {
  const pounds = amountPence / 100;
  return `£${pounds.toLocaleString('en-GB', {
    minimumFractionDigits: pounds % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** A PENDING quote whose validUntil has passed is shown as expired. */
function effectiveQuoteStatus(q: NonNullable<CompareOffer['quote']>): string {
  if (q.status === 'PENDING' && q.validUntil && new Date(q.validUntil).getTime() <= Date.now()) {
    return 'EXPIRED';
  }
  return q.status;
}

export default function CompareOffersScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const { isAdmin } = useAuth();

  const { data, isLoading, error, refetch, isRefetching } = useCompareEnquiries({
    query: { enabled: !isAdmin, queryKey: getCompareEnquiriesQueryKey() },
  });
  const groups: CompareGroup[] = data?.groups ?? [];

  // Review buttons are only shown for jobs that are actually reviewable
  // (confirmed done, not cancelled, not yet reviewed) per the eligible endpoint.
  const { data: eligibleData } = useGetEligibleEnquiriesForReview({
    query: { enabled: !isAdmin, queryKey: ['/api/reviews/eligible'] },
  });
  const eligibleIds = React.useMemo(
    () => new Set((eligibleData?.enquiries ?? []).map((e) => e.enquiryId)),
    [eligibleData],
  );

  if (isAdmin) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Not available for admins</Text>
      </View>
    );
  }

  if (isLoading) {
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
        <Text style={styles.emptySubtitle}>
          {error instanceof Error ? error.message : 'Failed to load offers'}
        </Text>
        <Pressable style={styles.retryBtn} onPress={() => refetch()}>
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
          Send enquiries to a few traders for the same job and their quotes will
          appear here side by side.
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
      contentContainerStyle={{ padding: 16, paddingBottom: tabBarHeight + insets.bottom + 24 }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          tintColor={Colors.light.primary}
        />
      }
    >
      <Text style={styles.intro}>
        Each card below groups the traders you've contacted for the same job.
        Swipe horizontally inside a card to compare their quotes.
      </Text>

      {groups.map((group) => (
        <View key={group.requestGroupId} style={styles.groupCard}>
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
                reviewEligible={eligibleIds.has(offer.enquiryId)}
                onOpenChat={
                  offer.conversationId
                    ? () =>
                        router.push({
                          pathname: `/messages/${offer.conversationId}` as never,
                          params: { returnTo: '/compare-offers' },
                        } as never)
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
  reviewEligible,
  onOpenChat,
  onViewProfile,
  onLeaveReview,
}: {
  offer: CompareOffer;
  reviewEligible: boolean;
  onOpenChat: (() => void) | null;
  onViewProfile: () => void;
  onLeaveReview: () => void;
}) {
  const quote = offer.quote ?? null;
  const quoteStatus = quote ? effectiveQuoteStatus(quote) : null;
  const ratingIsNumber = offer.traderRating != null && Number.isFinite(offer.traderRating);
  const repliesFast =
    offer.traderResponseTimeMinutes != null && offer.traderResponseTimeMinutes <= 60;

  const reviewWord = offer.traderReviewCount === 1 ? 'review' : 'reviews';
  const ratingPhrase =
    ratingIsNumber && offer.traderReviewCount > 0
      ? `${offer.traderRating!.toFixed(1)} stars from ${offer.traderReviewCount} ${reviewWord}`
      : ratingIsNumber
      ? `${offer.traderRating!.toFixed(1)} stars`
      : offer.traderReviewCount > 0
      ? `${offer.traderReviewCount} ${reviewWord}`
      : 'no rating yet';
  const quotePhrase = quote
    ? `quoted ${fmtPounds(quote.amountPence)} ${quote.priceType === 'FIXED' ? 'fixed price' : 'estimate'}, ${
        (QUOTE_STATUS_META[quoteStatus ?? ''] ?? { label: quoteStatus ?? '' }).label
      }`.toLowerCase()
    : offer.hasTraderReply
    ? 'trader replied, no quote yet'
    : `awaiting trader reply, enquiry sent ${formatRelative(offer.enquiryCreatedAt)}`;
  const summaryLabel = [
    offer.traderBusinessName,
    offer.traderTown ? `in ${offer.traderTown}` : null,
    offer.traderVerified ? 'verified' : null,
    ratingPhrase,
    quotePhrase,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.offerCard}>
      <View accessible accessibilityLabel={summaryLabel}>
        <View style={styles.offerTop}>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.traderName} numberOfLines={1}>{offer.traderBusinessName}</Text>
              {offer.traderVerified ? (
                <Feather name="check-circle" size={12} color={Colors.light.success} />
              ) : null}
            </View>
            {offer.traderTown ? (
              <Text style={styles.traderTown} numberOfLines={1}>
                <Feather name="map-pin" size={10} color={Colors.light.textSecondary} /> {offer.traderTown}
              </Text>
            ) : null}
          </View>
          <StagePill offer={offer} quoteStatus={quoteStatus} />
        </View>

        <View style={styles.ratingRow}>
          <Feather name="star" size={12} color={Colors.light.featured} />
          {offer.traderReviewCount === 0 ? (
            <Text style={styles.ratingText}>New</Text>
          ) : (
            <>
              <Text style={styles.ratingText}>
                {offer.traderRating != null ? offer.traderRating.toFixed(1) : 'No rating'}
              </Text>
              <Text style={styles.reviewCount}>
                ({offer.traderReviewCount} {offer.traderReviewCount === 1 ? 'review' : 'reviews'})
              </Text>
            </>
          )}
          {repliesFast ? (
            <View style={styles.fastBadge}>
              <Feather name="zap" size={9} color="#B45309" />
              <Text style={styles.fastBadgeText}>Replies fast</Text>
            </View>
          ) : null}
        </View>

        {quote ? (
          <View style={[styles.quoteBox, quoteStatus === 'ACCEPTED' && styles.quoteBoxAccepted]}>
            <View style={styles.quoteTopRow}>
              <Text style={styles.quoteLabel}>Quote</Text>
              <QuoteStatusPill status={quoteStatus!} />
            </View>
            <View style={styles.quoteAmountRow}>
              <Text style={styles.quoteAmount}>{fmtPounds(quote.amountPence)}</Text>
              <Text style={styles.quotePriceType}>
                {quote.priceType === 'FIXED' ? 'Fixed price' : 'Estimate'}
              </Text>
            </View>
            <Text style={styles.quoteDescription} numberOfLines={3}>
              {quote.description}
            </Text>
            {quoteStatus === 'PENDING' && quote.validUntil ? (
              <Text style={styles.quoteValidity}>Valid until {fmtDate(quote.validUntil)}</Text>
            ) : quoteStatus === 'EXPIRED' && quote.validUntil ? (
              <Text style={styles.quoteValidity}>Expired {fmtDate(quote.validUntil)}</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.replyBox}>
            <Text style={styles.replyLabel}>
              {offer.hasTraderReply ? 'No quote yet' : 'Awaiting reply'}
            </Text>
            <Text style={styles.replyMuted}>
              {offer.hasTraderReply
                ? 'The trader has replied but not sent a quote yet. Open the chat to ask for one.'
                : `Sent ${formatRelative(offer.enquiryCreatedAt)}. The trader has not responded yet.`}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.ctaCol}>
        {onOpenChat ? (
          <Pressable
            style={styles.primaryCta}
            onPress={onOpenChat}
            accessibilityRole="button"
            accessibilityLabel={
              quoteStatus === 'PENDING'
                ? `View quote from ${offer.traderBusinessName}`
                : `Open chat with ${offer.traderBusinessName}`
            }
          >
            <Feather
              name={quoteStatus === 'PENDING' ? 'file-text' : 'message-circle'}
              size={14}
              color="#fff"
            />
            <Text style={styles.primaryCtaText}>
              {quoteStatus === 'PENDING' ? 'View quote' : 'Open chat'}
            </Text>
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
        {reviewEligible ? (
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

const QUOTE_STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  PENDING: { label: 'Quote received', bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' },
  ACCEPTED: { label: 'Accepted', bg: 'rgba(6, 214, 160, 0.18)', fg: '#047857' },
  DECLINED: { label: 'Declined', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
  WITHDRAWN: { label: 'Withdrawn', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
  EXPIRED: { label: 'Expired', bg: 'rgba(245, 158, 11, 0.14)', fg: '#B45309' },
  REVISED: { label: 'Revised', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
};

function QuoteStatusPill({ status }: { status: string }) {
  const v = QUOTE_STATUS_META[status] ?? QUOTE_STATUS_META.DECLINED;
  return (
    <View style={[styles.pill, { backgroundColor: v.bg }]}>
      <Text style={[styles.pillText, { color: v.fg }]}>{v.label}</Text>
    </View>
  );
}

const STAGE_META: Record<string, { label: string; bg: string; fg: string }> = {
  HIRED: { label: 'Hired', bg: 'rgba(59, 130, 246, 0.14)', fg: '#1D4ED8' },
  AWAITING_CUSTOMER_CONFIRMATION: { label: 'Confirm done', bg: 'rgba(245, 158, 11, 0.14)', fg: '#B45309' },
  JOB_DONE: { label: 'Job done', bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' },
  CANCELLED: { label: 'Cancelled', bg: 'rgba(239, 71, 111, 0.14)', fg: '#BE123C' },
  CLOSED: { label: 'Closed', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
};
const AWAITING_PILL = { label: 'Awaiting', bg: 'rgba(245, 158, 11, 0.14)', fg: '#B45309' };
const REPLIED_PILL = { label: 'Replied', bg: 'rgba(59, 130, 246, 0.14)', fg: '#1D4ED8' };
const QUOTED_PILL = { label: 'Quoted', bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' };

function StagePill({ offer, quoteStatus }: { offer: CompareOffer; quoteStatus: string | null }) {
  let v;
  if (offer.stage && STAGE_META[offer.stage]) {
    v = STAGE_META[offer.stage];
  } else if (quoteStatus === 'PENDING' || quoteStatus === 'ACCEPTED') {
    v = QUOTED_PILL;
  } else if (offer.hasTraderReply) {
    v = REPLIED_PILL;
  } else {
    v = AWAITING_PILL;
  }
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  traderName: { fontSize: 14, fontWeight: '700', color: Colors.light.text, flexShrink: 1 },
  traderTown: { fontSize: 11, color: Colors.light.textSecondary, marginTop: 2 },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  ratingText: { fontSize: 12, fontWeight: '700', color: Colors.light.text },
  reviewCount: { fontSize: 11, color: Colors.light.textSecondary },
  fastBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    marginLeft: 4,
  },
  fastBadgeText: { fontSize: 9, fontWeight: '700', color: '#B45309', letterSpacing: 0.2 },

  quoteBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.surface ?? '#F9FAFB',
    padding: 10,
    gap: 5,
    marginTop: 8,
  },
  quoteBoxAccepted: { borderColor: Colors.light.success },
  quoteTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quoteLabel: { fontSize: 10, fontWeight: '700', color: Colors.light.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  quoteAmountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  quoteAmount: { fontSize: 20, fontWeight: '800', color: Colors.light.text },
  quotePriceType: { fontSize: 11, fontWeight: '600', color: Colors.light.textSecondary },
  quoteDescription: { fontSize: 12, color: Colors.light.text, lineHeight: 17 },
  quoteValidity: { fontSize: 10, fontWeight: '600', color: Colors.light.textSecondary },

  replyBox: { borderRadius: 10, backgroundColor: Colors.light.surface ?? '#F9FAFB', padding: 10, gap: 4, marginTop: 8 },
  replyLabel: { fontSize: 10, fontWeight: '700', color: Colors.light.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  replyMuted: { fontSize: 12, color: Colors.light.textSecondary, fontStyle: 'italic', lineHeight: 17 },

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
