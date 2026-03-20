import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';

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
          MyLocalTrade is the UK's premier platform for connecting homeowners with trusted, verified local tradespeople.
        </Text>
        <Text style={styles.paragraph}>
          Founded with the mission to bring transparency and trust to the local services industry, we ensure that finding a reliable plumber, electrician, or builder is as simple as a few taps on your phone.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Our Promise</Text>
        <View style={styles.promiseCard}>
          <View style={styles.promiseItem}>
            <View style={[styles.promiseIcon, { backgroundColor: Colors.light.secondaryMuted }]}>
              <Feather name="check-circle" size={16} color={Colors.light.secondary} />
            </View>
            <View style={styles.promiseContent}>
              <Text style={styles.promiseTitle}>Verified Professionals</Text>
              <Text style={styles.promiseDesc}>We check credentials of all tradespeople.</Text>
            </View>
          </View>
          <View style={styles.promiseItem}>
            <View style={[styles.promiseIcon, { backgroundColor: Colors.light.featuredMuted }]}>
              <Feather name="star" size={16} color={Colors.light.featured} />
            </View>
            <View style={styles.promiseContent}>
              <Text style={styles.promiseTitle}>Real Reviews</Text>
              <Text style={styles.promiseDesc}>Only genuine customers can leave feedback.</Text>
            </View>
          </View>
          <View style={styles.promiseItem}>
            <View style={[styles.promiseIcon, { backgroundColor: Colors.light.primaryMuted }]}>
              <Feather name="map-pin" size={16} color={Colors.light.primary} />
            </View>
            <View style={styles.promiseContent}>
              <Text style={styles.promiseTitle}>Local First</Text>
              <Text style={styles.promiseDesc}>We prioritize your immediate community.</Text>
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
          <Feather name="file-text" size={14} color={Colors.light.textMuted} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Legal Entity</Text>
            <Text style={styles.infoText}>Service Provider LTD</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Feather name="hash" size={14} color={Colors.light.textMuted} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Company Number</Text>
            <Text style={styles.infoText}>12345678</Text>
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
            <Text style={styles.infoText}>123 Business Street{'\n'}London, EC1A 1BB{'\n'}United Kingdom</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Feather name="percent" size={14} color={Colors.light.textMuted} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>VAT Registration</Text>
            <Text style={styles.infoText}>GB 123 4567 89</Text>
          </View>
        </View>

        <View style={styles.infoDivider} />

        <View style={styles.infoRow}>
          <Feather name="mail" size={14} color={Colors.light.primary} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={[styles.infoText, { color: Colors.light.primary }]}>support@mylocaltrade.co.uk</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Feather name="phone" size={14} color={Colors.light.primary} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Telephone</Text>
            <Text style={[styles.infoText, { color: Colors.light.primary }]}>020 1234 5678</Text>
          </View>
        </View>
      </View>

      <View style={styles.legalNote}>
        <Feather name="info" size={14} color={Colors.light.textMuted} />
        <Text style={styles.legalNoteText}>
          This app is operated by Service Provider LTD, a company registered in England and Wales (Company No. 12345678). All prices shown include VAT where applicable. By using this app you agree to our Terms & Conditions and Privacy Policy.
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
});
