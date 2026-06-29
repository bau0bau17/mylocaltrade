import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';

const CODE_LENGTH = 6;
const MIN_PASSWORD = 8;

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const { resetPassword, forgotPassword } = useAuth();

  const [email, setEmail] = useState(emailParam ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!email.trim()) {
      setError('Missing email address. Please start again.');
      return;
    }
    if (code.length !== CODE_LENGTH) {
      setError(`Please enter the ${CODE_LENGTH}-digit code.`);
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Your new password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await resetPassword(email.trim(), code, password);
      setDone(true);
      setTimeout(() => router.replace('/(tabs)/account'), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset your password.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!email.trim() || isResending || resendIn > 0) return;
    setIsResending(true);
    setError(null);
    setInfo(null);
    try {
      await forgotPassword(email.trim());
      setResendIn(60);
      setInfo('A new code has been sent. Please check your inbox.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend the code.');
    } finally {
      setIsResending(false);
    }
  };

  if (done) {
    return (
      <View
        style={[
          styles.container,
          styles.center,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={[styles.iconBubble, { backgroundColor: Colors.light.secondaryMuted }]}>
          <Feather name="check-circle" size={32} color={Colors.light.secondary} />
        </View>
        <Text style={styles.title}>Password Reset</Text>
        <Text style={styles.subtitle}>You're now signed in with your new password.</Text>
        <ActivityIndicator size="small" color={Colors.light.primary} style={{ marginTop: 20 }} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollViewCompat
      style={styles.container}
      contentContainerStyle={{
        paddingTop: 24,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
      }}
      bottomOffset={60}
    >
      <View style={styles.header}>
        <View style={styles.iconBubble}>
          <Feather name="lock" size={28} color={Colors.light.primary} />
        </View>
        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>Enter the 6-digit code we emailed you and choose a new password.</Text>
      </View>

      <View style={styles.form}>
        {!emailParam ? (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <View style={styles.inputWrap}>
              <Feather name="mail" size={16} color={Colors.light.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor={Colors.light.textMuted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>
        ) : (
          <Text style={styles.emailLine}>{email}</Text>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>6-digit code</Text>
          <View style={styles.inputWrap}>
            <Feather name="hash" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={[styles.input, { letterSpacing: 8, fontSize: 18, fontWeight: '700' }]}
              placeholder="000000"
              placeholderTextColor={Colors.light.textMuted}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              keyboardType="number-pad"
              maxLength={CODE_LENGTH}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>New password</Text>
          <View style={styles.inputWrap}>
            <Feather name="lock" size={16} color={Colors.light.textMuted} />
            <TextInput
              ref={passwordRef}
              style={styles.input}
              placeholder={`At least ${MIN_PASSWORD} characters`}
              placeholderTextColor={Colors.light.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
            <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={8}>
              <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color={Colors.light.textMuted} />
            </Pressable>
          </View>
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

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.light.white} />
          ) : (
            <Text style={styles.buttonText}>Reset Password</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.secondaryBtn, (isResending || resendIn > 0) && styles.buttonDisabled]}
          onPress={handleResend}
          disabled={isResending || resendIn > 0}
        >
          {isResending ? (
            <ActivityIndicator size="small" color={Colors.light.text} />
          ) : (
            <Text style={styles.secondaryBtnText}>
              {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
            </Text>
          )}
        </Pressable>

        <View style={styles.footer}>
          <Pressable onPress={() => router.replace('/auth/login')}>
            <Text style={styles.footerLink}>Back to log in</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  header: { alignItems: 'center', marginBottom: 32 },
  iconBubble: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  title: { fontSize: 24, fontWeight: '700', color: Colors.light.text, marginBottom: 6, textAlign: 'center' },
  subtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  emailLine: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.primary,
    textAlign: 'center',
  },
  form: { gap: 18 },
  inputGroup: { gap: 8 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.light.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
    gap: 10,
  },
  input: { flex: 1, height: '100%', fontSize: 15, color: Colors.light.text },
  button: {
    backgroundColor: Colors.light.primary,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: Colors.light.white, fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
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
  infoBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(6, 214, 160, 0.12)',
    borderColor: Colors.light.success,
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
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
  },
  errorText: { flex: 1, fontSize: 12, color: Colors.light.error, lineHeight: 17 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  footerLink: { color: Colors.light.primary, fontSize: 14, fontWeight: '700' },
});
