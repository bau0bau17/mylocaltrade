import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

interface DeletionRow {
  id: number;
  email: string;
  fullName: string;
  role: string;
  deletionStatus: string;
  deletionRequestedAt: string | null;
  deletionReason: string | null;
  retentionUntil: string | null;
  retentionReason: string | null;
  anonymisedAt: string | null;
  accountDisabledAt: string | null;
  deletionProcessedAt: string | null;
  adminDeletionNotes: string | null;
}

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'REQUESTED', label: 'New' },
  { value: 'DISABLED_PENDING_RETENTION', label: 'Retention' },
  { value: 'ANONYMISED', label: 'Anonymised' },
  { value: 'COMPLETED', label: 'Completed' },
];

function statusColor(status: string): { bg: string; fg: string } {
  if (status === 'REQUESTED') return { bg: 'rgba(239, 68, 68, 0.14)', fg: '#B91C1C' };
  if (status === 'DISABLED_PENDING_RETENTION') return { bg: 'rgba(245, 158, 11, 0.18)', fg: '#B45309' };
  if (status === 'ANONYMISED') return { bg: 'rgba(99, 102, 241, 0.14)', fg: '#3730A3' };
  return { bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' };
}

export default function AdminAccountDeletionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, isAdmin } = useAuth();

  const [rows, setRows] = useState<DeletionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const url = new URL(`${getApiUrl()}/api/admin/account-deletions`);
      if (statusFilter) url.searchParams.set('status', statusFilter);
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setRows(json.items as DeletionRow[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const callAction = async (
    userId: number,
    action: 'retain' | 'anonymise' | 'complete' | 'notes',
    body: Record<string, unknown>,
  ) => {
    if (!token) return;
    try {
      const res = await fetch(`${getApiUrl()}/api/admin/account-deletions/${userId}/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Action failed');
      await load();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Action failed');
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
      <Stack.Screen options={{ title: 'Account Deletions' }} />
      <View style={[styles.headerRow, { paddingTop: Math.max(insets.top, 50) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={Colors.light.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Account deletions</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
      >
        {STATUS_TABS.map((t) => {
          const selected = t.value === statusFilter;
          return (
            <Pressable
              key={t.value || 'all'}
              onPress={() => setStatusFilter(t.value)}
              style={[styles.tab, selected && styles.tabSelected]}
            >
              <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={Colors.light.primary}
          />
        }
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.light.primary} />
          </View>
        ) : error ? (
          <View style={[styles.center, { paddingHorizontal: 24 }]}>
            <Feather name="alert-circle" size={24} color={Colors.light.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={[styles.center, { paddingVertical: 60 }]}>
            <Feather name="inbox" size={28} color={Colors.light.textMuted} />
            <Text style={styles.muted}>No accounts in this filter.</Text>
          </View>
        ) : (
          rows.map((r) => (
            <DeletionCard
              key={r.id}
              row={r}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
              onAction={(action, body) => callAction(r.id, action, body)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function DeletionCard({
  row,
  expanded,
  onToggle,
  onAction,
}: {
  row: DeletionRow;
  expanded: boolean;
  onToggle: () => void;
  onAction: (
    action: 'retain' | 'anonymise' | 'complete' | 'notes',
    body: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const c = statusColor(row.deletionStatus);
  const [retentionReason, setRetentionReason] = useState('');
  const [confirm, setConfirm] = useState<null | 'anonymise' | 'complete'>(null);
  const [submitting, setSubmitting] = useState(false);
  const completed = row.deletionStatus === 'COMPLETED';
  const anonymised = row.deletionStatus === 'ANONYMISED' || completed;

  const runConfirmed = async () => {
    if (!confirm) return;
    setSubmitting(true);
    try {
      await onAction(confirm, {});
      setConfirm(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <Pressable onPress={onToggle} style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <View style={styles.rowGap}>
            <Text style={styles.name} numberOfLines={1}>{row.fullName}</Text>
            <View style={[styles.pill, { backgroundColor: c.bg }]}>
              <Text style={[styles.pillText, { color: c.fg }]}>{row.deletionStatus}</Text>
            </View>
          </View>
          <Text style={styles.email} numberOfLines={1}>{row.email}</Text>
          <Text style={styles.meta}>
            {row.role} · requested{' '}
            {row.deletionRequestedAt ? new Date(row.deletionRequestedAt).toLocaleString() : '—'}
          </Text>
        </View>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={Colors.light.textMuted}
        />
      </Pressable>

      {expanded && (
        <View style={styles.cardBody}>
          {row.deletionReason ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailLabel}>Reason given</Text>
              <Text style={styles.detailText}>{row.deletionReason}</Text>
            </View>
          ) : null}

          {row.retentionReason ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailLabel}>Retention reason</Text>
              <Text style={styles.detailText}>{row.retentionReason}</Text>
            </View>
          ) : null}

          {!completed && !anonymised && (
            <View style={styles.detailBlock}>
              <Text style={styles.detailLabel}>Apply legal-retention hold</Text>
              <TextInput
                style={styles.input}
                placeholder="Retention reason (required)"
                placeholderTextColor={Colors.light.textMuted}
                value={retentionReason}
                onChangeText={setRetentionReason}
              />
              <Pressable
                style={[
                  styles.btn,
                  styles.btnSecondary,
                  retentionReason.trim().length < 3 && styles.btnDisabled,
                ]}
                disabled={retentionReason.trim().length < 3}
                onPress={() =>
                  onAction('retain', { retentionReason: retentionReason.trim() })
                }
              >
                <Text style={styles.btnText}>Mark retention required</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.actionsRow}>
            {!anonymised && (
              <Pressable
                style={[styles.btn, styles.btnDanger]}
                onPress={() => setConfirm('anonymise')}
                accessibilityRole="button"
                accessibilityLabel="Anonymise this user's personal data"
              >
                <Feather name="user-x" size={14} color={Colors.light.white} />
                <Text style={styles.btnText}>Anonymise</Text>
              </Pressable>
            )}
            {!completed && (
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                onPress={() => setConfirm('complete')}
                accessibilityRole="button"
                accessibilityLabel="Mark this deletion as completed"
              >
                <Feather name="check" size={14} color={Colors.light.white} />
                <Text style={styles.btnText}>Mark completed</Text>
              </Pressable>
            )}
          </View>

          <Modal
            visible={confirm !== null}
            transparent
            animationType="fade"
            onRequestClose={() => !submitting && setConfirm(null)}
          >
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => !submitting && setConfirm(null)}
            >
              <Pressable style={styles.modalCard} onPress={() => {}}>
                <Text style={styles.modalTitle}>
                  {confirm === 'anonymise' ? 'Anonymise PII?' : 'Finalise deletion?'}
                </Text>
                <Text style={styles.modalBody}>
                  {confirm === 'anonymise'
                    ? "This wipes the user's name, email and contact details. The row is kept so reviews, conversations and audit history stay intact. This cannot be undone."
                    : 'The account will be soft-deleted and the user signed out everywhere. This is a terminal state and cannot be reversed.'}
                </Text>
                <View style={styles.modalActions}>
                  <Pressable
                    style={[styles.btn, styles.btnGhost]}
                    onPress={() => setConfirm(null)}
                    disabled={submitting}
                  >
                    <Text style={[styles.btnText, { color: Colors.light.text }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.btn,
                      confirm === 'anonymise' ? styles.btnDanger : styles.btnPrimary,
                      submitting && styles.btnDisabled,
                    ]}
                    onPress={runConfirmed}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color={Colors.light.white} />
                    ) : (
                      <Text style={styles.btnText}>
                        {confirm === 'anonymise' ? 'Anonymise' : 'Mark completed'}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  muted: { color: Colors.light.textMuted, fontSize: 14 },
  errorText: { color: Colors.light.error, fontSize: 14, textAlign: 'center', marginTop: 8 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: Colors.light.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: Colors.light.text },
  tabsRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border,
  },
  tabSelected: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  tabLabel: { fontSize: 12, fontWeight: '600', color: Colors.light.text },
  tabLabelSelected: { color: Colors.light.white },
  card: {
    backgroundColor: Colors.light.card, borderRadius: 14, borderWidth: 1,
    borderColor: Colors.light.border, marginBottom: 10, overflow: 'hidden',
  },
  cardHead: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  name: { fontSize: 15, fontWeight: '600', color: Colors.light.text, flexShrink: 1 },
  email: { fontSize: 13, color: Colors.light.textSecondary, marginBottom: 4 },
  meta: { fontSize: 11, color: Colors.light.textMuted },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  pillText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  cardBody: {
    paddingHorizontal: 14, paddingBottom: 14, gap: 10,
    borderTopWidth: 1, borderTopColor: Colors.light.border,
  },
  detailBlock: { gap: 6, marginTop: 10 },
  detailLabel: {
    fontSize: 10, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.5, color: Colors.light.textMuted,
  },
  detailText: { fontSize: 13, color: Colors.light.text, lineHeight: 19 },
  input: {
    backgroundColor: Colors.light.surface, borderColor: Colors.light.border,
    borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 14, color: Colors.light.text,
  },
  actionsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
  },
  btnPrimary: { backgroundColor: Colors.light.primary },
  btnSecondary: { backgroundColor: Colors.light.featured },
  btnDanger: { backgroundColor: Colors.light.error },
  btnDisabled: { opacity: 0.45 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.light.border },
  btnText: { color: Colors.light.white, fontSize: 13, fontWeight: '700' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 18,
    gap: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.light.text },
  modalBody: { fontSize: 13, lineHeight: 19, color: Colors.light.textSecondary },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
});
