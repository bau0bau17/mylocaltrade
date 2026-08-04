import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, Image, RefreshControl, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { getApiUrl, avatarImageUrl } from '@/lib/api-url';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { ScreenHeader } from '@/components/ScreenHeader';
import type { FeatherIconName } from '@/types/feather-icons';
import {
  useGetConversationsUnreadCount,
  getGetConversationsUnreadCountQueryKey,
  useGetMe,
  getGetMeQueryKey,
  useUpdateNotificationSettings,
  useGetLeadReminderSettings,
  getGetLeadReminderSettingsQueryKey,
  useUpdateLeadReminderSettings,
  UpdateLeadReminderSettingsRequestLeadReminderMinutes,
  useGetTraderOnboardingStatus,
  getGetTraderOnboardingStatusQueryKey,
  type TraderOnboardingStatus,
  useGetCustomerUploadUrl,
  useUpdateAvatar,
} from '@workspace/api-client-react';

const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
const AVATAR_ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

function guessAvatarMime(uri: string, fallback?: string | null): string {
  if (fallback && AVATAR_ALLOWED_MIMES.includes(fallback)) return fallback;
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    case 'heif': return 'image/heif';
    default: return 'image/jpeg';
  }
}

type OnboardingPill = { label: string; bg: string; fg: string };

function computeOnboardingPill(
  status: TraderOnboardingStatus | undefined,
): OnboardingPill | null {
  if (!status) return null;
  const v = status.verificationStatus;
  if (v === 'VERIFIED') {
    return { label: 'Verified', bg: 'rgba(16, 185, 129, 0.14)', fg: '#047857' };
  }
  if (v === 'REJECTED' || v === 'SUSPENDED' || v === 'EXPIRED_DOCUMENTS') {
    return { label: 'Action required', bg: 'rgba(239, 68, 68, 0.14)', fg: '#B91C1C' };
  }
  if (v === 'UNDER_REVIEW') {
    return { label: 'Pending review', bg: 'rgba(245, 158, 11, 0.18)', fg: '#B45309' };
  }
  // Pending — show progress (e.g. "2 / 5 steps") in amber so the user knows
  // there's still work to do. Defensive guard in case checklist is empty.
  const checklist = status.checklist ?? [];
  if (checklist.length === 0) {
    return { label: 'In progress', bg: 'rgba(245, 158, 11, 0.18)', fg: '#B45309' };
  }
  const total = checklist.length;
  const done = checklist.filter((s) => s.state === 'completed').length;
  return {
    label: `${done} / ${total} steps`,
    bg: 'rgba(245, 158, 11, 0.18)',
    fg: '#B45309',
  };
}

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isAuthenticated, isTrader, isAdmin, logout, token: adminToken, refreshUser } = useAuth();
  const qc = useQueryClient();
  const { refreshing, onRefresh } = usePullToRefresh();

  // --- Personal profile photo (headshot) — traders only. This is the
  // individual's photo, NOT the business logo (managed in Edit Profile).
  const { mutateAsync: getUploadUrl } = useGetCustomerUploadUrl();
  const { mutateAsync: updateAvatar } = useUpdateAvatar();
  const [avatarBusy, setAvatarBusy] = useState(false);
  // Local preview so the new photo shows instantly after upload.
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const pickAndUploadAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to set a profile photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const mimeType = guessAvatarMime(asset.uri, asset.mimeType ?? null);
    if (!AVATAR_ALLOWED_MIMES.includes(mimeType)) {
      Alert.alert('Unsupported', 'Please choose a JPEG, PNG, WEBP or HEIC image.');
      return;
    }
    const sizeBytes = asset.fileSize ?? 0;
    if (sizeBytes > AVATAR_MAX_BYTES) {
      Alert.alert('File too large', 'Maximum size is 8 MB.');
      return;
    }
    setAvatarBusy(true);
    try {
      const filename = asset.fileName || `avatar-${Date.now()}.jpg`;
      const urlResp = await getUploadUrl({ data: { filename, mimeType, sizeBytes: sizeBytes || 1 } });
      const fileResp = await fetch(asset.uri);
      const blob = await fileResp.blob();
      const putRes = await fetch(urlResp.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: blob,
      });
      if (!putRes.ok) throw new Error('Upload to storage failed');
      await updateAvatar({ data: { objectPath: urlResp.objectPath } });
      setAvatarPreview(asset.uri);
      await refreshUser();
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    try {
      await updateAvatar({ data: { objectPath: null } });
      setAvatarPreview(null);
      await refreshUser();
    } catch (e) {
      Alert.alert('Could not remove photo', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const onManageAvatar = () => {
    const hasPhoto = !!(avatarPreview || user?.avatarUrl);
    Alert.alert(
      'Profile photo',
      'Your personal photo, shown alongside your business when you chat with customers. This is not your business logo.',
      hasPhoto
        ? [
            { text: hasPhoto && avatarBusy ? 'Working…' : 'Change photo', onPress: () => void pickAndUploadAvatar() },
            { text: 'Remove photo', style: 'destructive', onPress: () => void removeAvatar() },
            { text: 'Cancel', style: 'cancel' },
          ]
        : [
            { text: 'Add photo', onPress: () => void pickAndUploadAvatar() },
            { text: 'Cancel', style: 'cancel' },
          ],
    );
  };
  const { data: unreadData, refetch: refetchUnread } = useGetConversationsUnreadCount({
    query: {
      queryKey: getGetConversationsUnreadCountQueryKey(),
      enabled: isAuthenticated && !isAdmin,
      refetchOnWindowFocus: true,
    },
  });
  const unreadCount = unreadData?.unreadCount ?? 0;

  // Refresh the unread badge whenever this screen regains focus (e.g. after the
  // user reads a thread and navigates back). refetchOnWindowFocus alone does not
  // fire on in-app screen navigation in React Native, so the badge would
  // otherwise stay stale until the next cold app foreground.
  useFocusEffect(
    React.useCallback(() => {
      if (isAuthenticated && !isAdmin) {
        void refetchUnread();
      }
    }, [isAuthenticated, isAdmin, refetchUnread]),
  );

  const { data: me } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: isAuthenticated,
    },
  });
  const updateNotificationSettings = useUpdateNotificationSettings({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      },
    },
  });
  const pushEnabled = me?.pushNotificationsEnabled ?? true;
  const togglePush = (next: boolean) => {
    updateNotificationSettings.mutate({ data: { pushNotificationsEnabled: next } });
  };

  const { data: onboardingStatus } = useGetTraderOnboardingStatus({
    query: {
      queryKey: getGetTraderOnboardingStatusQueryKey(),
      enabled: isAuthenticated && isTrader,
    },
  });
  const onboardingPill = computeOnboardingPill(onboardingStatus);

  const { data: traderReviewCount = 0 } = useQuery({
    queryKey: ['admin', 'trader-review-count'],
    enabled: isAuthenticated && isAdmin && !!adminToken,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await fetch(`${getApiUrl()}/api/admin/traders?status=UNDER_REVIEW`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!res.ok) return 0;
      const json = await res.json();
      const row = (json.counts ?? []).find((c: { status: string; count: number }) => c.status === 'UNDER_REVIEW');
      return row?.count ?? (json.traders?.length ?? 0);
    },
  });
  const { data: accountDeletionCount = 0 } = useQuery({
    queryKey: ['admin', 'account-deletion-count'],
    enabled: isAuthenticated && isAdmin && !!adminToken,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await fetch(`${getApiUrl()}/api/admin/account-deletions?status=REQUESTED`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!res.ok) return 0;
      const json = await res.json();
      return json.total ?? (json.items?.length ?? 0);
    },
  });

  const { data: reminderSettings } = useGetLeadReminderSettings({
    query: {
      queryKey: getGetLeadReminderSettingsQueryKey(),
      enabled: isAuthenticated && isTrader,
    },
  });
  const updateLeadReminder = useUpdateLeadReminderSettings({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetLeadReminderSettingsQueryKey() });
      },
    },
  });
  const reminderValue: number | null =
    reminderSettings?.leadReminderMinutes ?? reminderSettings?.defaultMinutes ?? 60;
  const emailReminderEnabled: boolean = reminderSettings?.leadReminderEmailEnabled ?? true;
  const toggleEmailReminder = (next: boolean) => {
    if (next === emailReminderEnabled) return;
    updateLeadReminder.mutate({ data: { leadReminderEmailEnabled: next } });
  };
  const reminderOptions = [
    { label: '30 min', value: UpdateLeadReminderSettingsRequestLeadReminderMinutes.NUMBER_30 },
    { label: '1 hr', value: UpdateLeadReminderSettingsRequestLeadReminderMinutes.NUMBER_60 },
    { label: '3 hr', value: UpdateLeadReminderSettingsRequestLeadReminderMinutes.NUMBER_180 },
    { label: 'Off', value: UpdateLeadReminderSettingsRequestLeadReminderMinutes.NUMBER_0 },
  ] as const;
  const setReminder = (value: typeof reminderOptions[number]['value']) => {
    if (value === reminderValue) return;
    updateLeadReminder.mutate({ data: { leadReminderMinutes: value } });
  };

  const handleLogout = async () => {
    await logout();
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <ScreenHeader variant="tab" title="Account" />
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.unauthContent}>
          {/* Brand-palette mark (cyan tools on muted cyan) instead of the
              royal-blue logo tile, which clashed with the navy/cyan scheme. */}
          <View style={styles.unauthIconWrap}>
            <MaterialCommunityIcons name="hammer-wrench" size={34} color={Colors.light.primary} />
          </View>

          <Text style={styles.unauthTitle}>Join MyLocalTrade</Text>
          <Text style={styles.unauthSubtitle}>
            Connect with verified local tradespeople or grow your trade business.
          </Text>

          <View style={styles.authButtons}>
            <Pressable
              style={styles.primaryButton}
              accessibilityRole="button"
              accessibilityLabel="Log in"
              onPress={() => router.push('/auth/login')}
            >
              <Text style={styles.primaryButtonText}>Log In</Text>
            </Pressable>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel="Register as Customer"
              onPress={() => router.push('/auth/register-customer')}
            >
              <Feather name="user-plus" size={18} color={Colors.light.primary} style={{ marginRight: 8 }} />
              <Text style={styles.secondaryButtonText}>Register as Customer</Text>
            </Pressable>

            <Pressable
              style={styles.outlineButton}
              accessibilityRole="button"
              accessibilityLabel="Join as a Trader"
              onPress={() => router.push('/auth/register-trader')}
            >
              <Feather name="briefcase" size={18} color={Colors.light.primary} style={{ marginRight: 8 }} />
              <Text style={styles.outlineButtonText}>Join as a Trader</Text>
            </Pressable>
          </View>
        </View>

        {/* Flexible spacer: soaks up spare height on tall screens (capped so
            the help section stays visually attached to the actions) and
            collapses on small screens where the ScrollView takes over. */}
        <View style={styles.unauthSpacer} />

        <Text style={[styles.sectionLabel, styles.sectionLabelUnauth]}>Help & Legal</Text>
        <View style={[styles.group, { marginHorizontal: 16 }]}>
          <MenuRow icon="life-buoy" label="Help, support and legal" onPress={() => router.push('/legal-support')} />
        </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader variant="tab" title="Account" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.light.primary} />
        }
      >
      <View style={styles.profileCard}>
        <Pressable
          onPress={isTrader ? onManageAvatar : undefined}
          disabled={!isTrader || avatarBusy}
          accessibilityLabel={isTrader ? 'Manage profile photo' : undefined}
        >
          <View style={styles.avatar}>
            {avatarPreview || user?.avatarUrl ? (
              <Image
                source={{
                  uri: avatarPreview ?? avatarImageUrl(user?.avatarUrl)!,
                  ...(avatarPreview
                    ? {}
                    : { headers: { Authorization: `Bearer ${adminToken}` } }),
                }}
                style={styles.avatarImage}
              />
            ) : (
              <Text style={styles.avatarText}>
                {user?.fullName?.charAt(0) || user?.email?.charAt(0).toUpperCase()}
              </Text>
            )}
            {avatarBusy ? (
              <View style={styles.avatarBusyOverlay}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : null}
          </View>
          {isTrader ? (
            <View style={styles.avatarEditBadge}>
              <Feather name="camera" size={10} color="#fff" />
            </View>
          ) : null}
        </Pressable>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{user?.fullName}</Text>
          <Text style={styles.profileEmail}>{user?.email}</Text>
          <View style={[styles.roleBadge, isTrader && styles.traderBadge]}>
            <Feather
              name={isAdmin ? 'shield' : isTrader ? 'briefcase' : 'user'}
              size={10}
              color={isTrader ? Colors.light.featured : Colors.light.primary}
            />
            <Text style={[styles.roleText, isTrader && styles.traderRoleText]}>
              {isAdmin ? 'Administrator' : isTrader ? 'Trader Account' : 'Customer Account'}
            </Text>
          </View>
        </View>
      </View>

      {isAdmin ? (
        <>
          <Text style={styles.sectionLabel}>Admin</Text>
          <View style={[styles.group, { marginHorizontal: 16 }]}>
            <MenuRow icon="activity" label="Live Dashboard" sub="Platform stats & live activity" onPress={() => router.push('/admin/stats')} accent />
            <View style={styles.separator} />
            <MenuRow icon="shield" label="Trader Review Queue" sub="Approve or reject trader applications" onPress={() => router.push('/admin')} accent badge={traderReviewCount} />
            <View style={styles.separator} />
            <MenuRow icon="user-x" label="Account Deletion Reviews" sub="Review customer & trader deletion requests" onPress={() => router.push('/admin/account-deletions')} accent badge={accountDeletionCount} />
          </View>
        </>
      ) : null}

      {isTrader ? (
        <>
          <Text style={styles.sectionLabel}>Trader Dashboard</Text>
          <View style={[styles.group, { marginHorizontal: 16 }]}>
            <MenuRow icon="check-circle" label="Onboarding & Verification" sub="Track your verification progress" onPress={() => router.push('/trader-dashboard')} accent pill={onboardingPill} />
            <View style={styles.separator} />
            <MenuRow icon="user" label="Edit Profile" onPress={() => router.push('/trader-dashboard/edit-profile')} />
            <View style={styles.separator} />
            <MenuRow icon="tool" label="My Services" onPress={() => router.push('/trader-dashboard/services')} />
            <View style={styles.separator} />
            <MenuRow icon="image" label="Gallery" onPress={() => router.push('/trader-dashboard/gallery')} />
            <View style={styles.separator} />
            <MenuRow icon="message-square" label="Enquiries & Leads" sub="New customer enquiries and job requests" onPress={() => router.push('/trader-dashboard/leads')} />
            <View style={styles.separator} />
            <View style={styles.separator} />
            <MenuRow icon="credit-card" label="Billing & Plan" onPress={() => router.push('/trader-dashboard/billing')} accent />
          </View>
        </>
      ) : isAdmin ? null : (
        <>
          <Text style={styles.sectionLabel}>My Activity</Text>
          <View style={[styles.group, { marginHorizontal: 16 }]}>
            <MenuRow icon="user" label="Personal Details" sub="Name & phone number" onPress={() => router.push('/personal-details')} />
            <View style={styles.separator} />
            <MenuRow icon="bookmark" label="Saved Traders" onPress={() => router.push('/(tabs)/saved')} />
            <View style={styles.separator} />
            <MenuRow icon="message-circle" label="My Enquiries" onPress={() => router.push('/my-enquiries')} />
            <View style={styles.separator} />
          </View>
        </>
      )}

      <Text style={styles.sectionLabel}>Notifications</Text>
      <View style={[styles.group, { marginHorizontal: 16 }]}>
        <View style={styles.menuRow}>
          <View style={[styles.menuIconWrap, styles.menuIconAccent]}>
            <Feather name="bell" size={16} color={Colors.light.primary} />
          </View>
          <View style={styles.menuText}>
            <Text style={[styles.menuLabel, styles.menuLabelAccent]}>Push notifications</Text>
            <Text style={styles.menuSub} numberOfLines={2}>
              {pushEnabled
                ? 'On for all chats and enquiries'
                : 'Off — you won’t get push alerts on this account'}
            </Text>
          </View>
          <Switch
            value={pushEnabled}
            onValueChange={togglePush}
            disabled={updateNotificationSettings.isPending}
            trackColor={{ false: Colors.light.border, true: Colors.light.primary }}
            thumbColor={Colors.light.white}
          />
        </View>
        {isTrader ? (
          <>
            <View style={styles.separator} />
            <View style={styles.reminderRow}>
              <View style={[styles.menuIconWrap, styles.menuIconAccent]}>
                <Feather name="clock" size={16} color={Colors.light.primary} />
              </View>
              <View style={styles.menuText}>
                <Text style={[styles.menuLabel, styles.menuLabelAccent]}>Lead reminder</Text>
                <Text style={styles.menuSub} numberOfLines={2}>
                  {reminderValue === 0
                    ? 'Off — we won’t nudge you about unopened leads'
                    : `Nudge me ${reminderOptions.find((o) => o.value === reminderValue)?.label ?? `${reminderValue} min`} after a new lead I haven’t opened`}
                </Text>
              </View>
            </View>
            <View style={styles.segmentWrap}>
              {reminderOptions.map((opt) => {
                const selected = opt.value === reminderValue;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setReminder(opt.value)}
                    disabled={updateLeadReminder.isPending}
                    style={[styles.segment, selected && styles.segmentSelected]}
                  >
                    <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.separator} />
            <View style={styles.menuRow}>
              <View style={[styles.menuIconWrap, styles.menuIconAccent]}>
                <Feather name="mail" size={16} color={Colors.light.primary} />
              </View>
              <View style={styles.menuText}>
                <Text style={[styles.menuLabel, styles.menuLabelAccent]}>Email me about unanswered leads</Text>
                <Text style={styles.menuSub} numberOfLines={2}>
                  {emailReminderEnabled
                    ? 'On — we’ll also email you when the push reminder fires'
                    : 'Off — push reminder still fires, but no email is sent'}
                </Text>
              </View>
              <Switch
                value={emailReminderEnabled}
                onValueChange={toggleEmailReminder}
                disabled={updateLeadReminder.isPending}
                trackColor={{ false: Colors.light.border, true: Colors.light.primary }}
                thumbColor={Colors.light.white}
              />
            </View>
          </>
        ) : null}
      </View>

      {!isAdmin ? (
        <>
          <Text style={styles.sectionLabel}>Support & Legal</Text>
          <View style={[styles.group, { marginHorizontal: 16 }]}>
            <MenuRow
              icon="mail"
              label="Contact Support"
              sub="Send us a message"
              onPress={() => router.push('/contact-support')}
              accent
            />
            <View style={styles.separator} />
            <MenuRow icon="info" label="About MyLocalTrade" onPress={() => router.push('/about')} />
            <View style={styles.separator} />
            <MenuRow icon="life-buoy" label="Legal & Support" onPress={() => router.push('/legal-support')} />
          </View>

          <Text style={styles.sectionLabel}>Danger Zone</Text>
          <View style={[styles.group, { marginHorizontal: 16 }]}>
            {me?.deletionStatus === 'REQUESTED' || me?.deletionStatus === 'DISABLED_PENDING_RETENTION' ? (
              <MenuRow
                icon="clock"
                label="Account deletion request pending"
                sub="View deletion status or cancel the request"
                onPress={() => router.push('/account/delete-account')}
                accent
              />
            ) : (
              <MenuRow
                icon="trash-2"
                label="Delete Account"
                sub="Permanently remove your MyLocalTrade account"
                onPress={() => router.push('/account/delete-account')}
              />
            )}
          </View>
        </>
      ) : null}

      <View style={styles.logoutWrap}>
        <Pressable style={styles.logoutButton} onPress={handleLogout}>
          <Feather name="log-out" size={18} color={Colors.light.error} />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
      </View>
      </ScrollView>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  sub,
  onPress,
  accent,
  badge,
  pill,
}: {
  icon: FeatherIconName;
  label: string;
  sub?: string;
  onPress: () => void;
  accent?: boolean;
  badge?: number;
  pill?: OnboardingPill | null;
}) {
  const showBadge = typeof badge === 'number' && badge > 0;
  return (
    <Pressable style={styles.menuRow} onPress={onPress}>
      <View style={[styles.menuIconWrap, accent && styles.menuIconAccent]}>
        <Feather name={icon} size={16} color={accent ? Colors.light.primary : Colors.light.textSecondary} />
      </View>
      <View style={styles.menuText}>
        <Text style={[styles.menuLabel, accent && styles.menuLabelAccent]}>{label}</Text>
        {sub ? <Text style={styles.menuSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {pill ? (
        <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
          <Text style={[styles.statusPillText, { color: pill.fg }]}>{pill.label}</Text>
        </View>
      ) : null}
      {showBadge ? (
        <View style={styles.menuBadge}>
          <Text style={styles.menuBadgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
      <Feather name="chevron-right" size={16} color={Colors.light.textMuted} />
    </Pressable>
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
  unauthContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
    alignItems: 'center',
  },
  unauthIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  unauthTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 8,
  },
  unauthSubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondaryStrong,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 22,
  },
  authButtons: {
    width: '100%',
    gap: 12,
  },
  // Grows on tall screens but never beyond 36pt, so the help section stays
  // near the actions; on small screens it shrinks to 8pt and the screen
  // scrolls normally.
  unauthSpacer: {
    flexGrow: 1,
    minHeight: 8,
    maxHeight: 36,
  },
  sectionLabelUnauth: {
    color: Colors.light.textSecondary,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.primary,
  },
  primaryButtonText: {
    color: Colors.light.white,
    fontSize: 16,
    fontWeight: '700',
  },
  // Tonal cyan fill — sits between the solid Log In button and the outlined
  // trader button so both registration paths read as equal siblings.
  secondaryButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.primaryMuted,
    borderWidth: 1,
    borderColor: `${Colors.light.primary}4D`,
  },
  secondaryButtonText: {
    color: Colors.light.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  outlineButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.light.primary,
  },
  outlineButtonText: {
    color: Colors.light.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.light.border,
  },
  dividerText: {
    color: Colors.light.textSecondary,
    paddingHorizontal: 16,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: Colors.light.card,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarBusyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBadge: {
    position: 'absolute',
    right: 10,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 2,
  },
  profileEmail: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.light.primaryMuted,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  traderBadge: {
    backgroundColor: Colors.light.featuredMuted,
  },
  roleText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.primary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  traderRoleText: {
    color: Colors.light.featured,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 20,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  group: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: 'hidden',
  },
  separator: {
    height: 1,
    backgroundColor: Colors.light.border,
    marginLeft: 58,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  menuIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.light.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconAccent: {
    backgroundColor: Colors.light.primaryMuted,
  },
  menuText: {
    flex: 1,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.light.text,
    letterSpacing: 0.1,
  },
  menuLabelAccent: {
    color: Colors.light.primary,
    fontWeight: '600',
  },
  menuSub: {
    fontSize: 12,
    color: Colors.light.textMuted,
    marginTop: 1,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 6,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  menuBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    backgroundColor: Colors.light.error,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  menuBadgeText: {
    color: Colors.light.white,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  logoutWrap: {
    marginHorizontal: 16,
    marginTop: 28,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    backgroundColor: Colors.light.errorMuted,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.errorMuted,
    gap: 8,
  },
  logoutText: {
    color: Colors.light.error,
    fontSize: 15,
    fontWeight: '600',
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 8,
    gap: 12,
  },
  segmentWrap: {
    flexDirection: 'row',
    marginHorizontal: 14,
    marginBottom: 12,
    backgroundColor: Colors.light.surface,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: {
    backgroundColor: Colors.light.primary,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.textSecondary,
  },
  segmentLabelSelected: {
    color: Colors.light.white,
  },
});
