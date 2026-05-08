import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import type { FeatherIconName } from '@/types/feather-icons';

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isAuthenticated, isTrader, isAdmin, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  if (!isAuthenticated) {
    return (
      <ScrollView
        style={[styles.container, { paddingTop: Math.max(insets.top, 44) }]}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Account</Text>
        </View>

        <View style={styles.unauthContent}>
          <View style={styles.unauthIconWrap}>
            <Feather name="shield" size={40} color={Colors.light.primary} />
          </View>
          <Text style={styles.unauthTitle}>Join MyLocalTrade</Text>
          <Text style={styles.unauthSubtitle}>
            Connect with verified local tradespeople or grow your trade business.
          </Text>

          <View style={styles.authButtons}>
            <Pressable style={styles.primaryButton} onPress={() => router.push('/auth/login')}>
              <Text style={styles.primaryButtonText}>Log In</Text>
            </Pressable>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable style={styles.secondaryButton} onPress={() => router.push('/auth/register-customer')}>
              <Feather name="user-plus" size={18} color={Colors.light.white} style={{ marginRight: 8 }} />
              <Text style={styles.secondaryButtonText}>Register as Customer</Text>
            </Pressable>

            <Pressable style={styles.outlineButton} onPress={() => router.push('/auth/register-trader')}>
              <Feather name="briefcase" size={18} color={Colors.light.primary} style={{ marginRight: 8 }} />
              <Text style={styles.outlineButtonText}>Join as a Trader</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Support & Legal</Text>
        <View style={[styles.group, { marginHorizontal: 16 }]}>
          <MenuRow icon="life-buoy" label="Legal & Support" onPress={() => router.push('/legal-support')} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: Math.max(insets.top, 44) }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Account</Text>
      </View>

      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.fullName?.charAt(0) || user?.email?.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{user?.fullName}</Text>
          <Text style={styles.profileEmail}>{user?.email}</Text>
          <View style={[styles.roleBadge, isTrader && styles.traderBadge]}>
            <Feather
              name={isTrader ? 'briefcase' : 'user'}
              size={10}
              color={isTrader ? Colors.light.featured : Colors.light.primary}
            />
            <Text style={[styles.roleText, isTrader && styles.traderRoleText]}>
              {isTrader ? 'Trader Account' : 'Customer Account'}
            </Text>
          </View>
        </View>
      </View>

      {isAdmin ? (
        <>
          <Text style={styles.sectionLabel}>Admin</Text>
          <View style={[styles.group, { marginHorizontal: 16 }]}>
            <MenuRow icon="shield" label="Trader Review Queue" sub="Approve or reject trader applications" onPress={() => router.push('/admin')} accent />
          </View>
        </>
      ) : null}

      {isTrader ? (
        <>
          <Text style={styles.sectionLabel}>Trader Dashboard</Text>
          <View style={[styles.group, { marginHorizontal: 16 }]}>
            <MenuRow icon="check-circle" label="Onboarding & Verification" sub="Track your verification progress" onPress={() => router.push('/trader-dashboard')} accent />
            <View style={styles.separator} />
            <MenuRow icon="user" label="Edit Profile" onPress={() => router.push('/trader-dashboard/edit-profile')} />
            <View style={styles.separator} />
            <MenuRow icon="tool" label="My Services" onPress={() => router.push('/trader-dashboard/services')} />
            <View style={styles.separator} />
            <MenuRow icon="image" label="Gallery" onPress={() => router.push('/trader-dashboard/gallery')} />
            <View style={styles.separator} />
            <MenuRow icon="message-square" label="My Leads" onPress={() => router.push('/trader-dashboard/leads')} />
            <View style={styles.separator} />
            <MenuRow icon="credit-card" label="Billing & Plan" onPress={() => router.push('/trader-dashboard/billing')} accent />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.sectionLabel}>My Activity</Text>
          <View style={[styles.group, { marginHorizontal: 16 }]}>
            <MenuRow icon="bookmark" label="Saved Traders" onPress={() => router.push('/(tabs)/saved')} />
            <View style={styles.separator} />
            <MenuRow icon="message-circle" label="My Enquiries" onPress={() => router.push('/my-enquiries')} />
          </View>
        </>
      )}

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

      <View style={styles.logoutWrap}>
        <Pressable style={styles.logoutButton} onPress={handleLogout}>
          <Feather name="log-out" size={18} color={Colors.light.error} />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function MenuRow({
  icon,
  label,
  sub,
  onPress,
  accent,
}: {
  icon: FeatherIconName;
  label: string;
  sub?: string;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <Pressable style={styles.menuRow} onPress={onPress}>
      <View style={[styles.menuIconWrap, accent && styles.menuIconAccent]}>
        <Feather name={icon} size={16} color={accent ? Colors.light.primary : Colors.light.textSecondary} />
      </View>
      <View style={styles.menuText}>
        <Text style={[styles.menuLabel, accent && styles.menuLabelAccent]}>{label}</Text>
        {sub ? <Text style={styles.menuSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
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
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unauthIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
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
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  authButtons: {
    width: '100%',
    gap: 12,
    marginBottom: 24,
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
  secondaryButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.secondary,
  },
  secondaryButtonText: {
    color: Colors.light.white,
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
    color: Colors.light.textMuted,
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
});
