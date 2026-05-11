import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  TextInput,
  Switch,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

interface PromoCode {
  id: number;
  code: string;
  description: string | null;
  discountGbp: number;
  maxRedemptions: number;
  applicablePlans: string[];
  validForDays: number;
  isActive: boolean;
  redemptionsCount: number;
  slotsRemaining: number;
}

interface Redemption {
  id: number;
  email: string | null;
  fullName: string | null;
  businessName: string | null;
  planId: string;
  originalPriceGbp: number;
  discountGbp: number;
  discountedPriceGbp: number;
  redeemedAt: string;
  expiresAt: string;
}

function formatRemaining(expiresAt: string): { text: string; expired: boolean } {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { text: 'expired', expired: true };
  const totalHours = Math.floor(ms / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return { text: `${days}d ${hours}h left`, expired: false };
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  return { text: `${hours}h ${minutes}m left`, expired: false };
}

const PLANS: ReadonlyArray<'basic' | 'premium' | 'elite'> = ['basic', 'premium', 'elite'];

export default function AdminPromoCodesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, isAdmin } = useAuth();

  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/promo-codes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setCodes(json.promoCodes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (code: PromoCode) => {
    if (!token) return;
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/promo-codes/${code.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !code.isActive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update');
      await load();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to update');
    }
  };

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
      <Stack.Screen options={{ title: 'Promo Codes' }} />

      <View style={[styles.headerRow, { paddingTop: Math.max(insets.top, 50) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={Colors.light.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Promo codes</Text>
        <Pressable onPress={() => setShowCreate((v) => !v)} style={styles.backBtn}>
          <Feather name={showCreate ? 'x' : 'plus'} size={20} color={Colors.light.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={Colors.light.primary}
          />
        }
      >
        {showCreate && <CreateForm token={token} onDone={() => { setShowCreate(false); load(); }} />}

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
        ) : codes.length === 0 ? (
          <View style={[styles.center, { paddingVertical: 60 }]}>
            <Feather name="tag" size={28} color={Colors.light.textMuted} />
            <Text style={styles.muted}>No promo codes yet.</Text>
          </View>
        ) : (
          codes.map((c) => (
            <PromoCard
              key={c.id}
              code={c}
              expanded={expandedId === c.id}
              onToggleExpand={() => setExpandedId(expandedId === c.id ? null : c.id)}
              onToggleActive={() => toggleActive(c)}
              token={token}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function PromoCard({
  code,
  expanded,
  onToggleExpand,
  onToggleActive,
  token,
}: {
  code: PromoCode;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleActive: () => void;
  token: string | null;
}) {
  const [redemptions, setRedemptions] = useState<Redemption[] | null>(null);
  const [loadingR, setLoadingR] = useState(false);
  const fillPct = Math.min(100, Math.round((code.redemptionsCount / code.maxRedemptions) * 100));

  useEffect(() => {
    if (!expanded || redemptions !== null || !token) return;
    setLoadingR(true);
    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/api/admin/promo-codes/${code.id}/redemptions`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (res.ok) setRedemptions(json.redemptions);
      } finally {
        setLoadingR(false);
      }
    })();
  }, [expanded, redemptions, code.id, token]);

  return (
    <View style={styles.card}>
      <Pressable onPress={onToggleExpand} style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <View style={styles.codeRow}>
            <Text style={styles.codeText}>{code.code}</Text>
            <View style={[styles.pill, code.isActive ? styles.pillActive : styles.pillInactive]}>
              <Text style={[styles.pillText, code.isActive ? styles.pillTextActive : styles.pillTextInactive]}>
                {code.isActive ? 'active' : 'disabled'}
              </Text>
            </View>
          </View>
          <Text style={styles.metaText}>
            £{code.discountGbp} off · {code.applicablePlans.join(', ')} · valid {code.validForDays}d
          </Text>
          {code.description ? <Text style={styles.descText}>{code.description}</Text> : null}
          <View style={styles.progressWrap}>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${fillPct}%` }]} />
            </View>
            <Text style={styles.progressText}>
              {code.redemptionsCount}/{code.maxRedemptions} · {code.slotsRemaining} left
            </Text>
          </View>
        </View>
        <Switch value={code.isActive} onValueChange={onToggleActive} />
      </Pressable>

      {expanded && (
        <View style={styles.redemptionsBox}>
          {loadingR ? (
            <ActivityIndicator color={Colors.light.primary} />
          ) : !redemptions || redemptions.length === 0 ? (
            <Text style={styles.muted}>No redemptions yet.</Text>
          ) : (
            redemptions.map((r) => {
              const remain = formatRemaining(r.expiresAt);
              return (
                <View key={r.id} style={styles.redRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.redName} numberOfLines={1}>
                      {r.businessName ?? r.fullName ?? r.email ?? 'Trader'}
                    </Text>
                    <Text style={styles.redMeta} numberOfLines={1}>
                      {r.planId.toUpperCase()} · £{r.originalPriceGbp} → £{r.discountedPriceGbp}
                    </Text>
                  </View>
                  <View style={[styles.pill, remain.expired ? styles.pillInactive : styles.pillCountdown]}>
                    <Text style={[styles.pillText, remain.expired ? styles.pillTextInactive : styles.pillTextCountdown]}>
                      {remain.text}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

function CreateForm({ token, onDone }: { token: string | null; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [discountGbp, setDiscountGbp] = useState('5');
  const [maxRedemptions, setMaxRedemptions] = useState('20');
  const [validForDays, setValidForDays] = useState('30');
  const [plans, setPlans] = useState<Record<string, boolean>>({ basic: false, premium: true, elite: true });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!token) return;
    const applicable = PLANS.filter((p) => plans[p]);
    if (applicable.length === 0) {
      setErr('Pick at least one plan.');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/promo-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: code.trim(),
          discountGbp: Number(discountGbp),
          maxRedemptions: Number(maxRedemptions),
          validForDays: Number(validForDays),
          applicablePlans: applicable,
          isActive: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create');
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>New promo code</Text>
      {err && <Text style={styles.errorText}>{err}</Text>}
      <Text style={styles.label}>Code</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(v) => setCode(v.toUpperCase())}
        placeholder="LAUNCH20"
        placeholderTextColor={Colors.light.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={50}
      />
      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Discount (£)</Text>
          <TextInput style={styles.input} value={discountGbp} onChangeText={setDiscountGbp} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Max redemptions</Text>
          <TextInput style={styles.input} value={maxRedemptions} onChangeText={setMaxRedemptions} keyboardType="number-pad" />
        </View>
      </View>
      <Text style={styles.label}>Valid for (days)</Text>
      <TextInput style={styles.input} value={validForDays} onChangeText={setValidForDays} keyboardType="number-pad" />

      <Text style={styles.label}>Applicable plans</Text>
      <View style={styles.plansRow}>
        {PLANS.map((p) => (
          <Pressable
            key={p}
            onPress={() => setPlans({ ...plans, [p]: !plans[p] })}
            style={[styles.planChip, plans[p] && styles.planChipActive]}
          >
            <Text style={[styles.planChipText, plans[p] && styles.planChipTextActive]}>{p.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.submitBtn, (submitting || !code.trim()) && { opacity: 0.5 }]}
        onPress={submit}
        disabled={submitting || !code.trim()}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Create code</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  muted: { color: Colors.light.textMuted, fontSize: 14 },
  errorText: { color: Colors.light.error, fontSize: 14, textAlign: 'center', marginVertical: 8 },
  retryBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.light.primary, marginTop: 8 },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.light.text },
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeText: { fontSize: 16, fontWeight: '700', color: Colors.light.text, letterSpacing: 1 },
  metaText: { fontSize: 12, color: Colors.light.textSecondary, marginTop: 4 },
  descText: { fontSize: 12, color: Colors.light.textMuted, marginTop: 2, fontStyle: 'italic' },
  progressWrap: { marginTop: 8, gap: 4 },
  progressBg: { height: 6, backgroundColor: Colors.light.border, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.light.primary },
  progressText: { fontSize: 11, color: Colors.light.textMuted },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillActive: { backgroundColor: '#d1fae5' },
  pillInactive: { backgroundColor: Colors.light.border },
  pillCountdown: { backgroundColor: '#fef3c7' },
  pillText: { fontSize: 11, fontWeight: '700' },
  pillTextActive: { color: '#065f46' },
  pillTextInactive: { color: Colors.light.textMuted },
  pillTextCountdown: { color: '#92400e' },
  redemptionsBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.light.border, gap: 8 },
  redRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  redName: { fontSize: 13, fontWeight: '600', color: Colors.light.text },
  redMeta: { fontSize: 11, color: Colors.light.textMuted, marginTop: 2 },
  formCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 14,
    marginBottom: 16,
    gap: 6,
  },
  formTitle: { fontSize: 15, fontWeight: '700', color: Colors.light.text, marginBottom: 6 },
  formRow: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 11, fontWeight: '700', color: Colors.light.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.light.text,
    backgroundColor: Colors.light.background,
  },
  plansRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  planChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  planChipActive: { borderColor: Colors.light.primary, backgroundColor: Colors.light.primary },
  planChipText: { fontSize: 11, fontWeight: '700', color: Colors.light.textMuted, letterSpacing: 0.5 },
  planChipTextActive: { color: '#fff' },
  submitBtn: {
    marginTop: 12,
    backgroundColor: Colors.light.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
