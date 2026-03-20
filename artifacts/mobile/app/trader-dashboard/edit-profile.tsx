import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useGetTraderProfile, useUpdateTraderProfile } from '@workspace/api-client-react';

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: profile, isLoading } = useGetTraderProfile();
  const { mutateAsync: updateProfile, isPending } = useUpdateTraderProfile();

  const [formData, setFormData] = useState({
    businessName: '',
    contactName: '',
    phone: '',
    businessAddress: '',
    town: '',
    postcode: '',
    businessDescription: '',
    website: '',
  });

  useEffect(() => {
    if (profile) {
      setFormData({
        businessName: profile.businessName || '',
        contactName: profile.contactName || '',
        phone: profile.phone || '',
        businessAddress: profile.businessAddress || '',
        town: profile.town || '',
        postcode: profile.postcode || '',
        businessDescription: profile.businessDescription || '',
        website: profile.website || '',
      });
    }
  }, [profile]);

  const handleUpdate = async () => {
    try {
      await updateProfile({ data: formData });
      Alert.alert('Success', 'Profile updated successfully', [
        { text: 'OK', onPress: () => router.back() }
      ]);
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
    <KeyboardAwareScrollViewCompat
      style={styles.container}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 20,
      }}
      bottomOffset={60}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Edit Profile</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.sectionTitle}>Basic Information</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Business Name</Text>
          <TextInput
            style={styles.input}
            value={formData.businessName}
            onChangeText={(text) => setFormData(prev => ({ ...prev, businessName: text }))}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Contact Name</Text>
          <TextInput
            style={styles.input}
            value={formData.contactName}
            onChangeText={(text) => setFormData(prev => ({ ...prev, contactName: text }))}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            value={formData.phone}
            onChangeText={(text) => setFormData(prev => ({ ...prev, phone: text }))}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Website (Optional)</Text>
          <TextInput
            style={styles.input}
            value={formData.website}
            onChangeText={(text) => setFormData(prev => ({ ...prev, website: text }))}
            keyboardType="url"
            autoCapitalize="none"
          />
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Location</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Business Address</Text>
          <TextInput
            style={styles.input}
            value={formData.businessAddress}
            onChangeText={(text) => setFormData(prev => ({ ...prev, businessAddress: text }))}
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 2, marginRight: 12 }]}>
            <Text style={styles.label}>Town/City</Text>
            <TextInput
              style={styles.input}
              value={formData.town}
              onChangeText={(text) => setFormData(prev => ({ ...prev, town: text }))}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>Postcode</Text>
            <TextInput
              style={styles.input}
              value={formData.postcode}
              onChangeText={(text) => setFormData(prev => ({ ...prev, postcode: text }))}
              autoCapitalize="characters"
            />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>About Your Business</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Business Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={formData.businessDescription}
            onChangeText={(text) => setFormData(prev => ({ ...prev, businessDescription: text }))}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <Pressable 
          style={[styles.button, isPending && styles.buttonDisabled]} 
          onPress={handleUpdate}
          disabled={isPending}
        >
          {isPending ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.buttonText}>Save Changes</Text>
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  form: {
    gap: 16,
  },
  row: {
    flexDirection: 'row',
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.text,
  },
  input: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    height: 48,
    fontSize: 15,
    color: Colors.light.text,
  },
  textArea: {
    height: 100,
    paddingTop: 12,
  },
  button: {
    backgroundColor: Colors.light.primary,
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});