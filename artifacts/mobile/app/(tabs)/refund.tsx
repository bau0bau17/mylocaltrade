import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';

export default function RefundScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: tabBarHeight + insets.bottom + 32,
        paddingHorizontal: 20,
      }}
    >
      <Text style={styles.title}>Refund & Cancellation Policy</Text>
      
      <View style={styles.section}>
        <Text style={styles.paragraph}>
          This policy is issued by Service Provider LTD, a company registered in England and Wales under company number 15830141, trading as MyLocalTrade (registered office: 71-75 Shelton Street, Covent Garden, London, WC2H 9JQ), and outlines the terms regarding refunds and cancellations for trader subscriptions on the MyLocalTrade platform.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Your Right to Cancel</Text>
        <Text style={styles.paragraph}>
          Under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013, you have the right to cancel your subscription within 14 days of purchase without giving any reason. This 14-day cooling-off period begins from the day after you subscribe.
        </Text>
        <Text style={styles.paragraph}>
          To exercise your right to cancel, you must inform us of your decision by a clear statement (e.g. via the Contact Us button below or letter to our registered address). You may use the following wording: "I hereby give notice that I cancel my subscription to MyLocalTrade."
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Digital Services During Cooling-Off Period</Text>
        <Text style={styles.paragraph}>
          If you wish to begin using the subscription services immediately (before the 14-day cooling-off period ends), you must give your express consent and acknowledge that you will lose your right to cancel once the digital service has been fully performed. If you cancel before the service is fully performed, you may be required to pay a proportionate amount for the service provided up to the point of cancellation.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Subscription Cancellations</Text>
        <Text style={styles.paragraph}>
          You can cancel your subscription at any time through the App or by contacting us. When you cancel after the 14-day cooling-off period, you will continue to have access to the subscription features until the end of your current billing period. No further payments will be taken.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Refunds</Text>
        <Text style={styles.paragraph}>
          If you cancel within the 14-day cooling-off period, we will reimburse all payments received from you, without undue delay and no later than 14 days from the day we are informed of your decision to cancel.
        </Text>
        <Text style={styles.paragraph}>
          Refunds after the 14-day cooling-off period are provided at our discretion, except where required by the Consumer Rights Act 2015 (for example, if the service was not as described or not fit for purpose).
        </Text>
        <Text style={styles.paragraph}>
          Refunds will be made using the same method of payment used for the original transaction.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Service Disputes</Text>
        <Text style={styles.paragraph}>
          MyLocalTrade is a platform connecting customers with tradespeople. We are not responsible for issuing refunds for services provided by tradespeople to consumers. Any disputes regarding trade work, payments, or refunds for physical work must be resolved directly between the consumer and the tradesperson.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>How to Request a Refund</Text>
        <View style={styles.contactCard}>
          <Text style={styles.contactText}>
            Service Provider LTD{'\n'}
            Registered in England and Wales{'\n'}
            Company No: 15830141{'\n'}
            71-75 Shelton Street, Covent Garden, London, WC2H 9JQ
          </Text>
        </View>
        <Pressable
          style={styles.contactBtn}
          onPress={() => router.push('/contact-support?subject=Refund%20Request')}
        >
          <Feather name="mail" size={16} color={Colors.light.primary} />
          <Text style={styles.contactBtnText}>Contact Us</Text>
        </Pressable>
      </View>

      <View style={styles.legalNote}>
        <Text style={styles.legalNoteText}>
          This policy does not affect your statutory rights. For further information about your rights, contact Citizens Advice (citizensadvice.org.uk) or your local Trading Standards office.
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
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 24,
    letterSpacing: 0.3,
  },
  section: {
    marginBottom: 24,
  },
  heading: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 12,
  },
  paragraph: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    lineHeight: 22,
    marginBottom: 10,
  },
  contactCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  contactText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    lineHeight: 22,
  },
  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.light.primaryMuted,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginTop: 12,
  },
  contactBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  legalNote: {
    padding: 14,
    backgroundColor: Colors.light.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  legalNoteText: {
    fontSize: 12,
    color: Colors.light.textMuted,
    lineHeight: 18,
  },
});
