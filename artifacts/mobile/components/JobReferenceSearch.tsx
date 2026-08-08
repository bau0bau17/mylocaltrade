import React from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';

// Small search box used on the enquiry/lead lists to filter by job number
// (e.g. "MLT-000123" or just "000123"). Purely presentational — the parent
// owns the query state and applies the filtering.
export function JobReferenceSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      <Feather name="search" size={15} color={Colors.light.textMuted} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder="Search by job number (e.g. MLT-000123)"
        placeholderTextColor={Colors.light.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search by job number"
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear job number search"
        >
          <Feather name="x-circle" size={16} color={Colors.light.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  input: { flex: 1, fontSize: 14, color: Colors.light.text, padding: 0 },
});
