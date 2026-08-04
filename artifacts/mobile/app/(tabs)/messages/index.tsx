import React from "react";
import {
  AppState,
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAuth } from "@/contexts/AuthContext";
import {
  useGetConversations,
  getGetConversationsQueryKey,
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

function spokenTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return `on ${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

function mutedRemaining(mutedUntil?: string | null): string | null {
  if (!mutedUntil) return null;
  const remainingMs = new Date(mutedUntil).getTime() - Date.now();
  if (remainingMs <= 0) return null;
  const totalMinutes = Math.round(remainingMs / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m left`;
  const hours = Math.round(totalMinutes / 60);
  if (hours < 24) return `${hours}h left`;
  const days = Math.round(hours / 24);
  return `${days}d left`;
}

const STATUS_LABEL: Record<string, string> = {
  AWAITING_TRADER_REPLY: "Awaiting trader",
  AWAITING_CUSTOMER_REPLY: "Awaiting you",
  CLOSED: "Closed",
  BLOCKED: "Blocked",
  REPORTED: "Reported",
};

const STAGE_LABEL: Record<string, string> = {
  CANCELLED: "Cancelled",
  JOB_DONE: "Job done",
  AWAITING_CUSTOMER_CONFIRMATION: "Awaiting confirmation",
  HIRED: "Hired",
};

// The headline pill prefers the lifecycle stage once a job is underway (hired ->
// awaiting confirmation -> done/cancelled); before that it falls back to the
// raw conversation status (awaiting trader/you).
function stagePillLabel(stage: string | null | undefined, status: string): string {
  if (stage && STAGE_LABEL[stage]) return STAGE_LABEL[stage];
  return STATUS_LABEL[status] ?? status;
}

// Traffic-light colours for the trader's own lead-status pill:
// red = not yet responded, blue = contacted (in progress), amber = quoted,
// green = completed.
const TRADER_STATUS_COLORS: Record<string, { text: string; bg: string }> = {
  NEW: { text: Colors.light.error, bg: Colors.light.errorMuted },
  CONTACTED: { text: Colors.light.primary, bg: Colors.light.primaryMuted },
  QUOTED: { text: Colors.light.warning, bg: Colors.light.warningMuted },
  COMPLETED: { text: Colors.light.success, bg: "rgba(6, 214, 160, 0.12)" },
};

export default function MessagesIndexScreen() {
  const router = useRouter();
  const { isAuthenticated, isTrader, isAdmin } = useAuth();

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        {/* Shared safe-area-aware page header — same pattern as Search. */}
        <ScreenHeader variant="page" title="Messages" />
        <View style={styles.loggedOutBody}>
          <View style={styles.emptyIcon}>
            <Feather name="message-circle" size={28} color={Colors.light.primary} />
          </View>
          <Text style={styles.emptyTitle}>Log in to view your messages</Text>
          <Text style={styles.emptySub}>
            Keep track of enquiries and conversations with local traders.
          </Text>
          <Pressable
            style={styles.cta}
            onPress={() => router.push("/auth/login")}
            accessibilityRole="button"
            accessibilityLabel="Log in"
          >
            <Text style={styles.ctaText}>Log In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (isAdmin) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Not available for admins</Text>
        <Text style={styles.emptySub}>
          Admin accounts don't have customer or trader conversations. Use a customer account to message traders.
        </Text>
        <Pressable style={styles.cta} onPress={() => router.push('/admin')}>
          <Text style={styles.ctaText}>Go to Admin Panel</Text>
        </Pressable>
      </View>
    );
  }

  return <MessagesList isTrader={isTrader} />;
}

function MessagesList({ isTrader }: { isTrader: boolean }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  // Poll every 30s while the app is foregrounded so new conversations/replies
  // appear without a manual refresh (no push permission required).
  const [appActive, setAppActive] = React.useState(AppState.currentState === "active");
  React.useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);
  const { data, isLoading, isError, refetch, isRefetching } = useGetConversations({
    query: {
      queryKey: getGetConversationsQueryKey(),
      refetchInterval: appActive ? 30_000 : false,
    },
  });

  // Re-pull the list (and its per-row unread badges) each time the screen gains
  // focus, so counts clear right after the user reads a thread and comes back.
  useFocusEffect(
    React.useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  if (isLoading && !isRefetching) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  // If the request failed and we have nothing cached to show, surface a clear
  // error with a retry action instead of leaving a spinner up or showing a
  // misleading "no conversations" empty state.
  if (isError && !data) {
    return (
      <View style={styles.centered}>
        <View style={styles.emptyIcon}>
          <Feather name="alert-circle" size={28} color={Colors.light.primary} />
        </View>
        <Text style={styles.emptyTitle}>Couldn't load your messages</Text>
        <Text style={styles.emptySub}>
          Please check your connection and try again.
        </Text>
        <Pressable
          style={styles.cta}
          onPress={() => refetch()}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={styles.ctaText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const conversations: ConversationSummary[] = data?.conversations ?? [];

  return (
    <View style={styles.container}>
      <ScreenHeader
        variant="page"
        title="Messages"
        subtitle={isTrader ? "Conversations with customers" : "Conversations with traders"}
      />

      <FlatList
        data={conversations}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: tabBarHeight + insets.bottom + 24 }}
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
            {!isTrader && (
              <Pressable
                style={styles.cta}
                onPress={() => router.push('/(tabs)/search')}
                accessibilityRole="button"
                accessibilityLabel="Find a trader"
              >
                <Text style={styles.ctaText}>Find a trader</Text>
              </Pressable>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const otherName = isTrader ? item.customerName : item.traderBusinessName;
          const unread = item.unreadCount > 0;
          const muted = !!item.muted;
          const remaining = muted ? mutedRemaining(item.mutedUntil) : null;
          const muteLabel = muted ? (remaining ? `Muted · ${remaining}` : "Muted") : null;
          const spokenName = otherName ?? (isTrader ? "a customer" : "a trader");
          // "Boiler · MLT-000008" line so similar-looking conversations are
          // easy to tell apart; job reference only exists after hire.
          const jobLine = [item.serviceRequired, item.jobReference]
            .filter(Boolean)
            .join(" · ");
          const stageLabel = stagePillLabel(item.stage, item.status);
          const statusSpoken = stageLabel.toLowerCase();
          const unreadPhrase = unread
            ? `${item.unreadCount} unread message${item.unreadCount === 1 ? "" : "s"}`
            : null;
          const traderStatusPhrase =
            isTrader && item.traderStatus
              ? `trader status ${String(item.traderStatus).toLowerCase()}`
              : null;
          const mutedPhrase = muted
            ? remaining
              ? `muted, ${remaining}`
              : "muted"
            : null;
          const a11yLabel = [
            `Conversation with ${spokenName}`,
            jobLine || null,
            unreadPhrase,
            `last updated ${spokenTimeAgo(item.lastMessageAt)}`,
            `status ${statusSpoken}`,
            traderStatusPhrase,
            mutedPhrase,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <Pressable
              style={[styles.row, unread && styles.rowUnread, muted && styles.rowMuted]}
              onPress={() => router.push(`/messages/${item.id}`)}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel}
              accessibilityHint="Open conversation"
            >
              <View style={[styles.avatar, unread && styles.avatarUnread, muted && styles.avatarMuted]}>
                <Text style={[styles.avatarText, muted && styles.mutedDim]}>
                  {otherName?.charAt(0)?.toUpperCase() ?? "?"}
                </Text>
                {unread ? (
                  <View style={[styles.badge, muted && styles.badgeMuted]}>
                    <Text style={styles.badgeText}>{item.unreadCount}</Text>
                  </View>
                ) : null}
                {muted ? (
                  <View style={styles.bellOverlay}>
                    <Feather name="bell-off" size={10} color={Colors.light.textSecondary} />
                  </View>
                ) : null}
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text
                    style={[
                      styles.rowName,
                      unread && styles.rowNameUnread,
                      muted && styles.mutedDim,
                    ]}
                    numberOfLines={1}
                  >
                    {otherName}
                  </Text>
                  <Text style={[styles.rowTime, muted && styles.mutedDim]}>
                    {timeAgo(item.lastMessageAt)}
                  </Text>
                </View>
                {jobLine ? (
                  <Text
                    style={[styles.rowJob, muted && styles.mutedDim]}
                    numberOfLines={1}
                  >
                    {jobLine}
                  </Text>
                ) : null}
                <Text
                  style={[styles.rowPreview, muted && styles.mutedDim]}
                  numberOfLines={1}
                >
                  {item.lastMessagePreview ?? "(no messages yet)"}
                </Text>
                <View style={styles.rowFooter}>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusText}>{stageLabel}</Text>
                  </View>
                  {isTrader && item.stage !== "CANCELLED" ? (
                    <View
                      style={[
                        styles.statusPill,
                        styles.tStatusPill,
                        {
                          backgroundColor:
                            TRADER_STATUS_COLORS[String(item.traderStatus)]?.bg ??
                            Colors.light.featuredMuted,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          styles.tStatusText,
                          {
                            color:
                              TRADER_STATUS_COLORS[String(item.traderStatus)]?.text ??
                              Colors.light.featured,
                          },
                        ]}
                      >
                        {item.traderStatus}
                      </Text>
                    </View>
                  ) : null}
                  {muted ? (
                    <View style={[styles.statusPill, styles.mutedPill]}>
                      <Feather name="bell-off" size={10} color={Colors.light.textSecondary} />
                      <Text style={[styles.statusText, styles.mutedText]}>{muteLabel}</Text>
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
  empty: { alignItems: "center", padding: 32, marginTop: 40 },
  // Logged-out state: anchored in the upper portion of the screen under the
  // compact header, rather than floating in the vertical centre.
  loggedOutBody: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 32,
    paddingTop: 48,
  },
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
    textAlign: "center",
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
  rowMuted: { backgroundColor: Colors.light.surface, opacity: 0.85 },
  mutedDim: { color: Colors.light.textMuted },
  avatarMuted: { backgroundColor: Colors.light.surface },
  badgeMuted: { backgroundColor: Colors.light.textMuted },
  bellOverlay: {
    position: "absolute",
    bottom: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: "center",
    justifyContent: "center",
  },
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
  rowJob: { fontSize: 12, fontWeight: "600", color: Colors.light.primary },
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
