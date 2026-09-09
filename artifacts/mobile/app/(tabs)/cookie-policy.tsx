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
        paddingTop: 16,
        paddingBottom: tabBarHeight + insets.bottom + 32,
        paddingHorizontal: 20,
      }}
    >

      <View style={styles.section}>
        <Text style={styles.paragraph}>
          This Cookie Policy explains how MyLocalTrade ("we", "us", "our") uses cookies and device storage in the MyLocalTrade application, public website and admin dashboard.
        </Text>
        <Text style={styles.paragraph}>
          MyLocalTrade is a platform that connects customers with independent local traders.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>1. Cookies and storage</Text>
        <Text style={styles.paragraph}>
          Cookies are small text files placed on a browser device. Mobile apps use device storage instead; this policy distinguishes the two rather than treating all storage as cookies.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>2. Public website and admin dashboard</Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Public website:</Text> The public landing site currently uses no non-essential analytics or marketing cookies and no consent banner is required for this current behavior. It may receive a first-party GAESA cookie from Google hosting infrastructure; its observed purpose is routing, session affinity and load balancing. MyLocalTrade does not use GAESA for analytics, advertising, profiling or marketing. The observed cookie had an approximately 30-day expiry, and hosting behavior may change.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Admin dashboard:</Text> The functional <Text style={styles.bold}>sidebar_state</Text> cookie remembers the sidebar for 7 days. Functional <Text style={styles.bold}>admin-theme</Text> storage remembers the theme, and necessary <Text style={styles.bold}>mlt_admin_token</Text> storage keeps an administrator authenticated. These are first-party browser storage items.
        </Text>
        <Text style={styles.paragraph}>
          The public site and admin dashboard currently use no non-essential analytics or marketing tracking.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>3. Native app device storage</Text>
        <Text style={styles.paragraph}>
          The native app uses AsyncStorage on your device for session and authentication data, preferences, recent searches and cached location data (with its existing expiry). Operational/functional AsyncStorage also includes a push notification token: registration starts after session restoration or login, and the token is stored only after notification permission is granted. For each booking, a functional prompt marker may be stored when a confirmed booking is viewed, and an event marker may be stored after you authorize adding it to your calendar. These are not analytics or advertising. The app currently uses no analytics or marketing tracking.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>4. Managing cookies and storage</Text>
        <Text style={styles.paragraph}>
          You can clear browser cookies and storage through browser settings, or app storage through your device settings. Clearing necessary authentication storage may sign you out; clearing functional storage may reset preferences.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>5. Future changes</Text>
        <Text style={styles.paragraph}>
          Any future non-essential tracking would require a policy and consent review before activation. We would update this policy before introducing it.
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
