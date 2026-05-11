import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

const MIN_DESCRIPTION_LEN = 80;

interface ProfileForm {
  mainCategory: string;
  businessDescription: string;
  businessAddress: string;
  town: string;
  postcode: string;
  additionalServices: string[];
  serviceAreas: string[];
  openingHours: string;
  website: string;
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
    website: '',
  });
  const [serviceInput, setServiceInput] = useState('');
  const [areaInput, setAreaInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

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
          website: json.website ?? '',
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const addChip = (kind: 'services' | 'areas') => {
    const value = (kind === 'services' ? serviceInput : areaInput).trim();
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

  const handleSave = async () => {
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
          website: form.website.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      if (allMet) {
        setCompleted(true);
        Alert.alert(
          'Business profile complete',
          'You can now upload your verification documents.',
          [{ text: 'Continue', onPress: () => router.replace('/trader-dashboard') }],
        );
      } else {
        Alert.alert('Saved', 'Profile updated. Complete the remaining items to move to the next step.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
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
      <View style={[styles.headerRow, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={Colors.light.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Business Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: 8,
          paddingBottom: tabBarHeight + 24,
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
          <View style={styles.inputWrap}>
            <Feather name="tag" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. Plumber, Electrician"
              placeholderTextColor={Colors.light.textMuted}
              value={form.mainCategory}
              onChangeText={(t) => setForm(p => ({ ...p, mainCategory: t }))}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>About your business *</Text>
          <TextInput
            style={[styles.input, styles.textArea, { paddingHorizontal: 14 }]}
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
          <ChipList items={form.additionalServices} onRemove={(v) => removeChip('services', v)} />
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
          <ChipList items={form.serviceAreas} onRemove={(v) => removeChip('areas', v)} />
        </View>

        <Text style={styles.sectionTitle}>Business address *</Text>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Street address</Text>
          <View style={styles.inputWrap}>
            <Feather name="home" size={16} color={Colors.light.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="123 High Street"
              placeholderTextColor={Colors.light.textMuted}
              value={form.businessAddress}
              onChangeText={(t) => setForm(p => ({ ...p, businessAddress: t }))}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 2, marginRight: 10 }]}>
            <Text style={styles.label}>Town/City</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={[styles.input, { marginLeft: 0 }]}
                placeholder="London"
                placeholderTextColor={Colors.light.textMuted}
                value={form.town}
                onChangeText={(t) => setForm(p => ({ ...p, town: t }))}
              />
            </View>
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>Postcode</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={[styles.input, { marginLeft: 0 }]}
                placeholder="EC1A 1BB"
                placeholderTextColor={Colors.light.textMuted}
                value={form.postcode}
                onChangeText={(t) => setForm(p => ({ ...p, postcode: t }))}
                autoCapitalize="characters"
              />
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Opening hours *</Text>
        <View style={styles.inputGroup}>
          <TextInput
            style={[styles.input, styles.textArea, { paddingHorizontal: 14, height: 90 }]}
            placeholder={'Mon–Fri: 8am – 6pm\nSat: 9am – 1pm\nSun: closed'}
            placeholderTextColor={Colors.light.textMuted}
            value={form.openingHours}
            onChangeText={(t) => setForm(p => ({ ...p, openingHours: t }))}
            multiline
            textAlignVertical="top"
          />
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

        <Pressable
          style={[styles.saveBtn, saving && styles.btnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={Colors.light.white} />
          ) : (
            <Text style={styles.saveBtnText}>{allMet ? 'Save & continue' : 'Save progress'}</Text>
          )}
        </Pressable>

        {!allMet && (
          <Text style={styles.footerHint}>
            You can save your progress at any time and finish later.
          </Text>
        )}
      </KeyboardAwareScrollViewCompat>
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

function computeRequirements(form: ProfileForm) {
  const desc = form.businessDescription.trim();
  const addr = form.businessAddress.trim();
  const town = form.town.trim();
  const postcode = form.postcode.trim();
  const hours = form.openingHours.trim();
  const category = form.mainCategory.trim();
  return [
    { field: 'mainCategory', label: 'Main trade category', satisfied: category.length > 0, hint: 'e.g. Plumber, Electrician.' },
    { field: 'businessDescription', label: 'Business description', satisfied: desc.length >= MIN_DESCRIPTION_LEN, hint: `At least ${MIN_DESCRIPTION_LEN} characters.` },
    { field: 'businessAddress', label: 'Business address', satisfied: addr.length > 0 && town.length > 0 && postcode.length > 0, hint: 'Street, town and postcode.' },
    { field: 'additionalServices', label: 'Services offered', satisfied: form.additionalServices.length >= 1, hint: 'Add at least one service.' },
    { field: 'serviceAreas', label: 'Service areas', satisfied: form.serviceAreas.length >= 1, hint: 'Add at least one area you cover.' },
    { field: 'openingHours', label: 'Opening hours', satisfied: hours.length > 0, hint: 'Tell customers when you work.' },
  ];
}

const styles = StyleSheet.create({
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

  chipInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addChipBtn: { backgroundColor: Colors.light.secondary, height: 50, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  addChipText: { color: Colors.light.white, fontSize: 13, fontWeight: '700' },
  chipScroll: { gap: 6, paddingVertical: 8, paddingHorizontal: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 16 },
  chipText: { fontSize: 12, color: Colors.light.text, fontWeight: '500' },
  emptyChips: { fontSize: 12, color: Colors.light.textMuted, marginLeft: 4, marginTop: 6, fontStyle: 'italic' },

  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.light.errorMuted, borderColor: Colors.light.error, borderWidth: 1, padding: 12, borderRadius: 10, marginTop: 14 },
  errorText: { flex: 1, fontSize: 12, color: Colors.light.error, lineHeight: 17 },

  saveBtn: { backgroundColor: Colors.light.secondary, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  saveBtnText: { color: Colors.light.white, fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  btnDisabled: { opacity: 0.5 },
  footerHint: { fontSize: 11, color: Colors.light.textMuted, textAlign: 'center', marginTop: 10 },
  errorBanner: { color: Colors.light.textSecondary, fontSize: 14, textAlign: 'center' },
});
