import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/api-url';
import { useAuth } from '@/contexts/AuthContext';

interface Redemption {
  code: string;
  discountGbp: number;
  originalPriceGbp: number;
  discountedPriceGbp: number;
  expiresAt: string;
  isActive: boolean;
}

function formatRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const totalHours = Math.floor(ms / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `expires in ${days}d ${hours}h`;
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `expires in ${hours}h ${minutes}m`;
  return `expires in ${minutes}m`;
}

/**
 * Shows a discount countdown badge for the trader's active promo redemption.
 * Renders nothing if there is no active redemption.
 */
export function PromoCountdownBadge() {
  const { token, isTrader } = useAuth();
  const [redemption, setRedemption] = useState<Redemption | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!token || !isTrader) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/api/promo/my-redemption`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!cancelled && res.ok) setRedemption(json.redemption);
      } catch {
        // silent — badge just won't show
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, isTrader]);

  // Re-render every minute so the countdown text stays fresh.
  useEffect(() => {
    if (!redemption?.isActive) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [redemption?.isActive]);

  if (!redemption || !redemption.isActive) return null;

  return (
    <View style={styles.badge}>
      <Feather name="tag" size={14} color="#fff" />
      <Text style={styles.text}>
        £{redemption.discountGbp} OFF — {formatRemaining(redemption.expiresAt)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 12,
  },
  text: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
