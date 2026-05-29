import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import {
  useCreateEnquiry,
  useGetTrader,
  useGetCustomerUploadUrl,
} from '@workspace/api-client-react';
import { detectContactInfo, contactViolationMessage } from '@/lib/content-filter';
import { useAuth } from '@/contexts/AuthContext';
import { isTopRated, isFastResponder, formatResponseTime } from '@/components/TraderCard';
import {
  traderHasAnySpecialism,
  PROPERTY_TYPE_OPTIONS,
  TENURE_OPTIONS,
  URGENCY_OPTIONS,
  type PropertyType,
  type Tenure,
  type Urgency,
  type SpecialistFields,
} from '@/constants/specialisms';

const MAX_PHOTOS = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

function guessMime(uri: string, fallback?: string | null): string {
  if (fallback && ALLOWED_MIMES.includes(fallback)) return fallback;
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

export default function EnquiryScreen() {
  const { traderId } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isCustomer = user?.role === 'customer';

  const { data: trader } = useGetTrader(Number(traderId));
  const { mutateAsync: createEnquiry, isPending } = useCreateEnquiry();
  const { mutateAsync: getUploadUrl } = useGetCustomerUploadUrl();

  const [formData, setFormData] = useState({
    serviceRequired: '',
    message: '',
    preferredDate: '',
    phone: '',
  });
  const [specialistFields, setSpecialistFields] = useState<SpecialistFields>({});
  const [attachments, setAttachments] = useState<{ uri: string; objectPath: string }[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const showSpecialistFields = traderHasAnySpecialism(
    trader?.mainCategory,
    trader?.additionalServices,
  );

  const trustVerified = !!trader?.isVerified;
  const trustTopRated = !!trader && isTopRated(trader.rating, trader.reviewCount);
  const trustFast = !!trader && isFastResponder(trader.responseTimeMinutes);
  const showTrustRow = !!trader && (trustVerified || trustTopRated || trustFast);
  const responseTimeLabel = formatResponseTime(trader?.responseTimeMinutes);

  const messageViolation = useMemo(
    () => detectContactInfo(formData.message),
    [formData.message],
  );
  const messageViolationText = messageViolation
    ? contactViolationMessage(messageViolation)
    : null;

  const handleAddPhoto = async () => {
    if (uploadingPhoto || attachments.length >= MAX_PHOTOS) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to attach photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const mimeType = guessMime(asset.uri, asset.mimeType ?? null);
    if (!ALLOWED_MIMES.includes(mimeType)) {
      Alert.alert('Unsupported', 'Please choose a JPEG, PNG, WEBP or HEIC image.');
      return;
    }
    const sizeBytes = asset.fileSize ?? 0;
    if (sizeBytes > MAX_BYTES) {
      Alert.alert('File too large', `Maximum size is ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`);
      return;
    }

    setUploadingPhoto(true);
    try {
      const filename = asset.fileName || `enquiry-photo-${Date.now()}.jpg`;
      const urlResp = await getUploadUrl({
        data: { filename, mimeType, sizeBytes: sizeBytes || 1 },
      });
      const fileResp = await fetch(asset.uri);
      const blob = await fileResp.blob();
      const putRes = await fetch(urlResp.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: blob,
      });
      if (!putRes.ok) throw new Error('Upload to storage failed');
      setAttachments(prev => [...prev, { uri: asset.uri, objectPath: urlResp.objectPath }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      Alert.alert('Upload failed', msg);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!formData.serviceRequired || !formData.message) {
      Alert.alert('Error', 'Please fill in the required fields (Service and Message)');
      return;
    }
    if (messageViolation) {
      Alert.alert('Message blocked', contactViolationMessage(messageViolation));
      return;
    }

    const trimmedSpecialist: SpecialistFields = {
      ...(specialistFields.propertyType ? { propertyType: specialistFields.propertyType } : {}),
      ...(specialistFields.tenure ? { tenure: specialistFields.tenure } : {}),
      ...(specialistFields.urgency ? { urgency: specialistFields.urgency } : {}),
    };
    const hasSpecialist = Object.keys(trimmedSpecialist).length > 0;

    try {
      await createEnquiry({
        data: {
          traderId: Number(traderId),
          ...formData,
          ...(attachments.length > 0
            ? { attachmentUrls: attachments.map(a => a.objectPath) }
            : {}),
          ...(hasSpecialist && showSpecialistFields
            ? { specialistFields: trimmedSpecialist }
            : {}),
        },
      });
      const recipient = trader?.businessName?.trim() || 'the trader';
      const replyHint = responseTimeLabel
        ? ` Usually ${responseTimeLabel.charAt(0).toLowerCase()}${responseTimeLabel.slice(1)}.`
        : '';
      Alert.alert(
        'Enquiry sent',
        `Your enquiry has been sent to ${recipient}.${replyHint} Always verify quotes, insurance and credentials before any work starts.`,
        [
          { text: 'Done', style: 'cancel', onPress: () => router.back() },
          { text: 'View enquiries', onPress: () => router.replace('/(tabs)/my-enquiries') },
        ],
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not send enquiry';
      Alert.alert('Error', message);
    }
  };

  if (!isCustomer) {
    const isGuest = !user;
    return (
      <View style={[styles.container, { paddingTop: insets.top + 80, paddingHorizontal: 24, alignItems: 'center' }]}>
        <View style={styles.headerIconWrap}>
          <Feather name="lock" size={24} color={Colors.light.primary} />
        </View>
        <Text style={[styles.title, { textAlign: 'center' }]}>
          {isGuest ? 'Sign in to send a message' : 'Customers only'}
        </Text>
        <Text style={[styles.subtitle, { textAlign: 'center', marginBottom: 24 }]}>
          {isGuest
            ? 'You need a customer account to message a trader. Sign in or create a free customer account to continue.'
            : user?.role === 'admin'
              ? "Admin accounts can't send enquiries to traders. Use a customer account for this."
              : "Trader accounts can't send enquiries. Use a customer account for this."}
        </Text>
        {isGuest ? (
          <>
            <Pressable
              style={{ backgroundColor: Colors.light.primary, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, marginBottom: 12 }}
              onPress={() => router.push('/auth/login')}
            >
              <Text style={{ color: Colors.light.white, fontWeight: '700' }}>Sign In</Text>
            </Pressable>
            <Pressable
              style={{ paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, borderColor: Colors.light.primary }}
              onPress={() => router.push('/auth/register-customer')}
            >
              <Text style={{ color: Colors.light.primary, fontWeight: '700' }}>Create Customer Account</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            style={{ backgroundColor: Colors.light.primary, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 }}
            onPress={() => router.back()}
          >
            <Text style={{ color: Colors.light.white, fontWeight: '700' }}>Go Back</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <KeyboardAwareScrollViewCompat
      style={styles.container}
      contentContainerStyle={{
        paddingTop: 16,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 20,
      }}
      bottomOffset={60}
    >
      <View style={styles.header}>
        <View style={styles.headerIconWrap}>
          <Feather name="message-square" size={24} color={Colors.light.primary} />
        </View>
        <Text style={styles.title}>Contact {trader?.businessName || 'Trader'}</Text>
        {showTrustRow && (
          <View style={styles.trustRow}>
            {trustVerified && (
              <View style={[styles.trustChip, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
                <Feather name="check-circle" size={10} color={Colors.light.success} />
                <Text style={[styles.trustChipText, { color: Colors.light.success }]}>Verified</Text>
              </View>
            )}
            {trustTopRated && (
              <View style={[styles.trustChip, { backgroundColor: 'rgba(245, 158, 11, 0.14)' }]}>
                <Feather name="star" size={10} color={Colors.light.featured} />
                <Text style={[styles.trustChipText, { color: '#B45309' }]}>Top rated</Text>
              </View>
            )}
            {trustFast && (
              <View style={[styles.trustChip, { backgroundColor: Colors.light.primaryMuted }]}>
                <Feather name="zap" size={10} color={Colors.light.primary} />
                <Text style={[styles.trustChipText, { color: Colors.light.primary }]}>Replies fast</Text>
              </View>
            )}
          </View>
        )}
        <Text style={styles.subtitle}>
          {responseTimeLabel
            ? `Send a message to discuss your requirements. ${responseTimeLabel}.`
            : 'Send a message to discuss your requirements and request a quote.'}
        </Text>
      </View>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Service Required *</Text>
          <View style={styles.inputWrap}>
            <Feather name="tool" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. Boiler repair, Leaking pipe"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.serviceRequired}
              onChangeText={(text) => setFormData(prev => ({ ...prev, serviceRequired: text }))}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Message *</Text>
          <View
            style={[
              styles.inputWrap,
              styles.textAreaWrap,
              messageViolationText ? styles.inputWrapBlocked : null,
            ]}
          >
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Describe the job in detail..."
              placeholderTextColor={Colors.light.textMuted}
              value={formData.message}
              onChangeText={(text) => setFormData(prev => ({ ...prev, message: text }))}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />
          </View>
          {messageViolationText ? (
            <View style={styles.violationBanner}>
              <Feather name="alert-triangle" size={14} color={Colors.light.error} />
              <Text style={styles.violationText}>{messageViolationText}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Photos (Optional, up to {MAX_PHOTOS})</Text>
          <View style={styles.photosRow}>
            {attachments.map((a, idx) => (
              <View key={idx} style={styles.photoTile}>
                <Image source={{ uri: a.uri }} style={styles.photoImage} />
                <Pressable style={styles.photoRemove} onPress={() => removeAttachment(idx)} hitSlop={6}>
                  <Feather name="x" size={12} color={Colors.light.white} />
                </Pressable>
              </View>
            ))}
            {attachments.length < MAX_PHOTOS && (
              <Pressable
                style={[styles.photoAdd, uploadingPhoto && styles.buttonDisabled]}
                onPress={handleAddPhoto}
                disabled={uploadingPhoto}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator size="small" color={Colors.light.primary} />
                ) : (
                  <>
                    <Feather name="plus" size={18} color={Colors.light.primary} />
                    <Text style={styles.photoAddText}>Add</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        </View>

        {showSpecialistFields && (
          <View style={styles.specialistBlock}>
            <View style={styles.specialistHeader}>
              <Feather name="info" size={13} color={Colors.light.primary} />
              <Text style={styles.specialistHeaderText}>
                A few quick details (optional) help this trader prepare a more accurate quote.
              </Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Property type</Text>
              <View style={styles.choiceRow}>
                {PROPERTY_TYPE_OPTIONS.map((opt) => {
                  const active = specialistFields.propertyType === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      style={[styles.choiceChip, active && styles.choiceChipActive]}
                      onPress={() =>
                        setSpecialistFields((prev) => ({
                          ...prev,
                          propertyType: active ? undefined : (opt.value as PropertyType),
                        }))
                      }
                    >
                      <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>You are the</Text>
              <View style={styles.choiceRow}>
                {TENURE_OPTIONS.map((opt) => {
                  const active = specialistFields.tenure === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      style={[styles.choiceChip, active && styles.choiceChipActive]}
                      onPress={() =>
                        setSpecialistFields((prev) => ({
                          ...prev,
                          tenure: active ? undefined : (opt.value as Tenure),
                        }))
                      }
                    >
                      <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>How soon</Text>
              <View style={styles.choiceRow}>
                {URGENCY_OPTIONS.map((opt) => {
                  const active = specialistFields.urgency === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      style={[styles.choiceChip, active && styles.choiceChipActive]}
                      onPress={() =>
                        setSpecialistFields((prev) => ({
                          ...prev,
                          urgency: active ? undefined : (opt.value as Urgency),
                        }))
                      }
                    >
                      <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Preferred Date (Optional)</Text>
          <View style={styles.inputWrap}>
            <Feather name="calendar" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. Next Tuesday, ASAP"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.preferredDate}
              onChangeText={(text) => setFormData(prev => ({ ...prev, preferredDate: text }))}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Your Phone (Optional)</Text>
          <View style={styles.inputWrap}>
            <Feather name="phone" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="For quicker contact"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.phone}
              onChangeText={(text) => setFormData(prev => ({ ...prev, phone: text }))}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <Pressable
          style={[styles.button, (isPending || !!messageViolation || uploadingPhoto) && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isPending || !!messageViolation || uploadingPhoto}
        >
          {isPending ? (
            <ActivityIndicator color={Colors.light.white} />
          ) : (
            <>
              <Feather name="send" size={18} color={Colors.light.white} style={{ marginRight: 8 }} />
              <Text style={styles.buttonText}>Send Enquiry</Text>
            </>
          )}
        </Pressable>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  headerIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    lineHeight: 20,
    textAlign: 'center',
  },
  trustRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    marginBottom: 4,
  },
  trustChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 3,
  },
  trustChipText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  form: {
    gap: 16,
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
  textAreaWrap: {
    height: 120,
    alignItems: 'flex-start',
    paddingTop: 14,
  },
  inputWrapBlocked: {
    borderColor: Colors.light.error,
  },
  violationBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    marginTop: 6,
  },
  violationText: {
    flex: 1,
    fontSize: 12,
    color: Colors.light.error,
    lineHeight: 16,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    color: Colors.light.text,
  },
  textArea: {
    textAlignVertical: 'top',
  },
  photosRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  photoTile: {
    width: 84,
    height: 84,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAdd: {
    width: 84,
    height: 84,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.light.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  photoAddText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  button: {
    backgroundColor: Colors.light.primary,
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
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
  specialistBlock: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 14,
    padding: 14,
    gap: 14,
  },
  specialistHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  specialistHeaderText: {
    flex: 1,
    fontSize: 12,
    color: Colors.light.textSecondary,
    lineHeight: 16,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  choiceChipActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  choiceChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    letterSpacing: 0.2,
  },
  choiceChipTextActive: {
    color: Colors.light.white,
  },
});
