import React from 'react';
import { Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack } from 'expo-router';
import Colors from '@/constants/colors';
import { ReportForm } from '@/components/ReportForm';

export default function ReportCustomerScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ conversationId?: string; name?: string }>();
  const conversationId = params.conversationId ? Number(params.conversationId) : undefined;
  const hasConversation = !!conversationId && !Number.isNaN(conversationId);
  const name = typeof params.name === 'string' ? params.name : undefined;

  return (
    <>
      <Stack.Screen options={{ title: 'Report this customer' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 20,
        }}
      >
        {/* Page title comes from the shared stack header (Stack.Screen
            options above) — no duplicate inline title. */}
        <Text style={styles.paragraph}>
          If a customer has behaved inappropriately, please let us know. We review all reports and may take action on the account where appropriate.
        </Text>
        {hasConversation ? (
          <ReportForm subject="customer" conversationId={conversationId} targetName={name} />
        ) : (
          <Text style={styles.paragraph}>
            This report must be opened from a conversation with the customer.
          </Text>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  paragraph: { fontSize: 14, color: Colors.light.textSecondary, lineHeight: 22, marginBottom: 16 },
});
