import React from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { useGetEnquiries } from '@workspace/api-client-react';
import { EnquiryCard } from '@/components/EnquiryCard';

export default function MyEnquiriesScreen() {
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useGetEnquiries();

  return (
    <View style={styles.container}>
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      ) : data?.enquiries && data.enquiries.length > 0 ? (
        <FlatList
          data={data.enquiries}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <EnquiryCard enquiry={item} />}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
        />
      ) : (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No enquiries yet</Text>
          <Text style={styles.emptySubtitle}>
            When you send enquiries to traders, they will appear here.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
