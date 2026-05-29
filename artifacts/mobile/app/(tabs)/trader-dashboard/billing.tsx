import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import {
  useGetSubscriptionStatus,
  useCancelSubscription,
  useResumeSubscription,
} from '@workspace/api-client-react';
import { useSubscription } from '@/lib/revenuecat';

const PLAN_LABEL: Record<string, string> = {
  basic: 'Basic',
  premium: 'Premium',
  elite: 'Elite',
  trader: 'Trader Subscription',
};

export default function BillingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: status, isLoading, refetch, isRefetching } = useGetSubscriptionStatus({
    query: { queryKey: ['/api/subscriptions/status'] },
  });
  const { mutateAsync: cancelSub, isPending: cancelling } = useCancelSubscription();
  const { mutateAsync: resumeSub, isPending: resuming } = useResumeSubscription();
  const subscription = useSubscription();
  const busy = cancelling || resuming;

  useFocusEffect(useCallback(() => {
    refetch();
    if (subscription.isSupported) subscription.refresh();
  }, [refetch, subscription]));

  const manageApple = async () => {
    await subscription.manageSubscriptions();
  };

  const restoreApple = async () => {
    try {
      const active = await subscription.restore();
      await refetch();
      Alert.alert(
        active ? 'Subscription restored' : 'Nothing to restore',
        active
          ? 'Your Trader Subscription has been restored.'
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
      'Your profile will stay live until the end of the current billing period, then it will be hidden from customers.',
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

  if (isLoading) {
    return (
      <View style={s.center}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
    );
  }

  const plan = status?.plan ?? null;
  const planLabel = plan ? (PLAN_LABEL[plan] ?? plan) : 'No plan';
  const isActive = status?.status === 'active';
  const isPremiumOrElite = plan === 'premium' || plan === 'elite';
  const periodEnd = status?.currentPeriodEnd ? new Date(status.currentPeriodEnd) : null;

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32, paddingHorizontal: 20 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
    >
      <Text style={s.title}>Billing & Plan</Text>

      <View style={s.card}>
        <View style={s.planHeader}>
          <View>
            <Text style={s.cardLabel}>Current Plan</Text>
            <Text style={s.planName}>{planLabel}{plan ? ' Plan' : ''}</Text>
          </View>
          <View style={[s.badge, isActive ? s.badgeActive : s.badgeInactive]}>
            <Text style={[s.badgeText, isActive ? s.badgeTextActive : s.badgeTextInactive]}>
              {(status?.status ?? 'inactive').toUpperCase()}
            </Text>
          </View>
        </View>

        {periodEnd && (
          <Text style={s.meta}>
            {status?.cancelAtPeriodEnd ? 'Ends on ' : 'Renews on '}
            {periodEnd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </Text>
        )}

        {status?.cancelAtPeriodEnd ? (
          <View style={s.cancelBanner}>
            <Feather name="alert-triangle" size={16} color={Colors.light.warning ?? '#B45309'} />
            <Text style={s.cancelText}>
              Cancellation scheduled. Your profile will go offline at the end of the current period.
            </Text>
          </View>
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
              <Pressable style={s.secondaryBtn} onPress={manageApple}>
                <Feather name="settings" size={18} color={Colors.light.primary} />
                <Text style={s.secondaryBtnText}>Manage subscription</Text>
              </Pressable>
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
          {subscription.isSupported ? (
            <>
              <Feature included={isActive} text="Public business profile" />
              <Feature included={isActive} text="Receive customer enquiries" />
              <Feature included={isActive} text="Verified trader badge on your listing" />
              <Feature included={isActive} text="Visible in search and category results" />
            </>
          ) : (
            <>
              <Feature included={isActive} text="Public business profile" />
              <Feature included={isActive} text="Receive customer enquiries" />
              <Feature included={isActive && isPremiumOrElite} text="Higher search ranking" />
              <Feature included={isActive && isPremiumOrElite} text="Featured listing badge" />
              <Feature included={isActive && plan === 'elite'} text="Top-of-search Elite placement" />
            </>
          )}
        </View>
      </View>

      <Text style={s.footnote}>
        Subscriptions for the iOS app are handled securely through the Apple App Store.
      </Text>
    </ScrollView>
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
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  badgeTextActive: { color: Colors.light.secondary },
  badgeTextInactive: { color: Colors.light.textMuted },
  meta: { fontSize: 13, color: Colors.light.textSecondary, marginBottom: 12 },
  cancelBanner: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: '#FEF3C7', borderRadius: 10, padding: 10, marginBottom: 12 },
  cancelText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 18 },
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
});
