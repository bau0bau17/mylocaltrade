import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';

const SUPPORT_EMAIL = 'support@mylocaltrade.co.uk';

export default function ComplaintsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: tabBarHeight + insets.bottom + 32,
        paddingHorizontal: 20,
      }}
    >
      <Text style={styles.title}>Complaints Procedure</Text>

      <View style={styles.section}>
        <Text style={styles.paragraph}>
          We take complaints seriously and aim to resolve them fairly and promptly. This procedure explains how to raise a complaint about MyLocalTrade or about a trader you contacted through our platform.
        </Text>
        <Text style={styles.paragraph}>
          MyLocalTrade is a platform connecting customers with independent local traders. Traders are not employees, agents or representatives of MyLocalTrade. Any contract for work is between you and the trader directly.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>1. Complaints about a trader</Text>
        <Text style={styles.paragraph}>
          If you have a problem with work carried out by a trader, you should first try to resolve the matter directly with them. Most issues can be resolved this way.
        </Text>
        <Text style={styles.paragraph}>
          If the issue cannot be resolved directly, you can also report the trader to us so we can review whether their listing should remain on MyLocalTrade.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>2. Complaints about MyLocalTrade</Text>
        <Text style={styles.paragraph}>
          If your complaint is about the platform itself (for example, billing, account access, or how a trader is listed), please contact us at {SUPPORT_EMAIL}.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>3. What to include</Text>
        <Text style={styles.paragraph}>
          • Your name and contact details{'\n'}
          • The trader's business name (if applicable){'\n'}
          • A clear description of what happened{'\n'}
          • Dates and any relevant documents (quotes, invoices, photos){'\n'}
          • What outcome you would like
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>4. Our response</Text>
        <Text style={styles.paragraph}>
          We aim to acknowledge your complaint within 2 working days and to provide a substantive response within 30 days. If we need longer to investigate, we will let you know.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>5. External help</Text>
        <Text style={styles.paragraph}>
          If you are not satisfied with our response, or you need independent advice, you can contact:
        </Text>
        <Text style={styles.paragraph}>
          • Citizens Advice — citizensadvice.org.uk{'\n'}
          • Your local Trading Standards office{'\n'}
          • For gas-related issues — Gas Safe Register (gassaferegister.co.uk)
        </Text>
      </View>

      <Pressable style={styles.contactBtn} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Complaint`)}>
        <Feather name="mail" size={16} color={Colors.light.primary} />
        <Text style={styles.contactBtnText}>Email {SUPPORT_EMAIL}</Text>
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
