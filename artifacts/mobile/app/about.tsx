import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';

const CONTACT_EMAIL = 'support@mylocaltrade.co.uk';

export default function AboutScreen() {
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
      <View style={styles.headerSection}>
        <View style={styles.logoWrap}>
          <Feather name="briefcase" size={28} color={Colors.light.primary} />
        </View>
        <Text style={styles.title}>About MyLocalTrade</Text>
      </View>
      
      <View style={styles.section}>
        <Text style={styles.paragraph}>
          MyLocalTrade connects customers with independent local tradespeople across the UK.
        </Text>
        <Text style={styles.paragraph}>
          Our goal is to make it easier for homeowners to discover, contact and review tradespeople in their area. Traders listed on MyLocalTrade are independent businesses and are not employees, agents or representatives of MyLocalTrade.
        </Text>
        <Text style={styles.paragraph}>
          Customers should always make their own checks before hiring a tradesperson, including requesting written quotes and confirming any qualifications, insurance or registrations relevant to the work.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Our Approach</Text>
        <View style={styles.promiseCard}>
          <View style={styles.promiseItem}>
            <View style={[styles.promiseIcon, { backgroundColor: Colors.light.secondaryMuted }]}>
              <Feather name="check-circle" size={16} color={Colors.light.secondary} />
            </View>
            <View style={styles.promiseContent}>
              <Text style={styles.promiseTitle}>Information Checks</Text>
              <Text style={styles.promiseDesc}>Trader profiles may include verified information where applicable. Details such as contact information, business details, insurance or qualifications may be checked where required.</Text>
            </View>
          </View>
          <View style={styles.promiseItem}>
            <View style={[styles.promiseIcon, { backgroundColor: Colors.light.featuredMuted }]}>
              <Feather name="star" size={16} color={Colors.light.featured} />
            </View>
            <View style={styles.promiseContent}>
              <Text style={styles.promiseTitle}>Customer Reviews</Text>
              <Text style={styles.promiseDesc}>Reviews come from people who have used the platform to enquire. Reviews reflect individual experiences, not a guarantee of quality.</Text>
            </View>
          </View>
          <View style={styles.promiseItem}>
            <View style={[styles.promiseIcon, { backgroundColor: Colors.light.primaryMuted }]}>
              <Feather name="map-pin" size={16} color={Colors.light.primary} />
            </View>
            <View style={styles.promiseContent}>
              <Text style={styles.promiseTitle}>Local Focus</Text>
              <Text style={styles.promiseDesc}>We help customers find tradespeople operating in their local area.</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.companyInfo}>
        <Text style={styles.companyHeading}>Company Information</Text>

        <View style={styles.infoRow}>
          <Feather name="briefcase" size={14} color={Colors.light.textMuted} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Trading Name</Text>
            <Text style={styles.infoText}>MyLocalTrade</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Feather name="shield" size={14} color={Colors.light.textMuted} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Legal Entity</Text>
            <Text style={styles.infoText}>Service Provider LTD</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Feather name="hash" size={14} color={Colors.light.textMuted} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Company Number</Text>
            <Text style={styles.infoText}>15830141</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Feather name="globe" size={14} color={Colors.light.textMuted} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Place of Registration</Text>
            <Text style={styles.infoText}>England and Wales</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Feather name="map-pin" size={14} color={Colors.light.textMuted} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Registered Office</Text>
            <Text style={styles.infoText}>71-75 Shelton Street, Covent Garden, London, WC2H 9JQ, United Kingdom</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Feather name="mail" size={14} color={Colors.light.textMuted} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Contact Email</Text>
            <Text style={styles.infoText}>{CONTACT_EMAIL}</Text>
          </View>
        </View>

        <View style={styles.infoDivider} />

        <Pressable
          style={styles.contactBtn}
          onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=MyLocalTrade%20Enquiry`)}
        >
          <Feather name="mail" size={16} color={Colors.light.primary} />
          <Text style={styles.contactBtnText}>Contact Us</Text>
        </Pressable>
      </View>

      <View style={styles.legalNote}>
        <Feather name="info" size={14} color={Colors.light.textMuted} />
        <Text style={styles.legalNoteText}>
          This app is operated by Service Provider LTD (Company No. 15830141), a company registered in England and Wales, trading as MyLocalTrade. Registered office: 71-75 Shelton Street, Covent Garden, London, WC2H 9JQ. By using this app you agree to our Terms & Conditions and Privacy Policy. For any enquiries, use the Contact Us button above.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.3,
  },
  section: {
    marginBottom: 24,
  },
  heading: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginBottom: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  paragraph: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    lineHeight: 22,
    marginBottom: 10,
  },
  promiseCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 14,
  },
  promiseItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  promiseIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  promiseContent: {
    flex: 1,
  },
  promiseTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 2,
  },
  promiseDesc: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  companyInfo: {
    backgroundColor: Colors.light.card,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginTop: 8,
  },
  companyHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginBottom: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
    gap: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.light.textMuted,
    marginBottom: 2,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  infoText: {
    fontSize: 14,
    color: Colors.light.text,
    lineHeight: 20,
  },
  infoDivider: {
    height: 1,
    backgroundColor: Colors.light.border,
    marginVertical: 6,
    marginBottom: 14,
  },
  legalNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 16,
    padding: 14,
    backgroundColor: Colors.light.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  legalNoteText: {
    flex: 1,
    fontSize: 12,
    color: Colors.light.textMuted,
    lineHeight: 18,
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
  },
  contactBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.primary,
  },
});
