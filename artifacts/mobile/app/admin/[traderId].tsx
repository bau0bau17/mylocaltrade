import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  Linking,
  Image,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';
import PinchZoomImage from '@/components/PinchZoomImage';

interface TraderDoc {
  id: number;
  type: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

interface AuditEntry {
  id: number;
  action: string;
  notes: string | null;
  createdAt: string;
  details?: Record<string, unknown> | null;
}

interface TraderDetail {
  user: {
    id: number;
    email: string;
    emailVerified: boolean;
    isActive: boolean;
    createdAt: string;
  };
  profile: {
    businessName: string;
    contactName: string;
    phone: string;
    mainCategory: string;
    additionalServices: string[] | null;
    businessAddress: string | null;
    town: string;
    postcode: string;
    serviceAreas: string[] | null;
    businessDescription: string | null;
    website: string | null;
    openingHours: string | null;
    verificationStatus: string;
    phoneVerified: boolean;
    businessProfileCompleted: boolean;
    documentsSubmitted: boolean;
    submittedForReviewAt: string | null;
    verifiedAt: string | null;
    rejectedAt: string | null;
    rejectionReason: string | null;
    adminNotes: string | null;
    isActive: boolean;
    aiVerificationStatus: 'MATCH' | 'PARTIAL_MATCH' | 'NO_MATCH' | 'NOT_FOUND' | 'ERROR' | null;
    aiVerificationCheckedAt: string | null;
    aiVerificationData: {
      verdict: 'MATCH' | 'PARTIAL_MATCH' | 'NO_MATCH' | 'NOT_FOUND' | 'ERROR';
      reasoning: string;
      submitted: { businessName: string; address: string; postcode: string };
      companiesHouse: {
        companyNumber?: string;
        companyName?: string;
        address?: string;
        postcode?: string;
        status?: string;
        sicCodes?: string[];
      } | null;
      error?: string;
    } | null;
  };
  documents: TraderDoc[];
  documentsEvaluation: {
    complete: boolean;
    byType: Array<{ type: string; label: string; required: boolean; satisfied: boolean }>;
  };
  auditLog: AuditEntry[];
}

type ActionKind = 'approve' | 'reject' | 'request_info' | 'suspend' | 'reject_doc';

export default function AdminTraderDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { traderId } = useLocalSearchParams<{ traderId: string }>();
  const { token, isAdmin } = useAuth();

  const [data, setData] = useState<TraderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [modal, setModal] = useState<{ kind: ActionKind; documentId?: number } | null>(null);
  const [reason, setReason] = useState('');

  // GDPR/ICO: optional reason captured before opening any document. Sent to
  // the server so it lands in the audit log next to the access record.
  const [accessReason, setAccessReason] = useState('');
  const [preview, setPreview] = useState<{
    doc: TraderDoc;
    status: 'loading' | 'ready' | 'error' | 'unsupported';
    dataUri?: string;
    error?: string;
  } | null>(null);

  const apiUrl = getApiUrl();
  const [aiBusy, setAiBusy] = useState(false);

  const runAiVerification = useCallback(async () => {
    if (!traderId || !token) return;
    setAiBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/traders/${traderId}/ai-verification/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        Alert.alert('AI verification failed', j.error || `HTTP ${res.status}`);
      } else {
        await load();
      }
    } catch (e: any) {
      Alert.alert('AI verification failed', e?.message || 'Network error');
    } finally {
      setAiBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, traderId, token]);

  const load = useCallback(async () => {
    if (!token || !traderId) return;
    try {
      const res = await fetch(`${apiUrl}/api/admin/traders/${traderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load trader');
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, traderId, apiUrl]);

  useEffect(() => { load(); }, [load]);

  // Build URLs for the authenticated /file and /view-url endpoints. Both
  // produce a server-side audit entry (ADMIN_VIEWED_DOCUMENT or
  // ADMIN_DOWNLOADED_DOCUMENT) tagged with the optional reason. Each open
  // uses exactly one of the two endpoints to guarantee a single log entry.
  const buildUrl = (path: string, mode: 'view' | 'download') => {
    const u = new URL(`${apiUrl}${path}`);
    u.searchParams.set('mode', mode);
    const trimmed = accessReason.trim();
    if (trimmed) u.searchParams.set('reason', trimmed.slice(0, 500));
    return u.toString();
  };
  const fileUrl = (docId: number, mode: 'view' | 'download') =>
    buildUrl(`/api/admin/documents/${docId}/file`, mode);
  const viewUrlUrl = (docId: number) =>
    buildUrl(`/api/admin/documents/${docId}/view-url`, 'view');

  // Re-entrancy guard: avoid double-firing the open handler if the user
  // taps twice quickly. Without this, two simultaneous fetches each create
  // an audit entry — the bug the user reported as "two logs per open".
  const openingDocIdRef = useRef<number | null>(null);

  const openDocInline = (doc: TraderDoc) => {
    if (openingDocIdRef.current === doc.id) return;
    openingDocIdRef.current = doc.id;

    const isImage = doc.mimeType.startsWith('image/');
    const isPdf = doc.mimeType === 'application/pdf';
    if (!isImage && !isPdf) {
      setPreview({ doc, status: 'unsupported' });
      openingDocIdRef.current = null;
      return;
    }
    setPreview({ doc, status: 'loading' });

    (async () => {
      try {
        if (isImage) {
          // Stream the image bytes through /file so we can render them in a
          // sandboxed <Image>. /file produces ONE audit entry.
          const res = await fetch(fileUrl(doc.id, 'view'), {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) {
            const t = await res.text().catch(() => '');
            let msg = `HTTP ${res.status}`;
            try {
              const parsed = JSON.parse(t);
              if (parsed?.error) msg = parsed.error;
            } catch {
              if (t) msg = t;
            }
            throw new Error(msg);
          }
          const blob = await res.blob();
          const dataUri = await blobToDataUri(blob);
          setPreview({ doc, status: 'ready', dataUri });
          load();
        } else {
          // PDF: just hit /view-url — it both audits AND returns the
          // presigned URL we hand to the in-app browser. No /file pre-fetch
          // here, so opening a PDF produces ONE audit entry (was two).
          const r2 = await fetch(viewUrlUrl(doc.id), {
            headers: { Authorization: `Bearer ${token}` },
          });
          const j = await r2.json().catch(() => ({}));
          if (!r2.ok) throw new Error(j.error || `Failed to open document (HTTP ${r2.status})`);
          setPreview(null);
          await WebBrowser.openBrowserAsync(j.url);
          await load();
        }
      } catch (e) {
        setPreview({ doc, status: 'error', error: e instanceof Error ? e.message : 'Try again.' });
      } finally {
        openingDocIdRef.current = null;
      }
    })();
  };

  const openDocExternal = async (docId: number) => {
    // Same re-entrancy guard as openDocInline — rapid double-taps would
    // otherwise produce two /view-url calls and two audit rows.
    if (openingDocIdRef.current === docId) return;
    openingDocIdRef.current = docId;
    try {
      // /view-url audits AND returns the presigned URL — single round-trip,
      // single audit entry.
      const res = await fetch(viewUrlUrl(docId), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed to open document (HTTP ${res.status})`);
      await Linking.openURL(json.url);
      await load();
    } catch (e) {
      Alert.alert('Could not open', e instanceof Error ? e.message : 'Try again.');
    } finally {
      openingDocIdRef.current = null;
    }
  };

  const closePreview = () => {
    setPreview(null);
    // Refresh so the new audit-log entry shows up.
    load();
  };

  const submitAction = async () => {
    if (!modal) return;
    setBusy(true);
    try {
      let res: Response;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      switch (modal.kind) {
        case 'approve':
          res = await fetch(`${apiUrl}/api/admin/traders/${traderId}/approve`, {
            method: 'POST',
            headers,
            body: JSON.stringify(reason.trim() ? { notes: reason.trim() } : {}),
          });
          break;
        case 'reject':
          res = await fetch(`${apiUrl}/api/admin/traders/${traderId}/reject`, {
            method: 'POST', headers, body: JSON.stringify({ reason: reason.trim() }),
          });
          break;
        case 'request_info':
          res = await fetch(`${apiUrl}/api/admin/traders/${traderId}/request-info`, {
            method: 'POST', headers, body: JSON.stringify({ notes: reason.trim() }),
          });
          break;
        case 'suspend':
          res = await fetch(`${apiUrl}/api/admin/traders/${traderId}/suspend`, {
            method: 'POST', headers, body: JSON.stringify({ reason: reason.trim() }),
          });
          break;
        case 'reject_doc':
          res = await fetch(`${apiUrl}/api/admin/documents/${modal.documentId}/reject`, {
            method: 'POST', headers, body: JSON.stringify({ reason: reason.trim() }),
          });
          break;
      }
      const json = await res!.json();
      if (!res!.ok) throw new Error(json.error || 'Action failed');
      setModal(null);
      setReason('');
      await load();
    } catch (e) {
      Alert.alert('Action failed', e instanceof Error ? e.message : 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  const approveDocument = async (docId: number) => {
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/documents/${docId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: '{}',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to approve document');
      await load();
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Please try again');
    } finally {
      setBusy(false);
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
  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 40 }]}>
        <ActivityIndicator color={Colors.light.primary} />
      </View>
    );
  }
  if (error || !data) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 40, paddingHorizontal: 24 }]}>
        <Feather name="alert-circle" size={24} color={Colors.light.error} />
        <Text style={styles.errorText}>{error ?? 'No data'}</Text>
        <Pressable style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const { profile, user, documents, documentsEvaluation, auditLog } = data;
  const status = profile.verificationStatus;
  const verifiedWithoutDocs = status === 'VERIFIED' && !documentsEvaluation.complete;
  const canApprove = ['UNDER_REVIEW', 'PENDING_DOCUMENTS', 'REJECTED', 'SUSPENDED'].includes(status);
  const canReject = ['UNDER_REVIEW', 'PENDING_DOCUMENTS', 'VERIFIED'].includes(status);
  const canRequestInfo = ['UNDER_REVIEW', 'PENDING_DOCUMENTS'].includes(status);
  const canSuspend = ['VERIFIED', 'UNDER_REVIEW'].includes(status);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <Stack.Screen options={{ title: 'Trader Review' }} />

      <View style={[styles.headerRow, { paddingTop: Math.max(insets.top, 50) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={Colors.light.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{profile.businessName}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 200 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.light.primary} />}
      >
        {/* Status header */}
        <View style={styles.card}>
          <View style={styles.statusRow}>
            <Text style={styles.cardTitle}>Status</Text>
            <StatusPill status={status} />
          </View>
          {verifiedWithoutDocs && (
            <View style={styles.inconsistencyBox}>
              <Feather name="alert-triangle" size={14} color={Colors.light.error} />
              <Text style={styles.inconsistencyText}>
                Data inconsistency: this trader is marked VERIFIED but required documents are missing. Use Reject or Suspend to bring the record back in line.
              </Text>
            </View>
          )}
          {profile.adminNotes && (
            <View style={styles.notesBox}>
              <Text style={styles.notesLabel}>Admin notes</Text>
              <Text style={styles.notesText}>{profile.adminNotes}</Text>
            </View>
          )}
          {profile.rejectionReason && status === 'REJECTED' && (
            <View style={[styles.notesBox, { borderColor: Colors.light.error }]}>
              <Text style={[styles.notesLabel, { color: Colors.light.error }]}>Rejection reason</Text>
              <Text style={styles.notesText}>{profile.rejectionReason}</Text>
            </View>
          )}
        </View>

        {/* Business info */}
        <Text style={styles.sectionLabel}>Business Information</Text>
        <View style={styles.card}>
          <Field label="Contact" value={profile.contactName} />
          <Field label="Email" value={user.email} extra={user.emailVerified ? '✓ verified' : 'unverified'} />
          <Field label="Phone" value={profile.phone} extra={profile.phoneVerified ? '✓ verified' : 'unverified'} />
          <Field label="Trade" value={profile.mainCategory} />
          {profile.additionalServices?.length ? (
            <Field label="Services" value={profile.additionalServices.join(', ')} />
          ) : null}
          <Field label="Address" value={[profile.businessAddress, profile.town, profile.postcode].filter(Boolean).join(', ')} />
          {profile.serviceAreas?.length ? (
            <Field label="Service areas" value={profile.serviceAreas.join(', ')} />
          ) : null}
          {profile.openingHours ? <Field label="Opening hours" value={profile.openingHours} /> : null}
          {profile.website ? <Field label="Website" value={profile.website} /> : null}
          {profile.businessDescription ? (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.fieldLabel}>Description</Text>
              <Text style={styles.descText}>{profile.businessDescription}</Text>
            </View>
          ) : null}
        </View>

        {/* AI Verification */}
        <View style={styles.aiHeaderRow}>
          <Text style={styles.sectionLabel}>AI Verification</Text>
          <Pressable
            style={[styles.aiRunBtn, aiBusy && { opacity: 0.5 }]}
            disabled={aiBusy}
            onPress={runAiVerification}
          >
            {aiBusy ? (
              <ActivityIndicator size="small" color={Colors.light.primary} />
            ) : (
              <Feather name="refresh-cw" size={12} color={Colors.light.primary} />
            )}
            <Text style={styles.aiRunBtnText}>
              {profile.aiVerificationCheckedAt ? 'Re-run check' : 'Run check'}
            </Text>
          </Pressable>
        </View>
        <View style={styles.card}>
          {!profile.aiVerificationCheckedAt || !profile.aiVerificationData ? (
            <Text style={styles.muted}>
              No AI cross-check yet. Tap Run check to compare submitted data against Companies House.
            </Text>
          ) : (
            <>
              <View style={styles.aiVerdictRow}>
                <AiVerdictPill verdict={profile.aiVerificationData.verdict} />
                <Text style={styles.aiCheckedAt}>
                  Checked {formatDate(profile.aiVerificationCheckedAt)}
                </Text>
              </View>
              <Text style={styles.aiReasoning}>{profile.aiVerificationData.reasoning}</Text>
              {profile.aiVerificationData.companiesHouse ? (
                <View style={styles.aiCompareBox}>
                  <Text style={styles.aiCompareTitle}>Submitted vs Companies House</Text>
                  <CompareRow
                    label="Name"
                    a={profile.aiVerificationData.submitted.businessName}
                    b={profile.aiVerificationData.companiesHouse.companyName ?? '—'}
                  />
                  <CompareRow
                    label="Address"
                    a={profile.aiVerificationData.submitted.address || '—'}
                    b={profile.aiVerificationData.companiesHouse.address ?? '—'}
                  />
                  <CompareRow
                    label="Postcode"
                    a={profile.aiVerificationData.submitted.postcode}
                    b={profile.aiVerificationData.companiesHouse.postcode ?? '—'}
                  />
                  {profile.aiVerificationData.companiesHouse.companyNumber ? (
                    <CompareRow
                      label="Co. number"
                      a="—"
                      b={profile.aiVerificationData.companiesHouse.companyNumber}
                    />
                  ) : null}
                  {profile.aiVerificationData.companiesHouse.status ? (
                    <CompareRow
                      label="CH status"
                      a="—"
                      b={profile.aiVerificationData.companiesHouse.status}
                    />
                  ) : null}
                </View>
              ) : null}
              {profile.aiVerificationData.error ? (
                <Text style={styles.aiErrorText}>Error: {profile.aiVerificationData.error}</Text>
              ) : null}
            </>
          )}
        </View>

        {/* Documents */}
        <Text style={styles.sectionLabel}>Documents</Text>
        {documents.length > 0 && (
          <View style={styles.icoBox}>
            <Feather name="shield" size={14} color="#B45309" />
            <View style={{ flex: 1 }}>
              <Text style={styles.icoTitle}>UK GDPR / ICO notice</Text>
              <Text style={styles.icoText}>
                Documents contain personal data. Each open and download is recorded in the audit
                log with your admin ID, time, IP and (if provided) the reason below. Only access
                what you need for this verification.
              </Text>
              <TextInput
                value={accessReason}
                onChangeText={setAccessReason}
                style={styles.icoInput}
                placeholder="Reason (e.g. ICO request ref. 123) — required to re-open approved docs"
                placeholderTextColor={Colors.light.textMuted}
                maxLength={500}
              />
            </View>
          </View>
        )}
        <View style={styles.card}>
          {documents.length === 0 ? (
            <Text style={styles.muted}>No documents uploaded yet.</Text>
          ) : (
            documents.map((doc) => {
              // Approved docs are "locked" — re-opening them requires a
              // written reason in the ICO field above (server enforces with
              // 403 REVIEW_REASON_REQUIRED). The lock auto-unlocks when the
              // reason has at least 3 characters.
              const isLocked =
                doc.status === 'APPROVED' && accessReason.trim().length < 3;
              return (
                <View key={doc.id} style={styles.docRow}>
                  <Feather
                    name={doc.mimeType === 'application/pdf' ? 'file-text' : 'image'}
                    size={16}
                    color={Colors.light.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docTitle} numberOfLines={1}>{doc.originalFilename}</Text>
                    <Text style={styles.docMeta}>
                      {DOC_LABEL[doc.type] ?? doc.type} · {formatSize(doc.sizeBytes)}
                    </Text>
                    <View style={styles.docPills}>
                      <DocPill status={doc.status} />
                    </View>
                    {doc.rejectionReason ? (
                      <Text style={styles.rejectionText}>{doc.rejectionReason}</Text>
                    ) : null}
                    {isLocked ? (
                      <Text style={styles.lockedHint}>
                        Approved — type a reason above to re-open.
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.docActions}>
                    <Pressable
                      style={[
                        styles.iconBtn,
                        { backgroundColor: 'rgba(234,88,12,0.12)', borderColor: 'rgba(234,88,12,0.3)' },
                        isLocked && styles.iconBtnDisabled,
                      ]}
                      onPress={() => openDocInline(doc)}
                      disabled={isLocked}
                    >
                      <Feather
                        name={isLocked ? 'lock' : 'eye'}
                        size={14}
                        color={isLocked ? Colors.light.textMuted : Colors.light.primary}
                      />
                    </Pressable>
                    {doc.status === 'PENDING_REVIEW' && (
                      <>
                        <Pressable
                          style={[styles.iconBtn, { backgroundColor: 'rgba(16,185,129,0.12)' }]}
                          onPress={() => approveDocument(doc.id)}
                          disabled={busy}
                        >
                          <Feather name="check" size={14} color={Colors.light.success} />
                        </Pressable>
                        <Pressable
                          style={[styles.iconBtn, { backgroundColor: 'rgba(239,68,68,0.12)' }]}
                          onPress={() => { setReason(''); setModal({ kind: 'reject_doc', documentId: doc.id }); }}
                          disabled={busy}
                        >
                          <Feather name="x" size={14} color={Colors.light.error} />
                        </Pressable>
                      </>
                    )}
                  </View>
                </View>
              );
            })
          )}
          <View style={styles.evalRow}>
            <Feather
              name={documentsEvaluation.complete ? 'check-circle' : 'alert-circle'}
              size={14}
              color={documentsEvaluation.complete ? Colors.light.success : Colors.light.warning ?? '#B45309'}
            />
            <Text style={styles.evalText}>
              {documentsEvaluation.complete
                ? 'All required documents present.'
                : 'Required documents missing — trader cannot be approved yet.'}
            </Text>
          </View>
        </View>

        {/* Audit log */}
        <Text style={styles.sectionLabel}>Activity Log</Text>
        <View style={styles.card}>
          {auditLog.length === 0 ? (
            <Text style={styles.muted}>No activity yet.</Text>
          ) : (
            auditLog.map((entry) => {
              // Surface WHICH document section was opened (e.g. "Public
              // liability insurance") instead of just the filename. The
              // backend stores doc.type in details.documentType for every
              // ADMIN_VIEWED_DOCUMENT / ADMIN_DOWNLOADED_DOCUMENT entry.
              const docType =
                typeof entry.details?.documentType === 'string'
                  ? (entry.details.documentType as string)
                  : null;
              const sectionLabel = docType ? (DOC_LABEL[docType] ?? docType) : null;
              return (
                <View key={entry.id} style={styles.auditRow}>
                  <View style={styles.auditDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.auditAction}>
                      {formatAction(entry.action)}
                      {sectionLabel ? ` — ${sectionLabel}` : ''}
                    </Text>
                    {entry.notes && <Text style={styles.auditNotes}>{entry.notes}</Text>}
                    <Text style={styles.auditTime}>{formatDate(entry.createdAt)}</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Action bar */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
        {canApprove && (
          <Pressable
            style={[styles.primaryBtn, !documentsEvaluation.complete && styles.btnDisabled]}
            disabled={!documentsEvaluation.complete || busy}
            onPress={() => { setReason(''); setModal({ kind: 'approve' }); }}
          >
            <Feather name="check" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Approve</Text>
          </Pressable>
        )}
        {canRequestInfo && (
          <Pressable
            style={styles.warnBtn}
            disabled={busy}
            onPress={() => { setReason(''); setModal({ kind: 'request_info' }); }}
          >
            <Feather name="alert-circle" size={16} color="#B45309" />
            <Text style={styles.warnBtnText}>Request info</Text>
          </Pressable>
        )}
        {canReject && (
          <Pressable
            style={styles.dangerBtn}
            disabled={busy}
            onPress={() => { setReason(''); setModal({ kind: 'reject' }); }}
          >
            <Feather name="x" size={16} color={Colors.light.error} />
            <Text style={styles.dangerBtnText}>Reject</Text>
          </Pressable>
        )}
        {canSuspend && (
          <Pressable
            style={styles.dangerBtn}
            disabled={busy}
            onPress={() => { setReason(''); setModal({ kind: 'suspend' }); }}
          >
            <Feather name="slash" size={16} color={Colors.light.error} />
            <Text style={styles.dangerBtnText}>Suspend</Text>
          </Pressable>
        )}
      </View>

      {/* Document preview (inline) */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={closePreview}>
        <View style={styles.previewBackdrop}>
          <View style={styles.previewSheet}>
            <View style={styles.previewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle} numberOfLines={1}>
                  {preview?.doc.originalFilename}
                </Text>
                <Text style={styles.previewMeta} numberOfLines={1}>
                  {preview ? `${DOC_LABEL[preview.doc.type] ?? preview.doc.type} · ${preview.doc.mimeType}` : ''}
                </Text>
              </View>
              <Pressable onPress={closePreview} style={styles.previewClose} hitSlop={10}>
                <Feather name="x" size={20} color={Colors.light.text} />
              </Pressable>
            </View>

            <View style={styles.previewBody}>
              {preview?.status === 'loading' && (
                <ActivityIndicator color={Colors.light.primary} />
              )}
              {preview?.status === 'ready' && preview.dataUri && preview.doc.mimeType.startsWith('image/') && (
                <PinchZoomImage
                  source={{ uri: preview.dataUri }}
                  onError={() =>
                    setPreview({ doc: preview.doc, status: 'error', error: 'Could not load image inline.' })
                  }
                />
              )}
              {preview?.status === 'error' && (
                <View style={{ alignItems: 'center', gap: 8 }}>
                  <Feather name="alert-circle" size={24} color={Colors.light.error} />
                  <Text style={styles.errorText}>{preview.error ?? 'Failed to load.'}</Text>
                </View>
              )}
              {preview?.status === 'unsupported' && (
                <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 24 }}>
                  <Feather name="file" size={28} color={Colors.light.textMuted} />
                  <Text style={styles.muted}>
                    Inline preview is not available for this file type. Use “Open external”.
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.previewFooter}>
              <Pressable
                style={[styles.previewBtn, styles.previewBtnGhost]}
                onPress={() => preview && openDocExternal(preview.doc.id)}
              >
                <Feather name="external-link" size={14} color={Colors.light.text} />
                <Text style={styles.previewBtnGhostText}>Open external</Text>
              </Pressable>
              <Pressable style={styles.previewBtn} onPress={closePreview}>
                <Text style={styles.previewBtnText}>Done</Text>
              </Pressable>
            </View>

            <Text style={styles.icoFooter}>
              This access is recorded in the audit log.
            </Text>
          </View>
        </View>
      </Modal>

      <Modal visible={!!modal} transparent animationType="fade" onRequestClose={() => setModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{modalTitle(modal?.kind)}</Text>
            <Text style={styles.modalHint}>{modalHint(modal?.kind)}</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              style={styles.modalInput}
              multiline
              numberOfLines={4}
              placeholder={modalPlaceholder(modal?.kind)}
              placeholderTextColor={Colors.light.textMuted}
              autoFocus
            />
            <View style={styles.modalRow}>
              <Pressable
                style={[styles.modalBtn, styles.modalCancel]}
                onPress={() => { setModal(null); setReason(''); }}
                disabled={busy}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalConfirm, busy && styles.btnDisabled]}
                onPress={submitAction}
                disabled={busy || (modal?.kind !== 'approve' && reason.trim().length < 5)}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>{modalConfirm(modal?.kind)}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const DOC_LABEL: Record<string, string> = {
  ID_DOCUMENT: 'Photo ID',
  PROOF_OF_ADDRESS: 'Proof of address',
  INSURANCE: 'Public liability insurance',
  QUALIFICATION: 'Trade qualification',
  OTHER: 'Other document',
};

// Convert a fetched Blob into a data: URI usable by <Image source={{ uri }}>.
// Works on both web (FileReader) and React Native (which polyfills FileReader).
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read file.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Read failed.'));
    reader.readAsDataURL(blob);
  });
}

function formatAction(a: string): string {
  return a.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function modalTitle(k?: ActionKind): string {
  switch (k) {
    case 'approve': return 'Approve trader';
    case 'reject': return 'Reject application';
    case 'request_info': return 'Request more information';
    case 'suspend': return 'Suspend trader';
    case 'reject_doc': return 'Reject document';
    default: return '';
  }
}
function modalHint(k?: ActionKind): string {
  switch (k) {
    case 'approve': return 'Optional admin note (visible to the trader). All pending documents will be marked Approved.';
    case 'reject': return 'The trader will receive an email with this reason and their profile will not go live.';
    case 'request_info': return 'The trader returns to "awaiting documents" and is emailed your message — describe exactly what you need (e.g. clearer photo of ID, updated insurance certificate).';
    case 'suspend': return 'The trader will be hidden, unable to operate, and emailed this reason. It is also recorded in the audit log.';
    case 'reject_doc': return 'The trader is emailed this reason and can re-upload the document. Be specific (e.g. "ID is blurry — please send a clearer scan").';
    default: return '';
  }
}
function modalPlaceholder(k?: ActionKind): string {
  switch (k) {
    case 'approve':
      return 'Welcome to MyLocalTrade…';
    case 'request_info':
      return 'e.g. Please upload a clearer photo of your driving licence (both sides) and a recent utility bill from the last 3 months.';
    case 'reject_doc':
      return 'e.g. The ID photo is blurry and the expiry date is not legible. Please re-upload a clear scan.';
    case 'reject':
      return 'e.g. Insurance certificate has expired and trade qualification could not be verified.';
    case 'suspend':
      return 'e.g. Multiple complaints from customers — account suspended pending investigation.';
    default:
      return 'Enter a clear, helpful message (5+ characters)…';
  }
}
function modalConfirm(k?: ActionKind): string {
  switch (k) {
    case 'approve': return 'Approve';
    case 'reject': return 'Reject & email trader';
    case 'request_info': return 'Send email';
    case 'suspend': return 'Suspend & email trader';
    case 'reject_doc': return 'Reject & email trader';
    default: return 'Confirm';
  }
}

function Field({ label, value, extra }: { label: string; value: string | null; extra?: string }) {
  if (!value) return null;
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldValue}>{value}</Text>
        {extra ? <Text style={styles.fieldExtra}>{extra}</Text> : null}
      </View>
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    PENDING_EMAIL_VERIFICATION: { label: 'Email', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
    PENDING_PHONE_VERIFICATION: { label: 'Phone', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
    PROFILE_INCOMPLETE: { label: 'Profile incomplete', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
    PENDING_DOCUMENTS: { label: 'Awaiting documents', bg: 'rgba(245, 158, 11, 0.14)', fg: '#B45309' },
    UNDER_REVIEW: { label: 'Under review', bg: 'rgba(59, 130, 246, 0.14)', fg: '#1D4ED8' },
    VERIFIED: { label: 'Verified', bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' },
    REJECTED: { label: 'Rejected', bg: 'rgba(239, 68, 68, 0.14)', fg: '#B91C1C' },
    SUSPENDED: { label: 'Suspended', bg: 'rgba(239, 68, 68, 0.14)', fg: '#B91C1C' },
    EXPIRED_DOCUMENTS: { label: 'Expired documents', bg: 'rgba(245, 158, 11, 0.14)', fg: '#B45309' },
  };
  const v = map[status] ?? { label: status, bg: Colors.light.surface, fg: Colors.light.text };
  return (
    <View style={[styles.pill, { backgroundColor: v.bg }]}>
      <Text style={[styles.pillText, { color: v.fg }]}>{v.label}</Text>
    </View>
  );
}

function AiVerdictPill({ verdict }: { verdict: 'MATCH' | 'PARTIAL_MATCH' | 'NO_MATCH' | 'NOT_FOUND' | 'ERROR' }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    MATCH: { label: 'AI: Match', bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' },
    PARTIAL_MATCH: { label: 'AI: Partial match', bg: 'rgba(245, 158, 11, 0.14)', fg: '#B45309' },
    NO_MATCH: { label: 'AI: No match', bg: 'rgba(239, 68, 68, 0.14)', fg: '#B91C1C' },
    NOT_FOUND: { label: 'AI: Not found on CH', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
    ERROR: { label: 'AI: Check failed', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
  };
  const v = map[verdict] ?? map.ERROR;
  return (
    <View style={[styles.pill, { backgroundColor: v.bg }]}>
      <Text style={[styles.pillText, { color: v.fg }]}>{v.label}</Text>
    </View>
  );
}

function CompareRow({ label, a, b }: { label: string; a: string; b: string }) {
  const same = a.trim().toLowerCase() === b.trim().toLowerCase();
  return (
    <View style={styles.compareRow}>
      <Text style={styles.compareLabel}>{label}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.compareSubmitted}>{a}</Text>
        <Text style={[styles.compareCh, same && { color: Colors.light.success }]}>{b}</Text>
      </View>
    </View>
  );
}

function DocPill({ status }: { status: TraderDoc['status'] }) {
  const map: Record<TraderDoc['status'], { label: string; bg: string; fg: string }> = {
    PENDING_REVIEW: { label: 'Pending review', bg: 'rgba(245, 158, 11, 0.14)', fg: '#B45309' },
    APPROVED: { label: 'Approved', bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' },
    REJECTED: { label: 'Rejected', bg: 'rgba(239, 68, 68, 0.14)', fg: '#B91C1C' },
    EXPIRED: { label: 'Expired', bg: 'rgba(107, 114, 128, 0.14)', fg: '#374151' },
  };
  const v = map[status];
  return (
    <View style={[styles.smallPill, { backgroundColor: v.bg }]}>
      <Text style={[styles.smallPillText, { color: v.fg }]}>{v.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: Colors.light.textMuted, fontSize: 13 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: Colors.light.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.border },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: Colors.light.text, paddingHorizontal: 8 },

  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.light.textMuted, marginTop: 14, marginBottom: 8, marginLeft: 4 },

  card: { backgroundColor: Colors.light.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.light.border, padding: 14, gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  notesBox: { borderWidth: 1, borderColor: Colors.light.border, borderRadius: 10, padding: 10, backgroundColor: Colors.light.surface },
  inconsistencyBox: { marginTop: 10, flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderWidth: 1, borderColor: Colors.light.error, borderRadius: 10, padding: 10, backgroundColor: 'rgba(239, 68, 68, 0.08)' },
  inconsistencyText: { flex: 1, fontSize: 12, lineHeight: 17, color: Colors.light.error, fontWeight: '600' },
  notesLabel: { fontSize: 10, fontWeight: '700', color: Colors.light.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  notesText: { fontSize: 12, color: Colors.light.text, lineHeight: 17 },

  fieldRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  fieldLabel: { width: 95, fontSize: 11, color: Colors.light.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, paddingTop: 1 },
  fieldValue: { flex: 1, fontSize: 13, color: Colors.light.text, fontWeight: '600' },
  fieldExtra: { fontSize: 10, color: Colors.light.textMuted, marginTop: 2 },
  descText: { fontSize: 12, color: Colors.light.text, lineHeight: 17, marginTop: 4 },

  docRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  docTitle: { fontSize: 12, fontWeight: '700', color: Colors.light.text },
  docMeta: { fontSize: 11, color: Colors.light.textMuted, marginTop: 2 },
  docPills: { flexDirection: 'row', gap: 6, marginTop: 6 },
  rejectionText: { fontSize: 11, color: Colors.light.error, marginTop: 4, fontStyle: 'italic' },
  docActions: { flexDirection: 'row', gap: 6 },
  iconBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.light.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.border },
  iconBtnDisabled: { opacity: 0.5, backgroundColor: Colors.light.surface, borderColor: Colors.light.border },
  lockedHint: { fontSize: 11, color: Colors.light.textMuted, marginTop: 4, fontStyle: 'italic' },

  evalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10 },
  evalText: { flex: 1, fontSize: 12, color: Colors.light.text },

  auditRow: { flexDirection: 'row', gap: 12, paddingVertical: 8 },
  auditDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.light.primary, marginTop: 6 },
  auditAction: { fontSize: 12, fontWeight: '700', color: Colors.light.text },
  auditNotes: { fontSize: 11, color: Colors.light.textMuted, marginTop: 2 },
  auditTime: { fontSize: 10, color: Colors.light.textMuted, marginTop: 4 },

  aiHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 8, marginLeft: 4, marginRight: 4 },
  aiRunBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 26, borderRadius: 8, backgroundColor: 'rgba(59, 130, 246, 0.1)', borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.3)' },
  aiRunBtnText: { fontSize: 11, fontWeight: '700', color: Colors.light.primary, letterSpacing: 0.3 },
  aiVerdictRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aiCheckedAt: { fontSize: 10, color: Colors.light.textMuted },
  aiReasoning: { fontSize: 12, color: Colors.light.text, lineHeight: 17 },
  aiCompareBox: { borderWidth: 1, borderColor: Colors.light.border, borderRadius: 10, padding: 10, gap: 8, backgroundColor: Colors.light.surface },
  aiCompareTitle: { fontSize: 10, fontWeight: '700', color: Colors.light.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  compareRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  compareLabel: { width: 80, fontSize: 10, color: Colors.light.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, paddingTop: 1 },
  compareSubmitted: { fontSize: 12, color: Colors.light.text, fontWeight: '600' },
  compareCh: { fontSize: 11, color: Colors.light.textMuted, marginTop: 2, fontStyle: 'italic' },
  aiErrorText: { fontSize: 11, color: Colors.light.error, fontStyle: 'italic' },

  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  pillText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  smallPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  smallPillText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },

  actionBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: Colors.light.background,
    borderTopWidth: 1, borderTopColor: Colors.light.border,
  },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, height: 44, borderRadius: 12, backgroundColor: Colors.light.success, flexGrow: 1, justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, height: 44, borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: Colors.light.error, flexGrow: 1, justifyContent: 'center' },
  dangerBtnText: { color: Colors.light.error, fontWeight: '700', fontSize: 13 },
  warnBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, height: 44, borderRadius: 12, backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 1, borderColor: '#B45309', flexGrow: 1, justifyContent: 'center' },
  warnBtnText: { color: '#B45309', fontWeight: '700', fontSize: 13 },
  btnDisabled: { opacity: 0.4 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.light.text },
  modalHint: { fontSize: 12, color: Colors.light.textMuted, lineHeight: 17 },
  modalInput: { borderWidth: 1, borderColor: Colors.light.border, borderRadius: 10, padding: 12, minHeight: 90, fontSize: 13, color: Colors.light.text, textAlignVertical: 'top' },
  modalRow: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  modalBtn: { paddingHorizontal: 18, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modalCancel: { backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border },
  modalCancelText: { fontWeight: '700', color: Colors.light.text, fontSize: 13 },
  modalConfirm: { backgroundColor: Colors.light.primary },
  modalConfirmText: { fontWeight: '700', color: '#fff', fontSize: 13 },

  errorText: { fontSize: 13, color: Colors.light.error, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 14, height: 36, borderRadius: 10, backgroundColor: Colors.light.primary, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  icoBox: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)',
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  icoTitle: { fontSize: 12, fontWeight: '700', color: '#B45309', marginBottom: 4 },
  icoText: { fontSize: 11, color: '#92400E', lineHeight: 16 },
  icoInput: {
    marginTop: 8, borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: '#fff', fontSize: 12, color: Colors.light.text,
  },
  icoFooter: { fontSize: 10, color: Colors.light.textMuted, textAlign: 'center', marginTop: 4 },

  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 12 },
  previewSheet: {
    width: '100%', maxWidth: 520, maxHeight: Dimensions.get('window').height - 80,
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
  },
  previewHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  previewTitle: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  previewMeta: { fontSize: 11, color: Colors.light.textMuted, marginTop: 2 },
  previewClose: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.light.surface },
  previewBody: { minHeight: 280, maxHeight: Dimensions.get('window').height - 280, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', padding: 8 },
  previewImage: { width: '100%', height: '100%', minHeight: 280 },
  previewFooter: { flexDirection: 'row', gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: Colors.light.border },
  previewBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: 10, backgroundColor: Colors.light.primary },
  previewBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  previewBtnGhost: { backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border },
  previewBtnGhostText: { color: Colors.light.text, fontWeight: '700', fontSize: 13 },
});
