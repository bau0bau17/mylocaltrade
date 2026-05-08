import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';

export default function RegisterTraderScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { registerTrader } = useAuth();

  const [formData, setFormData] = useState({
    businessName: '',
    contactName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    mainCategory: '',
    town: '',
    postcode: '',
  });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(() => setErrorMsg(null), 5000);
    return () => clearTimeout(t);
  }, [errorMsg]);

  const handleRegister = async () => {
    setErrorMsg(null);
    const requiredFields: (keyof typeof formData)[] = [
      'businessName', 'contactName', 'email', 'password', 'confirmPassword',
      'phone', 'mainCategory', 'town', 'postcode',
    ];
    const isMissing = requiredFields.some(field => !formData[field].trim());
    if (isMissing) {
      setErrorMsg('Please fill in all required fields.');
      return;
    }
    if (formData.password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (!acceptedTerms) {
      setErrorMsg('Please accept the Terms and Privacy Policy to continue.');
      return;
    }

    setIsLoading(true);
    try {
      const payload = {
        businessName: formData.businessName.trim(),
        contactName: formData.contactName.trim(),
        email: formData.email.trim(),
        password: formData.password,
        confirmPassword: formData.confirmPassword,
        phone: formData.phone.trim(),
        mainCategory: formData.mainCategory.trim(),
        town: formData.town.trim(),
        postcode: formData.postcode.trim().toUpperCase(),
        termsAccepted: true,
        privacyAccepted: true,
      };
      const { email, pollToken } = await registerTrader(payload);
      router.replace({ pathname: '/auth/verify-email', params: { email, pollToken } });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not create account';
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={styles.container}
      contentContainerStyle={{
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
      }}
      bottomOffset={60}
    >
      <View style={styles.header}>
        <View style={styles.logoWrap}>
          <Feather name="briefcase" size={28} color={Colors.light.secondary} />
        </View>
        <Text style={styles.title}>Create your Trader Account</Text>
        <Text style={styles.subtitle}>
          Verification will be required before your profile goes live.
        </Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.sectionTitle}>Business Details</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Business Name *</Text>
          <View style={styles.inputWrap}>
            <Feather name="briefcase" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. Smith Plumbing Ltd"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.businessName}
              onChangeText={(text) => setFormData(prev => ({ ...prev, businessName: text }))}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Main Category *</Text>
          <View style={styles.inputWrap}>
            <Feather name="tag" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. Plumber, Electrician"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.mainCategory}
              onChangeText={(text) => setFormData(prev => ({ ...prev, mainCategory: text }))}
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 2 }]}>
            <Text style={styles.label}>Town/City *</Text>
            <View style={styles.inputWrap}>
              <Feather name="map-pin" size={16} color={Colors.light.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="London"
                placeholderTextColor={Colors.light.textMuted}
                value={formData.town}
                onChangeText={(text) => setFormData(prev => ({ ...prev, town: text }))}
              />
            </View>
          </View>
          <View style={[styles.inputGroup, { flex: 1, marginLeft: 10 }]}>
            <Text style={styles.label}>Postcode *</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={[styles.input, { marginLeft: 0 }]}
                placeholder="EC1A 1BB"
                placeholderTextColor={Colors.light.textMuted}
                value={formData.postcode}
                onChangeText={(text) => setFormData(prev => ({ ...prev, postcode: text }))}
                autoCapitalize="characters"
              />
            </View>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Contact & Login</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Your Name *</Text>
          <View style={styles.inputWrap}>
            <Feather name="user" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="John Smith"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.contactName}
              onChangeText={(text) => setFormData(prev => ({ ...prev, contactName: text }))}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email Address *</Text>
          <View style={styles.inputWrap}>
            <Feather name="mail" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="you@business.com"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.email}
              onChangeText={(text) => setFormData(prev => ({ ...prev, email: text }))}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Phone Number *</Text>
          <View style={styles.inputWrap}>
            <Feather name="phone" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="07700 900000"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.phone}
              onChangeText={(text) => setFormData(prev => ({ ...prev, phone: text }))}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password * (Min 8 chars)</Text>
          <View style={styles.inputWrap}>
            <Feather name="lock" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Create a secure password"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.password}
              onChangeText={(text) => setFormData(prev => ({ ...prev, password: text }))}
              secureTextEntry
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Confirm Password *</Text>
          <View style={styles.inputWrap}>
            <Feather name="lock" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Re-enter your password"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.confirmPassword}
              onChangeText={(text) => setFormData(prev => ({ ...prev, confirmPassword: text }))}
              secureTextEntry
            />
          </View>
        </View>

        <Pressable
          style={styles.checkboxRow}
          onPress={() => setAcceptedTerms(v => !v)}
        >
          <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
            {acceptedTerms && <Feather name="check" size={14} color={Colors.light.white} />}
          </View>
          <Text style={styles.checkboxLabel}>
            I confirm that the information provided is accurate and I agree to MyLocalTrade's{' '}
            <Text style={styles.checkboxLink} onPress={() => router.push('/terms')}>Terms</Text>
            {' '}and{' '}
            <Text style={styles.checkboxLink} onPress={() => router.push('/privacy')}>Privacy Policy</Text>.
          </Text>
        </Pressable>

        <Text style={styles.helperText}>
          After signup, you'll be asked to verify your email, phone number, business details and insurance/qualifications where applicable.
        </Text>

        {errorMsg ? (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={16} color={Colors.light.error} />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={Colors.light.white} />
          ) : (
            <Text style={styles.buttonText}>Create Trader Account</Text>
          )}
        </Pressable>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Pressable onPress={() => router.push('/auth/login')}>
            <Text style={styles.footerLink}>Log In</Text>
          </Pressable>
        </View>
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
  logoWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.light.secondaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 18,
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
  row: {
    flexDirection: 'row',
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
    height: 50,
    gap: 10,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    color: Colors.light.text,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: Colors.light.secondary,
    borderColor: Colors.light.secondary,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    color: Colors.light.textSecondary,
    lineHeight: 19,
  },
  checkboxLink: {
    color: Colors.light.primary,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 12,
    color: Colors.light.textMuted,
    lineHeight: 17,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.light.errorMuted,
    borderWidth: 1,
    borderColor: Colors.light.error,
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    flex: 1,
    color: Colors.light.error,
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    backgroundColor: Colors.light.secondary,
    height: 52,
    borderRadius: 14,
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
  },
  footerText: {
    color: Colors.light.textSecondary,
    fontSize: 14,
  },
  footerLink: {
    color: Colors.light.primary,
    fontSize: 14,
    fontWeight: '700',
  },
});
