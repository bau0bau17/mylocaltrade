import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  TextInput,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

interface TraderRow {
  userId: number;
  email: string;
  emailVerified: boolean;
  businessName: string;
  contactName: string;
  phone: string;
  town: string;
  postcode: string;
  mainCategory: string;
  verificationStatus: string;
  phoneVerified: boolean;
  businessProfileCompleted: boolean;
  documentsSubmitted: boolean;
  submittedForReviewAt: string | null;
  verifiedAt: string | null;
}

interface CountRow {
  status: string;
  count: number;
}

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: 'UNDER_REVIEW', label: 'Under review' },
  { key: 'PENDING_DOCUMENTS', label: 'Pending docs' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'SUSPENDED', label: 'Suspended' },
  { key: 'ALL', label: 'All' },
];

export default function AdminIndexScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, isAdmin } = useAuth();

  const [statusFilter, setStatusFilter] = useState<string>('UNDER_REVIEW');
  const [query, setQuery] = useState('');
  const [traders, setTraders] = useState<TraderRow[]>([]);
  const [counts, setCounts] = useState<CountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (query.trim()) params.set('q', query.trim());
      const res = await fetch(`${getApiUrl()}/api/admin/traders?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load traders');
      setTraders(json.traders);
      setCounts(json.counts ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, statusFilter, query]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const countByStatus = useMemo(() => {
    const map: Record<string, number> = {};
    counts.forEach((c) => { map[c.status] = c.count; });
    return map;
  }, [counts]);

  if (!isAdmin) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 60 }]}>
        <Feather name="lock" size={28} color={Colors.light.textMuted} />
        <Text style={styles.muted}>Admin access required.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <Stack.Screen options={{ title: 'Trader Review' }} />

      <View style={[styles.headerRow, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={Colors.light.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Trader Review</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.searchWrap}>
        <Feather name="search" size={16} color={Colors.light.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search business, contact, email, postcode"
          placeholderTextColor={Colors.light.textMuted}
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={load}
        />
        {query.length > 0 && (
          <Pressable onPress={() => { setQuery(''); }}>
            <Feather name="x" size={16} color={Colors.light.textMuted} />
          </Pressable>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filtersRow}
      >
        {STATUS_FILTERS.map((f) => {
          const active = f.key === statusFilter;
          const count = f.key === 'ALL'
            ? counts.reduce((s, c) => s + c.count, 0)
            : (countByStatus[f.key] ?? 0);
          return (
            <Pressable
              key={f.key}
              onPress={() => setStatusFilter(f.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f.label}
                {count > 0 ? ` · ${count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.light.primary} />
        </View>
      ) : error ? (
        <View style={[styles.center, { paddingHorizontal: 24 }]}>
          <Feather name="alert-circle" size={24} color={Colors.light.error} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={traders}
          keyExtractor={(t) => String(t.userId)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={Colors.light.primary}
            />
          }
          ListEmptyComponent={
            <View style={[styles.center, { paddingVertical: 60 }]}>
              <Feather name="inbox" size={28} color={Colors.light.textMuted} />
              <Text style={styles.muted}>No traders match this view.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/admin/${item.userId}`)}
            >
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bizName} numberOfLines={1}>{item.businessName}</Text>
                  <Text style={styles.contactName} numberOfLines={1}>
                    {item.contactName} · {item.mainCategory}
                  </Text>
                </View>
                <StatusPill status={item.verificationStatus} />
              </View>
              <View style={styles.metaRow}>
                <Feather name="mail" size={11} color={Colors.light.textMuted} />
                <Text style={styles.metaText} numberOfLines={1}>{item.email}</Text>
              </View>
              <View style={styles.metaRow}>
                <Feather name="map-pin" size={11} color={Colors.light.textMuted} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {item.town} {item.postcode}
                </Text>
              </View>
              <View style={styles.checkRow}>
                <Check label="Email" ok={item.emailVerified} />
                <Check label="Phone" ok={item.phoneVerified} />
                <Check label="Profile" ok={item.businessProfileCompleted} />
                <Check label="Docs" ok={item.documentsSubmitted} />
              </View>
              {item.submittedForReviewAt && (
                <Text style={styles.submittedText}>
                  Submitted {formatDate(item.submittedForReviewAt)}
                </Text>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function Check({ label, ok }: { label: string; ok: boolean }) {
  return (
    <View style={styles.checkChip}>
      <Feather
        name={ok ? 'check' : 'x'}
        size={10}
        color={ok ? Colors.light.success : Colors.light.textMuted}
      />
      <Text style={[styles.checkText, ok && { color: Colors.light.success }]}>{label}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    PENDING_EMAIL_VERIFICATION: { label: 'Email', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
    PENDING_PHONE_VERIFICATION: { label: 'Phone', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
    PROFILE_INCOMPLETE: { label: 'Profile', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
    PENDING_DOCUMENTS: { label: 'Awaiting docs', bg: 'rgba(245, 158, 11, 0.14)', fg: '#B45309' },
    UNDER_REVIEW: { label: 'Under review', bg: 'rgba(59, 130, 246, 0.14)', fg: '#1D4ED8' },
    VERIFIED: { label: 'Verified', bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' },
    REJECTED: { label: 'Rejected', bg: 'rgba(239, 68, 68, 0.14)', fg: '#B91C1C' },
    SUSPENDED: { label: 'Suspended', bg: 'rgba(239, 68, 68, 0.14)', fg: '#B91C1C' },
    EXPIRED_DOCUMENTS: { label: 'Expired docs', bg: 'rgba(245, 158, 11, 0.14)', fg: '#B45309' },
  };
  const v = map[status] ?? { label: status, bg: Colors.light.surface, fg: Colors.light.text };
  return (
    <View style={[styles.pill, { backgroundColor: v.bg }]}>
      <Text style={[styles.pillText, { color: v.fg }]}>{v.label}</Text>
    </View>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: Colors.light.textMuted, fontSize: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: Colors.light.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.border },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.text },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, height: 40, borderRadius: 12, backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border },
  search: { flex: 1, fontSize: 13, color: Colors.light.text, padding: 0 },

  filtersRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  chip: { paddingHorizontal: 12, height: 30, borderRadius: 14, borderWidth: 1, borderColor: Colors.light.border, backgroundColor: Colors.light.card, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.light.text },
  chipTextActive: { color: '#fff' },

  card: { backgroundColor: Colors.light.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.light.border, padding: 14, marginBottom: 10, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 4 },
  bizName: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  contactName: { fontSize: 12, color: Colors.light.textMuted, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { flex: 1, fontSize: 11, color: Colors.light.textMuted },

  checkRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  checkChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, height: 20, borderRadius: 6, backgroundColor: Colors.light.surface },
  checkText: { fontSize: 10, color: Colors.light.textMuted, fontWeight: '600' },

  submittedText: { fontSize: 10, color: Colors.light.textMuted, marginTop: 6 },

  pill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  pillText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },

  errorText: { fontSize: 13, color: Colors.light.error, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 14, height: 36, borderRadius: 10, backgroundColor: Colors.light.primary, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
