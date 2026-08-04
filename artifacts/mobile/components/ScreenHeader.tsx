import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';

type Variant = 'stack' | 'tab' | 'page';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  variant?: Variant;
  showBack?: boolean;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** `page` variant only: render the subtle bottom divider (default true).
      Pass false when the header sits on the same surface as the content
      directly below it, so they read as one block. */
  divider?: boolean;
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
  divider = true,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const topPad = Math.max(insets.top, FALLBACK_TOP);

  // Default: back button shown for `stack`, hidden for `tab`.
  const back = showBack ?? variant === 'stack';
  const handleBack = onBack ?? (() => router.back());

  // Compact page header shared by top-level tab screens (Search, Messages):
  // safe-area aware, 20px horizontal padding, restrained title size.
  if (variant === 'page') {
    return (
      <View
        style={[
          styles.pageWrap,
          divider && styles.pageDivider,
          { paddingTop: topPad + 4 },
          style,
        ]}
      >
        <View style={styles.tabRow}>
          <View style={styles.tabTextWrap}>
            <Text style={styles.pageTitle} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.pageSubtitle} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {rightSlot ? <View style={styles.rightSlot}>{rightSlot}</View> : null}
        </View>
      </View>
    );
  }

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
        {/* When there is no right action, keep an invisible spacer (same width
            as the back button) so the title stays centred — without rendering
            what looks like an empty, broken control. */}
        {rightSlot ? (
          <View style={styles.backBtn}>{rightSlot}</View>
        ) : (
          <View style={styles.rightSpacer} />
        )}
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
  rightSpacer: {
    width: 36,
    height: 36,
  },
  pageWrap: {
    backgroundColor: Colors.light.surface,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  pageDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  pageTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.2,
  },
  pageSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: Colors.light.textSecondary,
    marginTop: 2,
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
