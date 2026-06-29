import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

const CODE_LENGTH = 6;

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { email, pollToken } = useLocalSearchParams<{ email: string; pollToken?: string }>();
  const { resendVerification, verifyEmailCode } = useAuth();

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const codeRef = useRef<TextInput>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Resend cooldown countdown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  // Auto-clear transient errors.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  // Fallback path: if the user verifies by tapping the link in their browser
  // instead of entering the code, poll the status so this screen still moves
  // them forward (to log in, since the link path does not issue a session).
  useEffect(() => {
    if (!pollToken) return;
    const check = async () => {
      try {
        const res = await fetch(
          `${getApiUrl()}/api/auth/verification-status?token=${encodeURIComponent(pollToken)}`,
        );
        if (!res.ok) return;
        const json = await res.json();
        if (json?.verified) {
          setVerified(true);
          if (intervalRef.current) clearInterval(intervalRef.current);
          setTimeout(() => router.replace('/auth/login'), 2000);
        }
      } catch {
        // silent retry
      }
    };
    check();
    intervalRef.current = setInterval(check, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [pollToken, router]);

  const handleVerify = async () => {
    if (verifying) return;
    if (!email) {
      setError('Missing email address. Please sign up again.');
      return;
    }
    if (code.length !== CODE_LENGTH) {
      setError(`Please enter the ${CODE_LENGTH}-digit code.`);
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const profile = await verifyEmailCode(email, code);
      if (intervalRef.current) clearInterval(intervalRef.current);
      setVerified(true);
      setTimeout(() => {
        if (profile.role === 'trader') {
          router.replace('/trader-dashboard/verify-phone');
        } else {
          router.replace('/(tabs)/account');
        }
      }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify code');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!email || isSending || resendIn > 0) return;
    setIsSending(true);
    setError(null);
    setInfo(null);
    try {
      await resendVerification(email);
      setResendIn(60);
      setInfo('A new code has been sent. Please check your inbox.');
      setTimeout(() => codeRef.current?.focus(), 200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend email');
    } finally {
      setIsSending(false);
    }
  };

  if (verified) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={[styles.iconBubble, { backgroundColor: Colors.light.secondaryMuted }]}>
          <Feather name="check-circle" size={32} color={Colors.light.secondary} />
        </View>
        <Text style={styles.title}>Email Verified!</Text>
        <Text style={styles.subtitle}>Your account has been activated.</Text>
        <ActivityIndicator size="small" color={Colors.light.primary} style={{ marginTop: 20 }} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.content}>
        <View style={styles.iconBubble}>
          <Feather name="mail" size={28} color={Colors.light.primary} />
        </View>

        <Text style={styles.title}>Verify your email</Text>
        <Text style={styles.subtitle}>Enter the 6-digit code we sent to:</Text>
        <Text style={styles.email}>{email ?? 'your email address'}</Text>

        <View style={styles.card}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>6-digit code</Text>
            <View style={styles.inputWrap}>
              <Feather name="hash" size={16} color={Colors.light.textMuted} />
              <TextInput
                ref={codeRef}
                style={[styles.input, { letterSpacing: 8, fontSize: 18, fontWeight: '700' }]}
                placeholder="000000"
                placeholderTextColor={Colors.light.textMuted}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, CODE_LENGTH))}
                keyboardType="number-pad"
                maxLength={CODE_LENGTH}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleVerify}
              />
            </View>
          </View>

          <Pressable
            style={[styles.primaryBtn, verifying && styles.btnDisabled]}
            onPress={handleVerify}
            disabled={verifying}
          >
            {verifying ? (
              <ActivityIndicator color={Colors.light.background} />
            ) : (
              <Text style={styles.primaryBtnText}>Verify email</Text>
            )}
          </Pressable>

          <Pressable
            style={[styles.secondaryBtn, (isSending || resendIn > 0) && styles.btnDisabled]}
            onPress={handleResend}
            disabled={isSending || resendIn > 0}
          >
            {isSending ? (
              <ActivityIndicator size="small" color={Colors.light.text} />
            ) : (
              <Text style={styles.secondaryBtnText}>
                {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </Text>
            )}
          </Pressable>
        </View>

        {info ? (
          <View style={styles.infoBox}>
            <Feather name="check-circle" size={14} color={Colors.light.success} />
            <Text style={styles.infoText}>{info}</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={14} color={Colors.light.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.note}>
          Prefer your browser? Tap the verification link in the same email instead. Check your spam
          folder if the email doesn't arrive within a few minutes.
        </Text>

        <Pressable style={styles.loginLinkRow} onPress={() => router.replace('/auth/login')}>
          <Feather name="log-in" size={14} color={Colors.light.primary} />
          <Text style={styles.loginLinkText}>Already verified? Log in</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background, paddingHorizontal: 24 },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, justifyContent: 'center' },
  iconBubble: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  email: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.primary,
    textAlign: 'center',
    marginBottom: 24,
  },
  card: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 18,
    padding: 18,
    gap: 14,
  },
  inputGroup: { gap: 6 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    gap: 10,
  },
  input: { flex: 1, height: '100%', color: Colors.light.text },
  primaryBtn: {
    backgroundColor: Colors.light.primary,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: Colors.light.background, fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  secondaryBtn: {
    backgroundColor: 'transparent',
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  secondaryBtnText: { color: Colors.light.text, fontSize: 13, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  infoBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(6, 214, 160, 0.12)',
    borderColor: Colors.light.success,
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  infoText: { flex: 1, fontSize: 12, color: Colors.light.success },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: Colors.light.errorMuted,
    borderColor: Colors.light.error,
    borderWidth: 1,
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  errorText: { flex: 1, fontSize: 12, color: Colors.light.error, lineHeight: 17 },
  note: {
    fontSize: 12,
    color: Colors.light.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 20,
  },
  loginLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 18,
  },
  loginLinkText: { fontSize: 14, color: Colors.light.primary, fontWeight: '600' },
});
