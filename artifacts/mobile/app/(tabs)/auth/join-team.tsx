import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

// Team-invitation acceptance. Reached from the emailed invite link
// (/open?j=<token> → Universal Link or custom-scheme bounce). This is a
// logged-OUT flow: the invited person creates their own login here and is
// connected to the inviting company automatically. An existing session means
// this invitation is not for this account — invites are for brand-new email
// addresses — so we ask the user to log out first instead of mixing accounts.
export default function JoinTeamScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const { isAuthenticated, user, applyToken, logout } = useAuth();

  const token = typeof params.token === 'string' ? params.token : '';

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Validate the token and fetch who the invitation is from. Any failure —
  // expired, cancelled, used, unknown — shows the same "no longer valid" card.
  const lookup = useQuery({
    queryKey: ['company', 'invite-lookup', token],
    enabled: token.length >= 16 && !isAuthenticated,
    retry: false,
    queryFn: async (): Promise<{ companyName: string; email: string }> => {
      const res = await fetch(`${getApiUrl()}/api/company/invites/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error('invalid');
      return res.json();
    },
  });

  const handleAccept = async () => {
    setErrorMsg('');
    if (!fullName.trim()) {
      setErrorMsg('Please enter your name.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/company/invites/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, fullName: fullName.trim(), password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(json?.error ?? 'Something went wrong. Please try again.');
        return;
      }
      await applyToken(json.token, json.user);
      Alert.alert(
        'Welcome to the team!',
        `Your account is ready and you're now a member of ${json.company?.name ?? 'the business'}.`,
      );
      router.replace('/(tabs)/account');
    } catch {
      setErrorMsg('Could not reach the server. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Already signed in: invitations create a brand-new account. ----
  if (isAuthenticated) {
    return (
      <View style={[styles.container, { paddingTop: 24 }]}>
        <View style={styles.card}>
          <Feather name="user-check" size={28} color={Colors.light.primary} style={{ marginBottom: 12 }} />
          <Text style={styles.cardTitle}>You're already signed in</Text>
          <Text style={styles.cardBody}>
            You're signed in as {user?.email}. Team invitations are for creating a new
            team-member account, so please log out first, then open the invitation link again.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={() => logout()}>
            <Text style={styles.primaryBtnText}>Log out</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---- Missing or invalid token ----
  if (token.length < 16 || lookup.isError) {
    return (
      <View style={[styles.container, { paddingTop: 24 }]}>
        <View style={styles.card}>
          <Feather name="alert-circle" size={28} color="#B91C1C" style={{ marginBottom: 12 }} />
          <Text style={styles.cardTitle}>Invitation not valid</Text>
          <Text style={styles.cardBody}>
            This invitation link is no longer valid. It may have expired, been cancelled,
            or already been used. Ask the business owner to send you a new invitation.
          </Text>
        </View>
      </View>
    );
  }

  if (lookup.isLoading || !lookup.data) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={Colors.light.primary} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollViewCompat
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerBlock}>
        <View style={styles.badge}>
          <Feather name="users" size={22} color={Colors.light.primary} />
        </View>
        <Text style={styles.title}>Join {lookup.data.companyName}</Text>
        <Text style={styles.subtitle}>
          Create your own login to join the team. You'll use it to sign in to MyLocalTrade.
        </Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Email</Text>
        <View style={[styles.input, styles.inputDisabled]}>
          <Text style={styles.inputDisabledText}>{lookup.data.email}</Text>
        </View>
        <Text style={styles.hint}>The invitation was sent to this address.</Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Your name *</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="e.g. Sam Taylor"
          placeholderTextColor={Colors.light.tabIconDefault}
          autoCapitalize="words"
          autoComplete="name"
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Password *</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            placeholderTextColor={Colors.light.tabIconDefault}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
          />
          <Pressable style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
            <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={Colors.light.tabIconDefault} />
          </Pressable>
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Confirm password *</Text>
        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Repeat your password"
          placeholderTextColor={Colors.light.tabIconDefault}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
        />
      </View>

      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

      <Pressable
        style={[styles.primaryBtn, submitting && { opacity: 0.6 }]}
        onPress={handleAccept}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Join the team</Text>
        )}
      </Pressable>

      <Text style={styles.legalNote}>
        By joining you agree to MyLocalTrade's Terms & Conditions and Privacy Policy.
      </Text>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  headerBlock: { alignItems: 'center', marginBottom: 24, marginTop: 8 },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0, 180, 216, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 22, fontWeight: '700', color: Colors.light.text, textAlign: 'center' },
  subtitle: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  fieldGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.light.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.light.text,
    backgroundColor: '#fff',
  },
  inputDisabled: { backgroundColor: Colors.light.background, justifyContent: 'center' },
  inputDisabledText: { fontSize: 15, color: Colors.light.tabIconDefault },
  hint: { fontSize: 12, color: Colors.light.tabIconDefault, marginTop: 4 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyeBtn: {
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  errorText: { color: '#B91C1C', fontSize: 13, marginBottom: 12 },
  primaryBtn: {
    backgroundColor: Colors.light.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  legalNote: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 24,
    alignItems: 'center',
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: Colors.light.text, marginBottom: 8, textAlign: 'center' },
  cardBody: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
});
