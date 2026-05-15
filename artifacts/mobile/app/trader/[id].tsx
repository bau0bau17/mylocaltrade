import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking, Alert, Image, Modal, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import {
  useGetTrader,
  useGetSavedTraders,
  useSaveTrader,
  useUnsaveTrader,
  getGetSavedTradersQueryKey,
} from '@workspace/api-client-react';
import { ReviewsSection } from '@/components/ReviewsSection';
import { formatResponseTime, isTopRated } from '@/components/TraderCard';
import { useAuth } from '@/contexts/AuthContext';
import { detectSpecialisms, SPECIALISM_BY_KEY } from '@/constants/specialisms';

export default function TraderProfileScreen() {
  const { id } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isTraderViewer = user?.role === 'trader';
  const canSave = isAuthenticated && !isTraderViewer && !isAdmin;
  const canMessage = !isAuthenticated || (!isTraderViewer && !isAdmin);

  const { data: trader, isLoading, error } = useGetTrader(Number(id));
  const specialisms = detectSpecialisms(trader?.mainCategory, trader?.additionalServices);

  // Only fetch the saved list when the user is logged in as a customer.
  const { data: savedData } = useGetSavedTraders({
    query: { enabled: canSave, queryKey: getGetSavedTradersQueryKey() },
  });
  const isSaved = !!savedData?.traders?.some((t) => t.id === Number(id));

  const invalidateSaved = () =>
    queryClient.invalidateQueries({ queryKey: getGetSavedTradersQueryKey() });

  const saveMutation = useSaveTrader({
    mutation: {
      onSuccess: invalidateSaved,
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Could not save trader.';
        Alert.alert('Save failed', msg);
      },
    },
  });
  const unsaveMutation = useUnsaveTrader({
    mutation: {
      onSuccess: invalidateSaved,
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Could not remove trader.';
        Alert.alert('Update failed', msg);
      },
    },
  });
  const saveBusy = saveMutation.isPending || unsaveMutation.isPending;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const onToggleSave = () => {
    if (!isAuthenticated) {
      Alert.alert(
        'Sign in to save traders',
        'Create a free customer account to save your favourite tradespeople.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', onPress: () => router.push('/auth/login') },
        ],
      );
      return;
    }
    if (isTraderViewer || isAdmin) {
      Alert.alert('Customers only', 'Saving traders is a customer-only feature.');
      return;
    }
    if (saveBusy || !trader) return;
    if (isSaved) {
      unsaveMutation.mutate({ traderId: trader.id });
    } else {
      saveMutation.mutate({ traderId: trader.id });
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  if (error || !trader) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.errorIconWrap}>
          <Feather name="alert-circle" size={32} color={Colors.light.error} />
        </View>
        <Text style={styles.errorText}>Could not load trader profile.</Text>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView 
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.headerCover, { paddingTop: Math.max(insets.top, 50) + 12 }]}>
          <View style={styles.headerNavRow}>
            <Pressable style={styles.backNav} onPress={() => router.back()} hitSlop={8}>
              <Feather name="arrow-left" size={20} color={Colors.light.text} />
            </Pressable>
            <Pressable
              style={[styles.saveNav, isSaved && styles.saveNavActive]}
              onPress={onToggleSave}
              hitSlop={8}
              disabled={saveBusy}
              accessibilityRole="button"
              accessibilityLabel={isSaved ? 'Remove from saved traders' : 'Save trader'}
              accessibilityState={{ selected: isSaved, busy: saveBusy }}
            >
              {saveBusy ? (
                <ActivityIndicator size="small" color={isSaved ? Colors.light.white : Colors.light.primary} />
              ) : (
                <Feather
                  name="bookmark"
                  size={18}
                  color={isSaved ? Colors.light.white : Colors.light.text}
                />
              )}
            </Pressable>
          </View>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>{trader.businessName.charAt(0)}</Text>
          </View>
          <Text style={styles.businessName}>{trader.businessName}</Text>
          <View style={styles.badges}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{trader.mainCategory}</Text>
            </View>
            {trader.isVerified && (
              <View style={[styles.planBadge, { backgroundColor: 'rgba(16, 185, 129, 0.14)' }]}>
                <Feather name="check-circle" size={11} color={Colors.light.success} />
                <Text style={[styles.planTextColored, { color: Colors.light.success }]}>Verified</Text>
              </View>
            )}
            {trader.plan === 'elite' && (
              <View style={[styles.planBadge, { backgroundColor: Colors.light.eliteMuted }]}>
                <Feather name="zap" size={10} color={Colors.light.elite} />
                <Text style={[styles.planTextColored, { color: Colors.light.elite }]}>Elite</Text>
              </View>
            )}
            {trader.plan === 'premium' && (
              <View style={[styles.planBadge, { backgroundColor: Colors.light.primaryMuted }]}>
                <Text style={[styles.planTextColored, { color: Colors.light.primary }]}>Premium</Text>
              </View>
            )}
            {isTopRated(trader.rating, trader.reviewCount) && (
              <View style={[styles.planBadge, { backgroundColor: 'rgba(245, 158, 11, 0.14)' }]}>
                <Feather name="star" size={11} color={Colors.light.featured} />
                <Text style={[styles.planTextColored, { color: '#B45309' }]}>Top rated</Text>
              </View>
            )}
          </View>
          {trader.verifiedAt && (
            <Text style={styles.verifiedSince}>
              Verified by MyLocalTrade · {new Date(trader.verifiedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
            </Text>
          )}
          {trader.createdAt && (
            <Text style={styles.verifiedSince}>
              On MyLocalTrade since {new Date(trader.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
            </Text>
          )}
          {formatResponseTime(trader.responseTimeMinutes) ? (
            <View style={styles.responseChip}>
              <Feather name="clock" size={11} color={Colors.light.primary} />
              <Text style={styles.responseChipText}>{formatResponseTime(trader.responseTimeMinutes)}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.content}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <View style={[styles.statIconWrap, { backgroundColor: Colors.light.featuredMuted }]}>
                <Feather name="star" size={16} color={Colors.light.featured} />
              </View>
              <Text style={styles.statValue}>
                {typeof trader.rating === 'number' && Number.isFinite(trader.rating)
                  ? trader.rating.toFixed(1)
                  : 'New'}
              </Text>
              <Text style={styles.statLabel}>
                {typeof trader.reviewCount === 'number' && trader.reviewCount > 0
                  ? `${trader.reviewCount} ${trader.reviewCount === 1 ? 'Review' : 'Reviews'}`
                  : 'No reviews yet'}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <View style={[styles.statIconWrap, { backgroundColor: Colors.light.primaryMuted }]}>
                <Feather name="map-pin" size={16} color={Colors.light.primary} />
              </View>
              <Text style={styles.statValue}>{trader.town}</Text>
              <Text style={styles.statLabel}>Location</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <View
                style={[
                  styles.statIconWrap,
                  {
                    backgroundColor: trader.isVerified
                      ? Colors.light.secondaryMuted
                      : Colors.light.border,
                  },
                ]}
              >
                <Feather
                  name={trader.isVerified ? 'check-circle' : 'shield'}
                  size={16}
                  color={trader.isVerified ? Colors.light.secondary : Colors.light.textMuted}
                />
              </View>
              <Text style={styles.statValue}>{trader.isVerified ? 'Verified' : 'Unverified'}</Text>
              <Text style={styles.statLabel}>Business</Text>
            </View>
          </View>

          {specialisms.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Specialisms</Text>
              <View style={styles.specialismsRow}>
                {specialisms.map((key) => {
                  const spec = SPECIALISM_BY_KEY[key];
                  return (
                    <View key={key} style={styles.specialismBadge}>
                      <Feather name={spec.icon} size={12} color={Colors.light.primary} />
                      <Text style={styles.specialismBadgeText}>{spec.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.description}>
              {trader.businessDescription || `${trader.businessName} is a professional ${trader.mainCategory.toLowerCase()} operating in ${trader.town} and surrounding areas.`}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Services</Text>
            <View style={styles.servicesList}>
              <View style={styles.serviceItem}>
                <View style={styles.serviceCheck}>
                  <Feather name="check" size={12} color={Colors.light.primary} />
                </View>
                <Text style={styles.serviceText}>{trader.mainCategory}</Text>
              </View>
              {trader.additionalServices?.map((service, idx) => (
                <View key={idx} style={styles.serviceItem}>
                  <View style={styles.serviceCheck}>
                    <Feather name="check" size={12} color={Colors.light.primary} />
                  </View>
                  <Text style={styles.serviceText}>{service}</Text>
                </View>
              ))}
            </View>
          </View>

          {trader.galleryUrls && trader.galleryUrls.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Gallery</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryRow}>
                {trader.galleryUrls.map((url, idx) => (
                  <Pressable key={`${url}-${idx}`} onPress={() => setLightboxIndex(idx)}>
                    <Image source={{ uri: url }} style={styles.galleryThumb} resizeMode="cover" />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Reviews</Text>
              <Pressable onPress={() => router.push(`/write-review/${trader.id}`)}>
                <Text style={styles.sectionAction}>Write a review</Text>
              </Pressable>
            </View>
            <ReviewsSection traderId={trader.id} />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact</Text>
            <View style={styles.contactCard}>
              <View style={styles.contactRow}>
                <View style={styles.contactIconWrap}>
                  <Feather name="user" size={14} color={Colors.light.textSecondary} />
                </View>
                <Text style={styles.contactText}>{trader.contactName}</Text>
              </View>
              <Pressable style={styles.contactRow} onPress={() => Linking.openURL(`tel:${trader.phone}`)}>
                <View style={styles.contactIconWrap}>
                  <Feather name="phone" size={14} color={Colors.light.primary} />
                </View>
                <Text style={[styles.contactText, { color: Colors.light.primary }]}>{trader.phone}</Text>
              </Pressable>
              {trader.website && (
                <Pressable style={styles.contactRow} onPress={() => Linking.openURL(trader.website!)}>
                  <View style={styles.contactIconWrap}>
                    <Feather name="globe" size={14} color={Colors.light.primary} />
                  </View>
                  <Text style={[styles.contactText, { color: Colors.light.primary }]}>{trader.website}</Text>
                </Pressable>
              )}
              {trader.businessAddress && (
                <View style={styles.contactRow}>
                  <View style={styles.contactIconWrap}>
                    <Feather name="map" size={14} color={Colors.light.textSecondary} />
                  </View>
                  <Text style={styles.contactText}>{trader.businessAddress}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={lightboxIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxIndex(null)}
      >
        <Pressable style={styles.lightboxBackdrop} onPress={() => setLightboxIndex(null)}>
          {lightboxIndex !== null && trader.galleryUrls?.[lightboxIndex] ? (
            <Image
              source={{ uri: trader.galleryUrls[lightboxIndex] }}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          ) : null}
          <Pressable style={[styles.lightboxClose, { top: insets.top + 12 }]} onPress={() => setLightboxIndex(null)} hitSlop={10}>
            <Feather name="x" size={22} color={Colors.light.white} />
          </Pressable>
        </Pressable>
      </Modal>

      {canMessage ? (() => {
        const responseLabel = formatResponseTime(trader.responseTimeMinutes);
        const ctaHintLabel = responseLabel
          ? `Usually ${responseLabel.charAt(0).toLowerCase()}${responseLabel.slice(1)}`
          : null;
        return (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom || 24 }]}>
            <View style={styles.verifyNote}>
              <Feather name="shield" size={12} color={Colors.light.textSecondary} />
              <Text style={styles.verifyNoteText}>
                Always verify quotes, insurance and credentials before any work starts.
              </Text>
            </View>
            <Pressable
              style={styles.contactButton}
              onPress={() => router.push(`/enquiry/${trader.id}`)}
            >
              <Feather name="message-square" size={18} color={Colors.light.white} style={{ marginRight: 8 }} />
              <Text style={styles.contactButtonText}>Message this trader</Text>
            </Pressable>
            {ctaHintLabel ? (
              <View style={styles.ctaHint}>
                <Feather name="clock" size={11} color={Colors.light.textMuted} />
                <Text style={styles.ctaHintText}>{ctaHintLabel}</Text>
              </View>
            ) : null}
          </View>
        );
      })() : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: Colors.light.background,
  },
  errorIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.light.errorMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorText: {
    fontSize: 15,
    color: Colors.light.textSecondary,
    marginBottom: 24,
  },
  specialismsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  specialismBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Colors.light.primaryMuted,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  specialismBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.light.primary,
    letterSpacing: 0.2,
  },
  verifyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  verifyNoteText: {
    flex: 1,
    fontSize: 11,
    color: Colors.light.textSecondary,
    lineHeight: 15,
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
  },
  headerCover: {
    backgroundColor: Colors.light.surface,
    paddingHorizontal: 20,
    paddingBottom: 24,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginBottom: 16,
  },
  backNav: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  saveNav: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  saveNavActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  avatarContainer: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  businessName: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionAction: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.primary,
  },
  badges: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  verifiedSince: {
    marginTop: 8,
    fontSize: 11,
    color: Colors.light.textMuted,
    letterSpacing: 0.3,
  },
  categoryBadge: {
    backgroundColor: Colors.light.primaryMuted,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  categoryText: {
    fontSize: 12,
    color: Colors.light.primary,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
  },
  planTextColored: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  content: {
    padding: 20,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.light.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.light.border,
    marginVertical: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.light.textMuted,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginBottom: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
    color: Colors.light.textSecondary,
  },
  servicesList: {
    gap: 8,
  },
  serviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serviceCheck: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  serviceText: {
    fontSize: 14,
    color: Colors.light.text,
  },
  contactCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 12,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.light.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginLeft: 10,
    flex: 1,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.light.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  contactButton: {
    backgroundColor: Colors.light.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 16,
  },
  contactButtonText: {
    color: Colors.light.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  ctaHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 8,
  },
  ctaHintText: {
    fontSize: 11,
    color: Colors.light.textMuted,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  responseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.light.primaryMuted,
  },
  responseChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.primary,
    letterSpacing: 0.3,
  },
  galleryRow: {
    gap: 8,
    paddingRight: 12,
  },
  galleryThumb: {
    width: 140,
    height: 140,
    borderRadius: 12,
    backgroundColor: Colors.light.surface,
  },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.8,
  },
  lightboxClose: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
