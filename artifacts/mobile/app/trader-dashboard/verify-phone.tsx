import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

const OTP_LENGTH = 6;

export default function VerifyPhoneScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, isTrader } = useAuth();

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
  const [mockCode, setMockCode] = useState<string | null>(null);
  const codeRef = useRef<TextInput>(null);

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
      const res = await fetch(`${getApiUrl()}/api/trader/phone/send-otp`, {
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
      const res = await fetch(`${getApiUrl()}/api/trader/phone/verify`, {
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
      Alert.alert('Phone verified', 'Your phone number has been verified successfully.', [
        { text: 'Continue', onPress: () => router.replace('/trader-dashboard') },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify code');
    } finally {
      setVerifying(false);
    }
  };

  if (!isTrader) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 40 }]}>
        <Feather name="lock" size={28} color={Colors.light.textMuted} />
        <Text style={styles.errorBanner}>This screen is for trader accounts only.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={Colors.light.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Verify Phone Number</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.iconBubble}>
          <Feather name="smartphone" size={28} color={Colors.light.secondary} />
        </View>

        <Text style={styles.title}>Confirm your mobile number</Text>
        <Text style={styles.subtitle}>
          We use your phone number to contact you about leads and account issues. It's never shared publicly.
        </Text>

        {!otpSent ? (
          <View style={styles.card}>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background, paddingHorizontal: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: Colors.light.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.border },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.text },
  content: { flex: 1, alignItems: 'stretch', paddingTop: 8 },
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
