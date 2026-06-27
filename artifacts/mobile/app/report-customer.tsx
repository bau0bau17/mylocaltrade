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
        <Text style={styles.title}>Report this customer</Text>
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
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 16,
    letterSpacing: 0.3,
  },
  paragraph: { fontSize: 14, color: Colors.light.textSecondary, lineHeight: 22, marginBottom: 16 },
});
