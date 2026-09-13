import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
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
  appealEligible?: boolean;
};

const APPEAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function appealDeadline(outcomeAt?: string | null): Date | null {
  if (!outcomeAt) return null;
  const decidedAt = new Date(outcomeAt);
  if (Number.isNaN(decidedAt.getTime())) return null;
  return new Date(decidedAt.getTime() + APPEAL_WINDOW_MS);
}

function formatUkDate(date: Date): string {
  return date.toLocaleDateString('en-GB');
}

function appealFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('only one appeal')) {
    return 'You have already submitted an appeal for this decision.';
  }
  if (message.includes('appeal period')) {
    return 'The appeal period for this decision has ended.';
  }
  if (message.includes('final decision') || message.includes('report not found')) {
    return 'This decision is not eligible for appeal.';
  }
  return 'We couldn’t submit your appeal. Please try again.';
}

export default function ReportStatusScreen() {
  const { isAuthenticated } = useAuth();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useGetMyReports({
    query: { enabled: isAuthenticated, queryKey: getGetMyReportsQueryKey() },
  });
  const isFocusedRef = useRef(false);
  const [appealFor, setAppealFor] = useState<ReportItem | null>(null);
  const [reason, setReason] = useState('');
  const [appealNotice, setAppealNotice] = useState<string | null>(null);
  const [appealError, setAppealError] = useState<string | null>(null);
  const isSubmittingAppealRef = useRef(false);
  const profileAppeal = useAppealReport();
  const conversationAppeal = useAppealConversationReport();
  const reports = ((data as unknown as { reports?: ReportItem[] } | undefined)?.reports ?? []);

  // This tab can stay mounted, and React Query's web focus integration does
  // not receive React Navigation focus events. Refresh both report outcomes
  // and appeal outcomes whenever this screen becomes visible.
  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      if (isAuthenticated) void refetch();
      return () => {
        isFocusedRef.current = false;
      };
    }, [isAuthenticated, refetch]),
  );

  // An administrator may resolve a report while the app is backgrounded. On
  // return, refresh only if this status screen is still the visible route.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isFocusedRef.current && isAuthenticated) {
        void refetch();
      }
    });
    return () => subscription.remove();
  }, [isAuthenticated, refetch]);

  const submitAppeal = () => {
    if (isSubmittingAppealRef.current) return;
    if (!appealFor || reason.trim().length < 10) {
      setAppealError('Please explain your appeal in at least 10 characters.');
      return;
    }
    const mutation = appealFor.reportType === 'conversation' ? conversationAppeal : profileAppeal;
    isSubmittingAppealRef.current = true;
    setAppealError(null);
    setAppealNotice(null);
    mutation.mutate(
      { id: appealFor.id, data: { reason: reason.trim() } },
      {
        onSuccess: async () => {
          setAppealFor(null);
          setReason('');
          setAppealNotice('Appeal submitted');
          await qc.invalidateQueries({ queryKey: getGetMyReportsQueryKey() });
          await refetch();
        },
        onError: (error: unknown) => setAppealError(appealFailureMessage(error)),
        onSettled: () => { isSubmittingAppealRef.current = false; },
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
        <Text style={styles.paragraph}>An appeal is a separate review of a decided report and does not automatically reverse the original decision. Safety handling may continue independently of an appeal.</Text>
      </View>
      {isLoading ? <ActivityIndicator color={Colors.light.primary} /> : isError ? (
        <Text style={styles.paragraph}>We couldn't load your report status. Please try again later.</Text>
      ) : reports.length === 0 ? (
        <Text style={styles.paragraph}>You have not submitted any reports.</Text>
      ) : reports.map((report) => {
        const decided = !!report.outcome;
        const deadline = appealDeadline(report.outcomeAt);
        const appealAvailable =
          report.appealEligible ??
          (decided && !!deadline && Date.now() <= deadline.getTime());
        return (
          <View key={`${report.reportType}-${report.id}`} style={styles.card}>
            <Text style={styles.cardTitle}>{report.category.replaceAll('_', ' ')}</Text>
            <Text style={styles.meta}>Status: {report.status}</Text>
            {report.outcome ? <Text style={styles.meta}>Outcome: {report.outcome}</Text> : <Text style={styles.meta}>Under review</Text>}
            {report.outcomeAt ? <Text style={styles.meta}>Decided {new Date(report.outcomeAt).toLocaleDateString('en-GB')}</Text> : null}
            {report.appeal ? (
              <Text style={styles.meta}>Appeal: {report.appeal.status}{report.appeal.outcome ? ` — ${report.appeal.outcome}` : ''}</Text>
            ) : appealAvailable && deadline ? (
              <>
                <Text style={styles.meta}>Appeal available until {formatUkDate(deadline)}</Text>
                <Pressable onPress={() => { setAppealFor(report); setReason(''); }}><Text style={styles.link}>Appeal this outcome</Text></Pressable>
              </>
            ) : decided ? <Text style={styles.meta}>Appeal period ended</Text> : null}
          </View>
        );
      })}
      {appealNotice ? (
        <Text style={styles.success} accessibilityRole="alert">{appealNotice}</Text>
      ) : null}
      {appealFor ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Challenge report outcome</Text>
           <Text style={styles.paragraph}>Explain why you think this decision should be reviewed. This is a separate review and does not automatically reverse the decision. Safety handling may continue independently of an appeal. We allow one appeal for each decided report.</Text>
          <TextInput value={reason} onChangeText={setReason} multiline maxLength={2000} style={styles.input} placeholder="At least 10 characters" placeholderTextColor={Colors.light.textMuted} />
          <Pressable style={[styles.button, (reason.trim().length < 10 || profileAppeal.isPending || conversationAppeal.isPending) && styles.disabled]} disabled={reason.trim().length < 10 || profileAppeal.isPending || conversationAppeal.isPending} onPress={submitAppeal}>
             {(profileAppeal.isPending || conversationAppeal.isPending) ? <Text style={styles.buttonText}>Submitting…</Text> : <Text style={styles.buttonText}>Submit appeal</Text>}
          </Pressable>
          {appealError ? <Text style={styles.error} accessibilityRole="alert">{appealError}</Text> : null}
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
  success: { color: Colors.light.success, fontWeight: '700', marginBottom: 12 },
  error: { color: Colors.light.error, fontSize: 13, lineHeight: 19, marginTop: 10 },
  cancel: { textAlign: 'center', color: Colors.light.textSecondary, padding: 14 },
  notice: { fontSize: 13, color: Colors.light.textMuted, lineHeight: 20, marginTop: 10 },
});