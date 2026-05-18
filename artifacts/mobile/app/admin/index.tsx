import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

const COUNTS_REFETCH_INTERVAL_MS = 30_000;

type SectionItem = {
  key: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  subtitle: string;
  href: string;
  badge: number;
  loading: boolean;
};

export default function AdminIndexScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, isAdmin } = useAuth();

  const enabled = !!token && isAdmin;

  const traderQueueQuery = useQuery({
    queryKey: ['admin', 'index-counts', 'trader-review'],
    enabled,
    refetchInterval: COUNTS_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<number> => {
      const res = await fetch(`${getApiUrl()}/api/admin/traders?status=UNDER_REVIEW`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      const row = (json.counts ?? []).find((c: { status: string; count: number }) => c.status === 'UNDER_REVIEW');
      return Number(row?.count ?? 0);
    },
  });

  const deletionsQueueQuery = useQuery({
    queryKey: ['admin', 'index-counts', 'account-deletions'],
    enabled,
    refetchInterval: COUNTS_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<number> => {
      const res = await fetch(`${getApiUrl()}/api/admin/account-deletions?status=REQUESTED`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      if (typeof json.total === 'number') return json.total;
      if (Array.isArray(json.items)) return json.items.length;
      return 0;
    },
  });

  const onRefresh = () => {
    void traderQueueQuery.refetch();
    void deletionsQueueQuery.refetch();
  };

  if (!isAdmin) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 60 }]}>
        <Feather name="lock" size={28} color={Colors.light.textMuted} />
        <Text style={styles.muted}>Admin access required.</Text>
      </View>
    );
  }

  const sections: SectionItem[] = [
    {
      key: 'stats',
      icon: 'activity',
      title: 'Live Dashboard',
      subtitle: 'Real-time platform metrics',
      href: '/admin/stats',
      badge: 0,
      loading: false,
    },
    {
      key: 'trader-review',
      icon: 'user-check',
      title: 'Trader Review Queue',
      subtitle: 'Verify and approve new traders',
      href: '/admin/trader-review',
      badge: traderQueueQuery.data ?? 0,
      loading: traderQueueQuery.isLoading,
    },
    {
      key: 'account-deletions',
      icon: 'trash-2',
      title: 'Account Deletion Reviews',
      subtitle: 'Process GDPR deletion requests',
      href: '/admin/account-deletions',
      badge: deletionsQueueQuery.data ?? 0,
      loading: deletionsQueueQuery.isLoading,
    },
    {
      key: 'promo-codes',
      icon: 'tag',
      title: 'Promo Codes',
      subtitle: 'Manage promotional codes',
      href: '/admin/promo-codes',
      badge: 0,
      loading: false,
    },
  ];

  const refreshing = traderQueueQuery.isFetching || deletionsQueueQuery.isFetching;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <Stack.Screen options={{ title: 'Admin' }} />

      <View style={[styles.headerRow, { paddingTop: Math.max(insets.top, 50) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={Colors.light.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Admin</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.light.primary} />
        }
      >
        {sections.map((s) => (
          <Pressable
            key={s.key}
            style={styles.menuCard}
            onPress={() => router.push(s.href as never)}
            accessibilityRole="button"
            accessibilityLabel={
              s.badge > 0
                ? `${s.title}, ${s.badge} ${s.badge === 1 ? 'item' : 'items'} needing attention`
                : s.title
            }
            accessibilityHint={s.subtitle}
          >
            <View style={styles.menuIconWrap}>
              <Feather name={s.icon} size={20} color={Colors.light.primary} />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{s.title}</Text>
              <Text style={styles.menuSubtitle}>{s.subtitle}</Text>
            </View>
            {s.badge > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{s.badge > 99 ? '99+' : String(s.badge)}</Text>
              </View>
            ) : null}
            <Feather name="chevron-right" size={20} color={Colors.light.textMuted} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: Colors.light.textMuted, fontSize: 14 },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 16 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: Colors.light.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.border },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.text },

  menuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  menuIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTextWrap: { flex: 1 },
  menuTitle: { fontSize: 15, fontWeight: '700', color: Colors.light.text },
  menuSubtitle: { fontSize: 12, color: Colors.light.textMuted, marginTop: 2 },

  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.light.error,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
});
