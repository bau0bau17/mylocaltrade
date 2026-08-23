import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, RefreshControl, Image, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl, avatarImageUrl } from '@/lib/api-url';
import { useSubscription } from '@/lib/revenuecat';
import { teamQueryKey } from '@/lib/team-billing-queries';

// Owner-only team management (Company Teams Phase 1): active members,
// pending invitations, invite / resend / cancel / remove. The API enforces
// every rule (owner-only, brand-new emails, seat cap, single-use tokens);
// this screen just surfaces its answers.

type TeamMember = {
  id: number;
  userId: number;
  fullName: string;
  email: string;
  role: 'OWNER' | 'EMPLOYEE';
  joinedAt: string;
  // The member's OWN personal photo (never the owner's, never the business
  // logo). Served by the membership-gated avatar-file route; null → initials.
  avatarUrl: string | null;
  status: string;
  // Seat suspension (Team billing): suspended members keep their login and
  // can read past work, but can't act until a seat is free again.
  seatSuspended?: boolean;
  seatSuspendedAt?: string | null;
  seatSuspensionSource?: 'OWNER' | 'SYSTEM' | null;
};
type TeamInvite = {
  id: number;
  email: string;
  status: string;
  expiresAt: string;
  createdAt: string;
};
type TeamSeats = {
  // Plan-truthful: used = active employees + seats reserved by pending
  // invitations; max = the employee seat allowance the owner's plan grants
  // (Solo = 0, Team 5/10/20 = 5/10/20). The owner NEVER counts as a seat,
  // and the server never reports a limit the plan doesn't include.
  used: number;
  max: number;
  plan?: string | null;
  planActive?: boolean;
  // `allowance` is sent ONLY while seat enforcement (suspend/reactivate) is
  // switched on server-side; newer servers also say so explicitly via
  // `enforcement`.
  allowance?: number;
  enforcement?: boolean;
  activeEmployees?: number;
  suspendedEmployees?: number;
  reservedInvites?: number;
  available?: number;
  overCapacity?: boolean;
  exemption?: { seatLimit: number; expiresAt: string | null } | null;
};
type TeamData = {
  members: TeamMember[];
  invites: TeamInvite[];
  seats: TeamSeats;
};

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

function formatJoined(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function TeamScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { token, user } = useAuth();
  const {
    isServerStateUpdating,
    serverStateError,
    retryServerState,
  } = useSubscription();
  const qc = useQueryClient();

  const [inviteEmail, setInviteEmail] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  const authHeaders = { Authorization: `Bearer ${token}` };
  const teamKey = teamQueryKey(user?.id);

  const teamQuery = useQuery({
    queryKey: teamKey,
    enabled: !!token && user?.id != null,
    retry: false,
    queryFn: async (): Promise<TeamData> => {
      const res = await fetch(`${getApiUrl()}/api/company/team`, { headers: authHeaders });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw Object.assign(new Error(body?.error ?? 'Failed to load your team'), {
          status: res.status,
        });
      }
      return res.json();
    },
  });

  // Scoped refetch driven by local state — never wire RefreshControl to
  // isRefetching (focus refetches would hold the iOS spinner inset open).
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await teamQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: teamKey });

  const post = async (path: string, body?: unknown) => {
    const res = await fetch(`${getApiUrl()}${path}`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? 'Something went wrong. Please try again.');
    return json;
  };

  const inviteMutation = useMutation({
    mutationFn: (email: string) => post('/api/company/invites', { email }),
    onSuccess: () => {
      setInviteEmail('');
      invalidate();
      Alert.alert('Invitation sent', 'We emailed them a link to join your team.');
    },
    onError: (e: Error) => Alert.alert('Could not send invitation', e.message),
  });

  const resendMutation = useMutation({
    mutationFn: (id: number) => post(`/api/company/invites/${id}/resend`),
    onSuccess: () => {
      invalidate();
      Alert.alert('Invitation resent', 'A fresh link is on its way. The old link no longer works.');
    },
    onError: (e: Error) => Alert.alert('Could not resend', e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => post(`/api/company/invites/${id}/cancel`),
    onSuccess: invalidate,
    onError: (e: Error) => Alert.alert('Could not cancel', e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => post(`/api/company/members/${id}/remove`),
    onSuccess: invalidate,
    onError: (e: Error) => Alert.alert('Could not remove member', e.message),
  });

  const suspendSeatMutation = useMutation({
    mutationFn: (id: number) => post(`/api/company/members/${id}/seat-suspend`),
    onSuccess: invalidate,
    onError: (e: Error) => Alert.alert('Could not suspend the seat', e.message),
  });

  const reactivateSeatMutation = useMutation({
    mutationFn: (id: number) => post(`/api/company/members/${id}/seat-reactivate`),
    onSuccess: invalidate,
    onError: (e: Error) => Alert.alert('Could not reactivate the seat', e.message),
  });

  const confirmSuspendSeat = (member: TeamMember) => {
    Alert.alert(
      'Suspend this seat?',
      `${member.fullName} will keep their login and can still see past work, but won't be able to send messages, quotes or manage bookings until you reactivate them. Their seat becomes free for someone else.`,
      [
        { text: 'Keep active', style: 'cancel' },
        { text: 'Suspend seat', style: 'destructive', onPress: () => suspendSeatMutation.mutate(member.id) },
      ],
    );
  };

  const confirmCancel = (invite: TeamInvite) => {
    Alert.alert('Cancel invitation?', `The invitation to ${invite.email} will stop working immediately.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel invitation', style: 'destructive', onPress: () => cancelMutation.mutate(invite.id) },
    ]);
  };

  const confirmRemove = (member: TeamMember) => {
    Alert.alert(
      'Remove team member?',
      `${member.fullName} will immediately lose access to your business's enquiries and messages. Their past activity is kept.`,
      [
        { text: 'Keep them', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeMutation.mutate(member.id) },
      ],
    );
  };

  const submitInvite = () => {
    const email = inviteEmail.trim();
    if (!email) return;
    inviteMutation.mutate(email);
  };

  if (teamQuery.isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={Colors.light.primary} />
      </View>
    );
  }

  if (teamQuery.isError) {
    const status = (teamQuery.error as Error & { status?: number }).status;
    return (
      <View style={[styles.container, { paddingTop: 24 }]}>
        <View style={styles.card}>
          <Feather name="lock" size={26} color={Colors.light.tabIconDefault} style={{ marginBottom: 10 }} />
          <Text style={styles.cardTitle}>
            {status === 403 ? 'Owner only' : 'Team management unavailable'}
          </Text>
          <Text style={styles.cardBody}>
            {status === 403
              ? 'Only the business owner can manage the team.'
              : (teamQuery.error as Error).message}
          </Text>
        </View>
      </View>
    );
  }

  const data = teamQuery.data!;
  // Plan-truthful seat figures — the server is the source of truth; the
  // legacy used/max pair doubles as a fallback for older servers. Never
  // derive or hardcode a seat limit on the client.
  const seatLimit = data.seats.max;
  const activeEmployees = data.seats.activeEmployees ?? data.seats.used;
  const reservedInvites = data.seats.reservedInvites ?? 0;
  const availableSeats =
    data.seats.available ?? Math.max(0, seatLimit - activeEmployees - reservedInvites);
  // Solo (or inactive) plan: 0 employee seats. Existing employees are
  // grandfathered — they stay active and listed — but no NEW invitations
  // are possible until the owner moves to a Team plan.
  const soloPlan = seatLimit === 0;
  const seatsFull = availableSeats <= 0;
  // Seat management (suspend/reactivate) exists server-side only while Team
  // billing enforcement is on; newer servers signal it explicitly.
  const enforced = data.seats.enforcement ?? typeof data.seats.allowance === 'number';
  const suspendedCount = data.seats.suspendedEmployees ?? 0;

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: tabBarHeight + insets.bottom + 24 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.light.primary} />
      }
      keyboardShouldPersistTaps="handled"
    >
      {isServerStateUpdating || serverStateError ? (
        <View style={[styles.planSyncCard, serverStateError && styles.planSyncError]}>
          {isServerStateUpdating ? (
            <ActivityIndicator size="small" color={Colors.light.primary} />
          ) : (
            <Feather name="alert-circle" size={18} color={Colors.light.warning} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.planSyncTitle}>
              {isServerStateUpdating ? 'Updating your plan…' : 'Plan update needs confirmation'}
            </Text>
            <Text style={styles.planSyncBody}>
              {isServerStateUpdating
                ? 'Refreshing your server-authorized Team seats and availability.'
                : serverStateError}
            </Text>
          </View>
          {serverStateError ? (
            <Pressable
              style={styles.planSyncRetry}
              onPress={() => void retryServerState()}
              accessibilityLabel="Retry plan update"
            >
              <Text style={styles.planSyncRetryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Invite / seats */}
      <View style={styles.inviteCard}>
        {soloPlan ? (
          <>
            {/* Truthful Solo state: no invite form, no invented seat count.
                Grandfathered employees stay listed below; the only path to
                MORE seats is a Team plan. */}
            <Text style={styles.inviteTitle}>Team seats</Text>
            <Text style={styles.inviteSub}>
              {activeEmployees === 1
                ? '1 active employee'
                : `${activeEmployees} active employees`}
              {' · '}Solo plan includes 0 employee seats
            </Text>
            <Pressable
              style={styles.upgradeBtn}
              onPress={() => router.push('/pricing')}
              accessibilityLabel="Change to a Team plan to invite more people"
            >
              <Feather name="arrow-up-circle" size={16} color={Colors.light.white} />
              <Text style={styles.upgradeBtnText}>Change to a Team plan to invite more people</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.inviteTitle}>Invite a team member</Text>
            <Text style={styles.inviteSub}>
              They'll get an email link to create their own login for your business. Use an email
              address that doesn't already have a MyLocalTrade account.
            </Text>
            <View style={styles.inviteRow}>
              <TextInput
                style={[
                  styles.input,
                  emailFocused && styles.inputFocused,
                  (inviteMutation.isPending || seatsFull) && styles.inputDisabled,
                ]}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                placeholder="name@example.com"
                placeholderTextColor={Colors.light.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!inviteMutation.isPending && !seatsFull}
              />
              <Pressable
                style={[styles.inviteBtn, (inviteMutation.isPending || seatsFull || !inviteEmail.trim()) && { opacity: 0.5 }]}
                onPress={submitInvite}
                disabled={inviteMutation.isPending || seatsFull || !inviteEmail.trim()}
              >
                {inviteMutation.isPending ? (
                  <ActivityIndicator color={Colors.light.white} size="small" />
                ) : (
                  <Feather name="send" size={16} color={Colors.light.white} />
                )}
              </Pressable>
            </View>
            <Text style={[styles.seatsLine, seatsFull && { color: Colors.light.warning }]}>
              {activeEmployees} of {seatLimit} employee seat{seatLimit === 1 ? '' : 's'} used
              {reservedInvites > 0
                ? ` · ${reservedInvites} reserved by pending invitation${reservedInvites === 1 ? '' : 's'}`
                : ''}
              {seatsFull
                ? enforced
                  ? ' — suspend a seat, cancel an invitation or upgrade your plan to free one up'
                  : ' — remove a member or cancel an invitation to free one up'
                : ''}
            </Text>
          </>
        )}
        {enforced && suspendedCount > 0 ? (
          <Text style={[styles.seatsLine, { color: Colors.light.warning }]}>
            {suspendedCount} team member{suspendedCount === 1 ? "'s seat is" : "s' seats are"} suspended —
            they keep their login and history, and you can reactivate them when a seat is free.
          </Text>
        ) : null}
        {enforced && suspendedCount > 0 && data.seats.overCapacity ? (
          <Text style={[styles.seatsLine, { color: Colors.light.warning }]}>
            Your team is over your plan's seat allowance. Upgrade your plan to reactivate everyone.
          </Text>
        ) : null}
      </View>

      {/* Pending invitations */}
      {data.invites.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Pending invitations</Text>
          <View style={styles.group}>
            {data.invites.map((invite, i) => {
              const expired = invite.status === 'EXPIRED';
              const days = daysUntil(invite.expiresAt);
              return (
                <View key={invite.id}>
                  {i > 0 ? <View style={styles.separator} /> : null}
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{invite.email}</Text>
                      <Text style={[styles.rowSub, expired && { color: Colors.light.warning }]}>
                        {expired
                          ? 'Expired — resend to issue a fresh link'
                          : `Expires in ${Math.max(days, 1)} day${days === 1 ? '' : 's'}`}
                      </Text>
                    </View>
                    <Pressable
                      style={styles.smallBtn}
                      onPress={() => resendMutation.mutate(invite.id)}
                      disabled={resendMutation.isPending}
                      hitSlop={6}
                    >
                      <Text style={styles.smallBtnText}>Resend</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.smallBtn, styles.smallBtnDanger]}
                      onPress={() => confirmCancel(invite)}
                      disabled={cancelMutation.isPending}
                      hitSlop={6}
                    >
                      <Text style={[styles.smallBtnText, styles.smallBtnDangerText]}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {/* Members */}
      <Text style={styles.sectionLabel}>Team members</Text>
      <View style={styles.group}>
        {data.members.map((member, i) => (
          <View key={member.id}>
            {i > 0 ? <View style={styles.separator} /> : null}
            <Pressable
              style={styles.row}
              onPress={() => setSelectedMember(member)}
              accessibilityLabel={`View ${member.fullName}'s details`}
            >
              <View style={[styles.avatar, member.role === 'OWNER' && styles.avatarOwner]}>
                {member.avatarUrl ? (
                  <Image
                    source={{
                      uri: avatarImageUrl(member.avatarUrl)!,
                      headers: { Authorization: `Bearer ${token}` },
                    }}
                    style={styles.avatarImg}
                  />
                ) : (
                  <Text
                    style={[
                      styles.avatarInitials,
                      member.role === 'OWNER' && { color: Colors.light.primary },
                    ]}
                  >
                    {initialsOf(member.fullName)}
                  </Text>
                )}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{member.fullName}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{member.email}</Text>
                {member.seatSuspended ? (
                  <Text style={[styles.rowSub, { color: Colors.light.warning }]} numberOfLines={1}>
                    Seat suspended{member.seatSuspensionSource === 'SYSTEM' ? ' (plan change)' : ''}
                  </Text>
                ) : null}
              </View>
              <View
                style={[
                  styles.roleChip,
                  member.role === 'OWNER' && styles.roleChipOwner,
                  member.seatSuspended && styles.roleChipSuspended,
                ]}
              >
                <Text
                  style={[
                    styles.roleChipText,
                    member.role === 'OWNER' && styles.roleChipTextOwner,
                    member.seatSuspended && styles.roleChipTextSuspended,
                  ]}
                >
                  {member.role === 'OWNER' ? 'Owner' : member.seatSuspended ? 'Suspended' : 'Employee'}
                </Text>
              </View>
              {member.role === 'EMPLOYEE' && enforced ? (
                member.seatSuspended ? (
                  <Pressable
                    style={[styles.smallBtn, { marginLeft: 8 }]}
                    onPress={() => reactivateSeatMutation.mutate(member.id)}
                    disabled={reactivateSeatMutation.isPending}
                    hitSlop={6}
                  >
                    <Text style={styles.smallBtnText}>Reactivate</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[styles.smallBtn, { marginLeft: 8 }]}
                    onPress={() => confirmSuspendSeat(member)}
                    disabled={suspendSeatMutation.isPending}
                    hitSlop={6}
                  >
                    <Text style={styles.smallBtnText}>Suspend</Text>
                  </Pressable>
                )
              ) : null}
              {member.role === 'EMPLOYEE' ? (
                <Pressable
                  style={[styles.smallBtn, styles.smallBtnDanger, { marginLeft: 8 }]}
                  onPress={() => confirmRemove(member)}
                  disabled={removeMutation.isPending}
                  hitSlop={6}
                >
                  <Text style={[styles.smallBtnText, styles.smallBtnDangerText]}>Remove</Text>
                </Pressable>
              ) : null}
            </Pressable>
          </View>
        ))}
      </View>

      <Text style={styles.footNote}>
        Team members can see and reply to your business's enquiries. Only you can edit the
        business profile, manage documents, billing and the team itself.
      </Text>
    </ScrollView>

    {/* Member detail — dark-themed sheet matching the app theme. */}
    <Modal
      visible={selectedMember != null}
      transparent
      animationType="fade"
      onRequestClose={() => setSelectedMember(null)}
    >
      <Pressable style={styles.modalBackdrop} onPress={() => setSelectedMember(null)}>
        <Pressable style={styles.modalCard} onPress={() => {}}>
          {selectedMember ? (
            <>
              <View style={styles.modalAvatar}>
                {selectedMember.avatarUrl ? (
                  <Image
                    source={{
                      uri: avatarImageUrl(selectedMember.avatarUrl)!,
                      headers: { Authorization: `Bearer ${token}` },
                    }}
                    style={styles.modalAvatarImg}
                  />
                ) : (
                  <Text style={styles.modalInitials}>{initialsOf(selectedMember.fullName)}</Text>
                )}
              </View>
              <Text style={styles.modalName}>{selectedMember.fullName}</Text>
              <Text style={styles.modalEmail}>{selectedMember.email}</Text>
              <View style={styles.modalMeta}>
                <View style={styles.modalMetaRow}>
                  <Text style={styles.modalMetaLabel}>Role</Text>
                  <Text style={styles.modalMetaValue}>
                    {selectedMember.role === 'OWNER' ? 'Owner' : 'Employee'}
                  </Text>
                </View>
                <View style={styles.modalMetaDivider} />
                <View style={styles.modalMetaRow}>
                  <Text style={styles.modalMetaLabel}>Status</Text>
                  <Text
                    style={[
                      styles.modalMetaValue,
                      {
                        color: selectedMember.seatSuspended
                          ? Colors.light.warning
                          : Colors.light.success,
                      },
                    ]}
                  >
                    {selectedMember.seatSuspended
                      ? 'Seat suspended'
                      : selectedMember.status === 'ACTIVE'
                        ? 'Active'
                        : selectedMember.status}
                  </Text>
                </View>
                <View style={styles.modalMetaDivider} />
                <View style={styles.modalMetaRow}>
                  <Text style={styles.modalMetaLabel}>Joined</Text>
                  <Text style={styles.modalMetaValue}>{formatJoined(selectedMember.joinedAt)}</Text>
                </View>
              </View>
              <Pressable style={styles.modalCloseBtn} onPress={() => setSelectedMember(null)}>
                <Text style={styles.modalCloseText}>Close</Text>
              </Pressable>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  planSyncCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.light.primaryMuted,
    borderColor: Colors.light.primary,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  planSyncError: {
    backgroundColor: Colors.light.surface,
    borderColor: Colors.light.warning,
  },
  planSyncTitle: { color: Colors.light.text, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  planSyncBody: { color: Colors.light.textSecondary, fontSize: 12, lineHeight: 17 },
  planSyncRetry: {
    backgroundColor: Colors.light.primary,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  planSyncRetryText: { color: Colors.light.white, fontSize: 12, fontWeight: '700' },
  center: { alignItems: 'center', justifyContent: 'center' },
  inviteCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 16,
    marginBottom: 8,
  },
  inviteTitle: { fontSize: 16, fontWeight: '700', color: Colors.light.text, marginBottom: 4 },
  inviteSub: { fontSize: 13, color: Colors.light.textSecondary, lineHeight: 18, marginBottom: 12 },
  inviteRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.light.borderLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colors.light.text,
    backgroundColor: Colors.light.background,
  },
  inputFocused: { borderColor: Colors.light.primary },
  inputDisabled: { opacity: 0.55 },
  inviteBtn: {
    backgroundColor: Colors.light.primary,
    borderRadius: 10,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatsLine: { fontSize: 12, color: Colors.light.textSecondary, marginTop: 10 },
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.light.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  upgradeBtnText: { color: Colors.light.white, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.tabIconDefault,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
  },
  group: {
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: 'hidden',
  },
  separator: { height: 1, backgroundColor: Colors.light.border, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  rowText: { flex: 1, marginRight: 8 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: Colors.light.text },
  rowSub: { fontSize: 12.5, color: Colors.light.textSecondary, marginTop: 2 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.light.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    overflow: 'hidden',
  },
  avatarOwner: { backgroundColor: Colors.light.primaryMuted },
  avatarImg: { width: 34, height: 34, borderRadius: 17 },
  avatarInitials: { fontSize: 12, fontWeight: '700', color: Colors.light.textSecondaryStrong },
  roleChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  roleChipOwner: { backgroundColor: 'rgba(0, 180, 216, 0.10)', borderColor: 'rgba(0, 180, 216, 0.35)' },
  roleChipSuspended: { backgroundColor: 'rgba(245, 158, 11, 0.10)', borderColor: 'rgba(245, 158, 11, 0.35)' },
  roleChipText: { fontSize: 11.5, fontWeight: '600', color: Colors.light.tabIconDefault },
  roleChipTextOwner: { color: Colors.light.primary },
  roleChipTextSuspended: { color: Colors.light.warning },
  smallBtn: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.light.borderLight,
    marginLeft: 6,
    backgroundColor: Colors.light.cardElevated,
  },
  smallBtnText: { fontSize: 12.5, fontWeight: '600', color: Colors.light.text },
  smallBtnDanger: { borderColor: 'rgba(239, 68, 68, 0.4)' },
  smallBtnDangerText: { color: Colors.light.error },
  footNote: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    lineHeight: 18,
    marginTop: 16,
    marginHorizontal: 4,
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 24,
    alignItems: 'center',
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.text, marginBottom: 6, textAlign: 'center' },
  cardBody: { fontSize: 14, color: Colors.light.textSecondary, textAlign: 'center', lineHeight: 20 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(3, 7, 18, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    alignSelf: 'stretch',
    backgroundColor: Colors.light.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 24,
    alignItems: 'center',
  },
  modalAvatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: Colors.light.cardElevated,
    borderWidth: 1,
    borderColor: Colors.light.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 14,
  },
  modalAvatarImg: { width: 84, height: 84, borderRadius: 42 },
  modalInitials: { fontSize: 28, fontWeight: '700', color: Colors.light.textSecondaryStrong },
  modalName: { fontSize: 19, fontWeight: '700', color: Colors.light.text, textAlign: 'center' },
  modalEmail: { fontSize: 13.5, color: Colors.light.textSecondary, marginTop: 3, textAlign: 'center' },
  modalMeta: {
    alignSelf: 'stretch',
    backgroundColor: Colors.light.cardElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginTop: 18,
  },
  modalMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  modalMetaDivider: { height: 1, backgroundColor: Colors.light.border },
  modalMetaLabel: { fontSize: 13, color: Colors.light.textSecondary },
  modalMetaValue: { fontSize: 13.5, fontWeight: '600', color: Colors.light.text },
  modalCloseBtn: {
    alignSelf: 'stretch',
    marginTop: 18,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: Colors.light.primary,
  },
  modalCloseText: { fontSize: 15, fontWeight: '700', color: Colors.light.white },
});
