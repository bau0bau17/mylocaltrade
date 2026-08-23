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
        paddingTop: 16,
        paddingBottom: tabBarHeight + insets.bottom + 32,
        paddingHorizontal: 20,
      }}
    >
      
      <View style={styles.section}>
        <Text style={styles.paragraph}>
          This page is provided by Service Provider LTD, a company registered in England and Wales under company number 15830141, trading as MyLocalTrade, and explains how billing, cancellations and refunds work for trader subscriptions on the MyLocalTrade platform. Our registered office address is shown in the contact section below.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Store-Managed Subscriptions</Text>
        <Text style={styles.paragraph}>
          Premium subscriptions are purchased through the app-store platform through which you subscribe. Apple App Store purchases are billed and managed by Apple; Google Play purchases, where offered, are billed and managed by Google. The relevant store manages billing, renewals, cancellations and refunds under its own policies and terms. MyLocalTrade manages access to Premium features once the store confirms your subscription.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Cancelling Your Subscription</Text>
        <Text style={styles.paragraph}>
          You can cancel your subscription through the store platform where you purchased it. For Apple App Store purchases, use your App Store subscription settings; for Google Play purchases, use your Google Play subscriptions. Your Premium access continues until the end of the current billing period, and no further payments are taken after that. Your free Basic listing stays live.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Refunds</Text>
        <Text style={styles.paragraph}>
          Refund requests are made to and decided by the store platform that processed your purchase under that platform's own policies. For Apple App Store purchases, you can request a refund at reportaproblem.apple.com or through your App Store purchase history. For Google Play purchases, use Google Play's refund process.
        </Text>
        <Text style={styles.paragraph}>
          MyLocalTrade does not take store-subscription payments directly and cannot issue refunds for Apple App Store or Google Play purchases.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Service Disputes</Text>
        <Text style={styles.paragraph}>
          MyLocalTrade is a platform connecting customers with tradespeople. We are not responsible for issuing refunds for services provided by tradespeople to consumers. Any disputes regarding trade work, payments, or refunds for physical work must be resolved directly between the consumer and the tradesperson.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Questions About Billing</Text>
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
          onPress={() => router.push('/contact-support?subject=Billing%20Question')}
        >
          <Feather name="mail" size={16} color={Colors.light.primary} />
          <Text style={styles.contactBtnText}>Contact Us</Text>
        </Pressable>
      </View>

      <View style={styles.legalNote}>
        <Text style={styles.legalNoteText}>
          Nothing on this page affects your statutory rights. For further information about your rights, contact Citizens Advice (citizensadvice.org.uk) or your local Trading Standards office.
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
