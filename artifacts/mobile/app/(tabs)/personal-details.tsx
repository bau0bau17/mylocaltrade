import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

type OwnChangeRequest = {
  id: number;
  field: string;
  fieldLabel: string;
  proposedValue: string | null;
  status: 'PENDING' | 'NEEDS_INFO' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  phoneOtpVerified: boolean;
  adminInfoRequest: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function statusBadge(status: OwnChangeRequest['status']) {
  switch (status) {
    case 'PENDING':
      return { label: 'Change pending review', bg: 'rgba(245, 158, 11, 0.16)', fg: '#B45309' };
    case 'NEEDS_INFO':
      return { label: 'More information required', bg: 'rgba(59, 130, 246, 0.14)', fg: '#1D4ED8' };
    case 'APPROVED':
      return { label: 'Change approved', bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' };
    case 'REJECTED':
      return { label: 'Change rejected', bg: 'rgba(239, 68, 68, 0.14)', fg: '#B91C1C' };
    default:
      return null;
  }
}

// Customer identity/contact details. Once the account is established
// (email verified), edits to the full name become admin-reviewed change
// requests, and phone changes go through the OTP-verified change flow.
export default function PersonalDetailsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const { token, user, isCustomer, isAuthenticated } = useAuth();

  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [currentPhone, setCurrentPhone] = useState<string | null>(null);
  const [phoneVerified, setPhoneVerified] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [changeControlActive, setChangeControlActive] = useState(false);
  const [requests, setRequests] = useState<OwnChangeRequest[]>([]);
  const [banner, setBanner] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/profile/change-requests`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setChangeControlActive(Boolean(json.changeControlActive));
        setRequests(Array.isArray(json.requests) ? json.requests : []);
        if (json.currentValues) {
          setCurrentPhone(json.currentValues.phone ?? null);
          setPhoneVerified(
            typeof json.currentValues.phoneVerified === 'boolean'
              ? json.currentValues.phoneVerified
              : null,
          );
          if (typeof json.currentValues.fullName === 'string') {
            setFullName((prev) => (prev ? prev : json.currentValues.fullName));
          }
        }
      }
    } catch {
      // Non-fatal: statuses simply won't show.
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) loadRequests();
    }, [isAuthenticated, loadRequests]),
  );

  useEffect(() => {
    setFullName(user?.fullName ?? '');
  }, [user?.fullName]);

  const latestFor = (field: string): OwnChangeRequest | null => {
    const r = requests.find((x) => x.field === field && x.status !== 'CANCELLED');
    return r ?? null;
  };

  const nameRequest = latestFor('fullName');
  const phoneRequest = latestFor('phone');
  const nameActive = nameRequest?.status === 'PENDING' || nameRequest?.status === 'NEEDS_INFO';

  const onSave = async () => {
    if (saving) return;
    setBanner(null);
    setSaving(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/account/personal-details`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fullName: fullName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Could not save your details');
      }
      if (Array.isArray(json.changeRequests) && json.changeRequests.length > 0) {
        setBanner(json.message ?? 'Your changes have been submitted for review.');
        // The live name stays as the approved value until admin approval.
        setFullName(json.fullName ?? fullName);
      } else {
        Alert.alert('Saved', json.message ?? 'Your details have been updated.');
      }
      loadRequests();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not save your details');
    } finally {
      setSaving(false);
    }
  };

  if (!isAuthenticated || !isCustomer) {
    return (
      <View style={[styles.centerContainer, { paddingTop: insets.top + 40 }]}>
        <Feather name="lock" size={28} color={Colors.light.textMuted} />
        <Text style={styles.mutedCenter}>This screen is for customer accounts.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 16, paddingHorizontal: 20 }}
        bottomOffset={60}
      >
        <View style={styles.form}>
          {banner ? (
            <View style={styles.bannerBox}>
              <Feather name="clock" size={14} color="#B45309" />
              <Text style={styles.bannerText}>{banner}</Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Identity & Contact</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={[styles.input, nameActive && styles.inputLocked]}
              value={fullName}
              onChangeText={setFullName}
              editable={!nameActive}
            />
            <FieldStatus request={nameRequest} />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Phone Number</Text>
            <View style={[styles.input, styles.staticRow]}>
              <Text style={styles.staticText}>{currentPhone || 'Not set'}</Text>
              <Pressable onPress={() => router.push('/change-phone')} hitSlop={8}>
                <Text style={styles.changeLink}>Change</Text>
              </Pressable>
            </View>
            <FieldStatus request={phoneRequest} />
            {phoneVerified === true ? (
              <View style={styles.verifiedRow}>
                <Feather name="check-circle" size={13} color={Colors.light.success} />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            ) : phoneVerified === false ? (
              <View style={styles.verifiedRow}>
                <Feather name="alert-circle" size={13} color="#B45309" />
                <Text style={styles.unverifiedText}>
                  Not verified — required before contacting traders.
                </Text>
                <Pressable onPress={() => router.push('/verify-phone')} hitSlop={8}>
                  <Text style={styles.changeLink}>Verify now</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <Text style={styles.noticeText}>
            Changes to your submitted identity and contact details will be reviewed before they are applied to your account. Reviews can take up to 48 hours.
          </Text>
          {!changeControlActive ? (
            <Text style={styles.noticeText}>
              Your account is not yet fully established, so changes apply straight away.
            </Text>
          ) : null}
        </View>
      </KeyboardAwareScrollViewCompat>

      <View style={[styles.footerBar, { paddingBottom: insets.bottom + tabBarHeight + 12 }]}>
        <Pressable
          style={[styles.button, (saving || nameActive) && styles.buttonDisabled]}
          onPress={onSave}
          disabled={saving || nameActive}
        >
          {saving ? (
            <ActivityIndicator color={Colors.light.white} />
          ) : (
            <Text style={styles.buttonText}>Save Changes</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function FieldStatus({ request }: { request: OwnChangeRequest | null }) {
  if (!request) return null;
  const badge = statusBadge(request.status);
  if (!badge) return null;
  return (
    <View style={{ gap: 4 }}>
      <View style={[styles.badge, { backgroundColor: badge.bg }]}>
        <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
      </View>
      {request.status === 'NEEDS_INFO' && request.adminInfoRequest ? (
        <Text style={styles.badgeDetail}>Admin: {request.adminInfoRequest}</Text>
      ) : null}
      {request.status === 'REJECTED' && request.decisionReason ? (
        <Text style={styles.badgeDetail}>Reason: {request.decisionReason}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    gap: 12,
  },
  mutedCenter: { color: Colors.light.textSecondary, fontSize: 14, textAlign: 'center' },
  form: { gap: 14 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginBottom: 4,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  inputGroup: { gap: 6 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.light.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  input: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 50,
    fontSize: 15,
    color: Colors.light.text,
  },
  inputLocked: { opacity: 0.6 },
  staticRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  staticText: { fontSize: 15, color: Colors.light.text },
  changeLink: { fontSize: 14, fontWeight: '700', color: Colors.light.primary },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, marginLeft: 4, flexWrap: 'wrap' },
  verifiedText: { fontSize: 12, fontWeight: '600', color: Colors.light.success },
  unverifiedText: { fontSize: 12, color: '#B45309', flexShrink: 1 },
  noticeText: { fontSize: 12, color: Colors.light.textMuted, lineHeight: 17, marginTop: 4 },
  bannerBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: '#B45309',
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
  },
  bannerText: { flex: 1, fontSize: 12, color: '#B45309', lineHeight: 17 },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  badgeDetail: { fontSize: 11, color: Colors.light.textSecondary, marginLeft: 4 },
  footerBar: {
    paddingTop: 12,
    paddingHorizontal: 20,
    backgroundColor: Colors.light.background,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  button: {
    backgroundColor: Colors.light.primary,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: Colors.light.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
