import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import {
  SEARCH_RADIUS_OPTIONS,
  radiusChipLabel,
  type SearchRadius,
} from '@/constants/searchRadius';

type RadiusSheetProps = {
  visible: boolean;
  selected: SearchRadius;
  onSelect: (value: SearchRadius) => void;
  onClose: () => void;
};

/**
 * Bottom sheet with the fixed search-radius options (no slider by design).
 * Matches the Search screen's filter-sheet look. Selecting an option is the
 * caller's cue to commit + close; tapping the backdrop/X just dismisses.
 */
export function RadiusSheet({ visible, selected, onSelect, onClose }: RadiusSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close search radius"
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Search radius</Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Feather name="x" size={22} color={Colors.light.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>How far should we look for traders?</Text>
          {SEARCH_RADIUS_OPTIONS.map((value, idx) => {
            const active = selected === value;
            return (
              <Pressable
                key={String(value)}
                style={[styles.row, idx < SEARCH_RADIUS_OPTIONS.length - 1 && styles.rowBorder]}
                onPress={() => onSelect(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={radiusChipLabel(value)}
              >
                <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>
                  {radiusChipLabel(value)}
                </Text>
                {active ? <Feather name="check" size={18} color={Colors.light.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.light.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: 20,
    maxHeight: '85%',
    borderTopWidth: 1,
    borderColor: Colors.light.border,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.light.borderLight,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  rowLabel: {
    fontSize: 15,
    color: Colors.light.text,
  },
  rowLabelActive: {
    fontWeight: '700',
    color: Colors.light.primary,
  },
});
