import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useCreateEnquiry, useGetTrader } from '@workspace/api-client-react';
import { detectContactInfo, contactViolationMessage } from '@/lib/content-filter';

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

  const messageViolation = useMemo(
    () => detectContactInfo(formData.message),
    [formData.message],
  );
  const messageViolationText = messageViolation
    ? contactViolationMessage(messageViolation)
    : null;

  const handleSubmit = async () => {
    if (!formData.serviceRequired || !formData.message) {
      Alert.alert('Error', 'Please fill in the required fields (Service and Message)');
      return;
    }
    if (messageViolation) {
      Alert.alert('Message blocked', contactViolationMessage(messageViolation));
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not send enquiry';
      Alert.alert('Error', message);
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
        <View style={styles.headerIconWrap}>
          <Feather name="message-square" size={24} color={Colors.light.primary} />
        </View>
        <Text style={styles.title}>Contact {trader?.businessName || 'Trader'}</Text>
        <Text style={styles.subtitle}>Send a message to discuss your requirements and request a quote.</Text>
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
          style={[styles.button, (isPending || !!messageViolation) && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isPending || !!messageViolation}
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
});
