import React from 'react';
import { View, Text, StyleSheet, Pressable, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';

const CONTACT_EMAIL = 'lucian.dpd@gmail.com';

export function CompanyFooter() {
  const router = useRouter();

  const handleContact = () => {
    Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=MyLocalTrade%20Enquiry`);
  };

  return (
    <View style={styles.container}>
      <View style={styles.divider} />

      <View style={styles.linksRow}>
        <Pressable onPress={() => router.push('/about')} hitSlop={6}>
          <Text style={styles.linkText}>About</Text>
        </Pressable>
        <View style={styles.dot} />
        <Pressable onPress={() => router.push('/terms')} hitSlop={6}>
          <Text style={styles.linkText}>Terms</Text>
        </Pressable>
        <View style={styles.dot} />
        <Pressable onPress={() => router.push('/privacy')} hitSlop={6}>
          <Text style={styles.linkText}>Privacy</Text>
        </Pressable>
        <View style={styles.dot} />
        <Pressable onPress={() => router.push('/refund')} hitSlop={6}>
          <Text style={styles.linkText}>Refunds</Text>
        </Pressable>
      </View>

      <Pressable style={styles.contactButton} onPress={handleContact}>
        <Feather name="mail" size={14} color={Colors.light.primary} />
        <Text style={styles.contactButtonText}>Contact Us</Text>
      </Pressable>

      <View style={styles.companyRow}>
        <Feather name="briefcase" size={12} color={Colors.light.textMuted} />
        <Text style={styles.companyText}>
          Service Provider LTD
        </Text>
      </View>
      <Text style={styles.companyDetail}>
        Registered in England and Wales
      </Text>
      <Text style={styles.companyDetail}>
        Company No: 15830141
      </Text>
      <Text style={styles.companyDetail}>
        71-75 Shelton Street, Covent Garden, London, WC2H 9JQ
      </Text>

      <Text style={styles.copyright}>
        © {new Date().getFullYear()} MyLocalTrade. All rights reserved.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
    paddingHorizontal: 20,
  },
  divider: {
    width: 40,
    height: 2,
    borderRadius: 1,
    backgroundColor: Colors.light.border,
    marginBottom: 16,
  },
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
  },
  linkText: {
    fontSize: 13,
    color: Colors.light.primary,
    fontWeight: '600',
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.light.textMuted,
    marginHorizontal: 4,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.light.primaryMuted,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 14,
  },
  contactButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  companyText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    fontWeight: '600',
  },
  companyDetail: {
    fontSize: 11,
    color: Colors.light.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  copyright: {
    fontSize: 11,
    color: Colors.light.textMuted,
    marginTop: 10,
  },
});
