import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';

export function HomeFooter() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.company}>Operated by Service Provider LTD</Text>
        <Text style={styles.dot}>·</Text>
        <Pressable onPress={() => router.push('/legal-support')} hitSlop={10}>
          <Text style={styles.link}>Legal & Support</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  company: {
    fontSize: 11,
    color: Colors.light.textMuted,
    letterSpacing: 0.1,
  },
  dot: {
    fontSize: 11,
    color: Colors.light.textMuted,
  },
  link: {
    fontSize: 11,
    color: Colors.light.primary,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
