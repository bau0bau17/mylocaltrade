import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { forgotPassword } = useAuth();

  const [email, setEmail] = useState(params.email ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setEmail(params.email ?? '');
      setEmailError(null);
      setFormError(null);
    }, [params.email])
  );

  const handleSubmit = async () => {
    setFormError(null);
    if (!email.trim()) {
      setEmailError('Enter your email address.');
      return;
    }
    setEmailError(null);
    setIsLoading(true);
    try {
      await forgotPassword(email.trim());
      // The server responds generically whether or not the email exists, so we
      // always move the user forward to enter the code they were emailed.
      router.push({ pathname: '/auth/reset-password', params: { email: email.trim() } });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not send reset code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={styles.container}
      contentContainerStyle={{
        paddingTop: 24,
        paddingBottom: tabBarHeight + insets.bottom + 24,
        paddingHorizontal: 24,
      }}
      bottomOffset={60}
    >
      <View style={styles.header}>
        <View style={styles.logoWrap}>
          <Feather name="key" size={28} color={Colors.light.primary} />
        </View>
        <Text style={styles.title}>Forgot your password?</Text>
        <Text style={styles.subtitle}>
          Enter your email and we'll send you a 6-digit code to reset your password.
        </Text>
      </View>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email Address</Text>
          <View style={[styles.inputWrap, emailError && styles.inputWrapError]}>
            <Feather name="mail" size={16} color={emailError ? Colors.light.error : Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={Colors.light.textMuted}
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                if (emailError) setEmailError(null);
                if (formError) setFormError(null);
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="send"
              onSubmitEditing={handleSubmit}
            />
          </View>
          {emailError ? <Text style={styles.fieldError}>{emailError}</Text> : null}
        </View>

        {formError ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={16} color={Colors.light.error} />
            <Text style={styles.errorBannerText}>{formError}</Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={Colors.light.white} />
          ) : (
            <Text style={styles.buttonText}>Send Reset Code</Text>
          )}
        </Pressable>

        <Pressable style={styles.linkRow} onPress={() => router.push('/auth/reset-password')}>
          <Feather name="hash" size={14} color={Colors.light.primary} />
          <Text style={styles.linkText}>Already have a code? Enter it</Text>
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
  header: { alignItems: 'center', marginBottom: 36 },
  logoWrap: {
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
  title: { fontSize: 24, fontWeight: '700', color: Colors.light.text, marginBottom: 6 },
  subtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
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
  inputWrapError: { borderColor: Colors.light.error, borderWidth: 1.5 },
  fieldError: {
    fontSize: 12,
    color: Colors.light.error,
    fontWeight: '600',
    marginLeft: 4,
    marginTop: 2,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.light.errorMuted,
    borderWidth: 1,
    borderColor: Colors.light.error,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  errorBannerText: { flex: 1, fontSize: 13, color: Colors.light.error, fontWeight: '600' },
  button: {
    backgroundColor: Colors.light.primary,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: Colors.light.white, fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
  },
  linkText: { fontSize: 14, color: Colors.light.primary, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 12 },
  footerLink: { color: Colors.light.primary, fontSize: 14, fontWeight: '700' },
});
