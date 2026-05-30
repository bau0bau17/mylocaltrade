import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import type { TraderProfile } from '@workspace/api-client-react';

const PLAN_STYLES = {
  premium: { bg: Colors.light.primaryMuted, color: Colors.light.primary, label: 'Premium' },
  basic: { bg: Colors.light.border, color: Colors.light.textSecondary, label: 'Basic' },
};

export function formatResponseTime(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 60) return `Replies in ~${Math.max(1, Math.round(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 24) return `Replies in ~${Math.round(hours)}h`;
  const days = hours / 24;
  return `Replies in ~${Math.round(days)}d`;
}

const TOP_RATED_MIN_RATING = 4.7;
const TOP_RATED_MIN_REVIEWS = 5;
const FAST_RESPONDER_MAX_MINUTES = 60;
const PROMPT_RESPONDER_MAX_MINUTES = 24 * 60;

export function isTopRated(
  rating: number | null | undefined,
  reviewCount: number | null | undefined,
): boolean {
  return (
    typeof rating === 'number' &&
    Number.isFinite(rating) &&
    rating >= TOP_RATED_MIN_RATING &&
    typeof reviewCount === 'number' &&
    Number.isFinite(reviewCount) &&
    reviewCount >= TOP_RATED_MIN_REVIEWS
  );
}

export function isFastResponder(minutes: number | null | undefined): boolean {
  return (
    typeof minutes === 'number' &&
    Number.isFinite(minutes) &&
    minutes >= 0 &&
    minutes <= FAST_RESPONDER_MAX_MINUTES
  );
}

export function isPromptResponder(minutes: number | null | undefined): boolean {
  return (
    typeof minutes === 'number' &&
    Number.isFinite(minutes) &&
    minutes > FAST_RESPONDER_MAX_MINUTES &&
    minutes <= PROMPT_RESPONDER_MAX_MINUTES
  );
}

export function formatTenureSince(createdAt: Date | string | null | undefined): string | null {
  if (!createdAt) return null;
  const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  if (year >= new Date().getFullYear()) return null;
  return `Since ${year}`;
}

export function TraderCard({ trader }: { trader: TraderProfile }) {
  const router = useRouter();
  // Any non-basic, non-empty plan is Premium. This also normalises legacy
  // "trader" rows that predate the unified "premium" plan id.
  const isPremiumPlan = !!trader.plan && trader.plan !== 'basic';
  const planStyle = isPremiumPlan ? PLAN_STYLES.premium : undefined;
  const topRated = isTopRated(trader.rating, trader.reviewCount);
  const fastResponder = isFastResponder(trader.responseTimeMinutes);
  const promptResponder = !fastResponder && isPromptResponder(trader.responseTimeMinutes);
  const hasReviews = typeof trader.reviewCount === 'number' && trader.reviewCount > 0;
  const tenureLabel = formatTenureSince(trader.createdAt);
  const ratingLabel =
    typeof trader.rating === 'number' && Number.isFinite(trader.rating)
      ? trader.rating.toFixed(1)
      : '–';

  const ratingIsNumber = typeof trader.rating === 'number' && Number.isFinite(trader.rating);
  const reviewWord = trader.reviewCount === 1 ? 'review' : 'reviews';
  const reviewsPhrase = !hasReviews
    ? 'no reviews yet'
    : ratingIsNumber
    ? `${ratingLabel} stars from ${trader.reviewCount} ${reviewWord}`
    : `${trader.reviewCount} ${reviewWord}`;

  const planTierLabel =
    isPremiumPlan ? `${PLAN_STYLES.premium.label.toLowerCase()} member` : null;
  const accessibilityLabel = [
    trader.businessName,
    trader.mainCategory,
    trader.isVerified ? 'verified' : null,
    planTierLabel,
    topRated ? 'top rated' : null,
    fastResponder ? 'replies fast' : null,
    promptResponder ? 'replies promptly' : null,
    trader.town,
    reviewsPhrase,
    tenureLabel ? `on MyLocalTrade ${tenureLabel.toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/trader/${trader.id}`)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="View trader profile"
    >
      <View style={styles.header}>
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarLetter}>{trader.businessName.charAt(0)}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.businessName} numberOfLines={1}>{trader.businessName}</Text>
          <View style={styles.badgeRow}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{trader.mainCategory}</Text>
            </View>
            {trader.isVerified && (
              <View style={styles.verifiedBadge}>
                <Feather name="check-circle" size={10} color={Colors.light.success} />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            )}
            {planStyle && (
              <View style={[styles.planBadge, { backgroundColor: planStyle.bg }]}>
                <Text style={[styles.planText, { color: planStyle.color }]}>{planStyle.label}</Text>
              </View>
            )}
            {topRated && (
              <View style={styles.topRatedBadge}>
                <Feather name="star" size={10} color={Colors.light.featured} />
                <Text style={styles.topRatedText}>Top rated</Text>
              </View>
            )}
            {fastResponder && (
              <View style={styles.fastBadge}>
                <Feather name="zap" size={10} color={Colors.light.primary} />
                <Text style={styles.fastBadgeText}>Replies fast</Text>
              </View>
            )}
            {promptResponder && (
              <View style={styles.promptBadge}>
                <Feather name="clock" size={10} color={Colors.light.textSecondary} />
                <Text style={styles.promptBadgeText}>Replies promptly</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      <View style={styles.checkRow}>
        <Check label="Email" state={trader.emailVerified ? 'ok' : 'missing'} />
        <Check label="Phone" state={trader.phoneVerified ? 'ok' : 'missing'} />
        <Check label="Profile" state={trader.businessProfileCompleted ? 'ok' : 'missing'} />
        <Check
          label="Docs"
          state={
            trader.verificationStatus === 'VERIFIED'
              ? 'ok'
              : trader.documentsSubmitted
              ? 'pending'
              : 'missing'
          }
        />
      </View>
      <View style={styles.footer}>
        <View style={styles.footerItem}>
          <Feather name="map-pin" size={12} color={Colors.light.textMuted} />
          <Text style={styles.footerText}>{trader.town}</Text>
        </View>
        <View style={styles.footerItem}>
          <Feather name="star" size={12} color={Colors.light.featured} />
          <Text style={styles.footerText}>
            {hasReviews ? `${ratingLabel} (${trader.reviewCount})` : 'New'}
          </Text>
        </View>
        {formatResponseTime(trader.responseTimeMinutes) ? (
          <View style={styles.footerItem}>
            <Feather name="clock" size={12} color={Colors.light.textMuted} />
            <Text style={styles.footerText}>{formatResponseTime(trader.responseTimeMinutes)}</Text>
          </View>
        ) : null}
        {tenureLabel ? (
          <View style={styles.footerItem}>
            <Feather name="calendar" size={12} color={Colors.light.textMuted} />
            <Text style={styles.footerText}>{tenureLabel}</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <Feather name="chevron-right" size={16} color={Colors.light.textMuted} />
      </View>
    </Pressable>
  );
}

function Check({ label, state }: { label: string; state: 'ok' | 'pending' | 'missing' }) {
  const cfg =
    state === 'ok'
      ? { icon: 'check' as const, color: Colors.light.success, bg: 'rgba(16, 185, 129, 0.10)' }
      : state === 'pending'
      ? { icon: 'clock' as const, color: '#B45309', bg: 'rgba(245, 158, 11, 0.14)' }
      : { icon: 'x' as const, color: Colors.light.textMuted, bg: 'rgba(107, 114, 128, 0.10)' };
  return (
    <View style={[styles.checkChip, { backgroundColor: cfg.bg }]}>
      <Feather name={cfg.icon} size={10} color={cfg.color} />
      <Text style={[styles.checkText, { color: cfg.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  header: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarLetter: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  headerInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  businessName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    rowGap: 6,
  },
  categoryBadge: {
    backgroundColor: Colors.light.primaryMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  categoryText: {
    fontSize: 11,
    color: Colors.light.primary,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 3,
  },
  planText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 3,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.success,
    letterSpacing: 0.2,
  },
  topRatedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 3,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
  },
  topRatedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
    letterSpacing: 0.2,
  },
  fastBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 3,
    backgroundColor: Colors.light.primaryMuted,
  },
  fastBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.primary,
    letterSpacing: 0.2,
  },
  promptBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 3,
    backgroundColor: Colors.light.border,
  },
  promptBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textSecondary,
    letterSpacing: 0.2,
  },
  checkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  checkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  checkText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
    gap: 4,
  },
  footerText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
});
