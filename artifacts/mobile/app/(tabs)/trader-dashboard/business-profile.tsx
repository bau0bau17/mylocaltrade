import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';
import { UK_SERVICES } from '@/constants/uk-services';
import { UK_LOCATIONS } from '@/constants/uk-locations';

// Normalise a chip value: trim + collapse internal whitespace. Keeps the
// trader's own casing (existing saved data is never rewritten).
function normalizeChip(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

// Case-insensitive suggestion match: prefix matches first (on any word),
// then substring matches. Excludes values already added as chips.
function suggestFrom(source: string[], query: string, existing: string[], limit = 6): string[] {
  const q = normalizeChip(query).toLowerCase();
  if (q.length < 2) return [];
  const taken = new Set(existing.map(v => v.toLowerCase()));
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const item of source) {
    const lower = item.toLowerCase();
    if (taken.has(lower)) continue;
    if (lower.startsWith(q) || lower.split(/[\s&-]+/).some(w => w.startsWith(q))) {
      prefix.push(item);
    } else if (lower.includes(q)) {
      contains.push(item);
    }
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...contains].slice(0, limit);
}

const MIN_DESCRIPTION_LEN = 80;

const BUSINESS_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'DIRECTOR', label: 'Director' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'SELF_EMPLOYED', label: 'Self-employed / sole trader' },
  { value: 'OTHER', label: 'Other' },
];

const BUSINESS_TYPE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'LIMITED_COMPANY', label: 'Limited company (Ltd)', hint: 'Registered at Companies House. A company registration number is required.' },
  { value: 'SOLE_TRADER', label: 'Sole trader / self-employed', hint: 'Not registered at Companies House. No company number needed.' },
];

const COMPANY_NUMBER_RE = /^[A-Z0-9]{6,10}$/;

interface ProfileForm {
  mainCategory: string;
  businessDescription: string;
  businessAddress: string;
  town: string;
  postcode: string;
  additionalServices: string[];
  serviceAreas: string[];
  openingHours: string;
  workingHours: WorkingHoursState;
  website: string;
  businessRole: string;
  businessType: string;
  companyNumber: string;
  authorisedRepresentative: boolean;
  businessEmailDomain: string;
  vatNumber: string;
}

// --- Structured working hours (for appointment booking) ---------------------
type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type WorkingHoursState = Record<DayKey, { enabled: boolean; start: string; end: string }>;

const DAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL: Record<DayKey, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

function defaultWorkingHours(): WorkingHoursState {
  const weekday = { enabled: true, start: '08:00', end: '18:00' };
  return {
    mon: { ...weekday }, tue: { ...weekday }, wed: { ...weekday },
    thu: { ...weekday }, fri: { ...weekday },
    sat: { enabled: false, start: '09:00', end: '13:00' },
    sun: { enabled: false, start: '09:00', end: '13:00' },
  };
}

function normalizeWorkingHours(raw: unknown): WorkingHoursState {
  const base = defaultWorkingHours();
  if (!raw || typeof raw !== 'object') return base;
  for (const key of DAY_ORDER) {
    const d = (raw as Record<string, { enabled?: boolean; start?: string; end?: string }>)[key];
    if (d && typeof d.enabled === 'boolean' && typeof d.start === 'string' && typeof d.end === 'string') {
      base[key] = { enabled: d.enabled, start: d.start, end: d.end };
    }
  }
  return base;
}

// Tap a time to cycle through 30-minute options (06:00 → 22:00 → wraps).
const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 22; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`);
    if (h < 22) out.push(`${String(h).padStart(2, '0')}:30`);
  }
  return out;
})();

function nextTimeOption(current: string): string {
  const idx = TIME_OPTIONS.indexOf(current);
  return TIME_OPTIONS[(idx + 1) % TIME_OPTIONS.length] ?? '08:00';
}

export default function BusinessProfileScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const { token, isTrader } = useAuth();

  const [form, setForm] = useState<ProfileForm>({
    mainCategory: '',
    businessDescription: '',
    businessAddress: '',
    town: '',
    postcode: '',
    additionalServices: [],
    serviceAreas: [],
    openingHours: '',
    workingHours: defaultWorkingHours(),
    website: '',
    businessRole: '',
    businessType: '',
    companyNumber: '',
    authorisedRepresentative: false,
    businessEmailDomain: '',
    vatNumber: '',
  });
  const [serviceInput, setServiceInput] = useState('');
  const [areaInput, setAreaInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  // Whether the SERVER already has structured working hours saved. Legacy
  // traders (free-text opening hours only) see a prompt until they save.
  const [serverHasWorkingHours, setServerHasWorkingHours] = useState(true);

  // Business email domain confirmation (round-trip email proof). Advisory only.
  const [emailVerify, setEmailVerify] = useState<{
    verified: boolean;
    verifiedAddress: string | null;
    pendingTarget: string | null;
    savedDomain: string;
  }>({ verified: false, verifiedAddress: null, pendingTarget: null, savedDomain: '' });
  const [verifyAddress, setVerifyAddress] = useState('');
  const [sendingVerify, setSendingVerify] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const res = await fetch(`${getApiUrl()}/api/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load profile');
        setForm({
          mainCategory: json.mainCategory ?? '',
          businessDescription: json.businessDescription ?? '',
          businessAddress: json.businessAddress ?? '',
          town: json.town ?? '',
          postcode: json.postcode ?? '',
          additionalServices: Array.isArray(json.additionalServices) ? json.additionalServices : [],
          serviceAreas: Array.isArray(json.serviceAreas) ? json.serviceAreas : [],
          openingHours: json.openingHours ?? '',
          workingHours: normalizeWorkingHours(json.workingHours),
          website: json.website ?? '',
          businessRole: json.businessRole ?? '',
          businessType: json.businessType ?? '',
          companyNumber: json.companyNumber ?? '',
          authorisedRepresentative: Boolean(json.authorisedRepresentative),
          businessEmailDomain: json.businessEmailDomain ?? '',
          vatNumber: json.vatNumber ?? '',
        });
        setServerHasWorkingHours(Boolean(json.workingHours));
        setEmailVerify({
          verified: Boolean(json.businessEmailVerified),
          verifiedAddress: json.businessEmailVerifiedAddress ?? null,
          pendingTarget: json.businessEmailVerificationTarget ?? null,
          savedDomain: json.businessEmailDomain ?? '',
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const addChip = (kind: 'services' | 'areas', suggested?: string) => {
    const value = normalizeChip(suggested ?? (kind === 'services' ? serviceInput : areaInput));
    if (!value) return;
    setForm(prev => {
      const list = kind === 'services' ? prev.additionalServices : prev.serviceAreas;
      if (list.some(v => v.toLowerCase() === value.toLowerCase())) return prev;
      return kind === 'services'
        ? { ...prev, additionalServices: [...list, value] }
        : { ...prev, serviceAreas: [...list, value] };
    });
    if (kind === 'services') setServiceInput(''); else setAreaInput('');
  };

  const removeChip = (kind: 'services' | 'areas', value: string) => {
    setForm(prev => kind === 'services'
      ? { ...prev, additionalServices: prev.additionalServices.filter(v => v !== value) }
      : { ...prev, serviceAreas: prev.serviceAreas.filter(v => v !== value) }
    );
  };

  const requirements = computeRequirements(form);
  const allMet = requirements.every(r => r.satisfied);
  const fieldErrors = computeFieldErrors(form);
  const showFieldErrors = attemptedSave && !allMet;
  const fieldErr = (key: keyof typeof fieldErrors): string | null =>
    showFieldErrors ? fieldErrors[key] : null;

  const handleSave = async () => {
    if (!allMet) {
      setAttemptedSave(true);
      const missing = requirements.filter(r => !r.satisfied).map(r => r.label);
      setError(`Please complete the following before continuing: ${missing.join(', ')}.`);
      return;
    }
    setAttemptedSave(true);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/api/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mainCategory: form.mainCategory.trim(),
          businessDescription: form.businessDescription.trim(),
          businessAddress: form.businessAddress.trim(),
          town: form.town.trim(),
          postcode: form.postcode.trim().toUpperCase(),
          additionalServices: form.additionalServices,
          serviceAreas: form.serviceAreas,
          openingHours: form.openingHours.trim(),
          workingHours: form.workingHours,
          website: form.website.trim() || undefined,
          businessRole: form.businessRole || undefined,
          businessType: form.businessType || undefined,
          companyNumber:
            form.businessType === 'LIMITED_COMPANY'
              ? form.companyNumber.replace(/\s+/g, '').toUpperCase() || undefined
              : '',
          authorisedRepresentative: form.authorisedRepresentative,
          businessEmailDomain: form.businessEmailDomain.trim() || undefined,
          vatNumber: form.vatNumber.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      // The server is the single source of truth for whether the business
      // profile is complete enough to advance onboarding. We only move the
      // trader on when the server POSITIVELY confirms completion. Anything else
      // (an explicit `false`, or a missing/old field) keeps them on this screen
      // with a clear reason — never a silent bounce back to a dashboard that
      // still reads "Action required", which looks like "saving did nothing".
      if (json.businessProfileComplete !== true) {
        setAttemptedSave(true);
        const missing: string[] =
          Array.isArray(json.businessProfileMissing) && json.businessProfileMissing.length > 0
            ? json.businessProfileMissing
            : requirements.filter(r => !r.satisfied).map(r => r.label);
        setError(
          missing.length > 0
            ? `Your changes were saved, but a few details still need attention before you can continue: ${missing.join(', ')}.`
            : 'Your changes were saved, but we could not confirm your profile is complete. Please review the required fields and try again.',
        );
        return;
      }
      setServerHasWorkingHours(true);
      setCompleted(true);
      // Navigate straight to the trader dashboard. We previously used
      // Alert.alert as a confirmation, but native alerts do not render
      // reliably inside the web preview iframe — the save succeeds on
      // the server but the user sees no feedback and assumes it failed.
      router.replace('/trader-dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSendVerification = async () => {
    setVerifyNotice(null);
    setSendingVerify(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/profile/business-email/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          verifyAddress.trim() ? { email: verifyAddress.trim() } : {},
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to send verification email');
      setEmailVerify(prev => ({ ...prev, pendingTarget: json.target ?? (verifyAddress.trim() || null) }));
      setVerifyNotice(`Verification email sent to ${json.target}. Click the link in your inbox to confirm.`);
    } catch (e) {
      setVerifyNotice(e instanceof Error ? e.message : 'Failed to send verification email');
    } finally {
      setSendingVerify(false);
    }
  };

  if (!isTrader) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 40 }]}>
        <Feather name="lock" size={28} color={Colors.light.textMuted} />
        <Text style={styles.errorBanner}>Trader account required.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 40 }]}>
        <ActivityIndicator color={Colors.light.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: 8,
          paddingBottom: 16,
          paddingHorizontal: 20,
        }}
        bottomOffset={tabBarHeight + 24}
      >
        {/* Progress Summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryTitle}>Completion checklist</Text>
            <Text style={styles.summaryCount}>
              {requirements.filter(r => r.satisfied).length} / {requirements.length}
            </Text>
          </View>
          {requirements.map(req => (
            <View key={req.field} style={styles.requirementRow}>
              <Feather
                name={req.satisfied ? 'check-circle' : 'circle'}
                size={14}
                color={req.satisfied ? Colors.light.success : Colors.light.textMuted}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.requirementLabel, req.satisfied && { color: Colors.light.textMuted, textDecorationLine: 'line-through' }]}>
                  {req.label}
                </Text>
                {!req.satisfied && <Text style={styles.requirementHint}>{req.hint}</Text>}
              </View>
            </View>
          ))}
        </View>

        {/* Form */}
        <Text style={styles.sectionTitle}>Trade & description</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Main trade *</Text>
          <View style={[styles.inputWrap, fieldErr('mainCategory') && styles.inputWrapError]}>
            <Feather name="tag" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. Plumber, Electrician"
              placeholderTextColor={Colors.light.textMuted}
              value={form.mainCategory}
              onChangeText={(t) => setForm(p => ({ ...p, mainCategory: t }))}
            />
          </View>
          {fieldErr('mainCategory') && <Text style={styles.fieldError}>{fieldErr('mainCategory')}</Text>}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>About your business *</Text>
          <TextInput
            style={[
              styles.input,
              styles.textArea,
              { paddingHorizontal: 14 },
              fieldErr('businessDescription') && styles.inputWrapError,
            ]}
            placeholder="What do you do, what makes you different, and who do you typically work with?"
            placeholderTextColor={Colors.light.textMuted}
            value={form.businessDescription}
            onChangeText={(t) => setForm(p => ({ ...p, businessDescription: t }))}
            multiline
            textAlignVertical="top"
          />
          <Text style={[styles.helper, form.businessDescription.trim().length >= MIN_DESCRIPTION_LEN && { color: Colors.light.success }]}>
            {form.businessDescription.trim().length} / {MIN_DESCRIPTION_LEN} characters minimum
          </Text>
          {fieldErr('businessDescription') && <Text style={styles.fieldError}>{fieldErr('businessDescription')}</Text>}
        </View>

        <Text style={styles.sectionTitle}>Business type *</Text>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Are you a limited company or a sole trader?</Text>
          <Text style={styles.helper}>
            Limited companies must provide a Companies House registration number, which we verify automatically. Sole traders and self-employed traders do not.
          </Text>
          <View style={styles.typeGrid}>
            {BUSINESS_TYPE_OPTIONS.map((opt) => {
              const selected = form.businessType === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setForm(p => ({ ...p, businessType: opt.value }))}
                  style={[styles.typeCard, selected && styles.typeCardSelected]}
                >
                  <View style={styles.typeCardHeader}>
                    <Feather
                      name={selected ? 'check-circle' : 'circle'}
                      size={18}
                      color={selected ? Colors.light.primary : Colors.light.textMuted}
                    />
                    <Text style={[styles.typeCardLabel, selected && { color: Colors.light.primary }]}>{opt.label}</Text>
                  </View>
                  <Text style={styles.typeCardHint}>{opt.hint}</Text>
                </Pressable>
              );
            })}
          </View>
          {fieldErr('businessType') && <Text style={styles.fieldError}>{fieldErr('businessType')}</Text>}
        </View>

        {form.businessType === 'LIMITED_COMPANY' && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Company registration number *</Text>
            <View style={[styles.inputWrap, fieldErr('companyNumber') && styles.inputWrapError]}>
              <Feather name="briefcase" size={16} color={Colors.light.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="e.g. 12345678"
                placeholderTextColor={Colors.light.textMuted}
                value={form.companyNumber}
                onChangeText={(t) => setForm(p => ({ ...p, companyNumber: t }))}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
            <Text style={styles.helper}>
              Your 8-character Companies House number (some start with letters, e.g. SC123456). We check this against Companies House automatically.
            </Text>
            {fieldErr('companyNumber') && <Text style={styles.fieldError}>{fieldErr('companyNumber')}</Text>}
          </View>
        )}

        <Text style={styles.sectionTitle}>Your role in the business</Text>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>How are you connected to this business?</Text>
          <Text style={styles.helper}>
            This helps us verify the right documents. Sole traders are never asked for a company number.
          </Text>
          <View style={styles.roleGrid}>
            {BUSINESS_ROLE_OPTIONS.map((opt) => {
              const selected = form.businessRole === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setForm(p => ({ ...p, businessRole: selected ? '' : opt.value }))}
                  style={[styles.roleChip, selected && styles.roleChipSelected]}
                >
                  <Text style={[styles.roleChipText, selected && styles.roleChipTextSelected]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Pressable
            onPress={() => setForm(p => ({ ...p, authorisedRepresentative: !p.authorisedRepresentative }))}
            style={styles.toggleRow}
          >
            <Feather
              name={form.authorisedRepresentative ? 'check-square' : 'square'}
              size={20}
              color={form.authorisedRepresentative ? Colors.light.primary : Colors.light.textMuted}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>I am acting on behalf of the business owner</Text>
              <Text style={styles.toggleHint}>
                Tick this if you are not the owner. We will ask you to upload a signed authorisation letter.
              </Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Business email domain (optional)</Text>
          <View style={styles.inputWrap}>
            <Feather name="at-sign" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. yourcompany.co.uk"
              placeholderTextColor={Colors.light.textMuted}
              value={form.businessEmailDomain}
              onChangeText={(t) => setForm(p => ({ ...p, businessEmailDomain: t }))}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
          </View>
          <Text style={styles.helper}>Helps us confirm you use an official business email address.</Text>

          {emailVerify.savedDomain.trim().length > 0 && (
            <View style={styles.verifyBox}>
              {emailVerify.verified ? (
                <View style={styles.verifyStatusRow}>
                  <Feather name="check-circle" size={16} color={Colors.light.success} />
                  <Text style={styles.verifyConfirmedText}>
                    Confirmed{emailVerify.verifiedAddress ? ` (${emailVerify.verifiedAddress})` : ''}
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.verifyStatusRow}>
                    <Feather name="alert-circle" size={16} color={Colors.light.textMuted} />
                    <Text style={styles.verifyPendingText}>
                      {emailVerify.pendingTarget
                        ? `Verification pending — check ${emailVerify.pendingTarget} and click the link.`
                        : 'Not confirmed yet. Send a verification email to an address at this domain.'}
                    </Text>
                  </View>
                  <View style={styles.inputWrap}>
                    <Feather name="mail" size={16} color={Colors.light.textMuted} />
                    <TextInput
                      style={styles.input}
                      placeholder={`e.g. info@${emailVerify.savedDomain}`}
                      placeholderTextColor={Colors.light.textMuted}
                      value={verifyAddress}
                      onChangeText={setVerifyAddress}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                    />
                  </View>
                  <Pressable
                    style={[styles.verifyBtn, sendingVerify && styles.btnDisabled]}
                    onPress={handleSendVerification}
                    disabled={sendingVerify}
                  >
                    {sendingVerify ? (
                      <ActivityIndicator color={Colors.light.primary} />
                    ) : (
                      <Text style={styles.verifyBtnText}>
                        {emailVerify.pendingTarget ? 'Resend verification email' : 'Send verification email'}
                      </Text>
                    )}
                  </Pressable>
                </>
              )}
              {verifyNotice ? <Text style={styles.verifyNotice}>{verifyNotice}</Text> : null}
            </View>
          )}
          {form.businessEmailDomain.trim() !== emailVerify.savedDomain.trim() && form.businessEmailDomain.trim().length > 0 && (
            <Text style={styles.helper}>Save your profile to verify this domain.</Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>VAT number (optional)</Text>
          <View style={styles.inputWrap}>
            <Feather name="hash" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. GB123456789"
              placeholderTextColor={Colors.light.textMuted}
              value={form.vatNumber}
              onChangeText={(t) => setForm(p => ({ ...p, vatNumber: t }))}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>
          <Text style={styles.helper}>
            Only if you are VAT registered. Not required for sole traders or self-employed traders. We use it as a supporting check.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Services offered *</Text>
        <View style={styles.inputGroup}>
          <View style={styles.chipInputRow}>
            <View style={[styles.inputWrap, { flex: 1 }]}>
              <Feather name="plus" size={16} color={Colors.light.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="e.g. Boiler installation"
                placeholderTextColor={Colors.light.textMuted}
                value={serviceInput}
                onChangeText={setServiceInput}
                onSubmitEditing={() => addChip('services')}
                returnKeyType="done"
              />
            </View>
            <Pressable onPress={() => addChip('services')} style={styles.addChipBtn}>
              <Text style={styles.addChipText}>Add</Text>
            </Pressable>
          </View>
          {(() => {
            const suggestions = suggestFrom(UK_SERVICES, serviceInput, form.additionalServices);
            return suggestions.length > 0 ? (
              <View style={styles.suggestBox}>
                {suggestions.map((s) => (
                  <Pressable
                    key={s}
                    style={styles.suggestRow}
                    onPress={() => addChip('services', s)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add service ${s}`}
                  >
                    <Feather name="plus-circle" size={14} color={Colors.light.primary} />
                    <Text style={styles.suggestText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null;
          })()}
          <ChipList items={form.additionalServices} onRemove={(v) => removeChip('services', v)} />
          {fieldErr('additionalServices') && <Text style={styles.fieldError}>{fieldErr('additionalServices')}</Text>}
        </View>

        <Text style={styles.sectionTitle}>Service areas *</Text>
        <View style={styles.inputGroup}>
          <View style={styles.chipInputRow}>
            <View style={[styles.inputWrap, { flex: 1 }]}>
              <Feather name="map-pin" size={16} color={Colors.light.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="e.g. Camden, Islington"
                placeholderTextColor={Colors.light.textMuted}
                value={areaInput}
                onChangeText={setAreaInput}
                onSubmitEditing={() => addChip('areas')}
                returnKeyType="done"
              />
            </View>
            <Pressable onPress={() => addChip('areas')} style={styles.addChipBtn}>
              <Text style={styles.addChipText}>Add</Text>
            </Pressable>
          </View>
          {(() => {
            const suggestions = suggestFrom(UK_LOCATIONS, areaInput, form.serviceAreas);
            return suggestions.length > 0 ? (
              <View style={styles.suggestBox}>
                {suggestions.map((s) => (
                  <Pressable
                    key={s}
                    style={styles.suggestRow}
                    onPress={() => addChip('areas', s)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add service area ${s}`}
                  >
                    <Feather name="map-pin" size={14} color={Colors.light.primary} />
                    <Text style={styles.suggestText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null;
          })()}
          <ChipList items={form.serviceAreas} onRemove={(v) => removeChip('areas', v)} />
          {fieldErr('serviceAreas') && <Text style={styles.fieldError}>{fieldErr('serviceAreas')}</Text>}
        </View>

        <Text style={styles.sectionTitle}>Business address *</Text>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Street address</Text>
          <View style={[styles.inputWrap, fieldErr('businessAddress') && styles.inputWrapError]}>
            <Feather name="home" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="123 High Street"
              placeholderTextColor={Colors.light.textMuted}
              value={form.businessAddress}
              onChangeText={(t) => setForm(p => ({ ...p, businessAddress: t }))}
            />
          </View>
          {fieldErr('businessAddress') && <Text style={styles.fieldError}>{fieldErr('businessAddress')}</Text>}
        </View>
        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 2, marginRight: 10 }]}>
            <Text style={styles.label}>Town/City</Text>
            <View style={[styles.inputWrap, fieldErr('town') && styles.inputWrapError]}>
              <TextInput
                style={[styles.input, { marginLeft: 0 }]}
                placeholder="London"
                placeholderTextColor={Colors.light.textMuted}
                value={form.town}
                onChangeText={(t) => setForm(p => ({ ...p, town: t }))}
              />
            </View>
            {fieldErr('town') && <Text style={styles.fieldError}>{fieldErr('town')}</Text>}
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>Postcode</Text>
            <View style={[styles.inputWrap, fieldErr('postcode') && styles.inputWrapError]}>
              <TextInput
                style={[styles.input, { marginLeft: 0 }]}
                placeholder="EC1A 1BB"
                placeholderTextColor={Colors.light.textMuted}
                value={form.postcode}
                onChangeText={(t) => setForm(p => ({ ...p, postcode: t }))}
                autoCapitalize="characters"
              />
            </View>
            {fieldErr('postcode') && <Text style={styles.fieldError}>{fieldErr('postcode')}</Text>}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Opening hours notes (optional)</Text>
        <View style={styles.inputGroup}>
          <TextInput
            style={[
              styles.input,
              styles.textArea,
              { paddingHorizontal: 14, height: 90 },
              fieldErr('openingHours') && styles.inputWrapError,
            ]}
            placeholder={'Mon–Fri: 8am – 6pm\nSat: 9am – 1pm\nSun: closed'}
            placeholderTextColor={Colors.light.textMuted}
            value={form.openingHours}
            onChangeText={(t) => setForm(p => ({ ...p, openingHours: t }))}
            multiline
            textAlignVertical="top"
          />
          {fieldErr('openingHours') && <Text style={styles.fieldError}>{fieldErr('openingHours')}</Text>}
        </View>

        <Text style={styles.sectionTitle}>Working hours (for appointments)</Text>
        {!serverHasWorkingHours && (
          <View style={styles.whPromptBanner}>
            <Feather name="clock" size={16} color={Colors.light.primary} />
            <Text style={styles.whPromptText}>
              Please set your working hours. Appointments can only be booked within them — until
              you save a schedule, customers can request times between 08:00 and 18:00. Your
              existing opening-hours text is kept as a note.
            </Text>
          </View>
        )}
        <Text style={styles.whHint}>
          Customers can only book appointment times inside these hours. Tap a day to switch it on
          or off, then adjust the start and end times.
        </Text>
        {fieldErr('workingHours') && <Text style={styles.fieldError}>{fieldErr('workingHours')}</Text>}
        <View style={styles.inputGroup}>
          {DAY_ORDER.map((dayKey) => {
            const day = form.workingHours[dayKey];
            return (
              <View key={dayKey} style={styles.whRow}>
                <Pressable
                  style={[styles.whDayToggle, day.enabled && styles.whDayToggleOn]}
                  onPress={() =>
                    setForm(p => ({
                      ...p,
                      workingHours: {
                        ...p.workingHours,
                        [dayKey]: { ...p.workingHours[dayKey], enabled: !p.workingHours[dayKey].enabled },
                      },
                    }))
                  }
                  accessibilityRole="switch"
                  accessibilityState={{ checked: day.enabled }}
                  accessibilityLabel={`${DAY_LABEL[dayKey]} ${day.enabled ? 'working' : 'not working'}`}
                >
                  <Text style={[styles.whDayText, day.enabled && styles.whDayTextOn]}>
                    {DAY_LABEL[dayKey]}
                  </Text>
                </Pressable>
                {day.enabled ? (
                  <View style={styles.whTimes}>
                    {(['start', 'end'] as const).map((edge) => (
                      <Pressable
                        key={edge}
                        style={styles.whTimeBtn}
                        onPress={() =>
                          setForm(p => ({
                            ...p,
                            workingHours: {
                              ...p.workingHours,
                              [dayKey]: {
                                ...p.workingHours[dayKey],
                                [edge]: nextTimeOption(p.workingHours[dayKey][edge]),
                              },
                            },
                          }))
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`${DAY_LABEL[dayKey]} ${edge} time ${day[edge]}, tap to change`}
                      >
                        <Text style={styles.whTimeText}>{day[edge]}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.whClosed}>Not working</Text>
                )}
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Website (optional)</Text>
        <View style={styles.inputGroup}>
          <View style={styles.inputWrap}>
            <Feather name="globe" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="https://yourbusiness.co.uk"
              placeholderTextColor={Colors.light.textMuted}
              value={form.website}
              onChangeText={(t) => setForm(p => ({ ...p, website: t }))}
              keyboardType="url"
              autoCapitalize="none"
            />
          </View>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={14} color={Colors.light.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </KeyboardAwareScrollViewCompat>

      {/* Save CTA is pinned above the absolutely-positioned bottom tab bar so it
          is always fully visible and tappable, instead of scrolling behind it. */}
      <View style={[styles.footerBar, { paddingBottom: insets.bottom + tabBarHeight + 12 }]}>
        <Pressable
          style={[styles.saveBtn, saving && styles.btnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={Colors.light.white} />
          ) : (
            <Text style={styles.saveBtnText}>Save & continue</Text>
          )}
        </Pressable>

        {!allMet && (
          <Text style={styles.footerHint}>
            {requirements.filter(r => !r.satisfied).length} required field
            {requirements.filter(r => !r.satisfied).length === 1 ? '' : 's'} still to complete — tap Save & continue to see which.
          </Text>
        )}
      </View>
    </View>
  );
}

function ChipList({ items, onRemove }: { items: string[]; onRemove: (v: string) => void }) {
  if (items.length === 0) {
    return <Text style={styles.emptyChips}>None added yet.</Text>;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
      {items.map(item => (
        <Pressable key={item} onPress={() => onRemove(item)} style={styles.chip}>
          <Text style={styles.chipText}>{item}</Text>
          <Feather name="x" size={12} color={Colors.light.textMuted} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function computeFieldErrors(form: ProfileForm) {
  const desc = form.businessDescription.trim();
  const isLtd = form.businessType === 'LIMITED_COMPANY';
  const company = form.companyNumber.replace(/\s+/g, '').toUpperCase();
  return {
    businessType:
      form.businessType !== 'LIMITED_COMPANY' && form.businessType !== 'SOLE_TRADER'
        ? 'Please choose your business type.'
        : null,
    companyNumber: isLtd
      ? company.length === 0
        ? 'Limited companies must provide a company number.'
        : !COMPANY_NUMBER_RE.test(company)
          ? 'Enter a valid Companies House number (6–10 letters/digits).'
          : null
      : null,
    mainCategory: form.mainCategory.trim().length === 0 ? 'This field is required.' : null,
    businessDescription:
      desc.length === 0
        ? 'This field is required.'
        : desc.length < MIN_DESCRIPTION_LEN
          ? `At least ${MIN_DESCRIPTION_LEN} characters required (you have ${desc.length}).`
          : null,
    businessAddress: form.businessAddress.trim().length === 0 ? 'This field is required.' : null,
    town: form.town.trim().length === 0 ? 'This field is required.' : null,
    postcode: form.postcode.trim().length === 0 ? 'This field is required.' : null,
    additionalServices: form.additionalServices.length === 0 ? 'Add at least one service.' : null,
    serviceAreas: form.serviceAreas.length === 0 ? 'Add at least one service area.' : null,
    // Legacy free-text opening hours are OPTIONAL now — structured working
    // hours are the availability source of truth for onboarding + bookings.
    openingHours: null,
    workingHours: hasEnabledWorkingDay(form.workingHours)
      ? null
      : 'Enable at least one working day.',
  };
}

function hasEnabledWorkingDay(wh: WorkingHoursState): boolean {
  return DAY_ORDER.some((d) => wh[d].enabled);
}

function computeRequirements(form: ProfileForm) {
  const desc = form.businessDescription.trim();
  const addr = form.businessAddress.trim();
  const town = form.town.trim();
  const postcode = form.postcode.trim();
  const hours = form.openingHours.trim();
  const category = form.mainCategory.trim();
  const isLtd = form.businessType === 'LIMITED_COMPANY';
  const company = form.companyNumber.replace(/\s+/g, '').toUpperCase();
  return [
    { field: 'businessType', label: 'Business type', satisfied: form.businessType === 'LIMITED_COMPANY' || form.businessType === 'SOLE_TRADER', hint: 'Limited company or sole trader.' },
    ...(isLtd
      ? [{ field: 'companyNumber', label: 'Company registration number', satisfied: COMPANY_NUMBER_RE.test(company), hint: 'Your Companies House number.' }]
      : []),
    { field: 'mainCategory', label: 'Main trade category', satisfied: category.length > 0, hint: 'e.g. Plumber, Electrician.' },
    { field: 'businessDescription', label: 'Business description', satisfied: desc.length >= MIN_DESCRIPTION_LEN, hint: `At least ${MIN_DESCRIPTION_LEN} characters.` },
    { field: 'businessAddress', label: 'Business address', satisfied: addr.length > 0 && town.length > 0 && postcode.length > 0, hint: 'Street, town and postcode.' },
    { field: 'additionalServices', label: 'Services offered', satisfied: form.additionalServices.length >= 1, hint: 'Add at least one service.' },
    { field: 'serviceAreas', label: 'Service areas', satisfied: form.serviceAreas.length >= 1, hint: 'Add at least one area you cover.' },
    { field: 'workingHours', label: 'Working hours', satisfied: hasEnabledWorkingDay(form.workingHours) || hours.length > 0, hint: 'Set your weekly working hours.' },
  ];
}

const styles = StyleSheet.create({
  whPromptBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.light.primaryMuted,
    borderWidth: 1,
    borderColor: Colors.light.primary,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  whPromptText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.light.text,
  },
  whHint: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    lineHeight: 18,
    marginBottom: 10,
  },
  whRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: 10,
  },
  whDayToggle: {
    width: 64,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.surface,
    alignItems: 'center',
  },
  whDayToggleOn: {
    backgroundColor: Colors.light.primaryMuted,
    borderColor: Colors.light.primary,
  },
  whDayText: { fontSize: 13, fontWeight: '700', color: Colors.light.textMuted },
  whDayTextOn: { color: Colors.light.primary },
  whTimes: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  whTimeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
  },
  whTimeText: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  whClosed: { fontSize: 13, color: Colors.light.textMuted },
  container: { flex: 1, backgroundColor: Colors.light.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: Colors.light.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.border },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.text },

  summaryCard: { backgroundColor: Colors.light.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.light.border, padding: 14, marginBottom: 18, gap: 8 },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  summaryTitle: { fontSize: 13, fontWeight: '700', color: Colors.light.text },
  summaryCount: { fontSize: 12, color: Colors.light.textMuted, fontWeight: '600' },
  requirementRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 4 },
  requirementLabel: { fontSize: 13, color: Colors.light.text, fontWeight: '500' },
  requirementHint: { fontSize: 11, color: Colors.light.textMuted, marginTop: 1 },

  sectionTitle: { fontSize: 11, fontWeight: '700', color: Colors.light.textMuted, marginBottom: 8, marginTop: 14, marginLeft: 4, letterSpacing: 0.8, textTransform: 'uppercase' },
  inputGroup: { gap: 6, marginBottom: 8 },
  row: { flexDirection: 'row' },
  label: { fontSize: 11, fontWeight: '700', color: Colors.light.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginLeft: 4 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12, paddingHorizontal: 14, height: 50, gap: 10 },
  input: { flex: 1, height: '100%', fontSize: 15, color: Colors.light.text },
  textArea: { height: 110, paddingVertical: 12, alignSelf: 'stretch', backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12, fontSize: 15, color: Colors.light.text },
  helper: { fontSize: 11, color: Colors.light.textMuted, marginLeft: 4, marginTop: 2 },
  inputWrapError: { borderColor: Colors.light.error, borderWidth: 1.5 },
  fieldError: { fontSize: 11, color: Colors.light.error, marginLeft: 4, marginTop: 4, fontWeight: '600' },

  chipInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addChipBtn: { backgroundColor: Colors.light.secondary, height: 50, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  suggestBox: { marginTop: 6, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12, backgroundColor: Colors.light.white, overflow: 'hidden' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.light.border },
  suggestText: { fontSize: 14, color: Colors.light.text },
  addChipText: { color: Colors.light.white, fontSize: 13, fontWeight: '700' },
  chipScroll: { gap: 6, paddingVertical: 8, paddingHorizontal: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 16 },
  chipText: { fontSize: 12, color: Colors.light.text, fontWeight: '500' },
  emptyChips: { fontSize: 12, color: Colors.light.textMuted, marginLeft: 4, marginTop: 6, fontStyle: 'italic' },

  typeGrid: { gap: 10, marginTop: 6 },
  typeCard: { backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12, padding: 14, gap: 6 },
  typeCardSelected: { backgroundColor: 'rgba(59, 130, 246, 0.10)', borderColor: Colors.light.primary },
  typeCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  typeCardLabel: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  typeCardHint: { fontSize: 11, color: Colors.light.textMuted, lineHeight: 16, marginLeft: 28 },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  roleChip: { paddingHorizontal: 14, paddingVertical: 9, backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12 },
  roleChipSelected: { backgroundColor: 'rgba(59, 130, 246, 0.10)', borderColor: Colors.light.primary },
  roleChipText: { fontSize: 13, color: Colors.light.text, fontWeight: '600' },
  roleChipTextSelected: { color: Colors.light.primary },
  toggleRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12, padding: 14 },
  toggleLabel: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  toggleHint: { fontSize: 11, color: Colors.light.textMuted, lineHeight: 16, marginTop: 4 },

  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.light.errorMuted, borderColor: Colors.light.error, borderWidth: 1, padding: 12, borderRadius: 10, marginTop: 14 },
  errorText: { flex: 1, fontSize: 12, color: Colors.light.error, lineHeight: 17 },

  footerBar: { paddingTop: 12, paddingHorizontal: 20, backgroundColor: Colors.light.background, borderTopWidth: 1, borderTopColor: Colors.light.border },
  saveBtn: { backgroundColor: Colors.light.secondary, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: Colors.light.white, fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  btnDisabled: { opacity: 0.5 },
  footerHint: { fontSize: 11, color: Colors.light.textMuted, textAlign: 'center', marginTop: 10 },
  errorBanner: { color: Colors.light.textSecondary, fontSize: 14, textAlign: 'center' },

  verifyBox: { marginTop: 12, padding: 12, backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12, gap: 10 },
  verifyStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifyConfirmedText: { flex: 1, fontSize: 13, color: Colors.light.success, fontWeight: '700' },
  verifyPendingText: { flex: 1, fontSize: 12, color: Colors.light.textSecondary, lineHeight: 17 },
  verifyBtn: { borderWidth: 1, borderColor: Colors.light.primary, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  verifyBtnText: { color: Colors.light.primary, fontSize: 13, fontWeight: '700' },
  verifyNotice: { fontSize: 12, color: Colors.light.textSecondary, lineHeight: 17 },
});
