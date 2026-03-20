import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const { resendVerification } = useAuth();
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleResend = async () => {
    if (!email) return;
    setIsSending(true);
    try {
      await resendVerification(email);
      setSent(true);
      Alert.alert('Email Sent', 'A new verification email has been sent. Please check your inbox.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not resend email';
      Alert.alert('Error', message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.iconWrap}>
        <Feather name="mail" size={36} color={Colors.light.primary} />
      </View>

      <Text style={styles.title}>Check Your Email</Text>
      <Text style={styles.subtitle}>We sent a verification link to:</Text>
      <Text style={styles.email}>{email ?? 'your email address'}</Text>

      <View style={styles.steps}>
        <View style={styles.step}>
          <View style={styles.stepNum}><Text style={styles.stepNumText}>1</Text></View>
          <Text style={styles.stepText}>Open the email from MyLocalTrade</Text>
        </View>
        <View style={styles.step}>
          <View style={styles.stepNum}><Text style={styles.stepNumText}>2</Text></View>
          <Text style={styles.stepText}>Tap <Text style={styles.bold}>Verify Email Address</Text></Text>
        </View>
        <View style={styles.step}>
          <View style={styles.stepNum}><Text style={styles.stepNumText}>3</Text></View>
          <Text style={styles.stepText}>Return here and log in</Text>
        </View>
      </View>

      <Pressable
        style={styles.loginBtn}
        onPress={() => router.replace('/auth/login')}
      >
        <Feather name="log-in" size={16} color={Colors.light.primary} />
        <Text style={styles.loginBtnText}>Go to Log In</Text>
      </Pressable>

      <View style={styles.resendRow}>
        <Text style={styles.resendLabel}>Didn't receive it?</Text>
        <Pressable onPress={handleResend} disabled={isSending || sent}>
          {isSending ? (
            <ActivityIndicator size="small" color={Colors.light.primary} />
          ) : (
            <Text style={[styles.resendLink, sent && styles.resendSent]}>
              {sent ? 'Email sent ✓' : 'Resend email'}
            </Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.note}>
        Check your spam folder if you don't see the email within a few minutes.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  email: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.primary,
    textAlign: 'center',
    marginBottom: 32,
  },
  steps: {
    width: '100%',
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    padding: 20,
    gap: 16,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumText: {
    color: Colors.light.background,
    fontWeight: '700',
    fontSize: 13,
  },
  stepText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
  bold: {
    fontWeight: '600',
    color: Colors.light.text,
  },
  loginBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.light.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    marginBottom: 20,
  },
  loginBtnText: {
    color: Colors.light.background,
    fontWeight: '700',
    fontSize: 16,
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  resendLabel: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  resendLink: {
    fontSize: 14,
    color: Colors.light.primary,
    fontWeight: '600',
  },
  resendSent: {
    color: Colors.light.secondary,
  },
  note: {
    fontSize: 12,
    color: Colors.light.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
