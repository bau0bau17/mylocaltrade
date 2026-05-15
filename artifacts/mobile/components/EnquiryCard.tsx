import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import type { Enquiry } from '@workspace/api-client-react';
import {
  PROPERTY_TYPE_OPTIONS,
  TENURE_OPTIONS,
  URGENCY_OPTIONS,
} from '@/constants/specialisms';

function specialistSummary(fields: Enquiry['specialistFields']): string[] {
  if (!fields) return [];
  const parts: string[] = [];
  if (fields.propertyType) {
    const opt = PROPERTY_TYPE_OPTIONS.find((o) => o.value === fields.propertyType);
    parts.push(opt ? opt.label : fields.propertyType);
  }
  if (fields.tenure) {
    const opt = TENURE_OPTIONS.find((o) => o.value === fields.tenure);
    parts.push(opt ? opt.label : fields.tenure);
  }
  if (fields.urgency) {
    const opt = URGENCY_OPTIONS.find((o) => o.value === fields.urgency);
    parts.push(opt ? opt.label : fields.urgency);
  }
  return parts;
}

export function EnquiryCard({
  enquiry,
  viewerRole = 'trader',
}: {
  enquiry: Enquiry;
  viewerRole?: 'customer' | 'trader';
}) {
  const router = useRouter();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return Colors.light.featured;
      case 'responded': return Colors.light.secondary;
      case 'closed': return Colors.light.textMuted;
      default: return Colors.light.primary;
    }
  };

  const isCustomerView = viewerRole === 'customer';
  const statusColor = getStatusColor(enquiry.status);
  const isUnopened = enquiry.viewedByTrader === false;
  const customerStatusLabel = (() => {
    switch (enquiry.status) {
      case 'pending': return 'Awaiting reply';
      case 'responded': return 'Trader replied';
      case 'closed': return 'Closed';
      default: return String(enquiry.status);
    }
  })();
  const statusLabel = isCustomerView ? customerStatusLabel : enquiry.status.toUpperCase();
  const specialistParts = specialistSummary(enquiry.specialistFields);
  const headerName = isCustomerView
    ? (enquiry.traderBusinessName?.trim() || 'Trader')
    : enquiry.customerName;

  const handlePress = () => {
    if (enquiry.conversationId != null) {
      router.push(`/messages/${enquiry.conversationId}`);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={enquiry.conversationId == null}
      style={({ pressed }) => [
        styles.card,
        !isCustomerView && isUnopened && styles.cardUnopened,
        pressed && enquiry.conversationId != null && { opacity: 0.85 },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{headerName}</Text>
          <Text style={styles.service}>{enquiry.serviceRequired}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}1A` }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>
      
      <View style={styles.divider} />
      
      <Text style={styles.message} numberOfLines={3}>{enquiry.message}</Text>

      {specialistParts.length > 0 && (
        <View style={styles.specialistRow}>
          {specialistParts.map((part, idx) => (
            <View key={`${part}-${idx}`} style={styles.specialistChip}>
              <Text style={styles.specialistChipText}>{part}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.footer}>
        {!isCustomerView && (
          <>
            <View style={styles.contactRow}>
              <Feather name="mail" size={14} color={Colors.light.textSecondary} />
              <Text style={styles.contactText}>{enquiry.customerEmail}</Text>
            </View>
            {enquiry.phone && (
              <View style={styles.contactRow}>
                <Feather name="phone" size={14} color={Colors.light.textSecondary} />
                <Text style={styles.contactText}>{enquiry.phone}</Text>
              </View>
            )}
          </>
        )}
        <View style={styles.contactRow}>
          <Feather name="calendar" size={14} color={Colors.light.textSecondary} />
          <Text style={styles.contactText}>
            {isCustomerView ? 'Sent ' : ''}
            {new Date(enquiry.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  cardUnopened: {
    borderLeftWidth: 4,
    borderLeftColor: Colors.light.primary,
    paddingLeft: 13,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  headerInfo: {
    flex: 1,
    marginRight: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 2,
  },
  service: {
    fontSize: 14,
    color: Colors.light.primary,
    fontWeight: '500',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.light.border,
    marginBottom: 12,
  },
  message: {
    fontSize: 14,
    color: Colors.light.text,
    lineHeight: 20,
    marginBottom: 16,
  },
  specialistRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  specialistChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: Colors.light.primaryMuted,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  specialistChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.primary,
    letterSpacing: 0.2,
  },
  footer: {
    gap: 6,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactText: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginLeft: 8,
  },
});