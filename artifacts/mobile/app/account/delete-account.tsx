import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';
import { getGetMeQueryKey } from '@workspace/api-client-react';

type DeletionStatus = {
  deletionStatus: string | null;
  deletionRequestedAt: string | null;
  deletionReason: string | null;
  scheduledHardDeleteAt: string | null;
  retentionUntil: string | null;
  retentionReason: string | null;
  canCancel: boolean;
};

const CANCELLABLE = new Set(['REQUESTED', 'DISABLED_PENDING_RETENTION']);

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { user, isAuthenticated, isAdmin, token, applyToken } = useAuth();

  const [statusLoading, setStatusLoading] = useState(true);
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!token) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await fetch(`${getApiUrl()}/api/account/deletion-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatusError(data?.error ?? 'Could not load your deletion status.');
        setStatus(null);
      } else {
        setStatus(data as DeletionStatus);
      }
    } catch {
      setStatusError('Network error. Please check your connection and try again.');
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  if (!isAuthenticated || !user) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24, paddingHorizontal: 20 }]}>
        <Stack.Screen options={{ title: 'Delete account' }} />
        <Text style={styles.heading}>Delete account</Text>
        <Text style={styles.body}>You need to be signed in to delete your account.</Text>
      </View>
    );
  }

  if (isAdmin) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24, paddingHorizontal: 20 }]}>
        <Stack.Screen options={{ title: 'Delete account' }} />
        <Text style={styles.heading}>Delete account</Text>
        <Text style={styles.body}>
          Administrator accounts cannot be self-deleted from the app. Please contact another administrator.
        </Text>
      </View>
    );
  }

  if (statusLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Delete account' }} />
        <ActivityIndicator color={Colors.light.primary} />
      </View>
    );
  }

  if (statusError) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24, paddingHorizontal: 20 }]}>
        <Stack.Screen options={{ title: 'Delete account' }} />
        <Text style={styles.heading}>Delete account</Text>
        <Text style={styles.body}>{statusError}</Text>
        <Pressable style={[styles.deleteBtn, { marginTop: 20 }]} onPress={() => void fetchStatus()}>
          <Text style={styles.deleteBtnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const isPending = !!status?.deletionStatus && CANCELLABLE.has(status.deletionStatus);

  if (isPending) {
    return (
      <PendingDeletionView
        status={status!}
        token={token!}
        onCancelled={async () => {
          await fetchStatus();
          qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        }}
      />
    );
  }

  // Otherwise: account is active — show the request form.
  return (
    <RequestDeletionView
      token={token!}
      onRequested={async (newToken) => {
        await applyToken(newToken);
        await fetchStatus();
        qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Pending — status + cancel
// ---------------------------------------------------------------------------

function PendingDeletionView({
  status,
  token,
  onCancelled,
}: {
  status: DeletionStatus;
  token: string;
  onCancelled: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestedDate = status.deletionRequestedAt
    ? new Date(status.deletionRequestedAt).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;

  const stageLabel =
    status.deletionStatus === 'REQUESTED'
      ? 'Awaiting admin review'
      : 'Disabled — retention period in progress';

  const onCancelTap = () => {
    setShowCancelConfirm(true);
  };

  const onConfirmCancel = () => {
    setShowCancelConfirm(false);
    setError(null);
    setPassword('');
    setConfirm(false);
    setShowPasswordModal(true);
  };

  const onSubmitCancel = async () => {
    if (!password || !confirm || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/api/account/deletion-cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password, confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          setError('This deletion request can no longer be cancelled.');
        } else if (res.status === 401) {
          setError('The password you entered is incorrect.');
        } else if (res.status === 429) {
          setError(data?.error ?? 'Too many attempts. Please wait 15 minutes.');
        } else {
          setError(data?.error ?? 'We could not cancel your deletion request. Please try again.');
        }
        setSubmitting(false);
        return;
      }
      setShowPasswordModal(false);
      setSubmitting(false);
      Alert.alert(
        'Deletion request cancelled',
        'Your account deletion request has been cancelled. Some features may stay limited until your verification, subscription and document checks are reviewed.',
      );
      await onCancelled();
    } catch {
      setError('We could not cancel your deletion request. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Deletion status' }} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}>
        <View style={styles.warnCard}>
          <Feather name="clock" size={22} color={Colors.light.error} />
          <View style={{ flex: 1 }}>
            <Text style={styles.warnTitle}>Account deletion request pending</Text>
            <Text style={styles.warnBody}>
              Your account is currently deactivated. An administrator will finalise your deletion shortly.
              You can cancel this request from here while it is still pending.
            </Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Status</Text>
        <View style={styles.detailCard}>
          <DetailRow label="Stage" value={stageLabel} />
          {requestedDate ? <DetailRow label="Requested" value={requestedDate} /> : null}
          {status.deletionReason ? (
            <DetailRow label="Your reason" value={status.deletionReason} multiline />
          ) : null}
          {status.retentionUntil ? (
            <DetailRow
              label="Retention until"
              value={new Date(status.retentionUntil).toLocaleDateString('en-GB')}
            />
          ) : null}
          {status.retentionReason ? (
            <DetailRow label="Retention reason" value={status.retentionReason} multiline />
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>What happens if you cancel</Text>
        <View style={styles.bulletList}>
          <Bullet text="Your account is reactivated for sign-in." />
          <Bullet text="Trader profiles only become public again if your verification, subscription, suspension and document checks all pass." />
          <Bullet text="Some features may stay temporarily limited while we re-check your account." />
        </View>

        <Pressable
          style={[styles.deleteBtn, { backgroundColor: Colors.light.primary }]}
          onPress={onCancelTap}
        >
          <Feather name="rotate-ccw" size={18} color={Colors.light.white} />
          <Text style={styles.deleteBtnText}>Cancel deletion request</Text>
        </Pressable>
      </ScrollView>

      {/* Step 1: confirm intent */}
      <Modal
        transparent
        visible={showCancelConfirm}
        animationType="fade"
        onRequestClose={() => setShowCancelConfirm(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Cancel account deletion request?</Text>
            <Text style={styles.modalBody}>
              If you cancel your deletion request, your account may be reactivated. Some features may
              remain unavailable until your account status, verification, subscription or document
              status is checked.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setShowCancelConfirm(false)}
              >
                <Text style={styles.modalBtnGhostText}>Keep deletion request</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={onConfirmCancel}
              >
                <Text style={styles.modalBtnPrimaryText}>Cancel deletion request</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Step 2: password gate */}
      <Modal
        transparent
        visible={showPasswordModal}
        animationType="slide"
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm with your password</Text>
            <Text style={styles.modalBody}>
              For your security, enter your account password to cancel the deletion request.
            </Text>
            <TextInput
              style={[styles.input, { marginBottom: 12 }]}
              placeholder="Your current password"
              placeholderTextColor={Colors.light.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              value={password}
              onChangeText={setPassword}
              editable={!submitting}
            />
            <View style={styles.confirmRow}>
              <Switch
                value={confirm}
                onValueChange={setConfirm}
                disabled={submitting}
                trackColor={{ false: Colors.light.border, true: Colors.light.primary }}
                thumbColor={Colors.light.white}
              />
              <Text style={styles.confirmText}>
                I want to cancel my account deletion request.
              </Text>
            </View>
            {error ? (
              <View style={styles.errorBox}>
                <Feather name="x-circle" size={16} color={Colors.light.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setShowPasswordModal(false)}
                disabled={submitting}
              >
                <Text style={styles.modalBtnGhostText}>Back</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalBtn,
                  styles.modalBtnPrimary,
                  (!password || !confirm || submitting) && styles.deleteBtnDisabled,
                ]}
                onPress={onSubmitCancel}
                disabled={!password || !confirm || submitting}
              >
                {submitting ? (
                  <ActivityIndicator color={Colors.light.white} />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Cancel deletion</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <View style={[styles.detailRow, multiline && { flexDirection: 'column', alignItems: 'flex-start', gap: 4 }]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, multiline && { textAlign: 'left' }]}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Active — request form
// ---------------------------------------------------------------------------

function RequestDeletionView({
  token,
  onRequested,
}: {
  token: string;
  onRequested: (newToken: string) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = password.length > 0 && confirm && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/api/account/deletion-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          password,
          confirm: true,
          reason: reason.trim() ? reason.trim() : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          setError('The password you entered is incorrect.');
        } else {
          setError(data?.error ?? 'Could not submit your deletion request. Please try again.');
        }
        setSubmitting(false);
        return;
      }
      // Persist the rotated token before any other API call hits 401.
      if (data?.token) {
        await onRequested(data.token);
      }
      Alert.alert(
        'Deletion request received',
        'Your account is now deactivated. We have emailed you a confirmation. You can cancel this from here while it is still pending.',
      );
      setSubmitting(false);
    } catch {
      setError('Network error. Please check your connection and try again.');
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Delete account' }} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.warnCard}>
          <Feather name="alert-triangle" size={22} color={Colors.light.error} />
          <View style={{ flex: 1 }}>
            <Text style={styles.warnTitle}>This is permanent</Text>
            <Text style={styles.warnBody}>
              Deleting your account will sign you out of every other device, hide your trader profile (if any) from
              customers, and stop all email and push notifications. Our admin team will then finalise the deletion.
              Some records may be retained where the law requires us to do so.
            </Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>What happens immediately</Text>
        <View style={styles.bulletList}>
          <Bullet text="You are signed out of all your other devices." />
          <Bullet text="Your trader profile is removed from search and listings." />
          <Bullet text="Push notifications and marketing emails stop." />
          <Bullet text="You can cancel from this screen until an admin finalises the deletion." />
        </View>

        <Text style={styles.sectionLabel}>Reason (optional)</Text>
        <Text style={styles.helpText}>
          Telling us why you're leaving helps us improve. This is shared only with our admin team.
        </Text>
        <TextInput
          style={styles.textArea}
          placeholder="Why are you deleting your account?"
          placeholderTextColor={Colors.light.textMuted}
          multiline
          numberOfLines={4}
          maxLength={2000}
          value={reason}
          onChangeText={setReason}
          editable={!submitting}
        />

        <Text style={styles.sectionLabel}>Confirm with your password</Text>
        <Text style={styles.helpText}>
          For your security, you must enter your account password to continue.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Your current password"
          placeholderTextColor={Colors.light.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          value={password}
          onChangeText={setPassword}
          editable={!submitting}
        />

        <View style={styles.confirmRow}>
          <Switch
            value={confirm}
            onValueChange={setConfirm}
            disabled={submitting}
            trackColor={{ false: Colors.light.border, true: Colors.light.error }}
            thumbColor={Colors.light.white}
          />
          <Text style={styles.confirmText}>
            I understand my account will be deactivated immediately and finalised by an administrator.
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Feather name="x-circle" size={16} color={Colors.light.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.deleteBtn, !canSubmit && styles.deleteBtnDisabled]}
          disabled={!canSubmit}
          onPress={onSubmit}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.light.white} />
          ) : (
            <>
              <Feather name="trash-2" size={18} color={Colors.light.white} />
              <Text style={styles.deleteBtnText}>Delete my account</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.light.text, marginBottom: 12 },
  body: { fontSize: 14, color: Colors.light.textSecondary, lineHeight: 21 },
  warnCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(239, 68, 68, 0.30)',
    borderWidth: 1,
    padding: 14,
    borderRadius: 14,
    marginBottom: 20,
  },
  warnTitle: { fontSize: 15, fontWeight: '700', color: Colors.light.error, marginBottom: 4 },
  warnBody: { fontSize: 13, color: Colors.light.text, lineHeight: 19 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 8,
  },
  bulletList: { marginBottom: 16 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  bulletDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: Colors.light.error, marginTop: 7,
  },
  bulletText: { flex: 1, fontSize: 13, color: Colors.light.text, lineHeight: 19 },
  helpText: { fontSize: 12, color: Colors.light.textMuted, marginBottom: 8, lineHeight: 17 },
  textArea: {
    backgroundColor: Colors.light.card,
    borderColor: Colors.light.border,
    borderWidth: 1, borderRadius: 12, padding: 12,
    fontSize: 14, color: Colors.light.text,
    minHeight: 90, textAlignVertical: 'top', marginBottom: 12,
  },
  input: {
    backgroundColor: Colors.light.card,
    borderColor: Colors.light.border, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 15, color: Colors.light.text, marginBottom: 16,
  },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  confirmText: { flex: 1, fontSize: 13, color: Colors.light.text, lineHeight: 19 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    padding: 10, borderRadius: 10, marginBottom: 12,
  },
  errorText: { flex: 1, color: Colors.light.error, fontSize: 13 },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: Colors.light.error,
    paddingVertical: 14, borderRadius: 14, marginTop: 4,
  },
  deleteBtnDisabled: { opacity: 0.45 },
  deleteBtnText: { color: Colors.light.white, fontSize: 16, fontWeight: '700' },

  detailCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    flex: 1,
    fontSize: 14,
    color: Colors.light.text,
    textAlign: 'right',
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: Colors.light.background,
    borderRadius: 18,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.text,
  },
  modalBody: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    lineHeight: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  modalBtnGhostText: {
    color: Colors.light.text,
    fontSize: 14,
    fontWeight: '600',
  },
  modalBtnPrimary: {
    backgroundColor: Colors.light.primary,
  },
  modalBtnPrimaryText: {
    color: Colors.light.white,
    fontSize: 14,
    fontWeight: '700',
  },
});
