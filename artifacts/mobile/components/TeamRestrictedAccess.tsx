import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";

/**
 * Shared no-access state for employee Team screens. It intentionally has no
 * billing or purchase action: Team subscription ownership belongs to the
 * company owner.
 */
export function TeamRestrictedAccess({ ownerEmail }: { ownerEmail?: string | null }) {
  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.icon}>
        <Feather name="lock" size={28} color={Colors.light.primary} />
      </View>
      <Text style={styles.title}>Team access unavailable</Text>
      <Text style={styles.body}>
        This company no longer has an active Team subscription. Please contact the business
        account owner to restore Team access.
      </Text>
      {ownerEmail ? (
        <View style={styles.ownerContact}>
          <Text style={styles.ownerLabel}>Account owner</Text>
          <Text selectable style={styles.ownerEmail}>
            {ownerEmail}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: Colors.light.background,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.light.primaryMuted,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.light.text,
    textAlign: "center",
    marginBottom: 6,
  },
  body: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    lineHeight: 20,
    textAlign: "center",
  },
  ownerContact: {
    alignItems: "center",
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light.border,
    alignSelf: "stretch",
  },
  ownerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  ownerEmail: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.light.text,
  },
});