import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';

export default function RefundScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 20,
      }}
    >
      <Text style={styles.title}>Refund Policy</Text>
      
      <View style={styles.section}>
        <Text style={styles.paragraph}>
          This policy outlines the terms regarding refunds and cancellations for trader subscriptions on the MyLocalTrade platform.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Subscription Cancellations</Text>
        <Text style={styles.paragraph}>
          You can cancel your premium or elite subscription at any time. When you cancel, you will continue to have access to the subscription features until the end of your current billing period. We do not provide prorated refunds for mid-cycle cancellations.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Refunds</Text>
        <Text style={styles.paragraph}>
          Subscription fees are non-refundable except where required by UK law. If you believe you have been charged in error or have a statutory right to a refund under the Consumer Rights Act 2015, please contact our support team.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Service Disputes</Text>
        <Text style={styles.paragraph}>
          MyLocalTrade is not responsible for issuing refunds for services provided by tradespeople to consumers. Any disputes regarding trade work, payments, or refunds for physical work must be resolved directly between the consumer and the tradesperson.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 12,
  },
  paragraph: {
    fontSize: 15,
    color: Colors.light.textSecondary,
    lineHeight: 24,
    marginBottom: 12,
  },
});