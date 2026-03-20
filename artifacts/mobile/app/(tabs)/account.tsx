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
  const { user, isAuthenticated, isTrader, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  if (!isAuthenticated) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
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
            <Pressable 
              style={styles.primaryButton} 
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
              onPress={() => router.push('/auth/register-customer')}
            >
              <Feather name="user-plus" size={18} color={Colors.light.white} style={{ marginRight: 8 }} />
              <Text style={styles.secondaryButtonText}>Register as Customer</Text>
            </Pressable>

            <Pressable 
              style={styles.outlineButton} 
              onPress={() => router.push('/auth/register-trader')}
            >
              <Feather name="briefcase" size={18} color={Colors.light.primary} style={{ marginRight: 8 }} />
              <Text style={styles.outlineButtonText}>Join as a Trader</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView 
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 84 + 20 }}
    >
      <View style={styles.header}>
        <Text style={styles.title}>My Account</Text>
      </View>

      <View style={styles.profileSection}>
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
              {isTrader ? 'Trader' : 'Customer'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.menuSection}>
        {isTrader ? (
          <>
            <Text style={styles.sectionTitle}>Dashboard</Text>
            <MenuButton icon="user" label="Edit Profile" onPress={() => router.push('/trader-dashboard/edit-profile')} />
            <MenuButton icon="tool" label="My Services" onPress={() => router.push('/trader-dashboard/services')} />
            <MenuButton icon="image" label="Gallery" onPress={() => router.push('/trader-dashboard/gallery')} />
            <MenuButton icon="message-square" label="My Leads" onPress={() => router.push('/trader-dashboard/leads')} />
            <MenuButton icon="credit-card" label="Billing & Plan" onPress={() => router.push('/trader-dashboard/billing')} accent />
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>My Activity</Text>
            <MenuButton icon="bookmark" label="Saved Traders" onPress={() => router.push('/saved-traders')} />
            <MenuButton icon="message-circle" label="My Enquiries" onPress={() => router.push('/my-enquiries')} />
          </>
        )}

        <Text style={styles.sectionTitle}>Support & Info</Text>
        <MenuButton icon="info" label="About Us" onPress={() => router.push('/about')} />
        <MenuButton icon="file-text" label="Terms & Conditions" onPress={() => router.push('/terms')} />
        <MenuButton icon="shield" label="Privacy Policy" onPress={() => router.push('/privacy')} />
        <MenuButton icon="refresh-ccw" label="Refund Policy" onPress={() => router.push('/refund')} />

        <Pressable style={styles.logoutButton} onPress={handleLogout}>
          <Feather name="log-out" size={18} color={Colors.light.error} />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function MenuButton({ icon, label, onPress, accent }: { icon: FeatherIconName; label: string; onPress: () => void; accent?: boolean }) {
  return (
    <Pressable style={[styles.menuItem, accent && styles.menuItemAccent]} onPress={onPress}>
      <View style={[styles.menuIconWrap, accent && styles.menuIconAccent]}>
        <Feather name={icon} size={16} color={accent ? Colors.light.primary : Colors.light.textSecondary} />
      </View>
      <Text style={styles.menuLabel}>{label}</Text>
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
    padding: 20,
    paddingBottom: 12,
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
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: Colors.light.card,
    marginHorizontal: 16,
    borderRadius: 18,
    marginBottom: 24,
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
  menuSection: {
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    padding: 14,
    borderRadius: 14,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  menuItemAccent: {
    borderColor: Colors.light.primary,
    backgroundColor: Colors.light.primaryMuted,
  },
  menuIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.light.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconAccent: {
    backgroundColor: Colors.light.card,
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    color: Colors.light.text,
    marginLeft: 12,
    fontWeight: '500',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    marginTop: 24,
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
