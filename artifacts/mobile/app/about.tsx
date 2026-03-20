import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
      <Text style={styles.title}>About MyLocalTrade</Text>
      
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
        <Text style={styles.paragraph}>
          1. <Text style={styles.bold}>Verified Professionals:</Text> We check the credentials of tradespeople joining our platform.
        </Text>
        <Text style={styles.paragraph}>
          2. <Text style={styles.bold}>Real Reviews:</Text> Only customers who have genuinely used a service can leave feedback.
        </Text>
        <Text style={styles.paragraph}>
          3. <Text style={styles.bold}>Local First:</Text> We prioritize businesses in your immediate community.
        </Text>
      </View>

      <View style={styles.companyInfo}>
        <Text style={styles.heading}>Company Details</Text>
        <Text style={styles.infoText}>Service Provider LTD</Text>
        <Text style={styles.infoText}>Company Number: 12345678</Text>
        <Text style={styles.infoText}>Registered Address:</Text>
        <Text style={styles.infoText}>123 Business Street</Text>
        <Text style={styles.infoText}>London, EC1A 1BB</Text>
        <Text style={[styles.infoText, { marginTop: 8 }]}>support@mylocaltrade.co.uk</Text>
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
    fontSize: 28,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 12,
  },
  paragraph: {
    fontSize: 15,
    color: Colors.light.textSecondary,
    lineHeight: 24,
    marginBottom: 12,
  },
  bold: {
    fontWeight: '600',
    color: Colors.light.text,
  },
  companyInfo: {
    backgroundColor: Colors.light.card,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginTop: 16,
  },
  infoText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  }
});