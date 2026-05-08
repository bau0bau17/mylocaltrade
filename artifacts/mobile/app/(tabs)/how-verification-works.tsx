import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';

export default function HowVerificationWorksScreen() {
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
      <Text style={styles.title}>How Verification Works</Text>

      <View style={styles.section}>
        <Text style={styles.paragraph}>
          MyLocalTrade is a platform connecting customers with independent local traders. This page explains the checks we apply to trader profiles before they appear in public search.
        </Text>
        <Text style={styles.paragraph}>
          Trader profiles may include verified information where applicable. Information such as contact details, business details, insurance or qualifications may be checked where required. Verification helps improve trust and transparency on the platform but does not guarantee the quality of work.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>1. Account checks</Text>
        <Text style={styles.paragraph}>
          • Email address is verified before a trader can complete onboarding.{'\n'}
          • Phone number is verified using a one-time code.{'\n'}
          • Business details are completed by the trader and stored on their profile.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>2. Document checks</Text>
        <Text style={styles.paragraph}>
          Traders may upload documents such as ID, public liability insurance, and trade certifications. Our team reviews submitted documents and either approves them, requests a corrected document, or rejects them with a reason.
        </Text>
        <Text style={styles.paragraph}>
          Where a required document expires, the trader's profile is automatically hidden from public search until a valid document is uploaded and approved.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>3. Subscription</Text>
        <Text style={styles.paragraph}>
          Trader profiles are visible publicly only while the trader has an active subscription. If a subscription is cancelled, becomes overdue, or fails to renew, the profile is hidden from public search.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>4. What verification is not</Text>
        <Text style={styles.paragraph}>
          Our checks focus on the information traders provide to us. Verification is not:
        </Text>
        <Text style={styles.paragraph}>
          • A guarantee of the quality of any work carried out{'\n'}
          • A criminal records (DBS) check{'\n'}
          • A replacement for independent checks customers should make themselves
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>5. What customers should still do</Text>
        <Text style={styles.paragraph}>
          • Request written quotes before work starts{'\n'}
          • For gas work, independently check the trader's Gas Safe registration at gassaferegister.co.uk{'\n'}
          • For electrical work, ask for relevant certification and the appropriate electrical safety certificate{'\n'}
          • Confirm public liability insurance where relevant to the work{'\n'}
          • Read recent customer reviews on the trader's profile
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>6. Reporting concerns</Text>
        <Text style={styles.paragraph}>
          If you believe a trader has provided false information, or you have a safety concern, please use the "Report a Trader" page or email support@mylocaltrade.co.uk.
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
});
