import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { BlurView } from 'expo-blur';
import Colors from '@/constants/colors';
import type { FeatherIconName } from '@/types/feather-icons';

type TabKey = 'home' | 'search' | 'traders' | 'account';

interface TabDef {
  key: TabKey;
  label: string;
  icon: FeatherIconName;
  href: string;
  matchPrefixes: string[];
}

const TABS: TabDef[] = [
  { key: 'home', label: 'Home', icon: 'home', href: '/(tabs)', matchPrefixes: ['/(tabs)', '/index'] },
  { key: 'search', label: 'Search', icon: 'search', href: '/(tabs)/search', matchPrefixes: ['/(tabs)/search', '/search'] },
  { key: 'traders', label: 'Traders', icon: 'briefcase', href: '/(tabs)/traders', matchPrefixes: ['/(tabs)/traders', '/traders'] },
  { key: 'account', label: 'Account', icon: 'user', href: '/(tabs)/account', matchPrefixes: ['/(tabs)/account', '/account'] },
];

export function BottomNav() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname() || '';
  const isIOS = Platform.OS === 'ios';

  const activeKey: TabKey | null = (() => {
    for (const tab of TABS) {
      if (tab.matchPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
        return tab.key;
      }
    }
    return null;
  })();

  const bottomPad = Math.max(insets.bottom, 8);

  return (
    <View style={[styles.wrap, { paddingBottom: bottomPad, height: 60 + bottomPad }]}>
      {isIOS ? (
        <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.light.surface }]} />
      )}
      <View style={styles.row}>
        {TABS.map((tab) => {
          const active = tab.key === activeKey;
          const color = active ? Colors.light.tabActive : Colors.light.tabInactive;
          return (
            <Pressable
              key={tab.key}
              style={styles.item}
              onPress={() => router.push(tab.href as never)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
            >
              <Feather name={tab.icon} size={22} color={color} />
              <Text style={[styles.label, { color }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
