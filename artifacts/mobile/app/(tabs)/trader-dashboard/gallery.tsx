import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, ScrollView, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Colors from '@/constants/colors';
import {
  useGetTraderProfile,
  useUpdateTraderProfile,
  useGetCustomerUploadUrl,
} from '@workspace/api-client-react';

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

export default function GalleryScreen() {
  const insets = useSafeAreaInsets();
  const { data: profileData, isLoading } = useGetTraderProfile();
  const { mutateAsync: updateProfile, isPending: isSaving } = useUpdateTraderProfile();
  const { mutateAsync: getUploadUrl } = useGetCustomerUploadUrl();

  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (profileData?.galleryUrls) {
      setGalleryUrls(profileData.galleryUrls);
    }
  }, [profileData]);

  const plan = profileData?.plan;
  // Any non-basic, non-empty plan grants Premium entitlements. This also covers
  // legacy "trader" rows that predate the unified "premium" plan id.
  const isPremium = !!plan && plan !== 'basic';
  const maxImages = isPremium ? Infinity : 3;

  const pickAndUpload = async () => {
    if (uploading) return;
    if (galleryUrls.length >= maxImages) {
      Alert.alert('Limit Reached', 'Your Basic plan allows up to 3 gallery images. Upgrade to Premium for unlimited photos.');
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to add gallery images.');
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

    setUploading(true);
    try {
      const filename = asset.fileName || `gallery-${Date.now()}.jpg`;
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
      setGalleryUrls(prev => [...prev, urlResp.objectPath]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      Alert.alert('Upload failed', msg);
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (index: number) => {
    setGalleryUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    try {
      await updateProfile({ data: { galleryUrls } });
      Alert.alert('Saved', 'Your gallery has been updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not save gallery';
      Alert.alert('Error', message);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.sectionTitle}>Gallery Images</Text>
          <Text style={styles.counter}>{galleryUrls.length}/{maxImages === 999 ? 'Unlimited' : maxImages}</Text>
        </View>

        <Text style={styles.description}>
          Add photos of your work to showcase your skills. Tap below to pick an image from your device.
        </Text>

        <Pressable
          style={[styles.pickButton, (uploading || galleryUrls.length >= maxImages) && styles.buttonDisabled]}
          onPress={pickAndUpload}
          disabled={uploading || galleryUrls.length >= maxImages}
        >
          {uploading ? (
            <ActivityIndicator color={Colors.light.primary} />
          ) : (
            <>
              <Feather name="image" size={18} color={Colors.light.primary} />
              <Text style={styles.pickButtonText}>
                {galleryUrls.length >= maxImages ? 'Limit reached' : 'Add photo from device'}
              </Text>
            </>
          )}
        </Pressable>

        {galleryUrls.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="image" size={40} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No images yet</Text>
            <Text style={styles.emptyText}>
              Add photos of your completed work to attract more customers.
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {galleryUrls.map((url, idx) => (
              <View key={`${url}-${idx}`} style={styles.imageCard}>
                <Image source={{ uri: url }} style={styles.image} resizeMode="cover" />
                <Pressable style={styles.removeButton} onPress={() => removeImage(idx)}>
                  <Feather name="x" size={16} color={Colors.light.white} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <Pressable
          style={[styles.saveButton, isSaving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color={Colors.light.white} />
          ) : (
            <Text style={styles.saveButtonText}>Save Gallery</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.3,
  },
  counter: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    fontWeight: '500',
  },
  description: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 8,
    marginBottom: 16,
    lineHeight: 20,
  },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.light.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
    marginBottom: 16,
  },
  pickButtonText: {
    color: Colors.light.primary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  imageCard: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
  },
  saveButton: {
    backgroundColor: Colors.light.primary,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: Colors.light.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
