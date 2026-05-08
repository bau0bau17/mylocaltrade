import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

export default function ContactSupportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [form, setForm] = useState({
    name: user?.fullName ?? '',
    email: user?.email ?? '',
    subject: '',
    message: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [rateLimited, setRateLimited] = useState<{ nextAllowedAt: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSend = async () => {
    setErrorMsg(null);
    if (!form.name.trim() || !form.email.trim() || !form.subject.trim() || !form.message.trim()) {
      setErrorMsg('Please fill in all fields before sending.');
      return;
    }
    if (!form.email.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (form.message.trim().length < 10) {
      setErrorMsg('Please write a more detailed message (at least 10 characters).');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429 && data?.code === 'CONTACT_RATE_LIMIT') {
        setRateLimited({ nextAllowedAt: data.nextAllowedAt });
        return;
      }
      if (!res.ok) throw new Error(data.error || `Failed to send (HTTP ${res.status})`);
      setSent(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not send message. Check your connection and try again.';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const formatRelative = (iso: string) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'shortly';
    const hours = Math.ceil(ms / (60 * 60 * 1000));
    if (hours >= 24) {
      const days = Math.ceil(hours / 24);
      return `in about ${days} day${days > 1 ? 's' : ''}`;
    }
    return `in about ${hours} hour${hours > 1 ? 's' : ''}`;
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 44) }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <Feather name="chevron-left" size={24} color={Colors.light.primary} />
        </Pressable>
        <Text style={styles.title}>Contact Support</Text>
      </View>

      {rateLimited ? (
        <ScrollView
          contentContainerStyle={[styles.successContainer, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.successIcon, { backgroundColor: '#3A2A0E' }]}>
            <Feather name="alert-circle" size={48} color="#F59E0B" />
          </View>
          <Text style={styles.successTitle}>We're On It</Text>
          <Text style={styles.successSub}>
            We're already working on a reply to your previous messages — thank you
            for your patience.
          </Text>
          <View style={[styles.slaCard, { borderColor: '#F59E0B' }]}>
            <Feather name="info" size={18} color="#F59E0B" />
            <Text style={styles.slaText}>
              To prevent misuse, contact messages are limited to{' '}
              <Text style={styles.slaBold}>2 per 48 hours</Text>. You can send a
              new message <Text style={styles.slaBold}>{formatRelative(rateLimited.nextAllowedAt)}</Text>.
              We're working hard to get back to you as soon as possible.
            </Text>
          </View>
          <Pressable style={styles.doneBtn} onPress={() => router.back()}>
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </ScrollView>
      ) : sent ? (
        <ScrollView
          contentContainerStyle={[styles.successContainer, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.successIcon}>
            <Feather name="check-circle" size={48} color={Colors.light.secondary} />
          </View>
          <Text style={styles.successTitle}>Thank You!</Text>
          <Text style={styles.successSub}>
            We've received your message. Our support team will get back to you
            at <Text style={styles.successEmail}>{form.email}</Text> as soon as
            possible.
          </Text>
          <View style={styles.slaCard}>
            <Feather name="clock" size={18} color={Colors.light.primary} />
            <Text style={styles.slaText}>
              We aim to reply within{' '}
              <Text style={styles.slaBold}>48 working hours</Text>, though
              occasionally it may take a little longer during busy periods.
              Thanks for your patience.
            </Text>
          </View>
          <Pressable style={styles.doneBtn} onPress={() => router.back()}>
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.infoBox}>
            <Feather name="clock" size={14} color={Colors.light.primary} />
            <Text style={styles.infoText}>
              We aim to answer within 48 hours (working days).
            </Text>
          </View>

          <View style={styles.form}>
            <Field label="Your Name *">
              <Feather name="user" size={16} color={Colors.light.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Full name"
                placeholderTextColor={Colors.light.textMuted}
                value={form.name}
                onChangeText={(t) => setForm(p => ({ ...p, name: t }))}
              />
            </Field>

            <Field label="Email Address *">
              <Feather name="mail" size={16} color={Colors.light.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="your@email.com"
                placeholderTextColor={Colors.light.textMuted}
                value={form.email}
                onChangeText={(t) => setForm(p => ({ ...p, email: t }))}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </Field>

            <Field label="Subject *">
              <Feather name="tag" size={16} color={Colors.light.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="What is your enquiry about?"
                placeholderTextColor={Colors.light.textMuted}
                value={form.subject}
                onChangeText={(t) => setForm(p => ({ ...p, subject: t }))}
              />
            </Field>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Message *</Text>
              <View style={styles.textAreaWrap}>
                <TextInput
                  style={styles.textArea}
                  placeholder="Describe your issue or question in detail..."
                  placeholderTextColor={Colors.light.textMuted}
                  value={form.message}
                  onChangeText={(t) => setForm(p => ({ ...p, message: t }))}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                />
              </View>
              <Text style={styles.charCount}>{form.message.length} / 2000</Text>
            </View>

            {errorMsg ? (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={16} color="#DC2626" />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.sendBtn, isLoading && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color={Colors.light.white} />
              ) : (
                <>
                  <Feather name="send" size={16} color={Colors.light.white} />
                  <Text style={styles.sendBtnText}>Send Message</Text>
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>{children}</View>
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
  scroll: {
    padding: 16,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.light.primaryMuted,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.light.textSecondary,
    lineHeight: 19,
  },
  form: {
    gap: 16,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.light.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
    gap: 10,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    color: Colors.light.text,
  },
  textAreaWrap: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 14,
    padding: 14,
    minHeight: 140,
  },
  textArea: {
    fontSize: 15,
    color: Colors.light.text,
    lineHeight: 22,
    minHeight: 112,
  },
  charCount: {
    fontSize: 11,
    color: Colors.light.textMuted,
    textAlign: 'right',
    marginRight: 4,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#991B1B',
    lineHeight: 19,
    fontWeight: '500',
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.primary,
    height: 52,
    borderRadius: 14,
    gap: 8,
    marginTop: 8,
  },
  sendBtnDisabled: {
    opacity: 0.6,
  },
  sendBtnText: {
    color: Colors.light.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  successContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  slaCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: Colors.light.primaryMuted,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 28,
  },
  slaText: {
    flex: 1,
    fontSize: 14,
    color: Colors.light.textSecondary,
    lineHeight: 21,
  },
  slaBold: {
    color: Colors.light.text,
    fontWeight: '700',
  },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: Colors.light.secondaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 12,
  },
  successSub: {
    fontSize: 15,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  successEmail: {
    color: Colors.light.primary,
    fontWeight: '600',
  },
  doneBtn: {
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 48,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: Colors.light.white,
    fontSize: 16,
    fontWeight: '700',
  },
});
