import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';

const SUPPORT_EMAIL = 'support@mylocaltrade.co.uk';

export default function ReportTraderScreen() {
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
      <Text style={styles.title}>Report a Trader</Text>

      <View style={styles.section}>
        <Text style={styles.paragraph}>
          If you have concerns about a trader listed on MyLocalTrade, please let us know. We review all reports and may suspend or remove a trader's listing where appropriate.
        </Text>
        <Text style={styles.paragraph}>
          MyLocalTrade is a platform connecting customers with independent local traders. Traders are not employees, agents or representatives of MyLocalTrade.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>When to report a trader</Text>
        <Text style={styles.paragraph}>
          • Misleading information on their profile{'\n'}
          • Suspected fraud or dishonest behaviour{'\n'}
          • Unsafe work or safety concerns{'\n'}
          • Lapsed insurance or qualifications they claim to hold{'\n'}
          • Abusive or threatening behaviour{'\n'}
          • Working in a regulated trade (e.g. gas, electrical) without the required certification
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>How to report</Text>
        <Text style={styles.paragraph}>
          Email us at {SUPPORT_EMAIL} with the following information:
        </Text>
        <Text style={styles.paragraph}>
          • The trader's business name and location{'\n'}
          • A clear description of your concern{'\n'}
          • Any supporting documents or photos{'\n'}
          • Your contact details (so we can follow up)
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Urgent safety concerns</Text>
        <Text style={styles.paragraph}>
          If you believe there is an immediate risk to safety — for example, a suspected unsafe gas installation — contact the relevant authority directly:
        </Text>
        <Text style={styles.paragraph}>
          • Gas Safe Register: 0800 408 5500 (gassaferegister.co.uk){'\n'}
          • For electrical safety concerns, contact a registered electrician and your local Trading Standards{'\n'}
          • In an emergency, call 999
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>What happens next</Text>
        <Text style={styles.paragraph}>
          We acknowledge reports within 5 working days. Where appropriate, we will investigate, contact the trader for their response, and may suspend or remove their listing while we review. We will keep you informed of the outcome where possible.
        </Text>
      </View>

      <Pressable style={styles.contactBtn} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Report a trader`)}>
        <Feather name="alert-circle" size={16} color={Colors.light.primary} />
        <Text style={styles.contactBtnText}>Report a trader by email</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  title: { fontSize: 24, fontWeight: '700', color: Colors.light.text, marginBottom: 24, letterSpacing: 0.3 },
  section: { marginBottom: 24 },
  heading: { fontSize: 16, fontWeight: '600', color: Colors.light.text, marginBottom: 12 },
  paragraph: { fontSize: 14, color: Colors.light.textSecondary, lineHeight: 22, marginBottom: 10 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.light.primaryMuted, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.light.border, marginTop: 12 },
  contactBtnText: { fontSize: 14, fontWeight: '700', color: Colors.light.primary },
});
