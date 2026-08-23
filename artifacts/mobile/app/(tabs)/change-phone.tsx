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

// Change an already-established account's phone number. The proposed number
// is OTP-verified first (same Twilio Verify flow as onboarding), then
// submitted as a Profile Change Request for admin review. The current
// approved number stays active until the change is approved.
export default function ChangePhoneScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const { token, isTrader, isAuthenticated } = useAuth();

  const [phoneInput, setPhoneInput] = useState('');
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [mockCode, setMockCode] = useState<string | null>(null);
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(t);
  }, [error]);

  const sendOtp = async () => {
    if (sending || resendIn > 0) return;
    setError(null);
    setInfo(null);
    setSending(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/profile/phone-change/send-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: phoneInput.trim() }),
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
      const res = await fetch(`${getApiUrl()}/api/profile/phone-change/verify`, {
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
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify code');
    } finally {
      setVerifying(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 40 }]}>
        <Feather name="lock" size={28} color={Colors.light.textMuted} />
        <Text style={styles.errorBanner}>Please log in to change your phone number.</Text>
      </View>
    );
  }

  if (submitted) {
    return (
      <View style={[styles.container, { paddingTop: 12, paddingBottom: tabBarHeight + 16 }]}>
        <ScrollView contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
          <View style={[styles.iconBubble, { backgroundColor: 'rgba(6, 214, 160, 0.12)' }]}>
            <Feather name="check-circle" size={28} color={Colors.light.success} />
          </View>
          <Text style={styles.title}>Submitted for review</Text>
          <Text style={styles.subtitle}>
            Your changes have been submitted for review. Your current approved information will remain active while we review the request. We'll contact you if we need any additional information. Reviews can take up to 48 hours.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

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

          <Text style={styles.title}>Verify your phone number</Text>
          <Text style={styles.subtitle}>
            {isTrader
              ? 'Where Twilio Verify is configured, MyLocalTrade may send a one-time code through its configured channel, such as SMS or RCS where available; otherwise, the code is sent to your account email address to verify this mobile number for account access, security and trust.'
              : 'Where Twilio Verify is configured, MyLocalTrade may send a one-time code through its configured channel, such as SMS or RCS where available; otherwise, the code is sent to your account email address to verify this mobile number for account access, security and trust.'}{'\n\n'}
            {isTrader
              ? 'Phone verification is part of trader verification. Once verified, your new number is submitted for review — your current approved number stays active until the change is approved.'
              : 'This verification confirms your identity and contact details for account security and trust. Once verified, your new number is submitted for review — your current number stays active until the change is approved.'}
          </Text>

          {!otpSent ? (
            <View style={styles.card}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>New UK mobile number</Text>
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

              <Pressable
                style={[styles.primaryBtn, (sending || phoneInput.trim().length === 0) && styles.btnDisabled]}
                onPress={sendOtp}
                disabled={sending || phoneInput.trim().length === 0}
              >
                {sending ? (
                  <ActivityIndicator color={Colors.light.white} />
                ) : (
                  <Text style={styles.primaryBtnText}>Send verification code</Text>
                )}
              </Pressable>

              <Text style={styles.consentText}>
                By tapping 'Send verification code', you agree to receive a one-time verification message from MyLocalTrade where Twilio Verify is configured, through its configured channel such as SMS or RCS where available; otherwise, the code is sent to your account email address. Messaging delivery may vary by device, network, provider configuration and availability. These messages are used only for account and phone verification, security and trust — never for marketing, advertising, promotions, discounts or bulk messaging. Message and data rates may apply. See our{' '}
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

              <Pressable style={styles.secondaryBtn} onPress={() => { setOtpSent(false); setCode(''); }}>
                <Text style={styles.secondaryBtnText}>Use a different number</Text>
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
