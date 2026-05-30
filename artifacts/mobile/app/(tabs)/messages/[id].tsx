import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { detectContactInfo, contactViolationMessage } from "@/lib/content-filter";
import { confirmAction } from "@/lib/confirm";
import {
  useGetConversation,
  useSendConversationMessage,
  useUpdateConversationTraderStatus,
  useCloseConversation,
  useReportConversation,
  useMuteConversation,
  useAcceptConversationOffer,
  useCompleteConversationJob,
  useTraderMarkConversationDone,
  useCancelConversationJob,
  getGetConversationQueryKey,
  getGetConversationsQueryKey,
  getGetConversationsUnreadCountQueryKey,
} from "@workspace/api-client-react";

const TRADER_STATUSES = ["NEW", "CONTACTED", "QUOTED", "COMPLETED"] as const;
type TraderStatus = (typeof TRADER_STATUSES)[number];

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function ConversationThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = Number(id);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { isTrader, isAdmin, user } = useAuth();
  const listRef = useRef<FlatList>(null);

  const { data, isLoading, error, refetch } = useGetConversation(conversationId, {
    query: {
      enabled: !isAdmin,
      queryKey: getGetConversationQueryKey(conversationId),
    },
  });

  const sendMutation = useSendConversationMessage({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetConversationsUnreadCountQueryKey() });
      },
    },
  });

  const updateStatusMutation = useUpdateConversationTraderStatus({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
      },
    },
  });

  const closeMutation = useCloseConversation({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
      },
    },
  });

  const acceptMutation = useAcceptConversationOffer({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
      },
    },
  });

  const completeMutation = useCompleteConversationJob({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
      },
    },
  });

  const traderMarkDoneMutation = useTraderMarkConversationDone({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
      },
    },
  });

  const cancelMutation = useCancelConversationJob({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
      },
    },
  });

  const reportMutation = useReportConversation();

  const muteMutation = useMuteConversation({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
      },
    },
  });

  const [text, setText] = useState("");
  const [showStatus, setShowStatus] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  if (isAdmin) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top + 80 }]}>
        <Text style={styles.errorText}>Not available for admins</Text>
        <Text style={[styles.errorText, { fontSize: 13, opacity: 0.8 }]}>
          Admin accounts can't open customer/trader conversations.
        </Text>
        <Pressable style={styles.cta} onPress={() => router.replace('/(tabs)/account')}>
          <Text style={styles.ctaText}>Back to Account</Text>
        </Pressable>
      </View>
    );
  }

  const conv = data?.conversation;
  const messages = data?.messages ?? [];
  const closed =
    conv?.status === "CLOSED" || conv?.status === "BLOCKED";

  const otherName = useMemo(() => {
    if (!conv) return "";
    return isTrader ? conv.customerName : conv.traderBusinessName;
  }, [conv, isTrader]);

  const stageDisplay = useMemo(() => {
    switch (conv?.stage) {
      case "CANCELLED":
        return { label: "Cancelled", pill: styles.cancelledPill, text: styles.cancelledPillText };
      case "JOB_DONE":
        return { label: "Job done", pill: styles.donePill, text: styles.donePillText };
      case "AWAITING_CUSTOMER_CONFIRMATION":
        return { label: "Awaiting confirmation", pill: styles.awaitingPill, text: styles.awaitingPillText };
      case "HIRED":
        return { label: "Hired", pill: styles.hiredPill, text: styles.hiredPillText };
      case "CLOSED":
        return { label: "Closed", pill: styles.closedPill, text: styles.closedPillText };
      default:
        return { label: "Awaiting reply", pill: styles.statusPill, text: styles.statusPillText };
    }
  }, [conv?.stage]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
    }
  }, [messages.length]);

  // The GET conversation endpoint marks unread messages as read server-side,
  // so once we've loaded the thread refresh both the global unread badge and
  // the conversations list (whose per-row red badge would otherwise stay stale
  // until the list happens to refetch).
  useEffect(() => {
    if (data) {
      qc.invalidateQueries({ queryKey: getGetConversationsUnreadCountQueryKey() });
      qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
    }
  }, [data, qc]);

  const violation = useMemo(() => detectContactInfo(text), [text]);
  const violationText = violation ? contactViolationMessage(violation) : null;

  const onSend = () => {
    const body = text.trim();
    if (!body) return;
    if (closed) {
      Alert.alert("Conversation closed", "This conversation can no longer accept messages.");
      return;
    }
    if (violation) {
      Alert.alert("Message blocked", contactViolationMessage(violation));
      return;
    }
    sendMutation.mutate(
      { id: conversationId, data: { body } },
      {
        onSuccess: () => setText(""),
        onError: (err: unknown) => {
          const msg =
            err instanceof Error ? err.message : "Could not send message. Please try again.";
          Alert.alert("Error", msg);
        },
      },
    );
  };

  const onChangeStatus = (s: TraderStatus) => {
    setShowStatus(false);
    updateStatusMutation.mutate(
      { id: conversationId, data: { traderStatus: s } },
      {
        onSuccess: () => {
          if (s === "COMPLETED") {
            Alert.alert(
              "Status updated",
              "This only updates your work status. The customer still needs to confirm the job before they can leave a review.",
            );
          }
        },
        onError: () => Alert.alert("Error", "Could not update status."),
      },
    );
  };

  const onAccept = () => {
    confirmAction({
      title: "Hire this trader",
      message: `Confirm you're going with ${otherName} for this job?`,
      confirmLabel: "Accept offer",
      onConfirm: () =>
        acceptMutation.mutate(
          { id: conversationId },
          { onError: () => Alert.alert("Error", "Could not accept the offer.") },
        ),
    });
  };

  const onComplete = () => {
    confirmAction({
      title: "Confirm the job is done",
      message:
        "Only confirm once the work is finished to your satisfaction. You'll then be able to leave a review. This can't be undone.",
      confirmLabel: "Confirm job done",
      onConfirm: () =>
        completeMutation.mutate(
          { id: conversationId },
          {
            onSuccess: () =>
              Alert.alert("Job confirmed", "Thanks! You can now leave a review."),
            onError: () => Alert.alert("Error", "Could not confirm the job."),
          },
        ),
    });
  };

  const onMarkDone = () => {
    confirmAction({
      title: "Mark work as completed",
      message:
        "This lets the customer know you've finished. They still need to confirm before they can leave a review.",
      confirmLabel: "Notify customer",
      onConfirm: () =>
        traderMarkDoneMutation.mutate(
          { id: conversationId },
          {
            onSuccess: () =>
              Alert.alert(
                "Customer notified",
                "We've let the customer know the work is done. They'll confirm to unlock a review.",
              ),
            onError: () => Alert.alert("Error", "Could not notify the customer."),
          },
        ),
    });
  };

  const onSubmitCancel = () => {
    const reason = cancelReason.trim();
    if (reason.length < 3) {
      Alert.alert("Add a reason", "Please give a short reason for cancelling.");
      return;
    }
    cancelMutation.mutate(
      { id: conversationId, data: { reason } },
      {
        onSuccess: () => {
          setCancelOpen(false);
          setCancelReason("");
          Alert.alert("Job cancelled", "This job has been cancelled and the conversation closed.");
        },
        onError: () => Alert.alert("Error", "Could not cancel the job."),
      },
    );
  };

  const onLeaveReview = () => {
    if (!conv) return;
    router.push(
      `/write-review/${conv.traderProfileId}${
        conv.enquiryId ? `?enquiryId=${conv.enquiryId}` : ""
      }`,
    );
  };

  const onClose = () => {
    confirmAction({
      title: "Close conversation",
      message: "You won't be able to send any more messages. Continue?",
      confirmLabel: "Close",
      destructive: true,
      onConfirm: () => closeMutation.mutate({ id: conversationId }),
    });
  };

  const applyMute = (mutedUntil: string | null, label: string) => {
    muteMutation.mutate(
      { id: conversationId, data: { muted: true, mutedUntil } },
      {
        onSuccess: () =>
          Alert.alert(
            "Notifications muted",
            `Push notifications are off ${label}. Emails are unchanged.`,
          ),
        onError: () => Alert.alert("Error", "Could not update mute setting."),
      },
    );
  };

  const onUnmute = () => {
    muteMutation.mutate(
      { id: conversationId, data: { muted: false, mutedUntil: null } },
      {
        onSuccess: () =>
          Alert.alert(
            "Notifications unmuted",
            "Push notifications for this conversation are back on.",
          ),
        onError: () => Alert.alert("Error", "Could not update mute setting."),
      },
    );
  };

  const onShowMuteOptions = () => {
    if (!conv) return;
    if (conv.muted) {
      onUnmute();
      return;
    }
    const now = new Date();
    const oneHour = new Date(now.getTime() + 60 * 60 * 1000);
    const eightHours = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    // "Until tomorrow" = 8am local time on the next calendar day.
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);
    Alert.alert("Mute notifications", "Choose how long to silence this chat.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "For 1 hour",
        onPress: () => applyMute(oneHour.toISOString(), "for the next hour"),
      },
      {
        text: "For 8 hours",
        onPress: () => applyMute(eightHours.toISOString(), "for the next 8 hours"),
      },
      {
        text: "Until tomorrow",
        onPress: () => applyMute(tomorrow.toISOString(), "until tomorrow morning"),
      },
      {
        text: "Until I turn it back on",
        onPress: () => applyMute(null, "until you turn them back on"),
      },
    ]);
  };

  const mutedRemainingLabel = useMemo(() => {
    if (!conv?.muted || !conv.mutedUntil) return null;
    const untilMs = new Date(conv.mutedUntil).getTime();
    const remainingMs = untilMs - Date.now();
    if (remainingMs <= 0) return null;
    const totalMinutes = Math.round(remainingMs / 60000);
    if (totalMinutes < 60) return `${totalMinutes}m left`;
    const hours = Math.round(totalMinutes / 60);
    if (hours < 24) return `${hours}h left`;
    const days = Math.round(hours / 24);
    return `${days}d left`;
  }, [conv?.muted, conv?.mutedUntil]);

  const onReport = () => {
    Alert.prompt?.(
      "Report this conversation",
      "Tell us briefly what happened (this is reviewed by our admin team).",
      (reason) => {
        const trimmed = (reason ?? "").trim();
        if (trimmed.length < 5) return;
        reportMutation.mutate(
          { id: conversationId, data: { reason: trimmed } },
          {
            onSuccess: () => Alert.alert("Reported", "Thanks — our team will review this conversation."),
            onError: () => Alert.alert("Error", "Could not submit report."),
          },
        );
      },
    );
    // Android fallback
    if (!Alert.prompt) {
      reportMutation.mutate(
        { id: conversationId, data: { reason: "Reported from mobile app" } },
        {
          onSuccess: () => Alert.alert("Reported", "Thanks — our team will review this conversation."),
        },
      );
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  if (error || !conv) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Could not load conversation.</Text>
        <Pressable style={styles.cta} onPress={() => router.back()}>
          <Text style={styles.ctaText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.light.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 44 : 0}
    >
      <Stack.Screen options={{ title: otherName || "Conversation" }} />
      <View style={styles.headerCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName} numberOfLines={1}>
            {otherName}
          </Text>
          {conv.serviceRequired ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {conv.serviceRequired}
            </Text>
          ) : null}
          <View style={styles.headerPills}>
            <View style={[styles.statusPill, stageDisplay.pill]}>
              <Text style={[styles.statusPillText, stageDisplay.text]}>{stageDisplay.label}</Text>
            </View>
            {isTrader && conv.stage !== "CANCELLED" ? (
              <Pressable
                style={[styles.statusPill, styles.tStatusPill]}
                onPress={() => !closed && setShowStatus((s) => !s)}
              >
                <Text style={[styles.statusPillText, styles.tStatusText]}>
                  {conv.traderStatus} {!closed ? "▾" : ""}
                </Text>
              </Pressable>
            ) : null}
            {conv.muted ? (
              <View style={[styles.statusPill, styles.mutedPill]}>
                <Feather name="bell-off" size={10} color={Colors.light.textSecondary} />
                <Text style={[styles.statusPillText, styles.mutedPillText]}>
                  {mutedRemainingLabel ? `Muted · ${mutedRemainingLabel}` : "Muted"}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <Pressable
          style={styles.iconBtn}
          onPress={() =>
            Alert.alert("Conversation actions", undefined, [
              { text: "Cancel", style: "cancel" },
              {
                text: conv.muted ? "Unmute notifications" : "Mute notifications",
                onPress: onShowMuteOptions,
              },
              ...(conv.stage === "AWAITING_REPLY" ||
              conv.stage === "HIRED" ||
              conv.stage === "AWAITING_CUSTOMER_CONFIRMATION"
                ? [
                    {
                      text: "Cancel this job",
                      onPress: () => setCancelOpen(true),
                      style: "destructive" as const,
                    },
                  ]
                : []),
              ...(!closed
                ? [{ text: "Close conversation", onPress: onClose, style: "destructive" as const }]
                : []),
              { text: "Report this conversation", onPress: onReport },
            ])
          }
        >
          <Feather name="more-vertical" size={18} color={Colors.light.textSecondary} />
        </Pressable>
      </View>

      {showStatus ? (
        <View style={styles.statusMenu}>
          {TRADER_STATUSES.map((s) => (
            <Pressable
              key={s}
              style={[
                styles.statusMenuItem,
                conv.traderStatus === s && styles.statusMenuItemActive,
              ]}
              onPress={() => onChangeStatus(s)}
            >
              <Text
                style={[
                  styles.statusMenuText,
                  conv.traderStatus === s && styles.statusMenuTextActive,
                ]}
              >
                {s}
              </Text>
              {s === "COMPLETED" ? (
                <Text style={styles.statusMenuHint}>Customer confirms to unlock review</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 12,
          gap: 8,
        }}
        onRefresh={refetch}
        refreshing={false}
        renderItem={({ item }) => {
          if (item.systemMessage) {
            return (
              <View style={styles.systemRow}>
                <Text style={styles.systemText}>{item.body}</Text>
              </View>
            );
          }
          const mine =
            (isTrader && item.senderRole === "trader") ||
            (!isTrader && item.senderRole === "customer") ||
            item.senderUserId === user?.id;
          return (
            <View style={[styles.bubbleWrap, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
              <View style={[styles.bubble, mine ? styles.bubbleMineBg : styles.bubbleTheirsBg]}>
                <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
                <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
                  {fmtTime(item.createdAt)}
                </Text>
              </View>
            </View>
          );
        }}
        ListHeaderComponent={
          <View style={styles.safetyBanner}>
            <Feather name="shield" size={14} color={Colors.light.primary} />
            <Text style={styles.safetyText}>
              For your safety, keep all conversations and payments inside MyLocalTrade.
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={styles.systemText}>Start the conversation by sending a message.</Text>
          </View>
        }
      />

      {conv.stage === "CANCELLED" ? (
        <View style={styles.lifecycleBar}>
          <View style={styles.lifecycleDone}>
            <Feather name="x-circle" size={14} color={Colors.light.error} />
            <Text style={styles.lifecycleDoneText}>
              Job cancelled{conv.cancelledByRole ? ` by the ${conv.cancelledByRole}` : ""}
              {conv.cancellationReason ? ` · ${conv.cancellationReason}` : ""}
            </Text>
          </View>
        </View>
      ) : !isTrader && conv.stage === "JOB_DONE" && !conv.hasReview ? (
        <View style={styles.lifecycleBar}>
          <Text style={styles.trustText}>
            Your review is public and helps other customers hire with confidence. Only the
            customer who hired can review, and only after confirming the job is done.
          </Text>
          <Pressable
            style={[styles.lifecycleBtn, styles.reviewBtn]}
            onPress={onLeaveReview}
          >
            <Feather name="star" size={16} color={Colors.light.white} />
            <Text style={styles.lifecycleBtnText}>Leave a review</Text>
          </Pressable>
        </View>
      ) : conv.stage === "JOB_DONE" && (isTrader || conv.hasReview) ? (
        <View style={styles.lifecycleBar}>
          <View style={styles.lifecycleDone}>
            <Feather name="check-circle" size={14} color={Colors.light.success} />
            <Text style={styles.lifecycleDoneText}>
              {conv.hasReview ? "Job complete · review submitted" : "Job complete"}
            </Text>
          </View>
        </View>
      ) : !isTrader && !closed ? (
        <View style={styles.lifecycleBar}>
          {conv.stage === "AWAITING_REPLY" || (!conv.customerAcceptedAt && conv.stage !== "CLOSED") ? (
            <Pressable
              style={styles.lifecycleBtn}
              onPress={onAccept}
              disabled={acceptMutation.isPending}
            >
              {acceptMutation.isPending ? (
                <ActivityIndicator size="small" color={Colors.light.white} />
              ) : (
                <>
                  <Feather name="check-circle" size={16} color={Colors.light.white} />
                  <Text style={styles.lifecycleBtnText} numberOfLines={1}>
                    Accept offer & hire {otherName}
                  </Text>
                </>
              )}
            </Pressable>
          ) : (
            <>
              {conv.stage === "AWAITING_CUSTOMER_CONFIRMATION" ? (
                <Text style={styles.lifecycleHint}>
                  {otherName} marked the work as completed. Confirm once you're happy it's done,
                  or reply above if there's a problem.
                </Text>
              ) : null}
              <Pressable
                style={styles.lifecycleBtn}
                onPress={onComplete}
                disabled={completeMutation.isPending}
              >
                {completeMutation.isPending ? (
                  <ActivityIndicator size="small" color={Colors.light.white} />
                ) : (
                  <>
                    <Feather name="flag" size={16} color={Colors.light.white} />
                    <Text style={styles.lifecycleBtnText}>Confirm the job is done</Text>
                  </>
                )}
              </Pressable>
            </>
          )}
        </View>
      ) : isTrader && !closed ? (
        <View style={styles.lifecycleBar}>
          {conv.stage === "AWAITING_CUSTOMER_CONFIRMATION" ? (
            <View style={styles.lifecycleDone}>
              <Feather name="clock" size={14} color={Colors.light.textSecondary} />
              <Text style={styles.lifecycleDoneText}>
                Waiting for the customer to confirm the job is done.
              </Text>
            </View>
          ) : conv.stage === "HIRED" ? (
            <Pressable
              style={styles.lifecycleBtn}
              onPress={onMarkDone}
              disabled={traderMarkDoneMutation.isPending}
            >
              {traderMarkDoneMutation.isPending ? (
                <ActivityIndicator size="small" color={Colors.light.white} />
              ) : (
                <>
                  <Feather name="flag" size={16} color={Colors.light.white} />
                  <Text style={styles.lifecycleBtnText}>Mark work as completed</Text>
                </>
              )}
            </Pressable>
          ) : (
            <View style={styles.lifecycleDone}>
              <Feather name="clock" size={14} color={Colors.light.textSecondary} />
              <Text style={styles.lifecycleDoneText}>
                Waiting for {otherName} to hire you. Once hired, you can mark the work
                as completed.
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {closed ? (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.closedText}>This conversation is {conv.status.toLowerCase()}.</Text>
        </View>
      ) : (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
          {violationText ? (
            <View style={styles.violationBanner}>
              <Feather name="alert-triangle" size={14} color={Colors.light.error} />
              <Text style={styles.violationText}>{violationText}</Text>
            </View>
          ) : null}
          <View style={styles.composerRow}>
            <TextInput
              style={[styles.input, violationText ? styles.inputBlocked : null]}
              value={text}
              onChangeText={setText}
              placeholder="Write a message…"
              placeholderTextColor={Colors.light.textMuted}
              multiline
              maxLength={4000}
            />
            <Pressable
              style={[
                styles.sendBtn,
                (!text.trim() || sendMutation.isPending || !!violation) && styles.sendBtnDisabled,
              ]}
              disabled={!text.trim() || sendMutation.isPending || !!violation}
              onPress={onSend}
            >
              {sendMutation.isPending ? (
                <ActivityIndicator size="small" color={Colors.light.white} />
              ) : (
                <Feather name="send" size={18} color={Colors.light.white} />
              )}
            </Pressable>
          </View>
        </View>
      )}

      <Modal
        visible={cancelOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Cancel this job</Text>
            <Text style={styles.modalSub}>
              Let {otherName} know why you're cancelling. This closes the conversation and the
              job can't be reviewed.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="Reason for cancelling…"
              placeholderTextColor={Colors.light.textMuted}
              multiline
              maxLength={500}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => {
                  setCancelOpen(false);
                  setCancelReason("");
                }}
              >
                <Text style={styles.modalBtnGhostText}>Keep job</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalBtn,
                  styles.modalBtnDanger,
                  (cancelReason.trim().length < 3 || cancelMutation.isPending) &&
                    styles.modalBtnDisabled,
                ]}
                disabled={cancelReason.trim().length < 3 || cancelMutation.isPending}
                onPress={onSubmitCancel}
              >
                {cancelMutation.isPending ? (
                  <ActivityIndicator size="small" color={Colors.light.white} />
                ) : (
                  <Text style={styles.modalBtnDangerText}>Cancel job</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: Colors.light.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  errorText: { color: Colors.light.text, marginBottom: 12 },
  cta: {
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  ctaText: { color: Colors.light.white, fontWeight: "700" },
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.light.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerName: { fontSize: 16, fontWeight: "700", color: Colors.light.text },
  headerSub: { fontSize: 12, color: Colors.light.textSecondary, marginTop: 2 },
  headerPills: { flexDirection: "row", gap: 6, marginTop: 6 },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: Colors.light.primaryMuted,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: "700",
    color: Colors.light.primary,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  tStatusPill: { backgroundColor: Colors.light.featuredMuted },
  tStatusText: { color: Colors.light.featured },
  mutedPill: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  mutedPillText: { color: Colors.light.textSecondary },
  hiredPill: { backgroundColor: Colors.light.primaryMuted },
  hiredPillText: { color: Colors.light.primary },
  donePill: { backgroundColor: "rgba(6, 214, 160, 0.14)" },
  donePillText: { color: Colors.light.success },
  awaitingPill: { backgroundColor: Colors.light.featuredMuted },
  awaitingPillText: { color: Colors.light.featured },
  closedPill: { backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border },
  closedPillText: { color: Colors.light.textSecondary },
  cancelledPill: { backgroundColor: "rgba(239, 71, 111, 0.14)" },
  cancelledPillText: { color: Colors.light.error },
  lifecycleBar: {
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: Colors.light.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  lifecycleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    borderRadius: 14,
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 16,
  },
  reviewBtn: { backgroundColor: Colors.light.featured },
  lifecycleBtnText: {
    color: Colors.light.white,
    fontWeight: "700",
    fontSize: 14,
  },
  lifecycleDone: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  lifecycleDoneText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "600",
    color: Colors.light.textSecondary,
  },
  trustText: {
    fontSize: 11,
    color: Colors.light.textSecondary,
    lineHeight: 16,
    marginBottom: 8,
  },
  lifecycleHint: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    lineHeight: 17,
    marginBottom: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 16,
    padding: 18,
  },
  modalTitle: { fontSize: 16, fontWeight: "700", color: Colors.light.text },
  modalSub: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    lineHeight: 17,
    marginTop: 6,
  },
  modalInput: {
    marginTop: 12,
    minHeight: 80,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: Colors.light.text,
    backgroundColor: Colors.light.card,
    textAlignVertical: "top",
  },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  modalBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnGhost: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  modalBtnGhostText: { color: Colors.light.text, fontWeight: "700", fontSize: 14 },
  modalBtnDanger: { backgroundColor: Colors.light.error },
  modalBtnDangerText: { color: Colors.light.white, fontWeight: "700", fontSize: 14 },
  modalBtnDisabled: { opacity: 0.5 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.light.card,
    alignItems: "center",
    justifyContent: "center",
  },
  statusMenu: {
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusMenuItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.border,
    minWidth: 110,
  },
  statusMenuItemActive: {
    borderColor: Colors.light.featured,
    backgroundColor: Colors.light.featuredMuted,
  },
  statusMenuText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.light.text,
    letterSpacing: 0.3,
  },
  statusMenuTextActive: { color: Colors.light.featured },
  statusMenuHint: { fontSize: 10, color: Colors.light.textMuted, marginTop: 2 },
  safetyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    backgroundColor: Colors.light.primaryMuted,
    borderRadius: 10,
    marginBottom: 8,
  },
  safetyText: { flex: 1, fontSize: 11, color: Colors.light.textSecondary, lineHeight: 16 },
  systemRow: { alignItems: "center", paddingVertical: 4 },
  systemText: {
    fontSize: 11,
    color: Colors.light.textMuted,
    fontStyle: "italic",
    textAlign: "center",
  },
  bubbleWrap: { width: "100%", flexDirection: "row" },
  bubbleMine: { justifyContent: "flex-end" },
  bubbleTheirs: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 16,
  },
  bubbleMineBg: {
    backgroundColor: Colors.light.primary,
    borderTopRightRadius: 4,
  },
  bubbleTheirsBg: {
    backgroundColor: Colors.light.card,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  bubbleText: { fontSize: 14, color: Colors.light.text, lineHeight: 20 },
  bubbleTextMine: { color: Colors.light.white },
  bubbleTime: {
    fontSize: 10,
    color: Colors.light.textMuted,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  bubbleTimeMine: { color: "rgba(255,255,255,0.75)" },
  composer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: Colors.light.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  violationBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    backgroundColor: "#FEE2E2",
    borderRadius: 10,
    marginBottom: 8,
  },
  violationText: {
    flex: 1,
    fontSize: 12,
    color: Colors.light.error,
    lineHeight: 16,
  },
  inputBlocked: {
    borderColor: Colors.light.error,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.light.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.light.border,
    color: Colors.light.text,
    fontSize: 14,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.light.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
  closedText: {
    flex: 1,
    fontSize: 13,
    color: Colors.light.textSecondary,
    textAlign: "center",
    paddingVertical: 14,
  },
});
