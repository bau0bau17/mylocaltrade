import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';

export default function SafetyAdviceScreen() {
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
      <Text style={styles.title}>Customer Safety Advice</Text>

      <View style={styles.section}>
        <Text style={styles.paragraph}>
          MyLocalTrade is a platform connecting customers with independent local traders. We help you find tradespeople, but the contract for any work is between you and the trader directly.
        </Text>
        <Text style={styles.paragraph}>
          Verification helps improve trust and transparency on the platform but does not guarantee the quality of work. Customers should always make their own checks before hiring a tradesperson.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>1. Get written quotes</Text>
        <Text style={styles.paragraph}>
          Always request a written quote that clearly sets out the price, what is included, materials, timescale and payment terms. Where possible, get more than one quote so you can compare.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>2. Check qualifications and insurance</Text>
        <Text style={styles.paragraph}>
          Ask the trader to confirm their qualifications, trade body memberships and public liability insurance. Where the work is regulated, you should independently confirm the trader is on the relevant register.
        </Text>
        <Text style={styles.paragraph}>
          • <Text style={styles.bold}>Gas work:</Text> independently check the trader's Gas Safe registration at gassaferegister.co.uk before any gas work begins.{'\n'}
          • <Text style={styles.bold}>Electrical work:</Text> ask for relevant certification (for example NICEIC, NAPIT or other competent person scheme) and request the appropriate electrical safety certificate after the work.{'\n'}
          • <Text style={styles.bold}>Building work:</Text> for structural or building-control work, check whether the work needs Local Authority Building Control or a registered competent person.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>3. Be wary of red flags</Text>
        <Text style={styles.paragraph}>
          • Pressure to make quick decisions or pay upfront in full{'\n'}
          • Cash-only requests with no receipt{'\n'}
          • No written quote, contract or invoice{'\n'}
          • Reluctance to provide insurance or certification details{'\n'}
          • Significantly lower price than other quotes
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>4. Pay safely</Text>
        <Text style={styles.paragraph}>
          Avoid paying the full amount before the work has started. Stage payments linked to milestones are safer for larger jobs. Keep records of all payments and invoices.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>5. Keep records</Text>
        <Text style={styles.paragraph}>
          Keep a copy of the quote, contract, invoices, certificates and any messages with the trader. These will help if anything goes wrong.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>6. If something goes wrong</Text>
        <Text style={styles.paragraph}>
          Try to resolve the issue with the trader first. If you cannot, you can:
        </Text>
        <Text style={styles.paragraph}>
          • Report the trader to us at support@mylocaltrade.co.uk{'\n'}
          • Contact Citizens Advice (citizensadvice.org.uk){'\n'}
          • Contact your local Trading Standards office{'\n'}
          • In an emergency, call 999
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
