import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';

type Variant = 'stack' | 'tab';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  variant?: Variant;
  showBack?: boolean;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

// Minimum top padding so the header never sits under a device cutout / notch
// on platforms where safe-area insets are reported as 0 (web previews,
// some Android devices). Real iOS / Android with insets just use the inset.
const FALLBACK_TOP = Platform.select({ ios: 50, android: 28, default: 56 }) ?? 44;

export function ScreenHeader({
  title,
  subtitle,
  variant = 'stack',
  showBack,
  onBack,
  rightSlot,
  style,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const topPad = Math.max(insets.top, FALLBACK_TOP);

  // Default: back button shown for `stack`, hidden for `tab`.
  const back = showBack ?? variant === 'stack';
  const handleBack = onBack ?? (() => router.back());

  if (variant === 'tab') {
    return (
      <View style={[styles.tabWrap, { paddingTop: topPad + 8 }, style]}>
        <View style={styles.tabRow}>
          <View style={styles.tabTextWrap}>
            <Text style={styles.tabTitle} numberOfLines={1}>{title}</Text>
            {subtitle ? (
              <Text style={styles.tabSubtitle} numberOfLines={1}>{subtitle}</Text>
            ) : null}
          </View>
          {rightSlot ? <View style={styles.rightSlot}>{rightSlot}</View> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.stackWrap, { paddingTop: topPad }, style]}>
      <View style={styles.stackRow}>
        {back ? (
          <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={10}>
            <Feather name="chevron-left" size={24} color={Colors.light.primary} />
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
        <Text style={styles.stackTitle} numberOfLines={1}>{title}</Text>
        <View style={styles.backBtn}>{rightSlot}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stackWrap: {
    backgroundColor: Colors.light.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  stackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  stackTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabWrap: {
    backgroundColor: Colors.light.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  tabTextWrap: {
    flex: 1,
  },
  tabTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.2,
  },
  tabSubtitle: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  rightSlot: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
