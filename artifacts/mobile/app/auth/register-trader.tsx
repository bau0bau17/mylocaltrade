import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

interface ChHit {
  companyNumber: string;
  companyName: string;
  status: string | null;
  addressLine: string | null;
  town: string | null;
  postcode: string | null;
  addressSnippet: string | null;
}

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
    businessAddress: '',
    town: '',
    postcode: '',
  });
  const [companyNumber, setCompanyNumber] = useState<string | null>(null);
  const [confirmedName, setConfirmedName] = useState<string | null>(null);
  const [chSuggestions, setChSuggestions] = useState<ChHit[]>([]);
  const [chLoading, setChLoading] = useState(false);
  const [chError, setChError] = useState<string | null>(null);
  const [chOpen, setChOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>('');

  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(() => setErrorMsg(null), 5000);
    return () => clearTimeout(t);
  }, [errorMsg]);

  // Live Companies House search, debounced.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = formData.businessName.trim();

    // If the trader edits the name AWAY from the matched company they picked,
    // drop the confirmed selection so we don't claim a verification we don't
    // have. We compare against the exact name we stored at pick-time so a
    // re-render right after picking does not clear it.
    if (companyNumber && confirmedName && q !== confirmedName) {
      setCompanyNumber(null);
      setConfirmedName(null);
    }

    if (q.length < 3) {
      setChSuggestions([]);
      setChError(null);
      setChLoading(false);
      return;
    }

    setChLoading(true);
    debounceRef.current = setTimeout(async () => {
      lastQueryRef.current = q;
      try {
        const res = await fetch(
          `${getApiUrl()}/api/companies-house/search?q=${encodeURIComponent(q)}`,
        );
        if (lastQueryRef.current !== q) return;
        if (!res.ok) {
          setChError('Could not search Companies House right now.');
          setChSuggestions([]);
        } else {
          const json = (await res.json()) as { items: ChHit[] };
          setChSuggestions(json.items ?? []);
          setChError(null);
        }
      } catch {
        setChError('Could not search Companies House right now.');
        setChSuggestions([]);
      } finally {
        setChLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.businessName]);

  const pickSuggestion = (hit: ChHit) => {
    // Prefer the structured first address line; fall back to the snippet
    // (which is the full registered office address joined with commas).
    const addressLine = hit.addressLine ?? hit.addressSnippet ?? '';
    setFormData((prev) => ({
      ...prev,
      businessName: hit.companyName,
      businessAddress: addressLine || prev.businessAddress,
      town: hit.town || prev.town,
      postcode: hit.postcode || prev.postcode,
    }));
    setCompanyNumber(hit.companyNumber);
    setConfirmedName(hit.companyName);
    setChSuggestions([]);
    setChOpen(false);
  };

  const handleRegister = async () => {
    setErrorMsg(null);
    const requiredFields: (keyof typeof formData)[] = [
      'businessName', 'contactName', 'email', 'password', 'confirmPassword',
      'phone', 'mainCategory', 'businessAddress', 'town', 'postcode',
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
        ...(companyNumber ? { companyNumber } : {}),
        contactName: formData.contactName.trim(),
        email: formData.email.trim(),
        password: formData.password,
        confirmPassword: formData.confirmPassword,
        phone: formData.phone.trim(),
        mainCategory: formData.mainCategory.trim(),
        businessAddress: formData.businessAddress.trim(),
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

  const showSuggestionPanel =
    chOpen && formData.businessName.trim().length >= 3 && !companyNumber;

  // On web previews and some Android devices, safe-area insets are 0 even
  // though there is a visible notch / status bar. Apply a sensible minimum
  // so the header never sits under the device cutout.
  const topInset = Math.max(insets.top, Platform.OS === 'web' ? 56 : 44);

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: topInset }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={10}
        >
          <Feather name="chevron-left" size={24} color={Colors.light.primary} />
        </Pressable>
        <Text style={styles.topBarTitle}>Join as Trader</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={{
          paddingTop: 24,
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
          <View
            style={[
              styles.inputWrap,
              companyNumber ? styles.inputWrapVerified : null,
            ]}
          >
            <Feather
              name={companyNumber ? 'check-circle' : 'briefcase'}
              size={16}
              color={companyNumber ? Colors.light.secondary : Colors.light.textMuted}
            />
            <TextInput
              style={styles.input}
              placeholder="Start typing your registered company name"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.businessName}
              onChangeText={(text) => setFormData((prev) => ({ ...prev, businessName: text }))}
              onFocus={() => setChOpen(true)}
              autoCapitalize="words"
            />
            {chLoading ? (
              <ActivityIndicator size="small" color={Colors.light.textMuted} />
            ) : null}
          </View>

          {companyNumber ? (
            <View style={styles.verifiedBadge}>
              <Feather name="shield" size={12} color={Colors.light.secondary} />
              <Text style={styles.verifiedText}>
                Matched on Companies House (Co. No. {companyNumber}). Address pre-filled below.
              </Text>
            </View>
          ) : (
            <Text style={styles.hintText}>
              Pick your registered company from the list to auto-fill your details. If your business isn't listed, type manually — your account will go to manual review.
            </Text>
          )}

          {showSuggestionPanel && (chSuggestions.length > 0 || chError || chLoading) ? (
            <View style={styles.suggestionPanel}>
              {chError ? (
                <View style={styles.suggestionError}>
                  <Feather name="alert-triangle" size={14} color={Colors.light.error} />
                  <Text style={styles.suggestionErrorText}>{chError}</Text>
                </View>
              ) : null}
              {!chError && chSuggestions.length === 0 && !chLoading ? (
                <Text style={styles.suggestionEmpty}>
                  No matches. You can keep typing or fill in the form manually below.
                </Text>
              ) : null}
              <ScrollView
                style={{ maxHeight: 240 }}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {chSuggestions.map((hit) => {
                  const subline = [hit.addressSnippet, hit.status ? `Status: ${hit.status}` : null]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <Pressable
                      key={hit.companyNumber}
                      style={styles.suggestionItem}
                      onPress={() => pickSuggestion(hit)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestionName}>{hit.companyName}</Text>
                        {subline ? (
                          <Text style={styles.suggestionSub} numberOfLines={2}>
                            {subline}
                          </Text>
                        ) : null}
                        <Text style={styles.suggestionMeta}>Co. No. {hit.companyNumber}</Text>
                      </View>
                      <Feather name="chevron-right" size={18} color={Colors.light.textMuted} />
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Pressable style={styles.suggestionDismiss} onPress={() => setChOpen(false)}>
                <Text style={styles.suggestionDismissText}>Hide suggestions</Text>
              </Pressable>
            </View>
          ) : null}
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

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Business Address *</Text>
          <View style={styles.inputWrap}>
            <Feather name="home" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. 12 High Street"
              placeholderTextColor={Colors.light.textMuted}
              value={formData.businessAddress}
              onChangeText={(text) => setFormData(prev => ({ ...prev, businessAddress: text }))}
              autoCapitalize="words"
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  scroll: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: Colors.light.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'center',
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
  inputWrapVerified: {
    borderColor: Colors.light.secondary,
    backgroundColor: Colors.light.secondaryMuted,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    color: Colors.light.text,
  },
  hintText: {
    fontSize: 12,
    color: Colors.light.textMuted,
    lineHeight: 17,
    paddingHorizontal: 4,
    marginTop: 2,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    marginTop: 2,
  },
  verifiedText: {
    flex: 1,
    fontSize: 12,
    color: Colors.light.secondary,
    fontWeight: '600',
    lineHeight: 16,
  },
  suggestionPanel: {
    marginTop: 6,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
    gap: 8,
  },
  suggestionName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  suggestionSub: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  suggestionMeta: {
    fontSize: 11,
    color: Colors.light.textMuted,
    marginTop: 2,
  },
  suggestionEmpty: {
    fontSize: 12,
    color: Colors.light.textMuted,
    padding: 14,
  },
  suggestionError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: Colors.light.errorMuted,
  },
  suggestionErrorText: {
    flex: 1,
    fontSize: 12,
    color: Colors.light.error,
  },
  suggestionDismiss: {
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: Colors.light.background,
  },
  suggestionDismissText: {
    fontSize: 12,
    color: Colors.light.textMuted,
    fontWeight: '600',
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
