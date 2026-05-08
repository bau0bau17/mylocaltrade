import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';

export default function CodeOfConductScreen() {
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
      <Text style={styles.title}>Trader Code of Conduct</Text>

      <View style={styles.section}>
        <Text style={styles.paragraph}>
          MyLocalTrade is a platform connecting customers with independent local traders. Traders listed on MyLocalTrade are independent businesses and are not employees, agents or representatives of MyLocalTrade.
        </Text>
        <Text style={styles.paragraph}>
          By listing a profile on MyLocalTrade, traders agree to follow this Code of Conduct. Failure to do so may result in suspension or removal from the platform.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>1. Honest information</Text>
        <Text style={styles.paragraph}>
          Provide accurate and up-to-date information about your business, services, qualifications, insurance and registrations. Do not misrepresent your experience, certifications or trade body memberships.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>2. Required certifications</Text>
        <Text style={styles.paragraph}>
          Only carry out work for which you are qualified, certified and insured. In particular:
        </Text>
        <Text style={styles.paragraph}>
          • <Text style={styles.bold}>Gas work</Text> must only be carried out by a Gas Safe registered engineer.{'\n'}
          • <Text style={styles.bold}>Electrical work</Text> must be carried out by a suitably qualified person and certified appropriately.{'\n'}
          • Other regulated work must comply with the relevant UK regulations and competent person schemes.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>3. Quotes and contracts</Text>
        <Text style={styles.paragraph}>
          Provide clear written quotes setting out price, scope, materials and timescales. Be transparent about any additional costs that may arise. Honour your quotes and contracts in line with consumer law.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>4. Quality of work</Text>
        <Text style={styles.paragraph}>
          Carry out work to a reasonable professional standard, on time, and put right any defects in line with your obligations under the Consumer Rights Act 2015 and other applicable laws.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>5. Communication and conduct</Text>
        <Text style={styles.paragraph}>
          Respond to enquiries promptly and professionally. Treat customers with respect. Do not use abusive, discriminatory or threatening language at any time.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>6. Reviews</Text>
        <Text style={styles.paragraph}>
          Do not solicit fake or misleading reviews. Reply to customer reviews respectfully. Disputes about reviews should be raised with us at support@mylocaltrade.co.uk.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>7. Insurance and documents</Text>
        <Text style={styles.paragraph}>
          Keep the documents on your MyLocalTrade profile up to date. Where required documents expire, your profile will be hidden from public search until valid documents are uploaded.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>8. Compliance and consequences</Text>
        <Text style={styles.paragraph}>
          We may suspend or remove a trader's listing where we believe this Code has been breached, where required documents are missing or expired, or where we receive credible reports of unsafe or dishonest behaviour.
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
});
