import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';

export default function TermsScreen() {
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
        <Text style={styles.lastUpdated}>Last Updated: 11 July 2026</Text>
        <Text style={styles.paragraph}>
          These terms and conditions ("Terms") govern your use of the MyLocalTrade mobile application ("App"), operated by Service Provider LTD ("Company", "we", "us"), a company registered in England and Wales under company number 15830141, trading as MyLocalTrade.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>1. Acceptance of Terms</Text>
        <Text style={styles.paragraph}>
          By accessing and using this App, you accept and agree to be bound by these Terms. If you do not agree to these Terms, you must not use the App.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>2. Role of MyLocalTrade</Text>
        <Text style={styles.paragraph}>
          MyLocalTrade is a platform connecting consumers with tradespeople. We do not provide trade services ourselves, nor do we employ the tradespeople listed on the App. We are not responsible for the quality, safety, or legality of the services provided by tradespeople. All contracts for work are formed directly between you and the tradesperson.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>3. User Accounts</Text>
        <Text style={styles.paragraph}>
          You must be at least 18 years of age to use this App. You are responsible for maintaining the confidentiality of your account and password, and for restricting access to your device. You accept responsibility for all activities that occur under your account.
        </Text>
        <Text style={styles.paragraph}>
          When you register, log in, verify your phone number or request account access, you may receive one-time verification or security messages from MyLocalTrade. These messages are sent only when you request them and are used solely for account access, verification and security — not for marketing or promotional purposes. Delivery methods are described in the Phone Verification section below.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>4. Account and Profile Information</Text>
        <Text style={styles.paragraph}>
          Customers and traders must provide accurate, current and truthful account and profile information.
        </Text>
        <Text style={styles.paragraph}>
          Traders must not misrepresent their identity, business, services, qualifications, verification status or contact details. Customers must not impersonate another person or submit misleading identity or contact information.
        </Text>
        <Text style={styles.paragraph}>
          MyLocalTrade may require verification or additional evidence before accepting or applying protected profile changes.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>5. Changes to Protected Profile Details</Text>
        <Text style={styles.paragraph}>
          Before initial submission, users may edit eligible account or profile information directly.
        </Text>
        <Text style={styles.paragraph}>
          After relevant information has been submitted, changes to protected identity, contact or trader-profile details may require review and approval by MyLocalTrade before they take effect.
        </Text>
        <Text style={styles.paragraph}>
          The current approved information will remain active while a proposed change is reviewed. Proposed changes will not appear publicly or replace approved information unless they are approved.
        </Text>
        <Text style={styles.paragraph}>
          MyLocalTrade may approve a request, reject it or request additional information. Reviews can take up to 48 hours. Users must not attempt to bypass the review process or provide false or misleading information.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>6. Phone Verification</Text>
        <Text style={styles.paragraph}>
          Where phone verification is required, the user must enter a mobile number that they are authorised to use and actively request a one-time verification code.
        </Text>
        <Text style={styles.paragraph}>
          Trader verification codes may be delivered by SMS or RCS through the configured verification service. Customer phone-change verification codes are delivered by SMS.
        </Text>
        <Text style={styles.paragraph}>
          Completing verification confirms access to the proposed phone number but does not automatically guarantee approval of a profile change. A proposed replacement number may remain pending until reviewed by MyLocalTrade.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>7. Communication and Contact Details</Text>
        <Text style={styles.paragraph}>
          Before a quote is accepted or a trader is hired, customers and traders should communicate through MyLocalTrade.
        </Text>
        <Text style={styles.paragraph}>
          Direct contact details are not made available through the normal enquiry flow before hire. Users must not attempt to bypass platform safeguards by sharing or requesting phone numbers, email addresses, external messaging handles or direct contact links before hire.
        </Text>
        <Text style={styles.paragraph}>
          After a customer accepts a quote or hires a trader, verified contact details may be made available to that customer and the hired trader for job coordination.
        </Text>
        <Text style={styles.paragraph}>
          Users should continue recording important agreements, scope changes and job details in the MyLocalTrade conversation where possible.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>8. Structured Quotes</Text>
        <Text style={styles.paragraph}>
          A trader may send a structured quote through a customer conversation. A quote may include a fixed price or an estimate, a description of the proposed work, notes and a validity date.
        </Text>
        <Text style={styles.paragraph}>
          An estimate may change where the actual condition, scope or requirements of the work differ from the information originally provided. Traders must clearly explain material changes to the customer.
        </Text>
        <Text style={styles.paragraph}>
          A customer may accept or decline a valid quote. A quote that has expired, been withdrawn or been declined cannot be accepted.
        </Text>
        <Text style={styles.paragraph}>
          When a customer accepts a quote, MyLocalTrade may record the trader as hired and create or associate the relevant job record and job reference.
        </Text>
        <Text style={styles.paragraph}>
          Accepted quotes and their version history may be retained as an audit record. Neither party should attempt to alter or misrepresent an accepted quote outside the supported revision process.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>9. Agreement and Payment Between Customer and Trader</Text>
        <Text style={styles.paragraph}>
          Acceptance of a quote creates an agreement concerning the proposed work between the customer and trader. MyLocalTrade is not the provider of the trade service and does not become a party responsible for performing the work.
        </Text>
        <Text style={styles.paragraph}>
          MyLocalTrade does not process payment for the actual work. The customer and trader are responsible for agreeing the payment method, timing and any appropriate invoice or receipt separately.
        </Text>
        <Text style={styles.paragraph}>
          MyLocalTrade does not guarantee the quality, completion or payment of work, subject to any responsibilities that cannot lawfully be excluded.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>10. Trader Subscriptions</Text>
        <Text style={styles.paragraph}>
          Basic listings are free. Tradespeople may upgrade to Premium for additional features, billed either monthly or yearly through the Apple App Store, and renewing automatically until cancelled. Subscriptions are billed and managed by Apple: you can cancel at any time in your App Store subscription settings, and access continues until the end of the current billing period. Prices are subject to change with 30 days' notice. Cancellations and refunds are set out on our Subscription &amp; Billing page.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>11. Consumer Rights</Text>
        <Text style={styles.paragraph}>
          Nothing in these Terms affects your statutory rights under the Consumer Rights Act 2015.
        </Text>
        <Text style={styles.paragraph}>
          Premium subscriptions are purchased through the Apple App Store and are billed, renewed, cancelled and refunded by Apple in accordance with Apple's own policies. Details are set out on our Subscription &amp; Billing page.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>12. Limitation of Liability</Text>
        <Text style={styles.paragraph}>
          To the fullest extent permitted by law, we shall not be liable for any indirect, incidental, or consequential damages arising from your use of this App. Nothing in these Terms limits our liability for death or personal injury caused by our negligence, fraud, or any matter for which it would be unlawful to exclude or limit liability.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>13. Governing Law</Text>
        <Text style={styles.paragraph}>
          These Terms are governed by and construed in accordance with the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>14. Complaints & Dispute Resolution</Text>
        <Text style={styles.paragraph}>
          If you have a complaint, please contact us using the Contact Us button below. We aim to acknowledge complaints within 2 working days and to provide a substantive response within 30 days. If we cannot resolve your complaint, you may seek independent advice from Citizens Advice (citizensadvice.org.uk) or your local Trading Standards office.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Contact</Text>
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
          onPress={() => router.push('/contact-support?subject=Terms%20%26%20Conditions%20Enquiry')}
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
