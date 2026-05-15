import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useGetTraderProfile, useUpdateTraderProfile } from '@workspace/api-client-react';
import { SPECIALISMS } from '@/constants/specialisms';

export default function ServicesScreen() {
  const insets = useSafeAreaInsets();
  const { data: profileData, isLoading } = useGetTraderProfile();
  const { mutateAsync: updateProfile, isPending: isSaving } = useUpdateTraderProfile();

  const [services, setServices] = useState<string[]>([]);
  const [newService, setNewService] = useState('');

  useEffect(() => {
    if (profileData?.additionalServices) {
      setServices(profileData.additionalServices);
    }
  }, [profileData]);

  const addService = () => {
    const trimmed = newService.trim();
    if (!trimmed) return;
    if (services.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      Alert.alert('Duplicate', 'This service is already listed');
      return;
    }
    setServices(prev => [...prev, trimmed]);
    setNewService('');
  };

  const addSuggested = (label: string) => {
    if (services.some((s) => s.toLowerCase() === label.toLowerCase())) return;
    setServices((prev) => [...prev, label]);
  };

  const removeService = (index: number) => {
    setServices(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    try {
      await updateProfile({ data: { additionalServices: services } });
      Alert.alert('Saved', 'Your services have been updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not save services';
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
        <Text style={styles.sectionTitle}>Main Category</Text>
        <View style={styles.mainCategory}>
          <Feather name="briefcase" size={20} color={Colors.light.primary} />
          <Text style={styles.mainCategoryText}>{profileData?.mainCategory || 'Not set'}</Text>
        </View>

        <Text style={styles.sectionTitle}>Additional Services</Text>
        <Text style={styles.description}>
          List the additional services you offer to help customers find you.
        </Text>

        <Text style={styles.suggestedLabel}>Quick add specialisms</Text>
        <Text style={styles.suggestedHint}>
          These are surfaced as badges on your public profile and used to filter search.
        </Text>
        <View style={styles.suggestedRow}>
          {SPECIALISMS.map((spec) => {
            const active = services.some((s) => s.toLowerCase() === spec.label.toLowerCase());
            return (
              <Pressable
                key={spec.key}
                style={[styles.suggestedChip, active && styles.suggestedChipActive]}
                onPress={() => addSuggested(spec.label)}
                disabled={active}
              >
                <Feather
                  name={spec.icon}
                  size={12}
                  color={active ? Colors.light.textMuted : Colors.light.primary}
                />
                <Text style={[styles.suggestedChipText, active && styles.suggestedChipTextActive]}>
                  {spec.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="e.g. Boiler Repair, Emergency Callout"
            placeholderTextColor={Colors.light.textMuted}
            value={newService}
            onChangeText={setNewService}
            onSubmitEditing={addService}
            returnKeyType="done"
          />
          <Pressable style={styles.addButton} onPress={addService}>
            <Feather name="plus" size={20} color={Colors.light.white} />
          </Pressable>
        </View>

        {services.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="list" size={32} color={Colors.light.textSecondary} />
            <Text style={styles.emptyText}>No additional services added yet</Text>
          </View>
        ) : (
          <View style={styles.servicesList}>
            {services.map((service, idx) => (
              <View key={idx} style={styles.serviceItem}>
                <Feather name="check-circle" size={16} color={Colors.light.secondary} />
                <Text style={styles.serviceText}>{service}</Text>
                <Pressable onPress={() => removeService(idx)} hitSlop={8}>
                  <Feather name="x" size={18} color={Colors.light.error} />
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
            <Text style={styles.saveButtonText}>Save Services</Text>
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
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginBottom: 8,
    marginTop: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  description: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  mainCategory: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.primaryMuted,
    padding: 16,
    borderRadius: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  mainCategoryText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.primary,
  },
  suggestedLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginTop: 16,
    marginBottom: 4,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  suggestedHint: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 10,
    lineHeight: 16,
  },
  suggestedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  suggestedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
  },
  suggestedChipActive: {
    opacity: 0.5,
  },
  suggestedChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.primary,
    letterSpacing: 0.2,
  },
  suggestedChipTextActive: {
    color: Colors.light.textMuted,
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
  servicesList: {
    gap: 8,
  },
  serviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 10,
  },
  serviceText: {
    flex: 1,
    fontSize: 15,
    color: Colors.light.text,
  },
  emptyState: {
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
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
