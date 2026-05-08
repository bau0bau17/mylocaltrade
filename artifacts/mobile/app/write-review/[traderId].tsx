import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useCreateReview, useGetEligibleEnquiriesForReview } from '@workspace/api-client-react';

export default function WriteReviewScreen() {
  const { traderId, enquiryId } = useLocalSearchParams<{ traderId: string; enquiryId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const traderIdNum = Number(traderId);
  const initialEnquiryId = enquiryId ? Number(enquiryId) : null;

  const { data: eligibleData, isLoading: loadingEligible } = useGetEligibleEnquiriesForReview({
    query: { queryKey: ['/api/reviews/eligible'] },
  });
  const eligibleForThisTrader = (eligibleData?.enquiries ?? []).filter((e) => e.traderId === traderIdNum);

  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [selectedEnquiryId, setSelectedEnquiryId] = useState<number | null>(
    initialEnquiryId ?? eligibleForThisTrader[0]?.enquiryId ?? null,
  );
  const { mutateAsync: createReview, isPending } = useCreateReview();

  React.useEffect(() => {
    if (selectedEnquiryId == null && eligibleForThisTrader[0]) {
      setSelectedEnquiryId(eligibleForThisTrader[0].enquiryId);
    }
  }, [eligibleForThisTrader, selectedEnquiryId]);

  const submit = async () => {
    if (!selectedEnquiryId) {
      Alert.alert('No eligible job', 'You can only review a trader after they respond to one of your enquiries.');
      return;
    }
    if (text.trim().length < 10) {
      Alert.alert('Add a few more words', 'Reviews need at least 10 characters of context.');
      return;
    }
    try {
      await createReview({
        data: { traderId: traderIdNum, enquiryId: selectedEnquiryId, rating, text: text.trim() },
      });
      Alert.alert(
        'Review submitted',
        'Thanks! Your review will be visible after our moderators have reviewed it.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e) {
      Alert.alert('Could not submit', e instanceof Error ? e.message : 'Try again later.');
    }
  };

  if (loadingEligible) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.light.primary} />
      </View>
    );
  }

  if (eligibleForThisTrader.length === 0) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 40, paddingHorizontal: 24 }]}>
        <Feather name="info" size={28} color={Colors.light.textMuted} />
        <Text style={styles.emptyTitle}>No reviewable jobs</Text>
        <Text style={styles.emptyText}>
          You can leave a review once this trader has responded to one of your enquiries.
        </Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Colors.light.background }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32, paddingHorizontal: 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={Colors.light.text} />
        </Pressable>
        <Text style={styles.title}>Leave a review</Text>
        <View style={{ width: 36 }} />
      </View>

      {eligibleForThisTrader.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.label}>Which job?</Text>
          {eligibleForThisTrader.map((e) => {
            const selected = selectedEnquiryId === e.enquiryId;
            return (
              <Pressable
                key={e.enquiryId}
                style={[styles.enquiryRow, selected && styles.enquiryRowActive]}
                onPress={() => setSelectedEnquiryId(e.enquiryId)}
              >
                <Feather name={selected ? 'check-circle' : 'circle'} size={16} color={selected ? Colors.light.primary : Colors.light.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.enquiryService}>{e.serviceRequired}</Text>
                  <Text style={styles.enquiryDate}>{new Date(e.createdAt).toLocaleDateString('en-GB')}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.label}>Rating</Text>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}>
              <Feather name="star" size={36} color={n <= rating ? Colors.light.featured : Colors.light.border} />
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Your review</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={6}
          placeholder="Tell others what the experience was like — quality of work, communication, value for money..."
          placeholderTextColor={Colors.light.textMuted}
          style={styles.textArea}
          maxLength={2000}
        />
        <Text style={styles.charCount}>{text.length} / 2000</Text>
      </View>

      <Pressable style={[styles.submitBtn, isPending && { opacity: 0.6 }]} onPress={submit} disabled={isPending}>
        {isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Submit review</Text>}
      </Pressable>
      <Text style={styles.note}>
        Your review will be checked by our moderators before it appears on the trader's public profile.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: Colors.light.background },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.light.text, marginTop: 8 },
  emptyText: { fontSize: 13, color: Colors.light.textMuted, textAlign: 'center', lineHeight: 19 },
  backBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border },
  backBtnText: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  iconBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: Colors.light.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.border },
  title: { fontSize: 18, fontWeight: '700', color: Colors.light.text },
  section: { marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.light.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 },
  enquiryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.light.border, backgroundColor: Colors.light.card, marginBottom: 8 },
  enquiryRowActive: { borderColor: Colors.light.primary, backgroundColor: Colors.light.primaryMuted },
  enquiryService: { fontSize: 13, fontWeight: '600', color: Colors.light.text },
  enquiryDate: { fontSize: 11, color: Colors.light.textMuted, marginTop: 2 },
  starsRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', paddingVertical: 8 },
  textArea: { backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12, padding: 12, color: Colors.light.text, fontSize: 14, minHeight: 130, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: Colors.light.textMuted, textAlign: 'right', marginTop: 4 },
  submitBtn: { backgroundColor: Colors.light.primary, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  note: { fontSize: 11, color: Colors.light.textMuted, textAlign: 'center', marginTop: 12, lineHeight: 16 },
});
