import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { Enquiry } from '@workspace/api-client-react/src/generated/api.schemas';

export function EnquiryCard({ enquiry }: { enquiry: Enquiry }) {
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#F59E0B'; // Amber
      case 'responded': return '#10B981'; // Green
      case 'closed': return '#6B7280'; // Gray
      default: return Colors.light.primary;
    }
  };

  const statusColor = getStatusColor(enquiry.status);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{enquiry.customerName}</Text>
          <Text style={styles.service}>{enquiry.serviceRequired}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}1A` }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{enquiry.status.toUpperCase()}</Text>
        </View>
      </View>
      
      <View style={styles.divider} />
      
      <Text style={styles.message} numberOfLines={3}>{enquiry.message}</Text>
      
      <View style={styles.footer}>
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
        <View style={styles.contactRow}>
          <Feather name="calendar" size={14} color={Colors.light.textSecondary} />
          <Text style={styles.contactText}>{new Date(enquiry.createdAt).toLocaleDateString()}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
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