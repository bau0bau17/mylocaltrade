import React from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useGetSavedTraders } from '@workspace/api-client-react';
import { TraderCard } from '@/components/TraderCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAuth } from '@/contexts/AuthContext';

export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { data, isLoading } = useGetSavedTraders();

  return (
    <View style={styles.container}>
      <ScreenHeader
        variant="tab"
        title="Saved"
        subtitle="Your saved tradespeople"
      />

      {!isAuthenticated ? (
        <View style={styles.centered}>
          <View style={styles.emptyIconWrap}>
            <Feather name="bookmark" size={32} color={Colors.light.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>Sign in to save traders</Text>
          <Text style={styles.emptySubtitle}>
            Create an account to save your favourite tradespeople and contact them anytime.
          </Text>
          <Pressable style={styles.ctaButton} onPress={() => router.push('/auth/login')}>
            <Text style={styles.ctaText}>Sign In</Text>
          </Pressable>
          <Pressable style={styles.ctaOutline} onPress={() => router.push('/auth/register-customer')}>
            <Text style={styles.ctaOutlineText}>Create Account</Text>
          </Pressable>
        </View>
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      ) : data?.traders && data.traders.length > 0 ? (
        <FlatList
          data={data.traders}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <TraderCard trader={item} />}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View style={styles.centered}>
          <View style={styles.emptyIconWrap}>
            <Feather name="bookmark" size={32} color={Colors.light.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No saved traders yet</Text>
          <Text style={styles.emptySubtitle}>
            Browse tradespeople and tap the bookmark icon to save them here for easy access.
          </Text>
          <Pressable style={styles.ctaButton} onPress={() => router.push('/(tabs)/traders')}>
            <Feather name="search" size={16} color={Colors.light.white} style={{ marginRight: 8 }} />
            <Text style={styles.ctaText}>Browse Traders</Text>
          </Pressable>
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
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: Colors.light.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  ctaButton: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
  },
  ctaText: {
    color: Colors.light.white,
    fontSize: 15,
    fontWeight: '700',
  },
  ctaOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  ctaOutlineText: {
    color: Colors.light.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
