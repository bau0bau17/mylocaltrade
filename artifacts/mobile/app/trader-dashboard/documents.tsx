import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, RefreshControl, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

const DOCUMENT_TYPES = [
  { type: 'ID_DOCUMENT', label: 'Photo ID', required: true, icon: 'user', hint: 'Passport or driving licence (front).' },
  { type: 'INSURANCE', label: 'Public liability insurance', required: true, icon: 'shield', hint: 'Current insurance certificate.' },
  { type: 'PROOF_OF_ADDRESS', label: 'Proof of address', required: false, icon: 'home', hint: 'Utility bill or bank statement (last 3 months).' },
  { type: 'QUALIFICATION', label: 'Trade qualification', required: false, icon: 'award', hint: 'Trade certificate, NVQ, City & Guilds, etc.' },
] as const;

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;

interface DocItem {
  id: number;
  type: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  rejectionReason: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface DocsEvaluation {
  complete: boolean;
  hasExpiredRequired: boolean;
  hasExpiringSoonRequired: boolean;
  byType: Array<{
    type: string;
    label: string;
    required: boolean;
    satisfied: boolean;
    hasUpload: boolean;
    count: number;
    latestStatus?: string;
    rejectionReason?: string;
    expiresAt?: string | null;
    expired?: boolean;
    expiringSoon?: boolean;
  }>;
}

const TRACK_EXPIRY: Record<string, boolean> = {
  INSURANCE: true,
  QUALIFICATION: true,
};

function parseExpiry(input: string): { iso: string | null; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) return { iso: null, error: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return { iso: null, error: 'Use format YYYY-MM-DD.' };
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { iso: null, error: 'Invalid date.' };
  if (date.getTime() <= Date.now()) return { iso: null, error: 'Date must be in the future.' };
  return { iso: date.toISOString(), error: null };
}

export default function DocumentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, isTrader } = useAuth();

  const [docs, setDocs] = useState<DocItem[]>([]);
  const [evaluation, setEvaluation] = useState<DocsEvaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expiryInputs, setExpiryInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${getApiUrl()}/api/trader/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load documents');
      setDocs(json.documents);
      setEvaluation(json.evaluation);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handlePick = async (docType: string) => {
    if (uploadingType) return;
    setError(null);

    let expiryIso: string | null = null;
    if (TRACK_EXPIRY[docType]) {
      const raw = expiryInputs[docType] ?? '';
      const parsed = parseExpiry(raw);
      if (parsed.error) {
        Alert.alert('Expiry date', parsed.error);
        return;
      }
      expiryIso = parsed.iso;
    }

    let pickResult: DocumentPicker.DocumentPickerResult;
    try {
      pickResult = await DocumentPicker.getDocumentAsync({
        type: ALLOWED_MIMES,
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch (e) {
      setError('Could not open file picker.');
      return;
    }
    if (pickResult.canceled || !pickResult.assets?.[0]) return;
    const asset = pickResult.assets[0];

    const mimeType = asset.mimeType || guessMime(asset.name);
    if (!ALLOWED_MIMES.includes(mimeType)) {
      Alert.alert('Unsupported file', 'Please select a JPEG, PNG, WEBP, HEIC or PDF file.');
      return;
    }
    const sizeBytes = asset.size ?? 0;
    if (sizeBytes <= 0) {
      Alert.alert('Empty file', 'The selected file appears to be empty.');
      return;
    }
    if (sizeBytes > MAX_BYTES) {
      Alert.alert('File too large', `Maximum size is ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`);
      return;
    }

    setUploadingType(docType);
    try {
      // 1. Get presigned URL
      const urlRes = await fetch(`${getApiUrl()}/api/trader/documents/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: docType, filename: asset.name, mimeType, sizeBytes }),
      });
      const urlJson = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlJson.error || 'Failed to get upload URL');

      // 2. Upload file directly to GCS
      const fileResp = await fetch(asset.uri);
      const blob = await fileResp.blob();
      const putRes = await fetch(urlJson.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: blob,
      });
      if (!putRes.ok) throw new Error('Upload to storage failed');

      // 3. Register the uploaded object using the path the server told us about.
      const regRes = await fetch(`${getApiUrl()}/api/trader/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: docType,
          objectPath: urlJson.objectPath,
          originalFilename: asset.name,
          mimeType,
          sizeBytes,
          ...(expiryIso ? { expiresAt: expiryIso } : {}),
        }),
      });
      const regJson = await regRes.json();
      if (!regRes.ok) throw new Error(regJson.error || 'Failed to save document');

      await load();
      setExpiryInputs((prev) => ({ ...prev, [docType]: '' }));
      if (regJson.evaluation?.complete) {
        Alert.alert(
          'Documents submitted',
          'Your account is now under review. We\'ll notify you once an admin has checked your documents.',
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingType(null);
    }
  };

  const handleDelete = (doc: DocItem) => {
    Alert.alert(
      'Remove document',
      `Remove "${doc.originalFilename}"? You can upload a replacement afterwards.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            try {
              const res = await fetch(`${getApiUrl()}/api/trader/documents/${doc.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              const json = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(json.error || 'Failed to remove');
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Failed to remove');
            }
          }
        },
      ],
    );
  };

  if (!isTrader) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 40 }]}>
        <Feather name="lock" size={28} color={Colors.light.textMuted} />
        <Text style={styles.muted}>Trader account required.</Text>
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

  const requiredCount = evaluation?.byType.filter(b => b.required && b.satisfied).length ?? 0;
  const requiredTotal = evaluation?.byType.filter(b => b.required).length ?? 2;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <View style={[styles.headerRow, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={Colors.light.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Verification documents</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.light.primary} />}
      >
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryTitle}>Required documents</Text>
            <Text style={styles.summaryCount}>{requiredCount} / {requiredTotal}</Text>
          </View>
          <Text style={styles.summaryHint}>
            {evaluation?.complete
              ? 'All required documents uploaded — your account is queued for admin review.'
              : 'Upload at least your photo ID and a current public liability insurance certificate to submit your profile for review.'}
          </Text>
        </View>

        {evaluation?.hasExpiredRequired && (
          <View style={styles.alertBox}>
            <Feather name="alert-triangle" size={14} color={Colors.light.error} />
            <Text style={styles.alertText}>
              A required document has expired. Your profile has been hidden — upload a fresh copy below to restore it.
            </Text>
          </View>
        )}
        {!evaluation?.hasExpiredRequired && evaluation?.hasExpiringSoonRequired && (
          <View style={styles.warnBox}>
            <Feather name="clock" size={14} color="#B45309" />
            <Text style={styles.warnText}>
              A required document expires within the next 30 days. Upload a replacement to avoid going offline.
            </Text>
          </View>
        )}

        {DOCUMENT_TYPES.map((dt) => {
          const evalRow = evaluation?.byType.find(b => b.type === dt.type);
          const myDocs = docs.filter(d => d.type === dt.type);
          const isUploading = uploadingType === dt.type;
          return (
            <View key={dt.type} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardIcon}>
                  <Feather name={dt.icon as 'shield'} size={18} color={Colors.light.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>{dt.label}</Text>
                    {dt.required ? (
                      <View style={styles.requiredBadge}><Text style={styles.requiredBadgeText}>Required</Text></View>
                    ) : (
                      <View style={styles.optionalBadge}><Text style={styles.optionalBadgeText}>Optional</Text></View>
                    )}
                  </View>
                  <Text style={styles.cardHint}>{dt.hint}</Text>
                </View>
                {evalRow?.satisfied && (
                  <Feather name="check-circle" size={18} color={Colors.light.success} />
                )}
              </View>

              {myDocs.length > 0 && (
                <View style={styles.docList}>
                  {myDocs.map(d => {
                    const expiryDate = d.expiresAt ? new Date(d.expiresAt) : null;
                    const expired = expiryDate ? expiryDate.getTime() <= Date.now() : d.status === 'EXPIRED';
                    const daysToExpiry = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
                    const expiringSoon = daysToExpiry != null && daysToExpiry > 0 && daysToExpiry <= 30;
                    return (
                      <View key={d.id} style={styles.docRow}>
                        <Feather
                          name={d.mimeType === 'application/pdf' ? 'file-text' : 'image'}
                          size={14}
                          color={Colors.light.textMuted}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.docName} numberOfLines={1}>{d.originalFilename}</Text>
                          <View style={styles.docMetaRow}>
                            <StatusPill status={expired ? 'EXPIRED' : d.status} />
                            <Text style={styles.docMeta}>{formatSize(d.sizeBytes)}</Text>
                          </View>
                          {expiryDate && (
                            <Text style={[styles.expiryText, expired && { color: Colors.light.error }, expiringSoon && { color: '#B45309' }]}>
                              {expired
                                ? `Expired ${expiryDate.toLocaleDateString('en-GB')}`
                                : `Expires ${expiryDate.toLocaleDateString('en-GB')}${expiringSoon ? ` (in ${daysToExpiry}d)` : ''}`}
                            </Text>
                          )}
                          {d.status === 'REJECTED' && d.rejectionReason && (
                            <Text style={styles.rejectionText}>{d.rejectionReason}</Text>
                          )}
                        </View>
                        {d.status !== 'APPROVED' && (
                          <Pressable onPress={() => handleDelete(d)} hitSlop={10}>
                            <Feather name="x" size={16} color={Colors.light.textMuted} />
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {TRACK_EXPIRY[dt.type] && (
                <View style={styles.expiryInputRow}>
                  <Feather name="calendar" size={13} color={Colors.light.textMuted} />
                  <TextInput
                    style={styles.expiryInput}
                    placeholder="Expiry date (YYYY-MM-DD, optional)"
                    placeholderTextColor={Colors.light.textMuted}
                    value={expiryInputs[dt.type] ?? ''}
                    onChangeText={(v) => setExpiryInputs((prev) => ({ ...prev, [dt.type]: v }))}
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={10}
                  />
                </View>
              )}

              <Pressable
                style={[styles.uploadBtn, isUploading && styles.btnDisabled]}
                onPress={() => handlePick(dt.type)}
                disabled={isUploading}
              >
                {isUploading ? (
                  <ActivityIndicator color={Colors.light.primary} size="small" />
                ) : (
                  <>
                    <Feather name="upload" size={14} color={Colors.light.primary} />
                    <Text style={styles.uploadBtnText}>
                      {myDocs.length > 0 ? 'Upload another' : 'Upload file'}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          );
        })}

        <Text style={styles.footerNote}>
          Files are stored securely and only visible to you and the MyLocalTrade review team. Accepted formats: JPEG, PNG, WEBP, HEIC, PDF (max 10 MB).
        </Text>

        {error ? (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={14} color={Colors.light.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StatusPill({ status }: { status: DocItem['status'] }) {
  const map: Record<DocItem['status'], { label: string; bg: string; fg: string }> = {
    PENDING_REVIEW: { label: 'Pending review', bg: 'rgba(245, 158, 11, 0.14)', fg: '#B45309' },
    APPROVED: { label: 'Approved', bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' },
    REJECTED: { label: 'Rejected', bg: 'rgba(239, 68, 68, 0.14)', fg: '#B91C1C' },
    EXPIRED: { label: 'Expired', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
  };
  const v = map[status];
  return (
    <View style={[styles.pill, { backgroundColor: v.bg }]}>
      <Text style={[styles.pillText, { color: v.fg }]}>{v.label}</Text>
    </View>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    case 'heif': return 'image/heif';
    case 'pdf': return 'application/pdf';
    default: return 'application/octet-stream';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: Colors.light.textMuted, fontSize: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: Colors.light.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.border },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.text },

  summaryCard: { backgroundColor: Colors.light.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.light.border, padding: 14, marginBottom: 18, gap: 6 },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryTitle: { fontSize: 13, fontWeight: '700', color: Colors.light.text },
  summaryCount: { fontSize: 12, color: Colors.light.textMuted, fontWeight: '600' },
  summaryHint: { fontSize: 12, color: Colors.light.textMuted, lineHeight: 17 },

  card: { backgroundColor: Colors.light.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.light.border, padding: 14, marginBottom: 12, gap: 12 },
  cardHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(59, 130, 246, 0.08)', alignItems: 'center', justifyContent: 'center' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  cardHint: { fontSize: 11, color: Colors.light.textMuted, lineHeight: 15 },
  requiredBadge: { backgroundColor: 'rgba(239, 68, 68, 0.1)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  requiredBadgeText: { color: '#B91C1C', fontSize: 9, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  optionalBadge: { backgroundColor: Colors.light.surface, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  optionalBadgeText: { color: Colors.light.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },

  docList: { gap: 8 },
  docRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, backgroundColor: Colors.light.surface, borderRadius: 10 },
  docName: { fontSize: 12, color: Colors.light.text, fontWeight: '600' },
  docMetaRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  docMeta: { fontSize: 10, color: Colors.light.textMuted },
  rejectionText: { fontSize: 11, color: Colors.light.error, marginTop: 4, fontStyle: 'italic' },
  expiryText: { fontSize: 10, color: Colors.light.textMuted, marginTop: 4 },

  expiryInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, height: 38, borderRadius: 10, borderWidth: 1, borderColor: Colors.light.border, backgroundColor: Colors.light.surface },
  expiryInput: { flex: 1, color: Colors.light.text, fontSize: 12, paddingVertical: 0 },

  alertBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.light.errorMuted, borderColor: Colors.light.error, borderWidth: 1, padding: 10, borderRadius: 10, marginBottom: 12 },
  alertText: { flex: 1, fontSize: 11, color: Colors.light.error, lineHeight: 16 },
  warnBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: 'rgba(245, 158, 11, 0.10)', borderColor: 'rgba(245, 158, 11, 0.3)', borderWidth: 1, padding: 10, borderRadius: 10, marginBottom: 12 },
  warnText: { flex: 1, fontSize: 11, color: '#B45309', lineHeight: 16 },

  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  pillText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },

  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, borderRadius: 10, borderWidth: 1, borderColor: Colors.light.primary, borderStyle: 'dashed', backgroundColor: 'rgba(59, 130, 246, 0.04)' },
  uploadBtnText: { color: Colors.light.primary, fontSize: 13, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },

  footerNote: { fontSize: 11, color: Colors.light.textMuted, lineHeight: 16, marginTop: 4, textAlign: 'center' },

  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.light.errorMuted, borderColor: Colors.light.error, borderWidth: 1, padding: 12, borderRadius: 10, marginTop: 14 },
  errorText: { flex: 1, fontSize: 12, color: Colors.light.error, lineHeight: 17 },
});
