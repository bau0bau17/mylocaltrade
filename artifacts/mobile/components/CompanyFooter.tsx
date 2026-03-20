import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';

export function CompanyFooter() {
  const router = useRouter();

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

      <View style={styles.companyRow}>
        <Feather name="briefcase" size={12} color={Colors.light.textMuted} />
        <Text style={styles.companyText}>
          Operated by Service Provider LTD
        </Text>
      </View>
      <Text style={styles.companyDetail}>
        Company No: 12345678 · 123 Business Street, London, EC1A 1BB
      </Text>
      <Text style={styles.companyDetail}>
        support@mylocaltrade.co.uk
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
    marginBottom: 16,
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
