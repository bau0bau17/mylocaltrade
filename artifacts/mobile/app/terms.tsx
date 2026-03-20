import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';

export default function TermsScreen() {
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
      <Text style={styles.title}>Terms & Conditions</Text>
      
      <View style={styles.section}>
        <Text style={styles.paragraph}>
          Please read these terms and conditions carefully before using the MyLocalTrade mobile application.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>1. Acceptance of Terms</Text>
        <Text style={styles.paragraph}>
          By accessing and using this app, you accept and agree to be bound by the terms and provision of this agreement.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>2. Role of MyLocalTrade</Text>
        <Text style={styles.paragraph}>
          MyLocalTrade is a platform connecting consumers with tradespeople. We do not provide trade services ourselves, nor do we employ the tradespeople listed on the app. We are not responsible for the quality, safety, or legality of the services provided by tradespeople.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>3. User Accounts</Text>
        <Text style={styles.paragraph}>
          You must be at least 18 years of age to use this app. You are responsible for maintaining the confidentiality of your account and password and for restricting access to your device.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>4. Trader Subscriptions</Text>
        <Text style={styles.paragraph}>
          Tradespeople may subscribe to premium features. Subscriptions are billed on a recurring basis as selected during purchase. Prices are subject to change with notice.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Contact</Text>
        <View style={styles.contactCard}>
          <Text style={styles.contactText}>
            Service Provider LTD{'\n'}
            123 Business Street, London, EC1A 1BB{'\n'}
            Company No: 12345678{'\n'}
            Email: support@mylocaltrade.co.uk
          </Text>
        </View>
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
});
