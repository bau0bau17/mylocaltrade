import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

const OTP_LENGTH = 6;

/**
 * Customer mobile verification (SMS only — customers are never sent RCS).
 * Phone is optional at registration; this screen is where a customer adds
 * and verifies a UK mobile before first contacting a trader (sending an
 * enquiry or accepting a quote/offer).
 */
export default function CustomerVerifyPhoneScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const { token, isCustomer } = useAuth();

  // Whether the account already has a phone on file (it was optional at
  // registration). null = still loading.
  const [hasRegisteredPhone, setHasRegisteredPhone] = useState<boolean | null>(null);
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [usingExistingPhone, setUsingExistingPhone] = useState(true);
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [mockCode, setMockCode] = useState<string | null>(null);
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!token || !isCustomer) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (cancelled) return;
        if (res.ok) {
          const has = typeof json.phone === 'string' && json.phone.trim().length > 0;
          setHasRegisteredPhone(has);
          setUsingExistingPhone(has);
          setAlreadyVerified(Boolean(json.phoneVerified));
        } else {
          setHasRegisteredPhone(false);
          setUsingExistingPhone(false);
        }
      } catch {
        if (!cancelled) {
          setHasRegisteredPhone(false);
          setUsingExistingPhone(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, isCustomer]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const sendOtp = async () => {
    if (sending || resendIn > 0) return;
    setError(null);
    setInfo(null);
    setSending(true);
    try {
      const body: Record<string, string> = {};
      if (!usingExistingPhone && phoneInput.trim().length > 0) {
        body.phone = phoneInput.trim();
      }
      const res = await fetch(`${getApiUrl()}/api/customer/phone/send-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Could not send code');
      }
      setMaskedPhone(json.phoneMasked ?? null);
      setMockCode(json.mockCode ?? null);
      setOtpSent(true);
      setResendIn(60);
      setInfo(`We sent a 6-digit code to ${json.phoneMasked ?? 'your phone'}.`);
      setTimeout(() => codeRef.current?.focus(), 200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send code');
    } finally {
      setSending(false);
    }
  };

  const verifyOtp = async () => {
    if (verifying) return;
    if (code.length !== OTP_LENGTH) {
      setError(`Please enter the ${OTP_LENGTH}-digit code.`);
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/api/customer/phone/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Could not verify code');
      }
      setVerified(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify code');
    } finally {
      setVerifying(false);
    }
  };

  if (!isCustomer) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 40 }]}>
        <Feather name="lock" size={28} color={Colors.light.textMuted} />
        <Text style={styles.errorBanner}>This screen is for customer accounts only.</Text>
      </View>
    );
  }

  if (verified || alreadyVerified) {
    return (
      <View style={[styles.container, styles.center, { paddingBottom: tabBarHeight + 16 }]}>
        <View style={styles.iconBubble}>
          <Feather name="check-circle" size={28} color={Colors.light.success} />
        </View>
        <Text style={styles.title}>Your number is verified</Text>
        <Text style={styles.subtitle}>
          You can now send enquiries to traders and accept quotes.
        </Text>
        <Pressable style={[styles.primaryBtn, { alignSelf: 'stretch' }]} onPress={() => router.back()}>
          <Text style={styles.primaryBtnText}>Continue</Text>
        </Pressable>
      </View>
    );
  }

  const showToggle = hasRegisteredPhone === true;

  return (
    <View style={[styles.container, { paddingTop: 12, paddingBottom: tabBarHeight + 16 }]}>
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        contentContainerStyle={[styles.contentContainer, { paddingBottom: 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconBubble}>
          <Feather name="smartphone" size={28} color={Colors.light.secondary} />
        </View>

        <Text style={styles.title}>Verify your mobile number</Text>
        <Text style={styles.subtitle}>
          Before you contact a trader for the first time, please verify a UK mobile number. MyLocalTrade will send you a one-time verification code by SMS.{'\n\n'}
          This keeps enquiries genuine for both customers and traders. Your number is never shared publicly.
        </Text>

        {hasRegisteredPhone === null ? (
          <View style={[styles.card, styles.center, { paddingVertical: 32 }]}>
            <ActivityIndicator color={Colors.light.secondary} />
          </View>
        ) : !otpSent ? (
          <View style={styles.card}>
            {showToggle ? (
              <View style={styles.toggleRow}>
                <Pressable
                  style={[styles.toggleBtn, usingExistingPhone && styles.toggleBtnActive]}
                  onPress={() => setUsingExistingPhone(true)}
                >
                  <Text style={[styles.toggleText, usingExistingPhone && styles.toggleTextActive]}>
                    Use registered number
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.toggleBtn, !usingExistingPhone && styles.toggleBtnActive]}
                  onPress={() => setUsingExistingPhone(false)}
                >
                  <Text style={[styles.toggleText, !usingExistingPhone && styles.toggleTextActive]}>
                    Use a different number
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {!usingExistingPhone && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>UK mobile number</Text>
                <View style={styles.inputWrap}>
                  <Feather name="phone" size={16} color={Colors.light.textMuted} />
                  <TextInput
                    style={styles.input}
                    placeholder="07700 900000"
                    placeholderTextColor={Colors.light.textMuted}
                    value={phoneInput}
                    onChangeText={setPhoneInput}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>
            )}

            <Pressable
              style={[styles.primaryBtn, sending && styles.btnDisabled]}
              onPress={sendOtp}
              disabled={sending}
            >
              {sending ? (
                <ActivityIndicator color={Colors.light.white} />
              ) : (
                <Text style={styles.primaryBtnText}>Send verification code</Text>
              )}
            </Pressable>

            <Text style={styles.consentText}>
              By continuing, you agree to receive a one-time verification message from MyLocalTrade by SMS, used for phone verification, account access, security and trust only — never for marketing, advertising, promotions, discounts or bulk messaging. Message and data rates may apply.{'\n\n'}
              If you prefer not to receive the SMS code, you can choose not to continue with this step, but you will not be able to send enquiries to traders or accept quotes. See our{' '}
              <Text style={styles.consentLink} onPress={() => router.push('/privacy')}>Privacy Policy</Text>
              {' '}and{' '}
              <Text style={styles.consentLink} onPress={() => router.push('/terms')}>Terms</Text>.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.sentTo}>Code sent to {maskedPhone ?? 'your phone'}</Text>

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
                  onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, OTP_LENGTH))}
                  keyboardType="number-pad"
                  maxLength={OTP_LENGTH}
                  autoFocus
                />
              </View>
            </View>

            {mockCode ? (
              <View style={styles.mockBox}>
                <Feather name="info" size={14} color={Colors.light.primary} />
                <Text style={styles.mockText}>
                  Test mode: your code is <Text style={{ fontWeight: '700' }}>{mockCode}</Text>
                </Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.primaryBtn, verifying && styles.btnDisabled]}
              onPress={verifyOtp}
              disabled={verifying}
            >
              {verifying ? (
                <ActivityIndicator color={Colors.light.white} />
              ) : (
                <Text style={styles.primaryBtnText}>Verify code</Text>
              )}
            </Pressable>

            <Pressable
              style={[styles.secondaryBtn, (sending || resendIn > 0) && styles.btnDisabled]}
              onPress={sendOtp}
              disabled={sending || resendIn > 0}
            >
              <Text style={styles.secondaryBtnText}>
                {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </Text>
            </Pressable>
          </View>
        )}

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
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background, paddingHorizontal: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  content: { flex: 1 },
  contentContainer: { paddingTop: 8 },
  iconBubble: { width: 64, height: 64, borderRadius: 20, backgroundColor: Colors.light.secondaryMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.border, alignSelf: 'center', marginBottom: 18 },
  title: { fontSize: 22, fontWeight: '700', color: Colors.light.text, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, color: Colors.light.textSecondary, textAlign: 'center', lineHeight: 19, marginBottom: 22, paddingHorizontal: 8 },
  card: { backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 18, padding: 18, gap: 14 },
  toggleRow: { flexDirection: 'row', backgroundColor: Colors.light.surface, padding: 4, borderRadius: 10 },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: Colors.light.card },
  toggleText: { fontSize: 12, fontWeight: '600', color: Colors.light.textMuted },
  toggleTextActive: { color: Colors.light.text },
  inputGroup: { gap: 6 },
  label: { fontSize: 11, fontWeight: '700', color: Colors.light.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginLeft: 4 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12, paddingHorizontal: 14, height: 52, gap: 10 },
  input: { flex: 1, height: '100%', fontSize: 15, color: Colors.light.text },
  sentTo: { fontSize: 13, color: Colors.light.textSecondary, textAlign: 'center' },
  consentText: { fontSize: 11, color: Colors.light.textMuted, lineHeight: 16, textAlign: 'center' },
  consentLink: { color: Colors.light.primary, fontWeight: '600', textDecorationLine: 'underline' },
  primaryBtn: { backgroundColor: Colors.light.secondary, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: Colors.light.white, fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  secondaryBtn: { backgroundColor: 'transparent', height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.border },
  secondaryBtnText: { color: Colors.light.text, fontSize: 13, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  mockBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: Colors.light.primaryMuted, borderColor: Colors.light.primary, borderWidth: 1, padding: 10, borderRadius: 10 },
  mockText: { flex: 1, fontSize: 12, color: Colors.light.primary },
  infoBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: 'rgba(6, 214, 160, 0.12)', borderColor: Colors.light.success, borderWidth: 1, padding: 10, borderRadius: 10, marginTop: 12 },
  infoText: { flex: 1, fontSize: 12, color: Colors.light.success },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.light.errorMuted, borderColor: Colors.light.error, borderWidth: 1, padding: 12, borderRadius: 10, marginTop: 12 },
  errorText: { flex: 1, fontSize: 12, color: Colors.light.error, lineHeight: 17 },
  errorBanner: { color: Colors.light.textSecondary, fontSize: 14, textAlign: 'center' },
});
