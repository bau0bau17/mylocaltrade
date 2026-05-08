import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import {
  useGetConversations,
  type ConversationSummary,
} from "@workspace/api-client-react";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-GB");
}

const STATUS_LABEL: Record<string, string> = {
  AWAITING_TRADER_REPLY: "Awaiting trader",
  AWAITING_CUSTOMER_REPLY: "Awaiting you",
  CLOSED: "Closed",
  BLOCKED: "Blocked",
  REPORTED: "Reported",
};

export default function MessagesIndexScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAuthenticated, isTrader } = useAuth();

  if (!isAuthenticated) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Log in to view your messages</Text>
        <Pressable style={styles.cta} onPress={() => router.push("/auth/login")}>
          <Text style={styles.ctaText}>Log In</Text>
        </Pressable>
      </View>
    );
  }

  return <MessagesList isTrader={isTrader} />;
}

function MessagesList({ isTrader }: { isTrader: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useGetConversations();

  if (isLoading && !isRefetching) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  const conversations: ConversationSummary[] = data?.conversations ?? [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.subtitle}>
          {isTrader ? "Conversations with customers" : "Conversations with traders"}
        </Text>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={Colors.light.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="message-circle" size={28} color={Colors.light.primary} />
            </View>
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptySub}>
              {isTrader
                ? "When a customer enquires about your services, you'll be able to reply here."
                : "Send an enquiry to a trader to start a conversation."}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const otherName = isTrader ? item.customerName : item.traderBusinessName;
          const unread = item.unreadCount > 0;
          return (
            <Pressable
              style={[styles.row, unread && styles.rowUnread]}
              onPress={() => router.push(`/messages/${item.id}`)}
            >
              <View style={[styles.avatar, unread && styles.avatarUnread]}>
                <Text style={styles.avatarText}>
                  {otherName?.charAt(0)?.toUpperCase() ?? "?"}
                </Text>
                {unread ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.unreadCount}</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text
                    style={[styles.rowName, unread && styles.rowNameUnread]}
                    numberOfLines={1}
                  >
                    {otherName}
                  </Text>
                  <Text style={styles.rowTime}>{timeAgo(item.lastMessageAt)}</Text>
                </View>
                <Text style={styles.rowPreview} numberOfLines={1}>
                  {item.lastMessagePreview ?? "(no messages yet)"}
                </Text>
                <View style={styles.rowFooter}>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusText}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </Text>
                  </View>
                  {isTrader ? (
                    <View style={[styles.statusPill, styles.tStatusPill]}>
                      <Text style={[styles.statusText, styles.tStatusText]}>
                        {item.traderStatus}
                      </Text>
                    </View>
                  ) : null}
                  {item.muted ? (
                    <View style={[styles.statusPill, styles.mutedPill]}>
                      <Feather name="bell-off" size={10} color={Colors.light.textSecondary} />
                      <Text style={[styles.statusText, styles.mutedText]}>Muted</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // shared
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: {
    flex: 1,
    backgroundColor: Colors.light.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    backgroundColor: Colors.light.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.light.text,
    letterSpacing: 0.3,
  },
  subtitle: { fontSize: 13, color: Colors.light.textSecondary, marginTop: 4 },
  empty: { alignItems: "center", padding: 32, marginTop: 40 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.light.text,
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  cta: {
    marginTop: 18,
    backgroundColor: Colors.light.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  ctaText: { color: Colors.light.white, fontWeight: "700", fontSize: 15 },
  row: {
    flexDirection: "row",
    backgroundColor: Colors.light.card,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 10,
    gap: 12,
  },
  rowUnread: { borderColor: Colors.light.primary },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarUnread: { backgroundColor: Colors.light.primary },
  avatarText: { color: Colors.light.text, fontWeight: "700", fontSize: 18 },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: Colors.light.error,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: Colors.light.white, fontSize: 10, fontWeight: "700" },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: Colors.light.text,
  },
  rowNameUnread: { fontWeight: "700" },
  rowTime: { fontSize: 11, color: Colors.light.textMuted },
  rowPreview: { fontSize: 13, color: Colors.light.textSecondary },
  rowFooter: { flexDirection: "row", gap: 6, marginTop: 4 },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: Colors.light.primaryMuted,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
    color: Colors.light.primary,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  tStatusPill: { backgroundColor: Colors.light.featuredMuted },
  tStatusText: { color: Colors.light.featured },
  mutedPill: {
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  mutedText: { color: Colors.light.textSecondary },
});
