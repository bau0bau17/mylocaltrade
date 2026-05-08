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

  const isWeb = Platform.OS === 'web';
  // Match react-navigation bottom-tabs default: items get a 49pt (iOS) /
  // 56dp (Android) row above the bottom safe area inset. On web our native
  // Tabs uses a fixed total of 84 (which already bakes in safe-area pad).
  const baseHeight = isIOS ? 49 : 56;
  const bottomPad = insets.bottom;
  const totalHeight = isWeb ? 84 : baseHeight + bottomPad;

  return (
    <View style={[styles.wrap, { paddingBottom: isWeb ? 0 : bottomPad, height: totalHeight }]}>
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
              <Feather name={tab.icon} size={24} color={color} />
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
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-around',
  },
  item: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 3,
    textAlign: 'center',
  },
});
