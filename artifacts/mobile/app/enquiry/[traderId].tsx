import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useCreateEnquiry, useGetTrader } from '@workspace/api-client-react';

export default function EnquiryScreen() {
  const { traderId } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: trader } = useGetTrader(Number(traderId));
  const { mutateAsync: createEnquiry, isPending } = useCreateEnquiry();

  const [formData, setFormData] = useState({
    serviceRequired: '',
    message: '',
    preferredDate: '',
    phone: '',
  });

  const handleSubmit = async () => {
    if (!formData.serviceRequired || !formData.message) {
      Alert.alert('Error', 'Please fill in the required fields (Service and Message)');
      return;
    }

    try {
      await createEnquiry({
        data: {
          traderId: Number(traderId),
          ...formData,
        }
      });
      Alert.alert('Success', 'Your enquiry has been sent to the trader.', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not send enquiry');
    }
  };

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
        <Text style={styles.title}>Contact {trader?.businessName || 'Trader'}</Text>
        <Text style={styles.subtitle}>Send a message to discuss your requirements and request a quote.</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Service Required *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Boiler repair, Leaking pipe"
            value={formData.serviceRequired}
            onChangeText={(text) => setFormData(prev => ({ ...prev, serviceRequired: text }))}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Message *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe the job in detail..."
            value={formData.message}
            onChangeText={(text) => setFormData(prev => ({ ...prev, message: text }))}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Preferred Date (Optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Next Tuesday, ASAP"
            value={formData.preferredDate}
            onChangeText={(text) => setFormData(prev => ({ ...prev, preferredDate: text }))}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Your Phone Number (Optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="For quicker contact"
            value={formData.phone}
            onChangeText={(text) => setFormData(prev => ({ ...prev, phone: text }))}
            keyboardType="phone-pad"
          />
        </View>

        <Pressable 
          style={[styles.button, isPending && styles.buttonDisabled]} 
          onPress={handleSubmit}
          disabled={isPending}
        >
          {isPending ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.buttonText}>Send Enquiry</Text>
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
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.light.textSecondary,
    lineHeight: 22,
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
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
    height: 120,
    paddingTop: 12,
  },
  button: {
    backgroundColor: Colors.light.primary,
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
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