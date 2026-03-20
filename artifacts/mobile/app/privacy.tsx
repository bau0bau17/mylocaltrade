import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';

export default function PrivacyScreen() {
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
      <Text style={styles.title}>Privacy Policy</Text>
      
      <View style={styles.section}>
        <Text style={styles.lastUpdated}>Last Updated: October 2023</Text>
        <Text style={styles.paragraph}>
          At MyLocalTrade, we take your privacy seriously. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our mobile application.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>1. Information We Collect</Text>
        <Text style={styles.paragraph}>
          Personal Data: We may collect personally identifiable information, such as your name, email address, telephone number, and location when you register for an account.
        </Text>
        <Text style={styles.paragraph}>
          Trader Data: If you register as a tradesperson, we collect business details, verification documents, and payment information for subscriptions.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>2. How We Use Your Information</Text>
        <Text style={styles.paragraph}>
          - To facilitate connections between customers and tradespeople
        </Text>
        <Text style={styles.paragraph}>
          - To manage your account and subscriptions
        </Text>
        <Text style={styles.paragraph}>
          - To improve our services and app functionality
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>3. Data Security</Text>
        <Text style={styles.paragraph}>
          We use administrative, technical, and physical security measures to help protect your personal information. While we have taken reasonable steps to secure the personal information you provide to us, please be aware that no security measures are perfect or impenetrable.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Contact Us</Text>
        <Text style={styles.paragraph}>
          If you have questions about this Privacy Policy, please contact us:
        </Text>
        <Text style={styles.paragraph}>
          Service Provider LTD{'\n'}
          123 Business Street, London, EC1A 1BB{'\n'}
          Company No: 12345678{'\n'}
          Email: support@mylocaltrade.co.uk
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
    marginBottom: 8,
  },
  lastUpdated: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    fontStyle: 'italic',
    marginBottom: 16,
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