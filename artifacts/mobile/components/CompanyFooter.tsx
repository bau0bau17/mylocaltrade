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

      <View style={styles.linksGrid}>
        <Pressable onPress={() => router.push('/about')} style={styles.linkItem} hitSlop={6}>
          <Text style={styles.linkText}>About</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/terms')} style={styles.linkItem} hitSlop={6}>
          <Text style={styles.linkText}>Terms</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/privacy')} style={styles.linkItem} hitSlop={6}>
          <Text style={styles.linkText}>Privacy</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/refund')} style={styles.linkItem} hitSlop={6}>
          <Text style={styles.linkText}>Refunds</Text>
        </Pressable>
      </View>

      <Pressable style={styles.contactButton} onPress={handleContact}>
        <Feather name="mail" size={14} color={Colors.light.primary} />
        <Text style={styles.contactButtonText}>Contact Us</Text>
      </Pressable>

      <View style={styles.companyBlock}>
        <View style={styles.companyNameRow}>
          <Feather name="briefcase" size={11} color={Colors.light.textMuted} />
          <Text style={styles.companyName}>Service Provider LTD</Text>
        </View>
        <Text style={styles.companyDetail}>Registered in England and Wales · No: 15830141</Text>
        <Text style={styles.companyDetail}>71-75 Shelton Street, Covent Garden, London, WC2H 9JQ</Text>
      </View>

      <Text style={styles.copyright}>
        © {new Date().getFullYear()} MyLocalTrade. All rights reserved.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  divider: {
    width: 36,
    height: 2,
    borderRadius: 1,
    backgroundColor: Colors.light.border,
    marginBottom: 20,
  },
  linksGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  linkItem: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.light.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  linkText: {
    fontSize: 12,
    color: Colors.light.primary,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: Colors.light.primaryMuted,
    paddingHorizontal: 24,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${Colors.light.primary}33`,
    marginBottom: 20,
  },
  contactButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.primary,
    letterSpacing: 0.3,
  },
  companyBlock: {
    alignItems: 'center',
    gap: 3,
    marginBottom: 12,
  },
  companyNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  companyName: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  companyDetail: {
    fontSize: 11,
    color: Colors.light.textMuted,
    textAlign: 'center',
    lineHeight: 17,
  },
  copyright: {
    fontSize: 11,
    color: Colors.light.textMuted,
    marginTop: 2,
    letterSpacing: 0.2,
  },
});
