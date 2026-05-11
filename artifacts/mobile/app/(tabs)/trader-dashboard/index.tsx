import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';
import type { FeatherIconName } from '@/types/feather-icons';
import { PromoCountdownBadge } from '@/components/PromoCountdownBadge';
import {
  useGetTraderOnboardingStatus,
  useGetMyTraderReviews,
  useGetNewLeadCount,
  type TraderOnboardingStatus,
  type TraderOnboardingChecklistStep,
} from '@workspace/api-client-react';

type StepState = TraderOnboardingChecklistStep['state'];
type ChecklistStep = TraderOnboardingChecklistStep;
type OnboardingStatus = TraderOnboardingStatus;

export default function TraderOnboardingDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user, isTrader, resendVerification } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [acceptingLegal, setAcceptingLegal] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const {
    data: status,
    isLoading: queryLoading,
    error: queryError,
    refetch: refetchStatus,
  } = useGetTraderOnboardingStatus({
    query: {
      queryKey: ['/api/trader/onboarding-status'],
      enabled: Boolean(token && isTrader),
    },
  });

  const { data: reviewsData, refetch: refetchReviews } = useGetMyTraderReviews({
    query: {
      queryKey: ['/api/trader/reviews'],
      enabled: Boolean(token && isTrader),
    },
  });

  const { data: newLeadsData, refetch: refetchNewLeads } = useGetNewLeadCount({
    query: {
      queryKey: ['/api/enquiries/new-count'],
      enabled: Boolean(token && isTrader),
    },
  });
  const newLeadsCount = newLeadsData?.newCount ?? 0;

  const fetchStatus = useCallback(async () => {
    await Promise.all([refetchStatus(), refetchReviews(), refetchNewLeads()]);
    setRefreshing(false);
  }, [refetchStatus, refetchReviews, refetchNewLeads]);

  useFocusEffect(
    useCallback(() => {
      void refetchStatus();
      void refetchReviews();
      void refetchNewLeads();
    }, [refetchStatus, refetchReviews, refetchNewLeads])
  );

  const loading = queryLoading;
  const error = acceptError ?? (queryError instanceof Error ? queryError.message : queryError ? 'Failed to load' : null);

  useEffect(() => {
    if (!resendMsg) return;
    const t = setTimeout(() => setResendMsg(null), 5000);
    return () => clearTimeout(t);
  }, [resendMsg]);

  const handleAcceptLegal = async () => {
    if (!token || !status?.legal?.needsReaccept || acceptingLegal) return;
    setAcceptingLegal(true);
    setAcceptError(null);
    try {
      // accept-terms isn't yet in the OpenAPI surface — keep raw fetch here
      // until that endpoint is modeled in the spec.
      const res = await fetch(`${getApiUrl()}/api/trader/accept-terms`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          acceptTerms: status.legal.termsNeedsReaccept,
          acceptPrivacy: status.legal.privacyNeedsReaccept,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to record acceptance');
      await refetchStatus();
    } catch (e) {
      setAcceptError(e instanceof Error ? e.message : 'Failed to record acceptance');
    } finally {
      setAcceptingLegal(false);
    }
  };

  const handleResend = async () => {
    if (!status?.email || resending) return;
    setResending(true);
    setResendMsg(null);
    try {
      await resendVerification(status.email);
      setResendMsg('Verification email sent. Check your inbox.');
    } catch (e) {
      setResendMsg(e instanceof Error ? e.message : 'Could not resend email');
    } finally {
      setResending(false);
    }
  };

  if (!isTrader) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 40 }]}>
        <Feather name="lock" size={32} color={Colors.light.textMuted} />
        <Text style={styles.errorText}>This dashboard is for trader accounts only.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 40 }]}>
        <ActivityIndicator color={Colors.light.primary} />
      </View>
    );
  }

  if (error || !status) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 40 }]}>
        <Feather name="alert-circle" size={28} color={Colors.light.error} />
        <Text style={styles.errorText}>{error || 'Unable to load your onboarding status.'}</Text>
        <Pressable style={styles.retryBtn} onPress={fetchStatus}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const completedCount = status.checklist.filter(s => s.state === 'completed').length;
  const totalCount = status.checklist.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 80, paddingHorizontal: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchStatus(); }} tintColor={Colors.light.primary} />}
    >

      <PromoCountdownBadge />

      {/* Greeting card */}
      <View style={styles.greetingCard}>
        <Text style={styles.greetingHello}>Welcome, {user?.fullName || status.businessName}</Text>
        <Text style={styles.greetingBiz}>{status.businessName}</Text>
        <View style={[styles.statusPill, statusPillStyle(status.verificationStatus)]}>
          <Text style={[styles.statusPillText, statusPillTextStyle(status.verificationStatus)]}>
            {prettyStatus(status.verificationStatus)}
          </Text>
        </View>
        <Text style={styles.statusMessage}>
          {status.isPublic
            ? 'Your trader profile is live and visible in search.'
            : `Your trader profile is not live yet. ${status.message}`}
        </Text>
      </View>

      {/* Phase 8: terms / privacy re-accept banner */}
      {status.legal?.needsReaccept ? (
        <View style={styles.legalBanner}>
          <View style={styles.legalBannerHeader}>
            <Feather name="file-text" size={16} color={WARNING} />
            <Text style={styles.legalBannerTitle}>
              {status.legal.termsNeedsReaccept && status.legal.privacyNeedsReaccept
                ? 'Updated Terms & Privacy Policy'
                : status.legal.termsNeedsReaccept
                ? 'Updated Terms of Service'
                : 'Updated Privacy Policy'}
            </Text>
          </View>
          <Text style={styles.legalBannerBody}>
            We&apos;ve updated our policies. Please review and re-accept to keep using your account.
          </Text>
          <Pressable
            onPress={handleAcceptLegal}
            disabled={acceptingLegal}
            style={[styles.legalBannerBtn, acceptingLegal && { opacity: 0.6 }]}
          >
            <Text style={styles.legalBannerBtnText}>
              {acceptingLegal ? 'Saving…' : 'Review & accept'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Progress bar */}
      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>Setup progress</Text>
          <Text style={styles.progressCount}>{completedCount} of {totalCount} steps</Text>
        </View>
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
        </View>
      </View>

      {/* Checklist */}
      <Text style={styles.sectionLabel}>Verification Checklist</Text>
      <View style={styles.checklistGroup}>
        {status.checklist.map((step, idx) => {
          let onAction: (() => void) | undefined;
          let actionLabel: string | undefined;
          if (step.key === 'email' && step.state === 'action_required') {
            onAction = handleResend;
            actionLabel = resending ? 'Sending…' : 'Resend email';
          } else if (step.key === 'phone' && step.state === 'action_required') {
            onAction = () => router.push('/trader-dashboard/verify-phone');
            actionLabel = 'Verify phone';
          } else if (step.key === 'business_profile' && step.state === 'action_required') {
            onAction = () => router.push('/trader-dashboard/business-profile');
            actionLabel = 'Complete profile';
          } else if (step.key === 'documents' && step.state === 'action_required') {
            onAction = () => router.push('/trader-dashboard/documents');
            actionLabel = 'Upload documents';
          } else if (step.key === 'subscription' && step.state === 'action_required') {
            onAction = () => router.push('/pricing');
            actionLabel = 'Choose plan';
          }
          return (
            <React.Fragment key={step.key}>
              <ChecklistRow step={step} onAction={onAction} actionLabel={actionLabel} />
              {idx < status.checklist.length - 1 && <View style={styles.separator} />}
            </React.Fragment>
          );
        })}
      </View>

      {resendMsg ? (
        <View style={styles.toastBox}>
          <Feather name="info" size={14} color={Colors.light.primary} />
          <Text style={styles.toastText}>{resendMsg}</Text>
        </View>
      ) : null}

      {/* Reviews summary card */}
      <Text style={styles.sectionLabel}>Reviews</Text>
      <ReviewsSummaryCard
        averageRating={reviewsData?.averageRating ?? null}
        approvedCount={reviewsData?.totalCount ?? 0}
        pendingCount={
          (reviewsData?.reviews ?? []).filter((r) => r.status === 'PENDING').length
        }
        latestApprovedAt={(() => {
          const approved = (reviewsData?.reviews ?? []).filter((r) => r.status === 'APPROVED');
          return approved[0]?.createdAt ?? null;
        })()}
        onOpen={() => router.push('/trader-dashboard/reviews')}
      />

      {/* Quick links to other trader-dashboard sections */}
      <Text style={styles.sectionLabel}>Manage</Text>
      <View style={styles.checklistGroup}>
        <Pressable style={styles.checklistRow} onPress={() => router.push('/trader-dashboard/leads')}>
          <View style={[styles.iconCircle, { backgroundColor: Colors.light.primaryMuted, borderColor: Colors.light.primary }]}>
            <Feather name="inbox" size={16} color={Colors.light.primary} />
          </View>
          <View style={styles.checklistMain}>
            <View style={styles.checklistTopLine}>
              <Text style={styles.checklistLabel}>My Leads</Text>
              {newLeadsCount > 0 ? (
                <View style={styles.newLeadsBadge}>
                  <Text style={styles.newLeadsBadgeText}>
                    {newLeadsCount > 99 ? '99+' : newLeadsCount} new
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.checklistDesc}>
              {newLeadsCount > 0
                ? `${newLeadsCount} unopened ${newLeadsCount === 1 ? 'enquiry' : 'enquiries'} waiting for you.`
                : 'View and respond to customer enquiries.'}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.light.textMuted} style={{ alignSelf: 'center' }} />
        </Pressable>
        <View style={styles.separator} />
        <Pressable style={styles.checklistRow} onPress={() => router.push('/trader-dashboard/billing')}>
          <View style={[styles.iconCircle, { backgroundColor: Colors.light.primaryMuted, borderColor: Colors.light.primary }]}>
            <Feather name="credit-card" size={16} color={Colors.light.primary} />
          </View>
          <View style={styles.checklistMain}>
            <Text style={styles.checklistLabel}>Billing & plan</Text>
            <Text style={styles.checklistDesc}>Manage your subscription and invoices.</Text>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.light.textMuted} style={{ alignSelf: 'center' }} />
        </Pressable>
      </View>

      {status.rejectionReason ? (
        <View style={styles.adminNoteBox}>
          <Text style={styles.adminNoteTitle}>Rejection reason</Text>
          <Text style={styles.adminNoteBody}>{status.rejectionReason}</Text>
        </View>
      ) : null}

      <Text style={styles.footerNote}>
        Business profile, documents and admin review will be enabled in upcoming releases.
      </Text>
    </ScrollView>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffD = Math.floor(diffHr / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ReviewsSummaryCard({
  averageRating,
  approvedCount,
  pendingCount,
  latestApprovedAt,
  onOpen,
}: {
  averageRating: number | null;
  approvedCount: number;
  pendingCount: number;
  latestApprovedAt: string | null;
  onOpen: () => void;
}) {
  const hasReviews = approvedCount > 0;
  return (
    <Pressable style={summaryStyles.card} onPress={onOpen}>
      <View style={summaryStyles.headerRow}>
        <View style={summaryStyles.ratingBlock}>
          <Text style={summaryStyles.avgValue}>
            {averageRating != null ? averageRating.toFixed(1) : '—'}
          </Text>
          <View style={summaryStyles.starsRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Feather
                key={n}
                name="star"
                size={14}
                color={n <= Math.round(averageRating ?? 0) ? Colors.light.featured : Colors.light.border}
              />
            ))}
          </View>
          <Text style={summaryStyles.metaText}>
            {hasReviews
              ? `${approvedCount} public review${approvedCount === 1 ? '' : 's'}`
              : 'No public reviews yet'}
          </Text>
        </View>
        <View style={summaryStyles.statsBlock}>
          {pendingCount > 0 ? (
            <View style={summaryStyles.pill}>
              <Feather name="clock" size={11} color={Colors.light.featured} />
              <Text style={summaryStyles.pillText}>
                {pendingCount} awaiting approval
              </Text>
            </View>
          ) : null}
          {latestApprovedAt ? (
            <Text style={summaryStyles.metaText}>Latest {formatRelative(latestApprovedAt)}</Text>
          ) : null}
        </View>
      </View>
      <View style={summaryStyles.cta}>
        <Text style={summaryStyles.ctaText}>Open reviews</Text>
        <Feather name="arrow-right" size={14} color={Colors.light.primary} />
      </View>
    </Pressable>
  );
}

const summaryStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 14,
    marginBottom: 16,
    gap: 12,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  ratingBlock: { gap: 4, flex: 1 },
  avgValue: { fontSize: 28, fontWeight: '700', color: Colors.light.text, lineHeight: 32 },
  starsRow: { flexDirection: 'row', gap: 2 },
  metaText: { fontSize: 11, color: Colors.light.textMuted },
  statsBlock: { alignItems: 'flex-end', justifyContent: 'flex-start', gap: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Colors.light.featuredMuted,
    borderWidth: 1,
    borderColor: Colors.light.featured,
  },
  pillText: { fontSize: 10, fontWeight: '700', color: Colors.light.featured, letterSpacing: 0.3 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  ctaText: { fontSize: 12, fontWeight: '700', color: Colors.light.primary },
});

function ChecklistRow({ step, onAction, actionLabel }: { step: ChecklistStep; onAction?: () => void; actionLabel?: string }) {
  const visual = visualForState(step.state);
  return (
    <View style={styles.checklistRow}>
      <View style={[styles.iconCircle, { backgroundColor: visual.bg, borderColor: visual.border }]}>
        <Feather name={visual.icon} size={16} color={visual.fg} />
      </View>
      <View style={styles.checklistMain}>
        <View style={styles.checklistTopLine}>
          <Text style={[styles.checklistLabel, step.state === 'locked' && { color: Colors.light.textMuted }]}>
            {step.label}
          </Text>
          {step.comingSoon ? (
            <View style={styles.soonPill}>
              <Text style={styles.soonPillText}>Coming soon</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.checklistState, { color: visual.fg }]}>{prettyState(step.state)}</Text>
        {step.description ? (
          <Text style={styles.checklistDesc}>{step.description}</Text>
        ) : null}
        {onAction ? (
          <Pressable onPress={onAction} style={styles.actionBtn}>
            <Text style={styles.actionBtnText}>{actionLabel || 'Action'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const SUCCESS_MUTED = 'rgba(6, 214, 160, 0.12)';
const WARNING = '#F59E0B';
const WARNING_MUTED = 'rgba(245, 158, 11, 0.12)';

function visualForState(state: StepState): { icon: FeatherIconName; fg: string; bg: string; border: string } {
  switch (state) {
    case 'completed':
      return { icon: 'check', fg: Colors.light.success, bg: SUCCESS_MUTED, border: Colors.light.success };
    case 'action_required':
      return { icon: 'alert-circle', fg: Colors.light.error, bg: Colors.light.errorMuted, border: Colors.light.error };
    case 'pending':
      return { icon: 'clock', fg: WARNING, bg: WARNING_MUTED, border: WARNING };
    case 'rejected':
      return { icon: 'x', fg: Colors.light.error, bg: Colors.light.errorMuted, border: Colors.light.error };
    case 'expired':
      return { icon: 'clock', fg: Colors.light.error, bg: Colors.light.errorMuted, border: Colors.light.error };
    case 'locked':
    default:
      return { icon: 'lock', fg: Colors.light.textMuted, bg: Colors.light.surface, border: Colors.light.border };
  }
}

function prettyState(state: StepState): string {
  switch (state) {
    case 'completed': return 'Completed';
    case 'action_required': return 'Action required';
    case 'pending': return 'Pending';
    case 'rejected': return 'Rejected';
    case 'expired': return 'Expired';
    case 'locked': return 'Locked';
  }
}

function prettyStatus(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function statusPillStyle(s: string) {
  if (s === 'VERIFIED') return { backgroundColor: SUCCESS_MUTED, borderColor: Colors.light.success };
  if (s === 'REJECTED' || s === 'SUSPENDED' || s === 'EXPIRED_DOCUMENTS') return { backgroundColor: Colors.light.errorMuted, borderColor: Colors.light.error };
  if (s === 'UNDER_REVIEW') return { backgroundColor: Colors.light.primaryMuted, borderColor: Colors.light.primary };
  return { backgroundColor: WARNING_MUTED, borderColor: WARNING };
}

function statusPillTextStyle(s: string) {
  if (s === 'VERIFIED') return { color: Colors.light.success };
  if (s === 'REJECTED' || s === 'SUSPENDED' || s === 'EXPIRED_DOCUMENTS') return { color: Colors.light.error };
  if (s === 'UNDER_REVIEW') return { color: Colors.light.primary };
  return { color: WARNING };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: Colors.light.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.border },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.text },
  greetingCard: { backgroundColor: Colors.light.card, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: Colors.light.border, marginBottom: 14 },
  greetingHello: { fontSize: 14, color: Colors.light.textSecondary, marginBottom: 2 },
  greetingBiz: { fontSize: 18, fontWeight: '700', color: Colors.light.text, marginBottom: 12 },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, marginBottom: 10 },
  statusPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  statusMessage: { fontSize: 13, color: Colors.light.textSecondary, lineHeight: 19 },
  progressCard: { backgroundColor: Colors.light.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.light.border, marginBottom: 18 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  progressLabel: { fontSize: 13, fontWeight: '600', color: Colors.light.text },
  progressCount: { fontSize: 12, color: Colors.light.textMuted },
  progressBarTrack: { height: 8, backgroundColor: Colors.light.surface, borderRadius: 4, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: Colors.light.primary, borderRadius: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.light.textMuted, marginBottom: 8, marginLeft: 4, letterSpacing: 0.8, textTransform: 'uppercase' },
  checklistGroup: { backgroundColor: Colors.light.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.light.border, overflow: 'hidden' },
  checklistRow: { flexDirection: 'row', padding: 14, gap: 12, alignItems: 'flex-start' },
  iconCircle: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginTop: 2 },
  checklistMain: { flex: 1 },
  checklistTopLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  checklistLabel: { fontSize: 14, fontWeight: '600', color: Colors.light.text, flexShrink: 1 },
  soonPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border },
  soonPillText: { fontSize: 9, fontWeight: '700', color: Colors.light.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' },
  checklistState: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  checklistDesc: { fontSize: 12, color: Colors.light.textSecondary, lineHeight: 17, marginTop: 2 },
  actionBtn: { marginTop: 8, alignSelf: 'flex-start', backgroundColor: Colors.light.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  actionBtnText: { color: Colors.light.white, fontSize: 12, fontWeight: '700' },
  separator: { height: 1, backgroundColor: Colors.light.border, marginLeft: 58 },
  toastBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: Colors.light.primaryMuted, borderColor: Colors.light.primary, borderWidth: 1, padding: 10, borderRadius: 10, marginTop: 12 },
  toastText: { fontSize: 12, color: Colors.light.primary, flex: 1 },
  adminNoteBox: { marginTop: 14, padding: 14, borderRadius: 12, backgroundColor: Colors.light.errorMuted, borderWidth: 1, borderColor: Colors.light.error },
  adminNoteTitle: { fontSize: 12, fontWeight: '700', color: Colors.light.error, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  adminNoteBody: { fontSize: 13, color: Colors.light.error, lineHeight: 18 },
  footerNote: { fontSize: 11, color: Colors.light.textMuted, marginTop: 24, textAlign: 'center', paddingHorizontal: 16, lineHeight: 16 },
  errorText: { fontSize: 14, color: Colors.light.textSecondary, textAlign: 'center', marginTop: 8 },
  retryBtn: { backgroundColor: Colors.light.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, marginTop: 8 },
  retryText: { color: Colors.light.white, fontSize: 14, fontWeight: '700' },
  newLeadsBadge: { backgroundColor: Colors.light.primary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  newLeadsBadgeText: { color: Colors.light.white, fontSize: 10, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  legalBanner: { backgroundColor: WARNING_MUTED, borderColor: WARNING, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14 },
  legalBannerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  legalBannerTitle: { fontSize: 14, fontWeight: '700', color: WARNING },
  legalBannerBody: { fontSize: 13, color: Colors.light.text, lineHeight: 18 },
  legalBannerBtn: { marginTop: 10, alignSelf: 'flex-start', backgroundColor: WARNING, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  legalBannerBtnText: { color: Colors.light.white, fontSize: 13, fontWeight: '700' },
});
