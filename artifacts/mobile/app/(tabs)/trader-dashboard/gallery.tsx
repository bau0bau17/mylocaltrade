import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Alert, ActivityIndicator, ScrollView, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useGetTraderProfile, useUpdateTraderProfile } from '@workspace/api-client-react';

export default function GalleryScreen() {
  const insets = useSafeAreaInsets();
  const { data: profileData, isLoading } = useGetTraderProfile();
  const { mutateAsync: updateProfile, isPending: isSaving } = useUpdateTraderProfile();

  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');

  useEffect(() => {
    if (profileData?.galleryUrls) {
      setGalleryUrls(profileData.galleryUrls);
    }
  }, [profileData]);

  const plan = profileData?.plan;
  const maxImages = plan === 'elite' ? 999 : plan === 'premium' ? 10 : 3;

  const addImage = () => {
    const trimmed = newUrl.trim();
    if (!trimmed) return;

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      Alert.alert('Invalid URL', 'Please enter a valid image URL starting with http:// or https://');
      return;
    }

    if (galleryUrls.length >= maxImages) {
      Alert.alert('Limit Reached', `Your ${plan || 'Basic'} plan allows up to ${maxImages} gallery images. Upgrade for more.`);
      return;
    }

    setGalleryUrls(prev => [...prev, trimmed]);
    setNewUrl('');
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
          Add photos of your work to showcase your skills. Paste image URLs below.
        </Text>

        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="https://example.com/image.jpg"
            placeholderTextColor={Colors.light.textMuted}
            value={newUrl}
            onChangeText={setNewUrl}
            onSubmitEditing={addImage}
            returnKeyType="done"
            autoCapitalize="none"
            keyboardType="url"
          />
          <Pressable style={styles.addButton} onPress={addImage}>
            <Feather name="plus" size={20} color={Colors.light.white} />
          </Pressable>
        </View>

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
              <View key={idx} style={styles.imageCard}>
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
  addRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 48,
    fontSize: 15,
    color: Colors.light.text,
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
    justifyContent: 'center',
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
