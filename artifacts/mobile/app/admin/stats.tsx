import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

type StatsResponse = {
  generatedAt: string;
  users: {
    total: number;
    byRole: Record<string, number>;
    newToday: number;
    newLast7d: number;
    allTimeRegistered: number;
    deleted: number;
  };
  traders: { byStatus: Record<string, number>; activeOnPlatform: number };
  enquiries: { total: number; byStatus: Record<string, number>; today: number; last7d: number };
  conversations: { total: number; byStatus: Record<string, number> };
  messages: { today: number; last7d: number; last15min: number };
  reviews: { total: number; byStatus: Record<string, number> };
  moderation: { openConversationReports: number };
  subscriptions: { active: number };
};

const REFETCH_INTERVAL_MS = 15_000;

export default function AdminStatsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, isAdmin } = useAuth();
  const [now, setNow] = useState(Date.now());

  const query = useQuery<StatsResponse>({
    queryKey: ['admin', 'stats'],
    enabled: !!token && isAdmin,
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await fetch(`${getApiUrl()}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const lastUpdatedLabel = useMemo(() => {
    if (!query.data?.generatedAt) return '—';
    const ms = now - new Date(query.data.generatedAt).getTime();
    const sec = Math.max(0, Math.floor(ms / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    return `${min}m ago`;
  }, [now, query.data?.generatedAt]);

  if (!isAdmin) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 60 }]}>
        <Feather name="lock" size={28} color={Colors.light.textMuted} />
        <Text style={styles.muted}>Admin access required.</Text>
      </View>
    );
  }

  const data = query.data;
  const isOffline = !data && query.isError;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <Stack.Screen options={{ title: 'Live Dashboard' }} />

      <View style={[styles.headerRow, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={Colors.light.text} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerTitle}>Live Dashboard</Text>
          <View style={styles.statusLine}>
            <View style={[styles.dot, isOffline ? styles.dotErr : query.isFetching ? styles.dotLive : styles.dotOk]} />
            <Text style={styles.statusText}>
              {isOffline ? 'Offline' : query.isFetching ? 'Updating…' : `Updated ${lastUpdatedLabel}`}
            </Text>
          </View>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => query.refetch()}
            tintColor={Colors.light.primary}
          />
        }
      >
        {!data && query.isLoading ? (
          <View style={[styles.center, { paddingVertical: 80 }]}>
            <ActivityIndicator color={Colors.light.primary} />
            <Text style={styles.muted}>Loading stats…</Text>
          </View>
        ) : isOffline ? (
          <View style={styles.errorCard}>
            <Feather name="wifi-off" size={20} color={Colors.light.error} />
            <Text style={styles.errorText}>
              Cannot reach the server. The dashboard needs an internet connection to show live metrics.
            </Text>
            <Pressable style={styles.retryBtn} onPress={() => query.refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : data ? (
          <>
            {/* LIVE NOW */}
            <SectionTitle icon="activity" label="Live Activity" />
            <View style={styles.grid}>
              <StatCard
                title="Messages (15 min)"
                value={data.messages.last15min}
                accent="primary"
                icon="message-circle"
                hint="Real-time chat volume"
              />
              <StatCard
                title="Open Reports"
                value={data.moderation.openConversationReports}
                accent={data.moderation.openConversationReports > 0 ? 'danger' : 'muted'}
                icon="alert-triangle"
                hint="Conversations awaiting review"
              />
            </View>

            {/* USERS */}
            <SectionTitle icon="users" label="Users" />
            <View style={styles.grid}>
              <StatCard
                title="Active Users"
                value={data.users.total}
                icon="users"
                accent="primary"
                hint="Currently active accounts"
              />
              <StatCard
                title="All-Time Registered"
                value={data.users.allTimeRegistered}
                icon="archive"
                hint="Includes deleted accounts"
              />
              <StatCard
                title="New Today"
                value={data.users.newToday}
                icon="user-plus"
                accent={data.users.newToday > 0 ? 'success' : 'muted'}
              />
              <StatCard
                title="Deleted"
                value={data.users.deleted}
                icon="user-x"
                accent={data.users.deleted > 0 ? 'danger' : 'muted'}
                hint="Removed accounts"
              />
              <StatCard title="Customers" value={data.users.byRole.customer ?? 0} icon="user" />
              <StatCard title="Traders" value={data.users.byRole.trader ?? 0} icon="briefcase" />
            </View>
            <View style={styles.smallRow}>
              <SmallStat label="New last 7d" value={data.users.newLast7d} />
              <SmallStat label="Admins" value={data.users.byRole.admin ?? 0} />
            </View>

            {/* TRADERS */}
            <SectionTitle icon="briefcase" label="Trader Verification" />
            <View style={styles.grid}>
              <StatusCard
                label="Awaiting Docs"
                value={data.traders.byStatus.PENDING_DOCUMENTS ?? 0}
                tone="warn"
                onPress={() => router.push('/admin?status=PENDING_DOCUMENTS' as never)}
              />
              <StatusCard
                label="Under Review"
                value={data.traders.byStatus.UNDER_REVIEW ?? 0}
                tone="info"
                onPress={() => router.push('/admin?status=UNDER_REVIEW' as never)}
              />
              <StatusCard
                label="Verified"
                value={data.traders.byStatus.VERIFIED ?? 0}
                tone="success"
                onPress={() => router.push('/admin?status=VERIFIED' as never)}
              />
              <StatusCard
                label="Rejected"
                value={data.traders.byStatus.REJECTED ?? 0}
                tone="danger"
                onPress={() => router.push('/admin?status=REJECTED' as never)}
              />
            </View>
            <View style={styles.smallRow}>
              <SmallStat label="Active on platform" value={data.traders.activeOnPlatform} />
              <SmallStat label="Suspended" value={data.traders.byStatus.SUSPENDED ?? 0} />
            </View>

            {/* DEMAND */}
            <SectionTitle icon="send" label="Customer Demand" />
            <View style={styles.grid}>
              <StatCard title="Enquiries Today" value={data.enquiries.today} icon="send" accent="primary" />
              <StatCard title="Enquiries 7d" value={data.enquiries.last7d} icon="trending-up" />
              <StatCard title="Total Enquiries" value={data.enquiries.total} icon="inbox" />
              <StatCard
                title="Open Enquiries"
                value={data.enquiries.byStatus.pending ?? data.enquiries.byStatus.OPEN ?? 0}
                icon="clock"
              />
            </View>

            {/* CONVERSATIONS */}
            <SectionTitle icon="message-circle" label="Conversations" />
            <View style={styles.grid}>
              <StatCard title="Total Conversations" value={data.conversations.total} icon="message-circle" />
              <StatCard
                title="Awaiting Trader"
                value={data.conversations.byStatus.AWAITING_TRADER_REPLY ?? 0}
                icon="clock"
                accent="warn"
              />
              <StatCard title="Messages Today" value={data.messages.today} icon="message-square" />
              <StatCard title="Messages 7d" value={data.messages.last7d} icon="bar-chart-2" />
            </View>

            {/* MODERATION */}
            <SectionTitle icon="shield" label="Moderation" />
            <View style={styles.grid}>
              <StatCard
                title="Reviews Pending"
                value={data.reviews.byStatus.PENDING ?? 0}
                icon="star"
                accent={(data.reviews.byStatus.PENDING ?? 0) > 0 ? 'warn' : 'muted'}
              />
              <StatCard title="Reviews Approved" value={data.reviews.byStatus.APPROVED ?? 0} icon="check-circle" />
              <StatCard
                title="Conv. Reports Open"
                value={data.moderation.openConversationReports}
                icon="flag"
                accent={data.moderation.openConversationReports > 0 ? 'danger' : 'muted'}
              />
              <StatCard title="Active Subs" value={data.subscriptions.active} icon="credit-card" />
            </View>

          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SectionTitle({ icon, label }: { icon: React.ComponentProps<typeof Feather>['name']; label: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Feather name={icon} size={14} color={Colors.light.primary} />
      <Text style={styles.sectionTitle}>{label}</Text>
    </View>
  );
}

type Accent = 'primary' | 'success' | 'warn' | 'danger' | 'muted';
const accentMap: Record<Accent, { color: string; bg: string }> = {
  primary: { color: Colors.light.primary, bg: 'rgba(0, 180, 216, 0.10)' },
  success: { color: '#047857', bg: 'rgba(16, 185, 129, 0.12)' },
  warn: { color: '#B45309', bg: 'rgba(245, 158, 11, 0.14)' },
  danger: { color: '#B91C1C', bg: 'rgba(239, 68, 68, 0.12)' },
  muted: { color: Colors.light.textMuted, bg: 'rgba(107, 114, 128, 0.10)' },
};

function StatCard({
  title,
  value,
  icon,
  hint,
  accent = 'muted',
}: {
  title: string;
  value: number;
  icon: React.ComponentProps<typeof Feather>['name'];
  hint?: string;
  accent?: Accent;
}) {
  const a = accentMap[accent];
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIconWrap, { backgroundColor: a.bg }]}>
        <Feather name={icon} size={16} color={a.color} />
      </View>
      <Text style={styles.statValue} numberOfLines={1}>
        {value.toLocaleString('en-GB')}
      </Text>
      <Text style={styles.statTitle} numberOfLines={2}>{title}</Text>
      {hint ? <Text style={styles.statHint} numberOfLines={2}>{hint}</Text> : null}
    </View>
  );
}

function StatusCard({
  label,
  value,
  tone,
  onPress,
}: {
  label: string;
  value: number;
  tone: 'warn' | 'info' | 'success' | 'danger';
  onPress?: () => void;
}) {
  const colorMap = {
    warn: { fg: '#B45309', bg: 'rgba(245, 158, 11, 0.14)' },
    info: { fg: '#1D4ED8', bg: 'rgba(59, 130, 246, 0.14)' },
    success: { fg: '#047857', bg: 'rgba(16, 185, 129, 0.14)' },
    danger: { fg: '#B91C1C', bg: 'rgba(239, 68, 68, 0.14)' },
  }[tone];
  return (
    <Pressable style={[styles.statCard, { borderColor: colorMap.bg }]} onPress={onPress}>
      <View style={[styles.statusPill, { backgroundColor: colorMap.bg }]}>
        <Text style={[styles.statusPillText, { color: colorMap.fg }]}>{label.toUpperCase()}</Text>
      </View>
      <Text style={styles.statValue}>{value.toLocaleString('en-GB')}</Text>
      <Text style={styles.statHint}>Tap to open list</Text>
    </Pressable>
  );
}

function SmallStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.smallStat}>
      <Text style={styles.smallStatValue}>{value.toLocaleString('en-GB')}</Text>
      <Text style={styles.smallStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: Colors.light.textMuted, fontSize: 14 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    backgroundColor: Colors.light.surface,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.text },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOk: { backgroundColor: '#10B981' },
  dotLive: { backgroundColor: Colors.light.primary },
  dotErr: { backgroundColor: '#EF4444' },
  statusText: { fontSize: 11, color: Colors.light.textMuted, fontWeight: '600' },

  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: -4 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.light.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  statCard: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 14,
    padding: 12,
    gap: 6,
    minHeight: 96,
  },
  statIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: { fontSize: 24, fontWeight: '800', color: Colors.light.text, letterSpacing: -0.5 },
  statTitle: { fontSize: 12, fontWeight: '600', color: Colors.light.text },
  statHint: { fontSize: 10, color: Colors.light.textMuted },

  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },

  smallRow: { flexDirection: 'row', gap: 10 },
  smallStat: {
    flex: 1,
    backgroundColor: Colors.light.surface,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  smallStatValue: { fontSize: 16, fontWeight: '700', color: Colors.light.text },
  smallStatLabel: { fontSize: 11, color: Colors.light.textMuted, marginTop: 2 },

  errorCard: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.error,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 12,
  },
  errorText: { fontSize: 13, color: Colors.light.error, textAlign: 'center', lineHeight: 19 },
  retryBtn: {
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 13 },

});
