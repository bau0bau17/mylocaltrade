import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';

export default function PrivacyScreen() {
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
          This Privacy Policy explains how Service Provider LTD (company registered in England and Wales under company number 15830141), trading as MyLocalTrade ("we", "us", "our"), collects, uses, discloses, and safeguards your personal data when you use our mobile application. Our registered office address is shown in the contact section below.
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
          Trader Data: If you register as a tradesperson, we collect business details and verification documents. We do not collect or store your payment card details. Subscriptions purchased through the MyLocalTrade iOS app are processed by Apple through the App Store, with subscription status managed through RevenueCat. If additional payment methods are introduced in the future, the relevant payment provider and terms will be disclosed before payment.
        </Text>
        <Text style={styles.paragraph}>
          Technical Data: We automatically collect certain information about your device, including IP address, device type, operating system, and usage patterns.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>2. Profile Information and Change Requests</Text>
        <Text style={styles.paragraph}>
          Customers and traders provide identity, contact and profile information when creating and using a MyLocalTrade account. Traders may also provide business information, service details, verification information and documents as part of trader onboarding and verification.
        </Text>
        <Text style={styles.paragraph}>
          Before initial submission, users may be able to edit their profile information directly. After relevant account or trader-profile information has been submitted, changes to certain protected details may require review and approval by MyLocalTrade before they take effect.
        </Text>
        <Text style={styles.paragraph}>
          Protected information may include a customer's personal name and phone number, and a trader's business or company name, contact name, phone number, website and business description.
        </Text>
        <Text style={styles.paragraph}>
          When a protected change is requested, we retain the current approved information while storing the proposed information separately for review. Pending information is not displayed publicly or applied to the account until it has been approved. We may approve the request, reject it or request additional information. Reviews can take up to 48 hours.
        </Text>
        <Text style={styles.paragraph}>
          We keep records of profile-change requests, previous and proposed values, review decisions, reasons and timestamps for security, fraud prevention, account integrity, dispute handling and audit purposes.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>3. Phone-Number Verification</Text>
        <Text style={styles.paragraph}>
          We use one-time verification codes to confirm ownership of a mobile phone number and support account access, trader verification, security and trust.
        </Text>
        <Text style={styles.paragraph}>
          For the trader-verification flow, a trader actively requests a verification code after reviewing the relevant consent notice. The code may be delivered by SMS or RCS through our messaging provider, Twilio, depending on service availability and the approved messaging configuration. Customer phone-change verification codes are delivered by SMS.
        </Text>
        <Text style={styles.paragraph}>
          A proposed replacement phone number must be successfully verified before it can be submitted for administrative review. Verifying a proposed number does not immediately replace the currently approved phone number. The current approved number remains active until the proposed change is approved.
        </Text>
        <Text style={styles.paragraph}>
          Verification messages are not used for marketing, advertising, promotions, discounts or bulk messaging. Message and data rates may apply. We do not sell personal information or share messaging opt-in data or consent with third parties for marketing purposes.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>4. Legal Basis for Processing</Text>
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
        <Text style={styles.heading}>5. How We Use Your Information</Text>
        <Text style={styles.paragraph}>
          - To facilitate connections between customers and tradespeople{'\n'}
          - To manage your account and subscriptions{'\n'}
          - To process subscription payments — on iOS through the Apple App Store, with subscription status managed by RevenueCat{'\n'}
          - To improve our services and app functionality{'\n'}
          - To send service-related communications{'\n'}
          - To comply with legal and regulatory requirements
        </Text>
        <Text style={styles.paragraph}>
          We may send one-time verification codes, security alerts and service-related account messages by SMS or email. RCS may be used for trader phone verification only, as described in the Phone-Number Verification section above. These messages are used for account access, registration, login and security purposes. We do not use these verification messages for marketing or promotional purposes. We do not sell personal information or share messaging opt-in data or consent with third parties for marketing purposes.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>6. Contact Details and Communication Between Users</Text>
        <Text style={styles.paragraph}>
          Before a customer accepts a structured quote or hires a trader, direct contact details such as phone numbers and email addresses are not disclosed between the customer and trader. Customers and traders should use MyLocalTrade messaging to discuss the enquiry, exchange relevant photos and receive or send quotes.
        </Text>
        <Text style={styles.paragraph}>
          When a customer accepts a quote or hires a trader, verified contact details may be made available to that customer and the hired trader for the purpose of coordinating the work.
        </Text>
        <Text style={styles.paragraph}>
          Contact details are not disclosed through this process to unrelated traders or to traders whose quotes were not accepted.
        </Text>
        <Text style={styles.paragraph}>
          Messages, quote records and job-related activity may be retained for account security, dispute handling, fraud prevention, moderation and to maintain an accurate record of the transaction journey.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>7. Quotes and Job Records</Text>
        <Text style={styles.paragraph}>
          When a trader sends a structured quote, we process information including the proposed price, whether the price is fixed or estimated, the description of work, notes, validity period, quote status and relevant timestamps.
        </Text>
        <Text style={styles.paragraph}>
          We process quote acceptance, decline, withdrawal, revision and expiry information to provide Compare Offers, maintain job history, determine when a trader has been hired and support reviews, moderation and dispute handling.
        </Text>
        <Text style={styles.paragraph}>
          Accepted quotes and their history may be retained as part of the job record and audit history.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>8. Payment for Trade Work</Text>
        <Text style={styles.paragraph}>
          MyLocalTrade does not process payments from customers to traders for the work described in an enquiry or quote. After a trader is hired, the customer and trader arrange payment for the actual work separately.
        </Text>
        <Text style={styles.paragraph}>
          Subscriptions purchased in the MyLocalTrade iOS app are separate from customer-to-trader job payments and are processed by Apple through the App Store, with subscription status managed through RevenueCat. MyLocalTrade does not collect or store Apple payment-card details.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>9. Data Sharing</Text>
        <Text style={styles.paragraph}>
          We may share your data with the providers that operate our service: Apple (App Store) and RevenueCat, which process and manage trader subscriptions purchased on iOS; our email provider (Brevo); and our hosting provider. We do not sell your personal data to third parties. When you send an enquiry to a trader, the trader receives your name, the service required, your preferred date and your message so they can respond to your request. If you choose to provide a phone number with your enquiry, it is stored securely but is not shown to the trader before hire — your phone number and email address only become available to a trader after you accept their quote or hire them, as described in the Contact Details and Communication Between Users section above. Replies come back through the in-app messaging system.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>10. Data Retention</Text>
        <Text style={styles.paragraph}>
          We retain your personal data for as long as your account is active or as needed to provide services. We will retain and use your data as necessary to comply with legal obligations, resolve disputes, and enforce our agreements. You may request deletion of your account and data at any time from inside the app. When you do, your account is immediately disabled and your trader profile (if any) is hidden from public search. There is then a short retention period during which you can cancel the request from the app, after which your personal data is anonymised and removed in line with our retention obligations.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>11. Your Rights</Text>
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
        <Text style={styles.heading}>12. International Data Transfers</Text>
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
        <Text style={styles.heading}>13. Data Security</Text>
        <Text style={styles.paragraph}>
          We use administrative, technical, and physical security measures to help protect your personal information, including encryption of data in transit and at rest. While we have taken reasonable steps to secure the personal information you provide to us, no security measures are perfect or impenetrable.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>14. Contact the Data Controller</Text>
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
          onPress={() => router.push('/contact-support?subject=Data%20Rights%20Request')}
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
