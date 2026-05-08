import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';

const CONTACT_EMAIL = 'support@mylocaltrade.co.uk';

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
          These terms and conditions ("Terms") govern your use of the MyLocalTrade mobile application ("App"), operated by Service Provider LTD ("Company", "we", "us"), a company registered in England and Wales under company number 15830141, trading as MyLocalTrade.
        </Text>
        <Text style={styles.paragraph}>
          Registered office: 71-75 Shelton Street, Covent Garden, London, WC2H 9JQ, United Kingdom.
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
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>4. Trader Subscriptions</Text>
        <Text style={styles.paragraph}>
          Tradespeople may subscribe to paid features. Subscriptions are billed on a recurring monthly basis as selected during purchase. Prices are subject to change with 30 days' notice. Your right to cancel is set out in our Refund Policy.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>5. Consumer Rights</Text>
        <Text style={styles.paragraph}>
          Nothing in these Terms affects your statutory rights under the Consumer Rights Act 2015 or the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013. You have the right to cancel a digital subscription within 14 days of purchase.
        </Text>
        <Text style={styles.paragraph}>
          If you request that we begin providing the digital service immediately during the 14-day cooling-off period, you acknowledge that your right to cancel will end once the service has been fully performed. If you cancel before the service is fully performed, you may be required to pay a proportionate amount for the service provided up to the point of cancellation.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>6. Limitation of Liability</Text>
        <Text style={styles.paragraph}>
          To the fullest extent permitted by law, we shall not be liable for any indirect, incidental, or consequential damages arising from your use of this App. Nothing in these Terms limits our liability for death or personal injury caused by our negligence, fraud, or any matter for which it would be unlawful to exclude or limit liability.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>7. Governing Law</Text>
        <Text style={styles.paragraph}>
          These Terms are governed by and construed in accordance with the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>8. Complaints & Dispute Resolution</Text>
        <Text style={styles.paragraph}>
          If you have a complaint, please contact us using the Contact Us button below. We aim to resolve all complaints within 14 working days. If we cannot resolve your complaint, you may be able to use the EU Online Dispute Resolution platform or seek advice from Citizens Advice.
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
          onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=MyLocalTrade%20Terms%20Enquiry`)}
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
});
