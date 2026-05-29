import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Colors from '@/constants/colors';

export default function CookiePolicyScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: tabBarHeight + insets.bottom + 32,
        paddingHorizontal: 20,
      }}
    >
      <Text style={styles.title}>Cookie Policy</Text>

      <View style={styles.section}>
        <Text style={styles.paragraph}>
          This Cookie Policy explains how MyLocalTrade ("we", "us", "our") uses cookies and similar technologies in the MyLocalTrade application and on any related web pages.
        </Text>
        <Text style={styles.paragraph}>
          MyLocalTrade is a platform that connects customers with independent local traders.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>1. What are cookies?</Text>
        <Text style={styles.paragraph}>
          Cookies are small text files placed on your device when you use an app or visit a website. Mobile apps use similar technologies such as local storage and device identifiers. We refer to all of these collectively as "cookies" in this policy.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>2. Types of cookies we use</Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Strictly necessary:</Text> Required to keep you signed in, remember your session and operate core features such as enquiries and reviews. These cannot be switched off.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Functional:</Text> Remember small preferences inside the app, such as your recent searches and view options. Saved traders are stored on our servers against your account, not in cookies.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Analytics:</Text> Help us understand how the app is used so we can improve it. Where required, these are only used with your consent.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Payment provider:</Text> When traders subscribe, our payment provider (Stripe) may set cookies to process the transaction securely.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>3. Managing cookies</Text>
        <Text style={styles.paragraph}>
          You can clear cookies and local storage from your device settings or from your browser at any time. Disabling strictly necessary cookies may stop parts of the app from working correctly.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>4. Third parties</Text>
        <Text style={styles.paragraph}>
          We use trusted third parties to deliver email (SMTP provider), payments (Stripe) and hosting. These providers may set their own cookies under their own policies.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>5. Contact</Text>
        <Text style={styles.paragraph}>
          For any questions about this policy, contact us at support@mylocaltrade.co.uk.
        </Text>
      </View>

      <View style={styles.legalNote}>
        <Text style={styles.legalNoteText}>
          Last updated: {new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long' })}.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  title: { fontSize: 24, fontWeight: '700', color: Colors.light.text, marginBottom: 24, letterSpacing: 0.3 },
  section: { marginBottom: 24 },
  heading: { fontSize: 16, fontWeight: '600', color: Colors.light.text, marginBottom: 12 },
  paragraph: { fontSize: 14, color: Colors.light.textSecondary, lineHeight: 22, marginBottom: 10 },
  bold: { fontWeight: '700', color: Colors.light.text },
  legalNote: { padding: 14, backgroundColor: Colors.light.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.light.border },
  legalNoteText: { fontSize: 12, color: Colors.light.textMuted, lineHeight: 18 },
});
