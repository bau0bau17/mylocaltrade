import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
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
          <Feather name="shield" size={64} color={Colors.light.primary} style={styles.unauthIcon} />
          <Text style={styles.unauthTitle}>Join MyLocalTrade</Text>
          <Text style={styles.unauthSubtitle}>
            Connect with verified local tradespeople or grow your trade business.
          </Text>

          <View style={styles.authButtons}>
            <Pressable 
              style={[styles.button, styles.primaryButton]} 
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
              style={[styles.button, styles.secondaryButton]} 
              onPress={() => router.push('/auth/register-customer')}
            >
              <Text style={styles.secondaryButtonText}>Register as Customer</Text>
            </Pressable>

            <Pressable 
              style={[styles.button, styles.outlineButton]} 
              onPress={() => router.push('/auth/register-trader')}
            >
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
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{isTrader ? 'Trader' : 'Customer'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.menuSection}>
        {isTrader ? (
          <>
            <Text style={styles.sectionTitle}>Trader Dashboard</Text>
            <MenuButton icon="user" label="Edit Profile" onPress={() => router.push('/trader-dashboard/edit-profile')} />
            <MenuButton icon="tool" label="My Services" onPress={() => router.push('/trader-dashboard/services')} />
            <MenuButton icon="image" label="Gallery" onPress={() => router.push('/trader-dashboard/gallery')} />
            <MenuButton icon="message-square" label="My Leads" onPress={() => router.push('/trader-dashboard/leads')} />
            <MenuButton icon="credit-card" label="Billing & Plan" onPress={() => router.push('/trader-dashboard/billing')} />
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Customer Menu</Text>
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
          <Feather name="log-out" size={20} color={Colors.light.error} />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function MenuButton({ icon, label, onPress }: { icon: FeatherIconName; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.menuItem} onPress={onPress}>
      <Feather name={icon} size={20} color={Colors.light.textSecondary} />
      <Text style={styles.menuLabel}>{label}</Text>
      <Feather name="chevron-right" size={20} color={Colors.light.border} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    padding: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.light.text,
  },
  unauthContent: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unauthIcon: {
    marginBottom: 24,
  },
  unauthTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 12,
  },
  unauthSubtitle: {
    fontSize: 16,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  authButtons: {
    width: '100%',
    gap: 16,
  },
  button: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: Colors.light.primary,
  },
  primaryButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: Colors.light.secondary,
  },
  secondaryButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
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
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.light.border,
  },
  dividerText: {
    color: Colors.light.textSecondary,
    paddingHorizontal: 16,
    fontSize: 14,
    fontWeight: '500',
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    backgroundColor: Colors.light.card,
    marginHorizontal: 16,
    borderRadius: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.primary,
  },
  menuSection: {
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  menuLabel: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
    marginLeft: 12,
    fontWeight: '500',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    marginTop: 24,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  logoutText: {
    color: Colors.light.error,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});