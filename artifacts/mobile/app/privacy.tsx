import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';

const CONTACT_EMAIL = 'lucian.dpd@gmail.com';

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
        <Text style={styles.lastUpdated}>Last Updated: March 2026</Text>
        <Text style={styles.paragraph}>
          This Privacy Policy explains how Service Provider LTD (trading as "MyLocalTrade"), a company registered in England and Wales (Company No. 15830141, registered office: 71-75 Shelton Street, Covent Garden, London, WC2H 9JQ), collects, uses, discloses, and safeguards your personal data when you use our mobile application.
        </Text>
        <Text style={styles.paragraph}>
          We are the data controller for the purposes of the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018.
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
        <Text style={styles.paragraph}>
          Technical Data: We automatically collect certain information about your device, including IP address, device type, operating system, and usage patterns.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>2. Legal Basis for Processing</Text>
        <Text style={styles.paragraph}>
          We process your personal data on the following legal bases under UK GDPR:
        </Text>
        <Text style={styles.paragraph}>
          - Contract performance: to provide our service and manage your account{'\n'}
          - Legitimate interests: to improve our services and prevent fraud{'\n'}
          - Consent: for marketing communications (which you may withdraw at any time){'\n'}
          - Legal obligation: to comply with applicable laws and regulations
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>3. How We Use Your Information</Text>
        <Text style={styles.paragraph}>
          - To facilitate connections between customers and tradespeople{'\n'}
          - To manage your account and subscriptions{'\n'}
          - To process payments via our payment processor (Stripe){'\n'}
          - To improve our services and app functionality{'\n'}
          - To send service-related communications{'\n'}
          - To comply with legal and regulatory requirements
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>4. Data Sharing</Text>
        <Text style={styles.paragraph}>
          We may share your data with: payment processors (Stripe), hosting providers, and analytics services. We do not sell your personal data to third parties. When you send an enquiry to a trader, your contact details are shared with that trader to facilitate the service.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>5. Data Retention</Text>
        <Text style={styles.paragraph}>
          We retain your personal data for as long as your account is active or as needed to provide services. We will retain and use your data as necessary to comply with legal obligations, resolve disputes, and enforce our agreements. You may request deletion of your account and data at any time.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>6. Your Rights</Text>
        <Text style={styles.paragraph}>
          Under UK GDPR, you have the right to:{'\n'}
          - Access your personal data{'\n'}
          - Rectify inaccurate data{'\n'}
          - Request erasure of your data{'\n'}
          - Restrict or object to processing{'\n'}
          - Data portability{'\n'}
          - Withdraw consent at any time{'\n'}
          - Lodge a complaint with the Information Commissioner's Office (ICO)
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>7. International Data Transfers</Text>
        <Text style={styles.paragraph}>
          Some of our service providers (including payment processors and hosting providers) may process your data outside the United Kingdom. Where we transfer personal data outside the UK, we ensure appropriate safeguards are in place, including:{'\n'}
          - UK Standard Contractual Clauses (SCCs) approved by the Secretary of State{'\n'}
          - Adequacy decisions where the destination country provides an adequate level of data protection{'\n'}
          - Binding corporate rules of the receiving organisation
        </Text>
        <Text style={styles.paragraph}>
          You may request further details about the safeguards we apply to international transfers by using the Contact Us button below.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>8. Data Security</Text>
        <Text style={styles.paragraph}>
          We use administrative, technical, and physical security measures to help protect your personal information, including encryption of data in transit and at rest. While we have taken reasonable steps to secure the personal information you provide to us, no security measures are perfect or impenetrable.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>9. Contact the Data Controller</Text>
        <Text style={styles.paragraph}>
          If you have questions about this Privacy Policy or wish to exercise your data rights, please contact us:
        </Text>
        <View style={styles.contactCard}>
          <Text style={styles.contactText}>
            Data Controller: Service Provider LTD{'\n'}
            Registered in England and Wales{'\n'}
            Company No: 15830141{'\n'}
            71-75 Shelton Street, Covent Garden, London, WC2H 9JQ{'\n\n'}
            Supervisory Authority:{'\n'}
            Information Commissioner's Office (ICO){'\n'}
            ICO Registration Ref: ZB724124{'\n'}
            Registered: 22.07.2024 — Valid until: 21.07.2026{'\n'}
            ico.org.uk
          </Text>
        </View>
        <Pressable
          style={styles.contactBtn}
          onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=MyLocalTrade%20Data%20Rights%20Request`)}
        >
          <Feather name="mail" size={16} color={Colors.light.primary} />
          <Text style={styles.contactBtnText}>Contact Us</Text>
        </Pressable>
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
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  lastUpdated: {
    fontSize: 12,
    color: Colors.light.textMuted,
    fontStyle: 'italic',
    marginBottom: 16,
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
});
