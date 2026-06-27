import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import {
  useGetReportCategories,
  getGetReportCategoriesQueryKey,
  useCreateReport,
} from '@workspace/api-client-react';

type Subject = 'trader' | 'customer';

interface ReportFormProps {
  subject: Subject;
  targetName?: string;
  // Required when reporting a trader (the trader profile id).
  traderProfileId?: number;
  // Required when reporting a customer (the shared conversation). Also passed
  // for trader reports raised from within a conversation, for context.
  conversationId?: number;
  onSubmitted?: () => void;
}

export function ReportForm({
  subject,
  targetName,
  traderProfileId,
  conversationId,
  onSubmitted,
}: ReportFormProps) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [category, setCategory] = useState<string | null>(null);
  const [detail, setDetail] = useState('');

  const { data: catData, isLoading: catsLoading } = useGetReportCategories({
    query: { enabled: isAuthenticated, queryKey: getGetReportCategoriesQueryKey() },
  });
  const categories =
    subject === 'trader' ? catData?.categories.trader : catData?.categories.customer;

  const createMutation = useCreateReport({
    mutation: {
      onSuccess: () => {
        Alert.alert(
          'Report submitted',
          'Thank you. Our team will review this and take action where appropriate.',
        );
        setCategory(null);
        setDetail('');
        onSubmitted?.();
      },
      onError: (err: unknown) => {
        const msg =
          err instanceof Error ? err.message : 'Could not submit your report. Please try again.';
        Alert.alert('Report failed', msg);
      },
    },
  });

  const trimmedDetail = detail.trim();
  const requiresDetail = category === 'OTHER';
  const canSubmit =
    !!category && (!requiresDetail || trimmedDetail.length >= 10) && !createMutation.isPending;

  const onSubmit = () => {
    if (!category) return;
    if (requiresDetail && trimmedDetail.length < 10) {
      Alert.alert('More detail needed', 'Please describe the issue in at least 10 characters.');
      return;
    }
    if (subject === 'trader') {
      if (!traderProfileId) return;
      createMutation.mutate({
        data: {
          reportedRole: 'trader',
          traderProfileId,
          category,
          detail: trimmedDetail || undefined,
          conversationId,
        },
      });
    } else {
      if (!conversationId) return;
      createMutation.mutate({
        data: {
          reportedRole: 'customer',
          conversationId,
          category,
          detail: trimmedDetail || undefined,
        },
      });
    }
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.gate}>
        <Text style={styles.gateText}>
          Please sign in to submit a report. This helps us follow up and keep the community safe.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.push('/auth/login')}>
          <Text style={styles.primaryBtnText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {targetName ? (
        <Text style={styles.target}>
          Reporting: <Text style={styles.targetName}>{targetName}</Text>
        </Text>
      ) : null}

      <Text style={styles.label}>Reason</Text>
      {catsLoading ? (
        <ActivityIndicator color={Colors.light.primary} style={{ marginVertical: 16 }} />
      ) : (
        <View style={styles.options}>
          {categories?.map((opt) => {
            const selected = category === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => setCategory(opt.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Feather
                  name={selected ? 'check-circle' : 'circle'}
                  size={18}
                  color={selected ? Colors.light.primary : Colors.light.textMuted}
                />
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text style={styles.label}>Details {requiresDetail ? '(required)' : '(optional)'}</Text>
      <TextInput
        style={styles.input}
        value={detail}
        onChangeText={setDetail}
        placeholder="Describe what happened. Please do not include personal contact details."
        placeholderTextColor={Colors.light.textMuted}
        multiline
        numberOfLines={4}
        maxLength={2000}
        textAlignVertical="top"
      />

      <Pressable
        style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
        onPress={onSubmit}
        disabled={!canSubmit}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color={Colors.light.white} />
        ) : (
          <Text style={styles.primaryBtnText}>Submit report</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  gate: {
    backgroundColor: Colors.light.primaryMuted,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 16,
    gap: 12,
  },
  gateText: { fontSize: 14, color: Colors.light.textSecondary, lineHeight: 22 },
  target: { fontSize: 14, color: Colors.light.textSecondary, marginBottom: 12 },
  targetName: { fontWeight: '700', color: Colors.light.text },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.text,
    marginTop: 8,
    marginBottom: 8,
  },
  options: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  optionSelected: { borderColor: Colors.light.primary, backgroundColor: Colors.light.primaryMuted },
  optionText: { flex: 1, fontSize: 14, color: Colors.light.textSecondary },
  optionTextSelected: { color: Colors.light.text, fontWeight: '600' },
  input: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: Colors.light.text,
    backgroundColor: Colors.light.background,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.primary,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: Colors.light.white },
});
