import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import type { FeatherIconName } from '@/types/feather-icons';

const CONTACT_EMAIL = 'support@mylocaltrade.co.uk';

export default function LegalSupportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleContact = () => {
    router.push('/contact-support');
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 44) }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <Feather name="chevron-left" size={24} color={Colors.light.primary} />
        </Pressable>
        <Text style={styles.title}>Legal & Support</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>Legal Documents</Text>
        <View style={styles.group}>
          <MenuRow
            icon="shield"
            label="Privacy Policy"
            sub="How we handle your data"
            onPress={() => router.push('/privacy')}
          />
          <View style={styles.separator} />
          <MenuRow
            icon="file-text"
            label="Terms & Conditions"
            sub="Rules for using MyLocalTrade"
            onPress={() => router.push('/terms')}
          />
          <View style={styles.separator} />
          <MenuRow
            icon="refresh-ccw"
            label="Refund & Cancellation Policy"
            sub="Subscription cancellation terms"
            onPress={() => router.push('/refund')}
          />
          <View style={styles.separator} />
          <MenuRow
            icon="settings"
            label="Cookie Policy"
            sub="How we use cookies and similar technologies"
            onPress={() => router.push('/cookie-policy')}
          />
        </View>

        <Text style={styles.sectionLabel}>Trust & Safety</Text>
        <View style={styles.group}>
          <MenuRow
            icon="check-circle"
            label="How Verification Works"
            sub="What we check and what we don't"
            onPress={() => router.push('/how-verification-works')}
          />
          <View style={styles.separator} />
          <MenuRow
            icon="shield"
            label="Customer Safety Advice"
            sub="Tips before hiring a tradesperson"
            onPress={() => router.push('/safety-advice')}
          />
          <View style={styles.separator} />
          <MenuRow
            icon="award"
            label="Trader Code of Conduct"
            sub="Standards we expect from traders"
            onPress={() => router.push('/code-of-conduct')}
          />
          <View style={styles.separator} />
          <MenuRow
            icon="alert-circle"
            label="Report a Trader"
            sub="Raise a concern about a listing"
            onPress={() => router.push('/report-trader')}
          />
          <View style={styles.separator} />
          <MenuRow
            icon="flag"
            label="Complaints Procedure"
            sub="How to make a complaint"
            onPress={() => router.push('/complaints')}
          />
        </View>

        <Text style={styles.sectionLabel}>Support</Text>
        <View style={styles.group}>
          <MenuRow
            icon="mail"
            label="Contact Support"
            onPress={handleContact}
            accent
          />
          <View style={styles.separator} />
          <MenuRow
            icon="info"
            label="About MyLocalTrade"
            sub="Our story and mission"
            onPress={() => router.push('/about')}
          />
        </View>

        <Text style={styles.sectionLabel}>Company Information</Text>
        <View style={styles.companyCard}>
          <View style={styles.companyRow}>
            <Feather name="briefcase" size={14} color={Colors.light.primary} />
            <Text style={styles.companyName}>Service Provider LTD</Text>
          </View>
          <View style={styles.companyDivider} />
          <CompanyDetail label="Registration" value="Registered in England and Wales" />
          <CompanyDetail label="Company Number" value="15830141" />
          <CompanyDetail label="Registered Address" value={"71-75 Shelton Street\nCovent Garden, London\nWC2H 9JQ"} />
          <CompanyDetail label="Support Email" value={CONTACT_EMAIL} />
          <CompanyDetail label="ICO Registration" value="ZB724124 (Data Protection)" />
        </View>

        <Text style={styles.copyright}>
          © {new Date().getFullYear()} MyLocalTrade. All rights reserved.
        </Text>
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
        {sub && <Text style={styles.menuSub} numberOfLines={1}>{sub}</Text>}
      </View>
      <Feather name="chevron-right" size={16} color={Colors.light.textMuted} />
    </Pressable>
  );
}

function CompanyDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.companyDetailRow}>
      <Text style={styles.companyDetailLabel}>{label}</Text>
      <Text style={styles.companyDetailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.light.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.3,
  },
  scrollContent: {
    padding: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.light.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
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
    marginLeft: 56,
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
  companyCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 16,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  companyName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 0.2,
  },
  companyDivider: {
    height: 1,
    backgroundColor: Colors.light.border,
    marginBottom: 12,
  },
  companyDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 12,
  },
  companyDetailLabel: {
    fontSize: 12,
    color: Colors.light.textMuted,
    fontWeight: '600',
    letterSpacing: 0.2,
    flexShrink: 0,
    minWidth: 100,
  },
  companyDetailValue: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    flex: 1,
    textAlign: 'right',
    lineHeight: 18,
  },
  copyright: {
    fontSize: 11,
    color: Colors.light.textMuted,
    textAlign: 'center',
    marginTop: 28,
    letterSpacing: 0.2,
  },
});
