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
        <Text style={styles.companyHeading}>Company Details</Text>
        <Text style={styles.infoText}>Service Provider LTD</Text>
        <Text style={styles.infoText}>Company Number: 12345678</Text>
        <Text style={styles.infoText}>Registered Address:</Text>
        <Text style={styles.infoText}>123 Business Street</Text>
        <Text style={styles.infoText}>London, EC1A 1BB</Text>
        <Text style={[styles.infoText, { marginTop: 8, color: Colors.light.primary }]}>support@mylocaltrade.co.uk</Text>
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
    marginBottom: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  infoText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  }
});
