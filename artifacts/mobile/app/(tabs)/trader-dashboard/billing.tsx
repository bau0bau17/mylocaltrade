import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, RefreshControl, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import {
  useGetSubscriptionStatus,
  useGetSubscriptionPlans,
  useCancelSubscription,
  useResumeSubscription,
} from '@workspace/api-client-react';
import { useSubscription } from '@/lib/revenuecat';
import { useTeamContext } from '@/hooks/useTeamContext';
import { getYearlySavings } from '@/lib/pricing';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { subscriptionStatusQueryKey } from '@/lib/team-billing-queries';

export default function BillingScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();

  // Company Teams: billing is owner-only. Employees get an explainer card
  // instead of the billing surface (and we skip the status call — the server
  // answers 403 OWNER_ONLY for them anyway).
  const { isEmployee, roleUnknown, userId } = useTeamContext();

  const { data: status, isLoading, refetch } = useGetSubscriptionStatus({
    query: {
      queryKey: subscriptionStatusQueryKey(userId),
      enabled: !isEmployee && !roleUnknown,
    },
  });
  const { data: plansData } = useGetSubscriptionPlans();
  const { mutateAsync: cancelSub, isPending: cancelling } = useCancelSubscription();
  const { mutateAsync: resumeSub, isPending: resuming } = useResumeSubscription();
  const subscription = useSubscription();
  const busy = cancelling || resuming;
  const [showDowngrade, setShowDowngrade] = useState(false);

  // Depend on the stable members, NOT the whole `subscription` object: the
  // provider rebuilds that object every render, so depending on it would make
  // this focus effect run on every render and spin an infinite refresh loop.
  const {
    isSupported: subSupported,
    refresh: subRefresh,
    isServerStateUpdating,
    serverStateError,
    retryServerState,
  } = subscription;
  // Pull-to-refresh keeps its own gesture-local spinner state (shared app
  // convention — see usePullToRefresh). Driving the RefreshControl from
  // react-query's `isRefetching` held the iOS spinner's content inset open on
  // every visit (the focus effect below refetches each time), which rendered
  // as a large empty gap between the header and the Current Plan card.
  const { refreshing, onRefresh } = usePullToRefresh(refetch, ...(subSupported ? [subRefresh] : []));
  useFocusEffect(useCallback(() => {
    // refetch() bypasses the query's `enabled` flag, so guard explicitly:
    // employees (and unknown roles) must not fire the status call the
    // server will 403 anyway.
    if (isEmployee || roleUnknown) return;
    refetch();
    if (subSupported) subRefresh();
  }, [refetch, subSupported, subRefresh, isEmployee, roleUnknown]));

  const manageApple = async () => {
    // Customer Center is the full self-service surface (manage, cancel, refund,
    // restore). It falls back silently if unavailable in this build.
    await subscription.presentCustomerCenter();
    await refetch();
  };

  const restoreApple = async () => {
    try {
      const result = await subscription.restore();
      await refetch();
      Alert.alert(
        result.active && result.confirmed
          ? 'Subscription restored'
          : result.active
            ? 'Plan update pending'
            : 'Nothing to restore',
        result.active && result.confirmed
          ? 'Your Premium plan has been restored.'
          : result.active
            ? 'Apple found your subscription, but we could not yet confirm the server-authorized Team seats. Use Retry to update your plan.'
          : 'We could not find an active subscription for this Apple ID.',
      );
    } catch (e) {
      Alert.alert('Restore failed', e instanceof Error ? e.message : 'Try again.');
    }
  };

  const cancel = () => {
    if (!status || status.cancelAtPeriodEnd) return;
    Alert.alert(
      'Cancel subscription?',
      'You will keep Premium until the end of the current billing period. After that your free Basic listing stays live — you only lose the Premium perks.',
      [
        { text: 'Keep plan', style: 'cancel' },
        {
          text: 'Cancel plan',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelSub();
              await refetch();
            } catch (e) {
              Alert.alert('Could not cancel', e instanceof Error ? e.message : 'Try again.');
            }
          },
        },
      ],
    );
  };

  const resume = async () => {
    try {
      await resumeSub();
      await refetch();
    } catch (e) {
      Alert.alert('Could not resume', e instanceof Error ? e.message : 'Try again.');
    }
  };

  if (isEmployee) {
    return (
      <View style={[s.center, { paddingHorizontal: 20 }]}>
        <View style={[s.card, { marginBottom: 0, alignItems: 'center', alignSelf: 'stretch' }]}>
          <Feather name="lock" size={26} color={Colors.light.tabIconDefault} style={{ marginBottom: 10 }} />
          <Text style={{ fontSize: 17, fontWeight: '700', color: Colors.light.text, marginBottom: 6, textAlign: 'center' }}>
            Managed by your business owner
          </Text>
          <Text style={{ fontSize: 14, color: Colors.light.textSecondary, textAlign: 'center', lineHeight: 20 }}>
            Billing and the Premium subscription for your business are handled by the business
            owner. Your team access doesn't require anything here.
          </Text>
        </View>
      </View>
    );
  }

  if (isLoading || roleUnknown) {
    return (
      <View style={s.center}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
    );
  }

  const plan = status?.plan ?? null;
  // Single paid plan: anything that is not the free "basic" tier is Premium.
  // This also normalises any legacy plan values (e.g. "trader", "elite") so the
  // label never shows a raw/unknown value to the trader.
  const isPremium = plan != null && plan !== 'basic';
  // The backend stores a single "premium" plan id, so the exact cadence
  // (Monthly vs Yearly) comes from RevenueCat's active product. Falls back to a
  // plain "Premium" label when the cadence can't be determined (e.g. web).
  const cadence = subscription.activeCadence;
  // Team plans are named by their confirmed tier (display only — the server
  // derives the real seat limit from the purchased product identifier).
  const teamTier = subscription.activeTeamTier;
  const teamSeats =
    teamTier === 'team5' ? 5 : teamTier === 'team10' ? 10 : teamTier === 'team20' ? 20 : null;
  const premiumName = teamSeats
    ? `Team ${teamSeats} Annual`
    : cadence === 'annual' ? 'Premium Yearly' : cadence === 'monthly' ? 'Premium Monthly' : 'Premium';
  // Verified traders are always listed for free as Basic, even with no paid
  // subscription row (plan === null). Only true paid plans show as Premium.
  const planLabel = isPremium ? premiumName : 'Basic';
  const isActive = status?.status === 'active';
  // Cancelled-but-still-active: Premium runs until the paid expiry but will
  // not renew. Trust EITHER the server flag (webhook / sync) OR the device
  // entitlement's willRenew === false — whichever learns about it first.
  const cancelled =
    isActive && ((status?.cancelAtPeriodEnd ?? false) || subscription.willRenew === false);
  // "Switch to yearly" nudge: only for traders actively paying monthly.
  // Prices come from the RevenueCat packages when available (native), falling
  // back to the backend plan list (same source the pricing screen uses).
  const monthlyPrice =
    subscription.monthlyPackage?.product.price ??
    plansData?.plans.find(p => p.interval === 'month' && p.price > 0)?.price;
  const yearlyPrice =
    subscription.annualPackage?.product.price ??
    plansData?.plans.find(p => p.interval === 'year' && p.price > 0)?.price;
  const yearlySavings =
    isActive && !cancelled && cadence === 'monthly'
      ? getYearlySavings(monthlyPrice, yearlyPrice)
      : null;
  // Prefer the server's period end; fall back to the device entitlement's
  // expiry so the date still shows if the server briefly lags Apple.
  const periodEnd = status?.currentPeriodEnd
    ? new Date(status.currentPeriodEnd)
    : subscription.expiresAt
      ? new Date(subscription.expiresAt)
      : null;
  const periodEndLabel = periodEnd
    ? periodEnd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  return (
    <>
    <ScrollView
      style={s.container}
      contentContainerStyle={{ paddingTop: 12, paddingBottom: tabBarHeight + insets.bottom + 32, paddingHorizontal: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.light.primary} />}
    >
      <View style={s.card}>
        <View style={s.planHeader}>
          <View>
            <Text style={s.cardLabel}>Current Plan</Text>
            <Text style={s.planName}>{planLabel}</Text>
          </View>
          <View
            style={[
              s.badge,
              isPremium && cancelled
                ? s.badgeCancelled
                : (isActive || !isPremium)
                  ? s.badgeActive
                  : s.badgeInactive,
            ]}
          >
            <Text
              style={[
                s.badgeText,
                isPremium && cancelled
                  ? s.badgeTextCancelled
                  : (isActive || !isPremium)
                    ? s.badgeTextActive
                    : s.badgeTextInactive,
              ]}
            >
              {isPremium ? (cancelled ? 'CANCELLED' : (status?.status ?? 'inactive').toUpperCase()) : 'FREE'}
            </Text>
          </View>
        </View>

        {periodEnd && (
          <Text style={s.meta}>
            {cancelled ? 'Premium active until ' : 'Renews on '}
            {periodEnd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </Text>
        )}

        {isServerStateUpdating || serverStateError ? (
          <View style={[s.planSyncCard, serverStateError && s.planSyncError]}>
            {isServerStateUpdating ? (
              <ActivityIndicator size="small" color={Colors.light.primary} />
            ) : (
              <Feather name="alert-circle" size={18} color={Colors.light.warning} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.planSyncTitle}>
                {isServerStateUpdating ? 'Updating your plan…' : 'Plan update needs confirmation'}
              </Text>
              <Text style={s.planSyncBody}>
                {isServerStateUpdating
                  ? 'Refreshing your server-authorized Team seats and availability.'
                  : serverStateError}
              </Text>
            </View>
            {serverStateError ? (
              <Pressable style={s.planSyncRetry} onPress={() => void retryServerState()}>
                <Text style={s.planSyncRetryText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {isPremium && teamSeats ? (
          <Text style={s.meta}>
            Includes the business owner and up to {teamSeats} employees. The owner doesn't use a
            seat, and pending invitations reserve seats — manage your team from the Team page.
          </Text>
        ) : null}

        {cancelled ? (
          <View style={s.cancelBanner}>
            <Feather name="alert-triangle" size={16} color={Colors.light.warning ?? '#B45309'} />
            <Text style={s.cancelText}>
              Cancelled — will not renew. You keep your Premium perks until
              {periodEndLabel ? ` ${periodEndLabel}` : ' the end of the current period'}, then your
              free Basic listing stays live.
            </Text>
          </View>
        ) : null}

        {yearlySavings ? (
          <Pressable style={s.savingsBanner} onPress={() => router.push('/pricing')}>
            <Feather name="trending-down" size={16} color={Colors.light.secondary} />
            <Text style={s.savingsText}>
              Switch to yearly and save ~{yearlySavings.percent}%
              {yearlySavings.monthsFree > 0
                ? ` — that's ${yearlySavings.monthsFree} month${yearlySavings.monthsFree === 1 ? '' : 's'} free vs paying monthly.`
                : '.'}
            </Text>
            <Feather name="chevron-right" size={16} color={Colors.light.secondary} />
          </Pressable>
        ) : null}

        <View style={s.divider} />

        {subscription.isSupported ? (
          !isActive ? (
            <View style={{ gap: 10 }}>
              <Pressable style={s.primaryBtn} onPress={() => router.push('/pricing')}>
                <Feather name="zap" size={18} color="#fff" />
                <Text style={s.primaryBtnText}>Choose a plan</Text>
              </Pressable>
              <Pressable style={s.dangerBtn} onPress={restoreApple}>
                <Feather name="refresh-ccw" size={18} color={Colors.light.text} />
                <Text style={s.dangerBtnText}>Restore purchases</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <Pressable style={s.secondaryBtn} onPress={() => router.push('/pricing')}>
                <Feather name="repeat" size={18} color={Colors.light.primary} />
                <Text style={s.secondaryBtnText}>Change plan</Text>
              </Pressable>
              <Pressable style={s.secondaryBtn} onPress={manageApple}>
                <Feather name="settings" size={18} color={Colors.light.primary} />
                <Text style={s.secondaryBtnText}>Manage subscription</Text>
              </Pressable>
              <Text style={s.actionHint}>
                Switch between Solo and Team plans from Change plan — Apple applies upgrades and
                downgrades within your existing subscription. Update payment or cancel any time in
                your App Store subscription settings.
              </Text>
              {!cancelled && (
                <Pressable style={s.dangerBtn} onPress={() => setShowDowngrade(true)}>
                  <Feather name="arrow-down-circle" size={18} color={Colors.light.text} />
                  <Text style={s.dangerBtnText}>Cancel Premium subscription</Text>
                </Pressable>
              )}
              <Pressable style={s.dangerBtn} onPress={restoreApple}>
                <Feather name="refresh-ccw" size={18} color={Colors.light.text} />
                <Text style={s.dangerBtnText}>Restore purchases</Text>
              </Pressable>
            </View>
          )
        ) : !isActive ? (
          <Pressable style={s.primaryBtn} onPress={() => router.push('/pricing')}>
            <Feather name="zap" size={18} color="#fff" />
            <Text style={s.primaryBtnText}>Choose a plan</Text>
          </Pressable>
        ) : status?.cancelAtPeriodEnd ? (
          <Pressable style={s.primaryBtn} onPress={resume} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <>
              <Feather name="refresh-ccw" size={18} color="#fff" />
              <Text style={s.primaryBtnText}>Resume subscription</Text>
            </>}
          </Pressable>
        ) : (
          <View style={{ gap: 10 }}>
            <Pressable style={s.secondaryBtn} onPress={() => router.push('/pricing')}>
              <Feather name="arrow-up-circle" size={18} color={Colors.light.primary} />
              <Text style={s.secondaryBtnText}>Change plan</Text>
            </Pressable>
            <Pressable style={s.dangerBtn} onPress={cancel} disabled={busy}>
              {busy ? <ActivityIndicator color={Colors.light.text} /> : <>
                <Feather name="x-circle" size={18} color={Colors.light.text} />
                <Text style={s.dangerBtnText}>Cancel subscription</Text>
              </>}
            </Pressable>
          </View>
        )}
      </View>

      <View style={s.featuresSection}>
        <Text style={s.sectionTitle}>Your Plan Features</Text>
        <View style={s.featuresCard}>
          <Feature included text="Receive customer enquiries" />
          <Feature included text="Public profile with photos and reviews" />
          <Feature included={isActive && isPremium} text="Higher search ranking and priority placement" />
          <Feature included={isActive && isPremium} text="Featured listing badge and home screen placement" />
          <Feature included={isActive && isPremium} text="Unlimited gallery images" />
        </View>
      </View>

      <Text style={s.footnote}>
        Subscriptions are billed and managed by Apple. Changes and cancellations are made in
        your App Store settings, and your status here updates automatically once Apple confirms them.
      </Text>
    </ScrollView>

    <Modal
      visible={showDowngrade}
      transparent
      animationType="fade"
      onRequestClose={() => setShowDowngrade(false)}
    >
      <View style={s.modalOverlay}>
        <View style={s.modalCard}>
          <Text style={s.modalTitle}>Cancel your Premium subscription?</Text>
          <Text style={s.modalBody}>
            {periodEndLabel
              ? `You'll keep your Premium perks until ${periodEndLabel}. After that your listing moves to the free Basic plan and you'll lose:`
              : `Your listing will move to the free Basic plan and you'll lose:`}
          </Text>
          <View style={s.lossList}>
            <LossRow text="Featured listing badge and home screen placement" />
            <LossRow text="Higher search ranking and priority placement" />
            <LossRow text="Unlimited gallery images (Basic allows up to 3)" />
          </View>
          <Text style={s.modalNote}>
            Your free Basic listing stays live — you keep customer enquiries, your profile,
            photos and reviews.
          </Text>
          <Text style={s.modalNote}>
            Your subscription is billed by Apple, so the final step is completed in your App Store settings.
          </Text>
          <Pressable
            style={s.primaryBtn}
            onPress={async () => {
              setShowDowngrade(false);
              await subscription.manageSubscriptions();
              await refetch();
            }}
          >
            <Feather name="external-link" size={18} color="#fff" />
            <Text style={s.primaryBtnText}>Continue in App Store</Text>
          </Pressable>
          <Pressable
            style={[s.dangerBtn, { marginTop: 10 }]}
            onPress={() => setShowDowngrade(false)}
          >
            <Text style={s.dangerBtnText}>Keep Premium</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
    </>
  );
}

function LossRow({ text }: { text: string }) {
  return (
    <View style={s.lossRow}>
      <Feather name="x" size={18} color={Colors.light.textMuted} />
      <Text style={s.lossText}>{text}</Text>
    </View>
  );
}

function Feature({ included, text }: { included: boolean; text: string }) {
  return (
    <View style={s.featureRow}>
      <Feather name={included ? 'check' : 'x'} size={20} color={included ? Colors.light.secondary : Colors.light.textMuted} />
      <Text style={[s.featureText, !included && s.featureTextOff]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.light.background },
  title: { fontSize: 22, fontWeight: '700', color: Colors.light.text, marginBottom: 20, letterSpacing: 0.3 },
  card: { backgroundColor: Colors.light.card, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: Colors.light.border, marginBottom: 24 },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  cardLabel: { fontSize: 11, color: Colors.light.textMuted, marginBottom: 4, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  planName: { fontSize: 20, fontWeight: '700', color: Colors.light.text },
  badge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  badgeActive: { backgroundColor: Colors.light.secondaryMuted },
  badgeInactive: { backgroundColor: Colors.light.surface },
  badgeCancelled: { backgroundColor: '#FEF3C7' },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  badgeTextActive: { color: Colors.light.secondary },
  badgeTextInactive: { color: Colors.light.textMuted },
  badgeTextCancelled: { color: '#92400E' },
  meta: { fontSize: 13, color: Colors.light.textSecondary, marginBottom: 12 },
  planSyncCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.light.primaryMuted,
    borderColor: Colors.light.primary,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  planSyncError: { backgroundColor: Colors.light.surface, borderColor: Colors.light.warning },
  planSyncTitle: { color: Colors.light.text, fontSize: 13, fontWeight: '700', marginBottom: 2 },
  planSyncBody: { color: Colors.light.textSecondary, fontSize: 11, lineHeight: 16 },
  planSyncRetry: {
    backgroundColor: Colors.light.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  planSyncRetryText: { color: Colors.light.white, fontSize: 12, fontWeight: '700' },
  cancelBanner: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: '#FEF3C7', borderRadius: 10, padding: 10, marginBottom: 12 },
  cancelText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 18 },
  savingsBanner: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: Colors.light.secondaryMuted, borderRadius: 10, padding: 10, marginBottom: 12 },
  savingsText: { flex: 1, fontSize: 12, color: Colors.light.secondary, fontWeight: '600', lineHeight: 18 },
  divider: { height: 1, backgroundColor: Colors.light.border, marginVertical: 12 },
  primaryBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, backgroundColor: Colors.light.primary, borderRadius: 14 },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  secondaryBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, backgroundColor: Colors.light.primaryMuted, borderRadius: 14 },
  secondaryBtnText: { fontSize: 15, fontWeight: '700', color: Colors.light.primary },
  dangerBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, backgroundColor: Colors.light.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.light.border },
  dangerBtnText: { fontSize: 15, fontWeight: '600', color: Colors.light.text },
  featuresSection: { marginTop: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: Colors.light.textMuted, marginBottom: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  featuresCard: { backgroundColor: Colors.light.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: Colors.light.border, gap: 14 },
  featureRow: { flexDirection: 'row', alignItems: 'center' },
  featureText: { fontSize: 14, color: Colors.light.text, marginLeft: 12 },
  featureTextOff: { color: Colors.light.textMuted, textDecorationLine: 'line-through' },
  footnote: { fontSize: 11, color: Colors.light.textMuted, textAlign: 'center', marginTop: 18, paddingHorizontal: 8, lineHeight: 16 },
  actionHint: { fontSize: 12, color: Colors.light.textMuted, lineHeight: 17, paddingHorizontal: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 24 },
  modalCard: { backgroundColor: Colors.light.card, borderRadius: 18, padding: 22, borderWidth: 1, borderColor: Colors.light.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.light.text, marginBottom: 10 },
  modalBody: { fontSize: 14, color: Colors.light.textSecondary, lineHeight: 20, marginBottom: 12 },
  lossList: { gap: 8, marginBottom: 14 },
  lossRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lossText: { flex: 1, fontSize: 14, color: Colors.light.text },
  modalNote: { fontSize: 12, color: Colors.light.textMuted, lineHeight: 18, marginBottom: 12 },
});
