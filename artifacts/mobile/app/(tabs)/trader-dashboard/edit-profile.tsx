import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useGetTraderProfile, useUpdateTraderProfile, useGetCustomerUploadUrl } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl, objectImageUrl } from '@/lib/api-url';

const LOGO_MAX_BYTES = 8 * 1024 * 1024;
const LOGO_ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

function guessLogoMime(uri: string, fallback?: string | null): string {
  if (fallback && LOGO_ALLOWED_MIMES.includes(fallback)) return fallback;
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    case 'heif': return 'image/heif';
    default: return 'image/jpeg';
  }
}

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

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const { token } = useAuth();

  const { data: profile, isLoading, refetch } = useGetTraderProfile();
  const { mutateAsync: updateProfile, isPending } = useUpdateTraderProfile();

  const [formData, setFormData] = useState({
    businessName: '',
    contactName: '',
    businessDescription: '',
    website: '',
  });
  const [changeControlActive, setChangeControlActive] = useState(false);
  const [requests, setRequests] = useState<OwnChangeRequest[]>([]);
  const [banner, setBanner] = useState<string | null>(null);

  // --- Business logo (the COMPANY's mark, shown on your public business
  // profile — not your personal profile photo, which lives in Account).
  const { mutateAsync: getUploadUrl } = useGetCustomerUploadUrl();
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const pickAndUploadLogo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to set your business logo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const mimeType = guessLogoMime(asset.uri, asset.mimeType ?? null);
    if (!LOGO_ALLOWED_MIMES.includes(mimeType)) {
      Alert.alert('Unsupported', 'Please choose a JPEG, PNG, WEBP or HEIC image.');
      return;
    }
    const sizeBytes = asset.fileSize ?? 0;
    if (sizeBytes > LOGO_MAX_BYTES) {
      Alert.alert('File too large', 'Maximum size is 8 MB.');
      return;
    }
    setLogoBusy(true);
    try {
      const filename = asset.fileName || `logo-${Date.now()}.jpg`;
      const urlResp = await getUploadUrl({ data: { filename, mimeType, sizeBytes: sizeBytes || 1 } });
      const fileResp = await fetch(asset.uri);
      const blob = await fileResp.blob();
      const putRes = await fetch(urlResp.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: blob,
      });
      if (!putRes.ok) throw new Error('Upload to storage failed');
      await updateProfile({ data: { logoUrl: urlResp.objectPath } });
      setLogoPreview(asset.uri);
      refetch();
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLogoBusy(false);
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      await updateProfile({ data: { logoUrl: null } });
      setLogoPreview(null);
      refetch();
    } catch (e) {
      Alert.alert('Could not remove logo', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLogoBusy(false);
    }
  };

  useEffect(() => {
    if (profile) {
      setFormData({
        businessName: profile.businessName || '',
        contactName: profile.contactName || '',
        businessDescription: profile.businessDescription || '',
        website: profile.website || '',
      });
    }
  }, [profile]);

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/profile/change-requests`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setChangeControlActive(Boolean(json.changeControlActive));
        setRequests(Array.isArray(json.requests) ? json.requests : []);
      }
    } catch {
      // Non-fatal: per-field statuses simply won't show.
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      loadRequests();
      refetch();
    }, [loadRequests, refetch]),
  );

  const latestFor = (field: string): OwnChangeRequest | null =>
    requests.find((x) => x.field === field && x.status !== 'CANCELLED') ?? null;

  const isFieldLocked = (field: string) => {
    const r = latestFor(field);
    return r?.status === 'PENDING' || r?.status === 'NEEDS_INFO';
  };

  const handleUpdate = async () => {
    setBanner(null);
    try {
      const result = await updateProfile({ data: formData });
      if (result.changeRequests && result.changeRequests.length > 0) {
        setBanner(
          result.reviewMessage ??
            'Your changes have been submitted for review. Your current approved information will remain active while we review the request.',
        );
        loadRequests();
        refetch();
      } else {
        Alert.alert('Success', 'Profile updated successfully', [
          { text: 'OK', onPress: () => router.back() }
        ]);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not update profile';
      Alert.alert('Error', message);
    }
  };

  if (isLoading) {
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
      contentContainerStyle={{
        paddingTop: 12,
        paddingBottom: 16,
        paddingHorizontal: 20,
      }}
      bottomOffset={60}
    >
      <View style={styles.form}>
        {banner ? (
          <View style={styles.bannerBox}>
            <Feather name="clock" size={14} color="#B45309" />
            <Text style={styles.bannerText}>{banner}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Basic Information</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Business Name</Text>
          <TextInput
            style={[styles.input, isFieldLocked('businessName') && styles.inputLocked]}
            value={formData.businessName}
            onChangeText={(text) => setFormData(prev => ({ ...prev, businessName: text }))}
            editable={!isFieldLocked('businessName')}
          />
          <FieldStatus request={latestFor('businessName')} />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Contact Name</Text>
          <TextInput
            style={[styles.input, isFieldLocked('contactName') && styles.inputLocked]}
            value={formData.contactName}
            onChangeText={(text) => setFormData(prev => ({ ...prev, contactName: text }))}
            editable={!isFieldLocked('contactName')}
          />
          <FieldStatus request={latestFor('contactName')} />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Phone Number</Text>
          <View style={[styles.input, styles.staticRow]}>
            <Text style={styles.staticText}>{profile?.phone || 'Not set'}</Text>
            <Pressable onPress={() => router.push('/change-phone')} hitSlop={8}>
              <Text style={styles.changeLink}>Change</Text>
            </Pressable>
          </View>
          <FieldStatus request={latestFor('phone')} />
          <Text style={styles.fieldHint}>
            Phone number changes are verified with a one-time code before being reviewed.
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Website (Optional)</Text>
          <TextInput
            style={[styles.input, isFieldLocked('website') && styles.inputLocked]}
            value={formData.website}
            onChangeText={(text) => setFormData(prev => ({ ...prev, website: text }))}
            keyboardType="url"
            autoCapitalize="none"
            editable={!isFieldLocked('website')}
          />
          <FieldStatus request={latestFor('website')} />
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Business Logo</Text>
        <View style={styles.inputGroup}>
          <Text style={styles.fieldHint}>
            Your company&apos;s logo, shown on your public business profile. This is separate from
            your personal profile photo, which you can set from the Account screen.
          </Text>
          <View style={styles.logoRow}>
            <View style={styles.logoBox}>
              {logoPreview || profile?.logoUrl ? (
                <Image
                  source={{ uri: logoPreview ?? objectImageUrl(profile?.logoUrl)! }}
                  style={styles.logoImage}
                  resizeMode="cover"
                />
              ) : (
                <Feather name="image" size={22} color={Colors.light.textSecondary} />
              )}
              {logoBusy ? (
                <View style={styles.logoBusyOverlay}>
                  <ActivityIndicator size="small" color="#fff" />
                </View>
              ) : null}
            </View>
            <View style={{ flex: 1, gap: 8 }}>
              <Pressable
                style={[styles.logoBtn, logoBusy && { opacity: 0.5 }]}
                onPress={() => void pickAndUploadLogo()}
                disabled={logoBusy}
              >
                <Feather name="upload" size={14} color={Colors.light.primary} />
                <Text style={styles.logoBtnText}>
                  {logoPreview || profile?.logoUrl ? 'Change logo' : 'Upload logo'}
                </Text>
              </Pressable>
              {logoPreview || profile?.logoUrl ? (
                <Pressable
                  style={[styles.logoBtn, logoBusy && { opacity: 0.5 }]}
                  onPress={() => void removeLogo()}
                  disabled={logoBusy}
                >
                  <Feather name="trash-2" size={14} color="#B91C1C" />
                  <Text style={[styles.logoBtnText, { color: '#B91C1C' }]}>Remove logo</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>About Your Business</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Business Description</Text>
          <TextInput
            style={[styles.input, styles.textArea, isFieldLocked('businessDescription') && styles.inputLocked]}
            value={formData.businessDescription}
            onChangeText={(text) => setFormData(prev => ({ ...prev, businessDescription: text }))}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            editable={!isFieldLocked('businessDescription')}
          />
          <FieldStatus request={latestFor('businessDescription')} />
        </View>

        {changeControlActive ? (
          <Text style={styles.noticeText}>
            Changes to your submitted business details will be reviewed before they appear on your public profile. Reviews can take up to 48 hours.
          </Text>
        ) : null}
      </View>
    </KeyboardAwareScrollViewCompat>

      {/* Save CTA pinned above the absolutely-positioned bottom tab bar. */}
      <View style={[styles.footerBar, { paddingBottom: insets.bottom + tabBarHeight + 12 }]}>
        <Pressable 
          style={[styles.button, isPending && styles.buttonDisabled]} 
          onPress={handleUpdate}
          disabled={isPending}
        >
          {isPending ? (
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
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.3,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginBottom: 4,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  form: {
    gap: 14,
  },
  inputGroup: {
    gap: 6,
  },
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
  inputLocked: {
    opacity: 0.6,
  },
  staticRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  staticText: {
    fontSize: 15,
    color: Colors.light.text,
  },
  changeLink: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  fieldHint: {
    fontSize: 11,
    color: Colors.light.textMuted,
    lineHeight: 15,
    marginLeft: 4,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 10,
  },
  logoBox: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: Colors.light.primaryMuted,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  logoBusyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  logoBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.primary,
  },
  noticeText: {
    fontSize: 12,
    color: Colors.light.textMuted,
    lineHeight: 17,
    marginTop: 4,
  },
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
  bannerText: {
    flex: 1,
    fontSize: 12,
    color: '#B45309',
    lineHeight: 17,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badgeDetail: {
    fontSize: 11,
    color: Colors.light.textSecondary,
    marginLeft: 4,
  },
  textArea: {
    height: 100,
    paddingTop: 14,
  },
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
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: Colors.light.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
