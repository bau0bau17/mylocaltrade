import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import type { FeatherIconName } from '@/types/feather-icons';

type MciIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export function CategoryCard({
  name,
  label,
  icon,
  iconSet = 'feather',
}: {
  /** Canonical category value — used for the search route param. Never changes. */
  name: string;
  /** Optional concise display label. Falls back to the canonical name. */
  label?: string;
  icon: FeatherIconName | MciIconName;
  iconSet?: 'feather' | 'mci';
}) {
  const router = useRouter();

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={label ?? name}
      onPress={() => {
        if (Platform.OS !== 'web') {
          Haptics.selectionAsync().catch(() => {});
        }
        router.push({ pathname: '/(tabs)/search', params: { category: name } });
      }}
    >
      <View style={styles.iconContainer}>
        {iconSet === 'mci' ? (
          <MaterialCommunityIcons name={icon as MciIconName} size={22} color={Colors.light.primary} />
        ) : (
          <Feather name={icon as FeatherIconName} size={21} color={Colors.light.primary} />
        )}
      </View>
      <Text style={styles.name} numberOfLines={2}>{label ?? name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 4,
    minHeight: 92,
  },
  cardPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.96 }],
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.light.borderLight,
  },
  name: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.light.textSecondaryStrong,
    textAlign: 'center',
    letterSpacing: 0.1,
    lineHeight: 14,
  },
});
