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
          • Phone number is verified using a one-time code sent by SMS.{'\n'}
          • Where a trader registers as a limited company, the Companies House number is checked at signup and the company must be listed as active.{'\n'}
          • Business details (main trade, description, address, services, service areas and opening hours) are completed by the trader and stored on their profile.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>2. Document checks</Text>
        <Text style={styles.paragraph}>
          The documents we ask for depend on the trader's role in the business. A sole trader is never asked for a company number, while a limited company director may be asked for company registration details.
        </Text>
        <Text style={styles.paragraph}>
          • Photo ID (required){'\n'}
          • Public liability insurance certificate (required){'\n'}
          • Proof of address (optional){'\n'}
          • Trade qualifications, such as NVQ or City &amp; Guilds (optional){'\n'}
          • Company registration, VAT registration or business address (where the business is registered){'\n'}
          • A signed authorisation letter (where someone applies on behalf of the business owner)
        </Text>
        <Text style={styles.paragraph}>
          Each document is reviewed by our team and is either approved or rejected with a reason. If we need anything else, we mark the profile as needing more information and tell the trader what to provide. The trader can then upload a replacement. Documents are tracked as pending review, approved, rejected or expired.
        </Text>
        <Text style={styles.paragraph}>
          Where a required document expires, the trader's profile is automatically hidden from public search until a valid replacement is uploaded and approved.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>3. Companies House cross-check</Text>
        <Text style={styles.paragraph}>
          When a trader who has provided a Companies House number submits their documents, we automatically cross-check the business name and registered address against the public Companies House register. The result (match, partial match, no match or not found) is shown to our review team to help decide whether to approve the profile.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>4. Subscription</Text>
        <Text style={styles.paragraph}>
          Trader profiles are visible publicly only while the trader has an active subscription. If a subscription is cancelled, becomes overdue, or fails to renew, the profile is hidden from public search until the subscription is active again.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>5. When a profile is hidden</Text>
        <Text style={styles.paragraph}>
          A trader profile may be hidden from public search for any of the following reasons:
        </Text>
        <Text style={styles.paragraph}>
          • A required document has expired or has not yet been approved{'\n'}
          • The trader's subscription is not active{'\n'}
          • The account has been suspended by our team{'\n'}
          • The trader has requested account deletion
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>6. What verification is not</Text>
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
        <Text style={styles.heading}>7. What customers should still do</Text>
        <Text style={styles.paragraph}>
          • Request written quotes before work starts{'\n'}
          • For gas work, independently check the trader's Gas Safe registration at gassaferegister.co.uk{'\n'}
          • For electrical work, ask for relevant certification and the appropriate electrical safety certificate{'\n'}
          • Confirm public liability insurance where relevant to the work{'\n'}
          • Read recent customer reviews on the trader's profile
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>8. Reporting concerns</Text>
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
