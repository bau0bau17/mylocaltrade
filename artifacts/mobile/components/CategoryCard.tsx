import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import type { FeatherIconName } from '@/types/feather-icons';

export function CategoryCard({ name, icon }: { name: string; icon: FeatherIconName }) {
  const router = useRouter();

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push({ pathname: '/(tabs)/search', params: { category: name } })}
    >
      <View style={styles.iconContainer}>
        <Feather name={icon} size={20} color={Colors.light.primary} />
      </View>
      <Text style={styles.name} numberOfLines={2}>{name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    margin: 2,
  },
  cardPressed: {
    opacity: 0.7,
  },
  iconContainer: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
    borderWidth: 1,
    borderColor: Colors.light.borderLight,
  },
  name: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    textAlign: 'center',
    letterSpacing: 0.1,
    lineHeight: 13,
  },
});
