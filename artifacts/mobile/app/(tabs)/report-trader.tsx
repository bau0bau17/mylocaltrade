import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { ReportForm } from '@/components/ReportForm';

const SUPPORT_EMAIL = 'support@mylocaltrade.co.uk';

export default function ReportTraderScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const params = useLocalSearchParams<{ traderId?: string; name?: string }>();
  const traderProfileId = params.traderId ? Number(params.traderId) : undefined;
  const traderName = typeof params.name === 'string' ? params.name : undefined;
  const hasTarget = !!traderProfileId && !Number.isNaN(traderProfileId);

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
          If you have concerns about a trader listed on MyLocalTrade, please let us know. We review all reports and may suspend or remove a trader's listing where appropriate.
        </Text>
        <Text style={styles.paragraph}>
          MyLocalTrade is a platform connecting customers with independent local traders. Traders are not employees, agents or representatives of MyLocalTrade.
        </Text>
      </View>

      {hasTarget ? (
        <View style={styles.formCard}>
          <Text style={styles.heading}>Submit a report</Text>
          <ReportForm subject="trader" traderProfileId={traderProfileId} targetName={traderName} />
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.heading}>How to report in the app</Text>
          <Text style={styles.paragraph}>
            Open the trader's profile and tap "Report this trader" to send us a structured report. You will need to be signed in.
          </Text>
        </View>
      )}

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
          We aim to acknowledge reports within 2 working days. Where appropriate, we will investigate, contact the trader for their response, and may suspend or remove their listing while we review. We will keep you informed of the outcome where possible.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Prefer to email?</Text>
        <Text style={styles.paragraph}>
          You can also email us at {SUPPORT_EMAIL} with the trader's business name and location, a clear description of your concern, any supporting documents or photos, and your contact details.
        </Text>
      </View>

      <Pressable
        style={styles.contactBtn}
        onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Report a trader`)}
      >
        <Feather name="mail" size={16} color={Colors.light.primary} />
        <Text style={styles.contactBtnText}>Report a trader by email</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  title: { fontSize: 24, fontWeight: '700', color: Colors.light.text, marginBottom: 24, letterSpacing: 0.3 },
  section: { marginBottom: 24 },
  formCard: {
    marginBottom: 24,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  heading: { fontSize: 16, fontWeight: '600', color: Colors.light.text, marginBottom: 12 },
  paragraph: { fontSize: 14, color: Colors.light.textSecondary, lineHeight: 22, marginBottom: 10 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.light.primaryMuted, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.light.border, marginTop: 12 },
  contactBtnText: { fontSize: 14, fontWeight: '700', color: Colors.light.primary },
});
