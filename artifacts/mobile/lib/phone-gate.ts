import { Alert } from 'react-native';
import { router } from 'expo-router';

/**
 * Customer contact gate: the server returns 403 with this machine-readable
 * code when a customer tries to contact a trader (send an enquiry, accept a
 * quote or offer) before SMS-verifying a UK mobile number.
 */
export function isPhoneVerificationRequired(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const data = (err as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return false;
  return (data as { code?: unknown }).code === 'PHONE_VERIFICATION_REQUIRED';
}

/** Standard prompt that routes the customer to the verify-phone screen. */
export function promptPhoneVerification(): void {
  Alert.alert(
    'Verify your mobile number',
    'Before you contact a trader for the first time, please verify a UK mobile number. We will send you a one-time code by SMS.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Verify now', onPress: () => router.push('/verify-phone') },
    ],
  );
}
