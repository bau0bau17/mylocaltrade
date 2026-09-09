import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import {
  useAppealConversationReport,
  useAppealReport,
  useGetMyReports,
  getGetMyReportsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

type ReportItem = {
  id: number;
  reportType: 'user' | 'conversation';
  category: string;
  status: string;
  outcome?: string | null;
  outcomeAt?: string | null;
  createdAt: string;
  appeal?: { id: number; status: string; outcome?: string | null } | null;
};

export default function ReportStatusScreen() {
  const { isAuthenticated } = useAuth();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useGetMyReports({
    query: { enabled: isAuthenticated, queryKey: getGetMyReportsQueryKey() },
  });
  const [appealFor, setAppealFor] = useState<ReportItem | null>(null);
  const [reason, setReason] = useState('');
  const profileAppeal = useAppealReport();
  const conversationAppeal = useAppealConversationReport();
  const reports = ((data as unknown as { reports?: ReportItem[] } | undefined)?.reports ?? []);

  const submitAppeal = () => {
    if (!appealFor || reason.trim().length < 10) return;
    const mutation = appealFor.reportType === 'conversation' ? conversationAppeal : profileAppeal;
    mutation.mutate(
      { id: appealFor.id, data: { reason: reason.trim() } },
      {
        onSuccess: () => {
          setAppealFor(null);
          setReason('');
          void qc.invalidateQueries({ queryKey: getGetMyReportsQueryKey() });
        },
      },
    );
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.center}>
        <Text style={styles.heading}>Report status</Text>
        <Text style={styles.paragraph}>Sign in to view reports you have submitted and any available outcomes.</Text>
        <Pressable style={styles.button} onPress={() => router.push('/auth/login')}><Text style={styles.buttonText}>Sign in</Text></Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: tabBarHeight + insets.bottom + 32 }}>
      <View style={styles.intro}>
        <Text style={styles.heading}>Your reports</Text>
        <Text style={styles.paragraph}>We review reports of suspected illegal content and other concerns. Outcomes may include no further action, safety measures, or action on an account or listing. We share only information appropriate to your report.</Text>
      </View>
      {isLoading ? <ActivityIndicator color={Colors.light.primary} /> : isError ? (
        <Text style={styles.paragraph}>We couldn't load your report status. Please try again later.</Text>
      ) : reports.length === 0 ? (
        <Text style={styles.paragraph}>You have not submitted any reports.</Text>
      ) : reports.map((report) => {
        const decided = !!report.outcome;
        return (
          <View key={`${report.reportType}-${report.id}`} style={styles.card}>
            <Text style={styles.cardTitle}>{report.category.replaceAll('_', ' ')}</Text>
            <Text style={styles.meta}>Status: {report.status}</Text>
            {report.outcome ? <Text style={styles.meta}>Outcome: {report.outcome}</Text> : <Text style={styles.meta}>Under review</Text>}
            {report.outcomeAt ? <Text style={styles.meta}>Decided {new Date(report.outcomeAt).toLocaleDateString('en-GB')}</Text> : null}
            {report.appeal ? (
              <Text style={styles.meta}>Challenge: {report.appeal.status}{report.appeal.outcome ? ` — ${report.appeal.outcome}` : ''}</Text>
            ) : decided ? <Pressable onPress={() => { setAppealFor(report); setReason(''); }}><Text style={styles.link}>Challenge this outcome</Text></Pressable> : null}
          </View>
        );
      })}
      {appealFor ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Challenge report outcome</Text>
          <Text style={styles.paragraph}>Explain why you think this decision should be reviewed. We allow one challenge for each decided report.</Text>
          <TextInput value={reason} onChangeText={setReason} multiline maxLength={2000} style={styles.input} placeholder="At least 10 characters" placeholderTextColor={Colors.light.textMuted} />
          <Pressable style={[styles.button, reason.trim().length < 10 && styles.disabled]} disabled={reason.trim().length < 10 || profileAppeal.isPending || conversationAppeal.isPending} onPress={submitAppeal}>
            {(profileAppeal.isPending || conversationAppeal.isPending) ? <ActivityIndicator color={Colors.light.white} /> : <Text style={styles.buttonText}>Submit challenge</Text>}
          </Pressable>
          <Pressable onPress={() => setAppealFor(null)}><Text style={styles.cancel}>Cancel</Text></Pressable>
        </View>
      ) : null}
      <Text style={styles.notice}>Reports are not an emergency service. If someone is in immediate danger, contact emergency services.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background, paddingHorizontal: 20, paddingTop: 16 },
  center: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: Colors.light.background },
  intro: { marginBottom: 12 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.light.text, marginBottom: 10 },
  paragraph: { fontSize: 14, color: Colors.light.textSecondary, lineHeight: 22, marginBottom: 12 },
  card: { backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 14, padding: 15, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.light.text, textTransform: 'capitalize', marginBottom: 8 },
  meta: { fontSize: 13, color: Colors.light.textSecondary, marginBottom: 5 },
  link: { color: Colors.light.primary, fontWeight: '700', marginTop: 8 },
  input: { minHeight: 110, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12, padding: 12, color: Colors.light.text, backgroundColor: Colors.light.background, textAlignVertical: 'top' },
  button: { backgroundColor: Colors.light.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  disabled: { opacity: 0.5 },
  buttonText: { color: Colors.light.white, fontWeight: '700' },
  cancel: { textAlign: 'center', color: Colors.light.textSecondary, padding: 14 },
  notice: { fontSize: 13, color: Colors.light.textMuted, lineHeight: 20, marginTop: 10 },
});