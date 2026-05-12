import React, { useState } from 'react';
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
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isAuthenticated, isAdmin, token, logout } = useAuth();

  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError(data?.error ?? 'Could not submit your deletion request. Please try again.');
        setSubmitting(false);
        return;
      }
      Alert.alert(
        'Deletion request received',
        'Your account is now deactivated. We have emailed you a confirmation. You can cancel from this screen for as long as the account is in the deactivated state.',
        [
          {
            text: 'OK',
            onPress: async () => {
              // The session is already invalidated server-side. Clear local state too.
              await logout();
              router.replace('/');
            },
          },
        ],
      );
    } catch (e) {
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
              Deleting your account will sign you out of every device, hide your trader profile (if any) from
              customers, and stop all email and push notifications. Our admin team will then finalise the deletion.
              Some records may be retained where the law requires us to do so.
            </Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>What happens immediately</Text>
        <View style={styles.bulletList}>
          <Bullet text="You are signed out of all your devices." />
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

        <Pressable style={styles.cancelBtn} onPress={() => router.back()} disabled={submitting}>
          <Text style={styles.cancelBtnText}>Cancel and go back</Text>
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
  cancelBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  cancelBtnText: { color: Colors.light.textSecondary, fontSize: 14, fontWeight: '600' },
});
