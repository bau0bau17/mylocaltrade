import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Linking,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Image,
  ScrollView,
  AppState,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { detectContactInfo, contactViolationMessage } from "@/lib/content-filter";
import { confirmAction } from "@/lib/confirm";
import { avatarImageUrl, objectImageUrl } from "@/lib/api-url";
import { isPhoneVerificationRequired, promptPhoneVerification } from "@/lib/phone-gate";

// Server returns 409 with this machine-readable code when the customer tries
// to accept an offer before the trader has replied or sent a quote.
function isNoOfferYet(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const data = (err as { data?: unknown }).data;
  if (!data || typeof data !== "object") return false;
  return (data as { code?: unknown }).code === "NO_OFFER_YET";
}

// Company Teams: the server answers 409 with this code when a teammate has
// already claimed the job — the attempted write was rolled back entirely.
// Returns undefined when the error is something else, otherwise the winning
// teammate's name (or null when the server didn't include one).
function jobClaimedByOtherName(err: unknown): string | null | undefined {
  if (!err || typeof err !== "object") return undefined;
  const data = (err as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  if ((data as { code?: unknown }).code !== "JOB_CLAIMED_BY_OTHER") return undefined;
  const name = (data as { assignedName?: unknown }).assignedName;
  return typeof name === "string" && name.trim() ? name : null;
}
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
  useCreateQuote,
  useReviseQuote,
  useWithdrawQuote,
  useAcceptQuote,
  useDeclineQuote,
  useProposeBooking,
  useConfirmBooking,
  useCancelBooking,
  useGetBookingSlots,
  getGetBookingSlotsQueryKey,
  getGetConversationQueryKey,
  getGetConversationsQueryKey,
  getGetConversationsUnreadCountQueryKey,
  getCompareEnquiriesQueryKey,
  type Quote,
  type Booking,
} from "@workspace/api-client-react";
import {
  addBookingToCalendar,
  hasPromptedForBooking,
  isBookingInCalendar,
  markPromptedForBooking,
} from "@/lib/booking-calendar";

// ---- Booking (appointment) helpers ----------------------------------------

/** "Tue 4 Aug at 09:30" in the device's locale timezone (UK users → UK time). */
function fmtBookingWhen(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} at ${time}`;
}

/** Next N days as selectable options (starting tomorrow). */
function bookingDayOptions(count = 14): { key: string; label: string; date: Date }[] {
  const out: { key: string; label: string; date: Date }[] = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 1; i <= count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    out.push({
      key: ymd,
      label: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
      date: d,
    });
  }
  return out;
}

/** Appointment length choices — mirrors the server's allowed durations. */
const BOOKING_DURATION_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hr" },
  { minutes: 90, label: "1.5 hrs" },
  { minutes: 120, label: "2 hrs" },
  { minutes: 180, label: "3 hrs" },
  { minutes: 240, label: "Half day" },
  { minutes: 480, label: "Full day" },
];

const TRADER_STATUSES = ["NEW", "CONTACTED", "QUOTED", "COMPLETED"] as const;
type TraderStatus = (typeof TRADER_STATUSES)[number];

// Traffic-light colours for the trader's lead-status pill (kept in sync with
// the conversations list): red = not yet responded, blue = contacted,
// amber = quoted, green = completed.
const TRADER_STATUS_COLORS: Record<string, { text: string; bg: string }> = {
  NEW: { text: Colors.light.error, bg: Colors.light.errorMuted },
  CONTACTED: { text: Colors.light.primary, bg: Colors.light.primaryMuted },
  QUOTED: { text: Colors.light.warning, bg: Colors.light.warningMuted },
  COMPLETED: { text: Colors.light.success, bg: "rgba(6, 214, 160, 0.12)" },
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtPounds(amountPence: number) {
  const pounds = amountPence / 100;
  return `£${pounds.toLocaleString("en-GB", {
    minimumFractionDigits: pounds % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** A stored PENDING quote whose expiry has passed is shown as expired. */
function effectiveStatus(q: Quote): Quote["status"] | "EXPIRED" {
  if (
    q.status === "PENDING" &&
    q.validUntil &&
    new Date(q.validUntil).getTime() <= Date.now()
  ) {
    return "EXPIRED";
  }
  return q.status;
}

/** Parse a "£450" / "450.50" style input into pence, or null if invalid. */
function parsePoundsToPence(raw: string): number | null {
  const cleaned = raw.replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const pence = Math.round(parseFloat(cleaned) * 100);
  if (!Number.isFinite(pence) || pence < 1 || pence > 100_000_000) return null;
  return pence;
}

const QUOTE_STATUS_LABEL: Record<string, string> = {
  PENDING: "Awaiting response",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
  REVISED: "Revised",
  EXPIRED: "Expired",
};

export default function ConversationThreadScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const conversationId = Number(id);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const goBack = () =>
    router.replace(
      (returnTo ?? "/messages") as Parameters<typeof router.replace>[0],
    );
  const { isTrader, isAdmin, user, token } = useAuth();
  const listRef = useRef<FlatList>(null);

  // Poll while the app is foregrounded so new replies appear without leaving
  // the thread (there's no realtime channel; push may be denied/muted).
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: string) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);
  const { data, isLoading, error, refetch } = useGetConversation(conversationId, {
    query: {
      enabled: !isAdmin,
      queryKey: getGetConversationQueryKey(conversationId),
      refetchInterval: !isAdmin && appActive ? 12_000 : false,
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

  const invalidateQuoteRelated = () => {
    qc.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
    qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
    qc.invalidateQueries({ queryKey: getCompareEnquiriesQueryKey() });
  };

  const createQuoteMutation = useCreateQuote({
    mutation: { onSuccess: invalidateQuoteRelated },
  });
  const reviseQuoteMutation = useReviseQuote({
    mutation: { onSuccess: invalidateQuoteRelated },
  });
  const withdrawQuoteMutation = useWithdrawQuote({
    mutation: { onSuccess: invalidateQuoteRelated },
  });
  const acceptQuoteMutation = useAcceptQuote({
    mutation: { onSuccess: invalidateQuoteRelated },
  });
  const declineQuoteMutation = useDeclineQuote({
    mutation: { onSuccess: invalidateQuoteRelated },
  });

  const invalidateBookingRelated = () => {
    qc.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
    qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
  };
  const proposeBookingMutation = useProposeBooking({
    mutation: { onSuccess: invalidateBookingRelated },
  });
  const confirmBookingMutation = useConfirmBooking({
    mutation: { onSuccess: invalidateBookingRelated },
  });
  const cancelBookingMutation = useCancelBooking({
    mutation: { onSuccess: invalidateBookingRelated },
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
  const [photoViewer, setPhotoViewer] = useState<number | null>(null);
  // Full-screen viewer for the other party's profile photo in the header.
  const [profilePhotoOpen, setProfilePhotoOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteMode, setQuoteMode] = useState<"create" | "revise">("create");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [quotePriceType, setQuotePriceType] = useState<"FIXED" | "ESTIMATE">("FIXED");
  const [quoteDescription, setQuoteDescription] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteValidDays, setQuoteValidDays] = useState<number | null>(14);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingDayKey, setBookingDayKey] = useState<string | null>(null);
  const [bookingDuration, setBookingDuration] = useState<number>(60);
  const [bookingSlot, setBookingSlot] = useState<string | null>(null); // ISO start
  const [bookingNote, setBookingNote] = useState("");

  // Available start times from the server (respects the trader's working
  // hours and existing confirmed appointments across all their jobs).
  const slotsQuery = useGetBookingSlots(
    conversationId,
    {
      date: bookingDayKey ?? "",
      durationMinutes: bookingDuration as 30 | 60 | 90 | 120 | 180 | 240 | 480,
    },
    {
      query: {
        enabled: bookingOpen && !!bookingDayKey,
        queryKey: getGetBookingSlotsQueryKey(conversationId, {
          date: bookingDayKey ?? "",
          durationMinutes: bookingDuration as 30 | 60 | 90 | 120 | 180 | 240 | 480,
        }),
      },
    },
  );

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
  const enquiryAttachments = data?.enquiryAttachments ?? [];
  const closed =
    conv?.status === "CLOSED" || conv?.status === "BLOCKED";

  // Quotes arrive newest first; the head of the list is the current version
  // of the quote chain (older revisions keep status REVISED).
  const quotes = data?.quotes ?? [];
  // Contact details are only present in the API response after the customer
  // accepted a quote / hired the trader (backend hire state is authoritative).
  const contactDetails = data?.contactDetails ?? null;
  const hired = Boolean(conv?.customerAcceptedAt);
  // Live appointment (PROPOSED or CONFIRMED) — cancelled/superseded bookings
  // never come back from the API; their history lives in system messages.
  const booking: Booking | null = (data?.booking as Booking | null) ?? null;
  const bookingBusy =
    proposeBookingMutation.isPending ||
    confirmBookingMutation.isPending ||
    cancelBookingMutation.isPending;

  const otherName = useMemo(() => {
    if (!conv) return "";
    return isTrader ? conv.customerName : conv.traderBusinessName;
  }, [conv, isTrader]);

  // Company Teams (Phase 2): assigned-person identity + claim state. With the
  // feature flag OFF the server sends legacy-shaped values (assigned = the
  // trader, no name/logo, viewerCanAct true), so every branch below collapses
  // to the old behaviour automatically.
  const assignedName = conv?.assignedTraderName ?? null;
  // Trader side: an unclaimed company lead — the first action claims it.
  const unclaimedLead =
    isTrader && conv?.viewerCanAct === true && conv?.assignedTraderUserId == null;
  // Trader side: a teammate owns this job — read-only for this viewer.
  const claimedByOther = isTrader && conv?.viewerCanAct === false;

  // A claim-race loser gets a 409: explain who won and refresh the thread so
  // the claimed (read-only) state appears immediately.
  const handleClaimedByOther = (err: unknown): boolean => {
    const name = jobClaimedByOtherName(err);
    if (name === undefined) return false;
    qc.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
    qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
    Alert.alert(
      "Job already claimed",
      `${name ?? assignedName ?? "A teammate"} got there first — this job is now theirs.`,
    );
    return true;
  };

  // "Add to calendar" prompt: shown once per confirmed booking+time (both the
  // confirmer and the proposer see it when they first observe the CONFIRMED
  // state). Dismissal ("Not now") is remembered locally; the booking card
  // keeps a small "Add to calendar" action for later. A reschedule creates a
  // new booking id server-side, so it gets its own single prompt.
  const calendarPromptShownRef = useRef<string | null>(null);
  useEffect(() => {
    if (!booking || booking.status !== "CONFIRMED") return;
    const key = `${booking.id}_${booking.startAt}`;
    if (calendarPromptShownRef.current === key) return;
    let stale = false;
    (async () => {
      if (
        (await hasPromptedForBooking(booking.id, booking.startAt)) ||
        (await isBookingInCalendar(booking.id, booking.startAt))
      ) {
        calendarPromptShownRef.current = key;
        return;
      }
      if (stale || calendarPromptShownRef.current === key) return;
      calendarPromptShownRef.current = key;
      void markPromptedForBooking(booking.id, booking.startAt);
      Alert.alert(
        "Appointment confirmed",
        "Would you like to add this appointment to your calendar?",
        [
          { text: "Not now", style: "cancel" },
          {
            text: "Add to Calendar",
            onPress: () =>
              void addBookingToCalendar({
                bookingId: booking.id,
                startAtIso: booking.startAt,
                contextLabel: conv?.serviceRequired || otherName || null,
                jobRef: conversationId,
                durationMinutes: booking.durationMinutes ?? null,
              }),
          },
        ],
      );
    })();
    return () => {
      stale = true;
    };
  }, [booking, conv?.serviceRequired, otherName, conversationId]);

  const onAddBookingToCalendar = () => {
    if (!booking) return;
    void addBookingToCalendar({
      bookingId: booking.id,
      startAtIso: booking.startAt,
      contextLabel: conv?.serviceRequired || otherName || null,
      jobRef: conversationId,
      durationMinutes: booking.durationMinutes ?? null,
    });
  };
  const currentQuote = quotes[0] ?? null;
  const currentQuoteStatus = currentQuote ? effectiveStatus(currentQuote) : null;
  const hasLivePendingQuote = currentQuoteStatus === "PENDING";
  const hasAcceptedQuote = currentQuoteStatus === "ACCEPTED";
  // There is only an "offer" to accept once the trader has actually engaged —
  // replied in the conversation or sent a quote (any status). Without this the
  // customer could hire a trader who has never responded. The server enforces
  // the same rule (409 NO_OFFER_YET).
  const traderHasEngaged =
    messages.some((m) => m.senderRole === "trader") || quotes.length > 0;
  const quoteBusy =
    createQuoteMutation.isPending ||
    reviseQuoteMutation.isPending ||
    withdrawQuoteMutation.isPending ||
    acceptQuoteMutation.isPending ||
    declineQuoteMutation.isPending;

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

  // Contact-sharing is only blocked BEFORE hire. Once hired, the customer and
  // trader may exchange contact details to coordinate the job (the backend
  // applies the same rule).
  const hiredForFilter = Boolean(data?.conversation?.customerAcceptedAt);
  const violation = useMemo(
    () => (hiredForFilter ? null : detectContactInfo(text)),
    [text, hiredForFilter],
  );
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
          if (handleClaimedByOther(err)) return;
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
          {
            onError: (err: unknown) => {
              if (isPhoneVerificationRequired(err)) {
                promptPhoneVerification();
                return;
              }
              if (isNoOfferYet(err)) {
                Alert.alert(
                  "No offer yet",
                  `${otherName} hasn't replied or sent a quote yet, so there's no offer to accept.`,
                );
                return;
              }
              Alert.alert("Error", "Could not accept the offer.");
            },
          },
        ),
    });
  };

  const openQuoteForm = (mode: "create" | "revise") => {
    setQuoteMode(mode);
    if (mode === "revise" && currentQuote) {
      setQuoteAmount((currentQuote.amountPence / 100).toFixed(2).replace(/\.00$/, ""));
      setQuotePriceType(currentQuote.priceType);
      setQuoteDescription(currentQuote.description);
      setQuoteNotes(currentQuote.notes ?? "");
      setQuoteValidDays(14);
    } else {
      setQuoteAmount("");
      setQuotePriceType("FIXED");
      setQuoteDescription("");
      setQuoteNotes("");
      setQuoteValidDays(14);
    }
    setQuoteOpen(true);
  };

  const onSubmitQuote = () => {
    const amountPence = parsePoundsToPence(quoteAmount);
    if (amountPence == null) {
      Alert.alert("Check the price", "Enter a valid amount, e.g. 450 or 450.50 (up to £1,000,000).");
      return;
    }
    const description = quoteDescription.trim();
    if (description.length < 3) {
      Alert.alert("Add a description", "Briefly describe what the quoted work includes.");
      return;
    }
    const notesViolation = hiredForFilter
      ? null
      : detectContactInfo(`${description} ${quoteNotes}`);
    if (notesViolation) {
      Alert.alert("Quote blocked", contactViolationMessage(notesViolation));
      return;
    }
    const body = {
      amountPence,
      priceType: quotePriceType,
      description,
      notes: quoteNotes.trim() ? quoteNotes.trim() : null,
      validUntil:
        quoteValidDays != null
          ? new Date(Date.now() + quoteValidDays * 24 * 60 * 60 * 1000).toISOString()
          : null,
    };
    const opts = {
      onSuccess: () => setQuoteOpen(false),
      onError: (err: unknown) => {
        if (handleClaimedByOther(err)) {
          setQuoteOpen(false);
          return;
        }
        const msg = err instanceof Error ? err.message : "Could not send the quote. Please try again.";
        Alert.alert("Error", msg);
      },
    };
    if (quoteMode === "revise" && currentQuote) {
      reviseQuoteMutation.mutate({ id: currentQuote.id, data: body }, opts);
    } else {
      createQuoteMutation.mutate({ id: conversationId, data: body }, opts);
    }
  };

  const onWithdrawQuote = () => {
    if (!currentQuote) return;
    confirmAction({
      title: "Withdraw this quote",
      message: "The customer will no longer be able to accept it. You can send a new quote afterwards.",
      confirmLabel: "Withdraw quote",
      destructive: true,
      onConfirm: () =>
        withdrawQuoteMutation.mutate(
          { id: currentQuote.id },
          { onError: () => Alert.alert("Error", "Could not withdraw the quote.") },
        ),
    });
  };

  const onAcceptQuote = () => {
    if (!currentQuote) return;
    confirmAction({
      title: "Accept this quote",
      message: `Accept ${fmtPounds(currentQuote.amountPence)} (${
        currentQuote.priceType === "FIXED" ? "fixed price" : "estimate"
      }) and hire ${otherName} for this job?`,
      confirmLabel: "Accept & hire",
      onConfirm: () =>
        acceptQuoteMutation.mutate(
          { id: currentQuote.id },
          {
            onError: (err: unknown) => {
              if (isPhoneVerificationRequired(err)) {
                promptPhoneVerification();
                return;
              }
              const msg =
                err instanceof Error ? err.message : "Could not accept the quote.";
              Alert.alert("Error", msg);
            },
          },
        ),
    });
  };

  const onDeclineQuote = () => {
    if (!currentQuote) return;
    confirmAction({
      title: "Decline this quote",
      message: `Decline ${otherName}'s quote of ${fmtPounds(currentQuote.amountPence)}? They can still send you a new one.`,
      confirmLabel: "Decline quote",
      destructive: true,
      onConfirm: () =>
        declineQuoteMutation.mutate(
          { id: currentQuote.id },
          { onError: () => Alert.alert("Error", "Could not decline the quote.") },
        ),
    });
  };

  const openBookingModal = () => {
    setBookingDayKey(null);
    setBookingDuration(60);
    setBookingSlot(null);
    setBookingNote("");
    setBookingOpen(true);
  };

  const submitBooking = () => {
    if (!bookingDayKey || !bookingSlot) {
      Alert.alert("Pick a date and time", "Choose a day and an available time for the appointment.");
      return;
    }
    if (new Date(bookingSlot).getTime() <= Date.now()) {
      Alert.alert("Time has passed", "Please pick a time in the future.");
      return;
    }
    proposeBookingMutation.mutate(
      {
        id: conversationId,
        data: {
          startAt: bookingSlot,
          durationMinutes: bookingDuration as 30 | 60 | 90 | 120 | 180 | 240 | 480,
          note: bookingNote.trim() || null,
        },
      },
      {
        onSuccess: () => setBookingOpen(false),
        onError: (err: unknown) => {
          if (handleClaimedByOther(err)) {
            setBookingOpen(false);
            return;
          }
          const msg =
            err instanceof Error ? err.message : "Could not propose the appointment.";
          Alert.alert("Error", msg);
          // The slot may have just been taken — refresh the list.
          void slotsQuery.refetch();
          setBookingSlot(null);
        },
      },
    );
  };

  const onConfirmBooking = () => {
    if (!booking) return;
    confirmAction({
      title: "Confirm appointment",
      message: `Confirm the appointment on ${fmtBookingWhen(booking.startAt)}?`,
      confirmLabel: "Confirm",
      onConfirm: () =>
        confirmBookingMutation.mutate(
          { id: booking.id },
          {
            onError: (err: unknown) => {
              if (handleClaimedByOther(err)) return;
              Alert.alert("Error", "Could not confirm the appointment.");
            },
          },
        ),
    });
  };

  const onCancelBooking = () => {
    if (!booking) return;
    confirmAction({
      title: "Cancel appointment",
      message: `Cancel the appointment on ${fmtBookingWhen(booking.startAt)}? The other party will be notified.`,
      confirmLabel: "Cancel appointment",
      destructive: true,
      onConfirm: () =>
        cancelBookingMutation.mutate(
          { id: booking.id },
          {
            onError: (err: unknown) => {
              if (handleClaimedByOther(err)) return;
              Alert.alert("Error", "Could not cancel the appointment.");
            },
          },
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
            onError: (err: unknown) => {
              if (handleClaimedByOther(err)) return;
              Alert.alert("Error", "Could not notify the customer.");
            },
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
        onError: (err: unknown) => {
          if (handleClaimedByOther(err)) {
            setCancelOpen(false);
            return;
          }
          Alert.alert("Error", "Could not cancel the job.");
        },
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
      <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
        <View style={[styles.headerCard, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={goBack} style={styles.headerBackBtn} hitSlop={10}>
            <Feather name="chevron-left" size={24} color={Colors.light.primary} />
          </Pressable>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      </View>
    );
  }

  if (error || !conv) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Could not load conversation.</Text>
        <Pressable style={styles.cta} onPress={goBack}>
          <Text style={styles.ctaText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.light.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <Stack.Screen options={{ title: otherName || "Conversation" }} />
      <View style={[styles.headerCard, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={goBack} style={styles.headerBackBtn} hitSlop={10}>
          <Feather name="chevron-left" size={24} color={Colors.light.primary} />
        </Pressable>
        {!isTrader && conv.traderAvatarUrl ? (
          // Personal photo of the trader handling this conversation — shown to
          // the customer only, next to the business name. Served through the
          // authenticated avatar endpoint (membership-scoped), so pass the
          // bearer token with the image request. Tapping it opens the photo
          // full-screen in the shared viewer below.
          <Pressable
            onPress={() => setProfilePhotoOpen(true)}
            hitSlop={6}
            accessibilityRole="imagebutton"
            accessibilityLabel="View profile photo"
          >
            <Image
              source={{
                uri: avatarImageUrl(conv.traderAvatarUrl)!,
                headers: { Authorization: `Bearer ${token}` },
              }}
              style={styles.headerAvatar}
            />
          </Pressable>
        ) : !isTrader && conv.traderLogoUrl ? (
          // Unclaimed company lead (Company Teams): no person yet, so show the
          // business logo instead. Logos are public gallery objects — no auth
          // headers needed.
          <Image
            source={{ uri: objectImageUrl(conv.traderLogoUrl)! }}
            style={styles.headerAvatar}
          />
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName} numberOfLines={1}>
            {!isTrader && assignedName ? assignedName : otherName}
          </Text>
          {!isTrader && assignedName ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {conv.traderBusinessName}
            </Text>
          ) : null}
          {conv.serviceRequired ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {conv.serviceRequired}
            </Text>
          ) : null}
          {conv.jobReference ? (
            <Text style={styles.headerJobRef} numberOfLines={1}>
              Job {conv.jobReference}
            </Text>
          ) : null}
          <View style={styles.headerPills}>
            <View style={[styles.statusPill, stageDisplay.pill]}>
              <Text style={[styles.statusPillText, stageDisplay.text]}>{stageDisplay.label}</Text>
            </View>
            {isTrader && conv.stage !== "CANCELLED" ? (
              <Pressable
                style={[
                  styles.statusPill,
                  styles.tStatusPill,
                  {
                    backgroundColor:
                      TRADER_STATUS_COLORS[String(conv.traderStatus)]?.bg ??
                      Colors.light.featuredMuted,
                  },
                ]}
                onPress={() => !closed && setShowStatus((s) => !s)}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    styles.tStatusText,
                    {
                      color:
                        TRADER_STATUS_COLORS[String(conv.traderStatus)]?.text ??
                        Colors.light.featured,
                    },
                  ]}
                >
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
              ...(!claimedByOther &&
              (conv.stage === "AWAITING_REPLY" ||
                conv.stage === "HIRED" ||
                conv.stage === "AWAITING_CUSTOMER_CONFIRMATION")
                ? [
                    {
                      text: "Cancel this job",
                      onPress: () => setCancelOpen(true),
                      style: "destructive" as const,
                    },
                  ]
                : []),
              ...(!closed && !claimedByOther
                ? [{ text: "Close conversation", onPress: onClose, style: "destructive" as const }]
                : []),
              { text: "Report this conversation", onPress: onReport },
              ...(isTrader
                ? [
                    {
                      text: "Report this customer",
                      onPress: () =>
                        router.push({
                          pathname: "/report-customer",
                          params: {
                            conversationId: String(conversationId),
                            name: conv.customerName ?? "",
                          },
                        }),
                    },
                  ]
                : []),
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

      {unclaimedLead && !closed && conv.stage !== "CANCELLED" && conv.stage !== "JOB_DONE" ? (
        <View style={styles.claimBanner}>
          <Feather name="zap" size={14} color={Colors.light.primary} />
          <Text style={styles.claimBannerText}>
            New company lead — the first teammate to reply or send a quote takes this job.
          </Text>
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
          // The first message of the conversation is the original enquiry; the
          // server appends a "[N photo(s) attached]" placeholder to it when the
          // enquiry carried photos. Those photos already render as tappable
          // thumbnails in the "Photos from the enquiry" section, so strip the
          // placeholder from that one message only — later chat messages are
          // never altered, even if they happen to contain the same text.
          const isOriginalEnquiryMessage = messages.length > 0 && item.id === messages[0].id;
          const hasPhotoPlaceholder =
            isOriginalEnquiryMessage &&
            enquiryAttachments.length > 0 &&
            /\[\d+ photos? attached\]/.test(item.body);
          const displayBody = hasPhotoPlaceholder
            ? item.body.replace(/\s*\[\d+ photos? attached\]\s*/g, "\n").trim()
            : item.body;
          return (
            <View style={[styles.bubbleWrap, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
              <View style={[styles.bubble, mine ? styles.bubbleMineBg : styles.bubbleTheirsBg]}>
                <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{displayBody}</Text>
                <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
                  {fmtTime(item.createdAt)}
                </Text>
              </View>
            </View>
          );
        }}
        ListHeaderComponent={
          <View>
            <View style={styles.safetyBanner}>
              <Feather name="shield" size={14} color={Colors.light.primary} />
              <Text style={styles.safetyText}>
                For your safety, keep all conversations inside MyLocalTrade until you're
                confident in the trader. Never share your bank details, and don't pay for
                any work before it's agreed.
              </Text>
            </View>
            {enquiryAttachments.length > 0 ? (
              <View style={styles.enquiryPhotos}>
                <Text style={styles.enquiryPhotosLabel}>Photos from the enquiry</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.enquiryPhotosRow}
                >
                  {enquiryAttachments.map((uri, idx) => (
                    <Pressable
                      key={`${uri}-${idx}`}
                      onPress={() => setPhotoViewer(idx)}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`Open enquiry photo ${idx + 1}`}
                    >
                      <Image
                        source={{ uri }}
                        style={styles.enquiryPhotoThumb}
                        resizeMode="cover"
                      />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={styles.systemText}>Start the conversation by sending a message.</Text>
          </View>
        }
      />

      {currentQuote && conv.stage !== "CANCELLED" ? (
        <View style={styles.quoteCard}>
          <View style={styles.quoteHeaderRow}>
            <View style={styles.quoteTitleWrap}>
              <Feather name="file-text" size={14} color={Colors.light.primary} />
              <Text style={styles.quoteTitle}>
                {isTrader ? "Your quote" : `Quote from ${otherName}`}
              </Text>
            </View>
            <View
              style={[
                styles.quoteStatusPill,
                currentQuoteStatus === "ACCEPTED" && styles.quotePillAccepted,
                (currentQuoteStatus === "DECLINED" ||
                  currentQuoteStatus === "WITHDRAWN" ||
                  currentQuoteStatus === "EXPIRED") &&
                  styles.quotePillEnded,
              ]}
            >
              <Text
                style={[
                  styles.quoteStatusPillText,
                  currentQuoteStatus === "ACCEPTED" && styles.quotePillAcceptedText,
                  (currentQuoteStatus === "DECLINED" ||
                    currentQuoteStatus === "WITHDRAWN" ||
                    currentQuoteStatus === "EXPIRED") &&
                    styles.quotePillEndedText,
                ]}
              >
                {QUOTE_STATUS_LABEL[currentQuoteStatus ?? ""] ?? currentQuoteStatus}
              </Text>
            </View>
          </View>
          <View style={styles.quoteAmountRow}>
            <Text style={styles.quoteAmount}>{fmtPounds(currentQuote.amountPence)}</Text>
            <Text style={styles.quotePriceType}>
              {currentQuote.priceType === "FIXED" ? "Fixed price" : "Estimate"}
            </Text>
          </View>
          <Text style={styles.quoteDescription} numberOfLines={3}>
            {currentQuote.description}
          </Text>
          {currentQuote.notes ? (
            <Text style={styles.quoteNotes} numberOfLines={2}>
              {currentQuote.notes}
            </Text>
          ) : null}
          {currentQuote.validUntil && hasLivePendingQuote ? (
            <Text style={styles.quoteValidity}>
              Valid until {fmtDate(currentQuote.validUntil)}
            </Text>
          ) : currentQuoteStatus === "EXPIRED" && currentQuote.validUntil ? (
            <Text style={styles.quoteValidity}>
              Expired on {fmtDate(currentQuote.validUntil)}
            </Text>
          ) : null}
          {!closed && !isTrader && hasLivePendingQuote ? (
            <View style={styles.quoteActionsRow}>
              <Pressable
                style={[styles.quoteBtn, styles.quoteBtnPrimary, quoteBusy && styles.quoteBtnDisabled]}
                disabled={quoteBusy}
                onPress={onAcceptQuote}
              >
                {acceptQuoteMutation.isPending ? (
                  <ActivityIndicator size="small" color={Colors.light.white} />
                ) : (
                  <>
                    <Feather name="check-circle" size={14} color={Colors.light.white} />
                    <Text style={styles.quoteBtnPrimaryText}>Accept & hire</Text>
                  </>
                )}
              </Pressable>
              <Pressable
                style={[styles.quoteBtn, styles.quoteBtnGhost, quoteBusy && styles.quoteBtnDisabled]}
                disabled={quoteBusy}
                onPress={onDeclineQuote}
              >
                <Text style={styles.quoteBtnGhostText}>Decline</Text>
              </Pressable>
            </View>
          ) : null}
          {!closed && isTrader && !claimedByOther && (hasLivePendingQuote || currentQuoteStatus === "EXPIRED") ? (
            <View style={styles.quoteActionsRow}>
              <Pressable
                style={[styles.quoteBtn, styles.quoteBtnPrimary, quoteBusy && styles.quoteBtnDisabled]}
                disabled={quoteBusy}
                onPress={() => openQuoteForm("revise")}
              >
                <Feather name="edit-2" size={14} color={Colors.light.white} />
                <Text style={styles.quoteBtnPrimaryText}>
                  {currentQuoteStatus === "EXPIRED" ? "Reissue quote" : "Revise"}
                </Text>
              </Pressable>
              {hasLivePendingQuote ? (
                <Pressable
                  style={[styles.quoteBtn, styles.quoteBtnGhost, quoteBusy && styles.quoteBtnDisabled]}
                  disabled={quoteBusy}
                  onPress={onWithdrawQuote}
                >
                  {withdrawQuoteMutation.isPending ? (
                    <ActivityIndicator size="small" color={Colors.light.primary} />
                  ) : (
                    <Text style={styles.quoteBtnGhostText}>Withdraw</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {!closed &&
          isTrader &&
          !claimedByOther &&
          !hasLivePendingQuote &&
          !hasAcceptedQuote &&
          currentQuoteStatus !== "EXPIRED" &&
          conv.stage !== "JOB_DONE" ? (
            <View style={styles.quoteActionsRow}>
              <Pressable
                style={[styles.quoteBtn, styles.quoteBtnPrimary, quoteBusy && styles.quoteBtnDisabled]}
                disabled={quoteBusy}
                onPress={() => openQuoteForm("create")}
              >
                <Feather name="plus" size={14} color={Colors.light.white} />
                <Text style={styles.quoteBtnPrimaryText}>Send a new quote</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Appointment (booking) card: only inside hired, still-live jobs. A
          PROPOSED booking shows Confirm to the non-proposer; both parties can
          cancel or propose a new time (reschedule = new proposal, mutual
          confirmation — never a silent overwrite). */}
      {hired && conv.stage !== "CANCELLED" && conv.stage !== "JOB_DONE" && !closed && (booking || !claimedByOther) ? (
        <View style={styles.bookingBar}>
          {booking ? (
            <>
              <View style={styles.bookingHeaderRow}>
                <View style={styles.quoteTitleWrap}>
                  <Feather name="calendar" size={14} color={Colors.light.primary} />
                  <Text style={styles.quoteTitle}>Appointment</Text>
                </View>
                <View
                  style={[
                    styles.quoteStatusPill,
                    booking.status === "CONFIRMED" && styles.quotePillAccepted,
                  ]}
                >
                  <Text
                    style={[
                      styles.quoteStatusPillText,
                      booking.status === "CONFIRMED" && styles.quotePillAcceptedText,
                    ]}
                  >
                    {booking.status === "CONFIRMED"
                      ? "Confirmed"
                      : booking.proposedByRole === (isTrader ? "trader" : "customer")
                        ? "Awaiting their confirmation"
                        : "Awaiting your confirmation"}
                  </Text>
                </View>
              </View>
              <Text style={styles.bookingWhen}>{fmtBookingWhen(booking.startAt)}</Text>
              {booking.note ? (
                <Text style={styles.quoteNotes} numberOfLines={2}>{booking.note}</Text>
              ) : null}
              {!claimedByOther ? (
              <View style={styles.quoteActionsRow}>
                {booking.status === "PROPOSED" &&
                booking.proposedByRole !== (isTrader ? "trader" : "customer") ? (
                  <Pressable
                    style={[styles.quoteBtn, styles.quoteBtnPrimary, bookingBusy && styles.quoteBtnDisabled]}
                    disabled={bookingBusy}
                    onPress={onConfirmBooking}
                  >
                    {confirmBookingMutation.isPending ? (
                      <ActivityIndicator size="small" color={Colors.light.white} />
                    ) : (
                      <>
                        <Feather name="check-circle" size={14} color={Colors.light.white} />
                        <Text style={styles.quoteBtnPrimaryText}>Confirm</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
                {booking.status === "CONFIRMED" ? (
                  <Pressable
                    style={[styles.quoteBtn, styles.quoteBtnGhost, bookingBusy && styles.quoteBtnDisabled]}
                    disabled={bookingBusy}
                    onPress={onAddBookingToCalendar}
                  >
                    <Feather name="calendar" size={14} color={Colors.light.primary} />
                    <Text style={styles.quoteBtnGhostText}>Add to Calendar</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.quoteBtn, styles.quoteBtnGhost, bookingBusy && styles.quoteBtnDisabled]}
                  disabled={bookingBusy}
                  onPress={openBookingModal}
                >
                  <Text style={styles.quoteBtnGhostText}>Propose new time</Text>
                </Pressable>
                <Pressable
                  style={[styles.quoteBtn, styles.quoteBtnGhost, bookingBusy && styles.quoteBtnDisabled]}
                  disabled={bookingBusy}
                  onPress={onCancelBooking}
                >
                  {cancelBookingMutation.isPending ? (
                    <ActivityIndicator size="small" color={Colors.light.primary} />
                  ) : (
                    <Text style={styles.quoteBtnGhostText}>Cancel</Text>
                  )}
                </Pressable>
              </View>
              ) : null}
            </>
          ) : (
            <View style={styles.bookingEmptyRow}>
              <View style={styles.quoteTitleWrap}>
                <Feather name="calendar" size={14} color={Colors.light.primary} />
                <Text style={styles.quoteTitle}>No appointment booked yet</Text>
              </View>
              <Pressable
                style={[styles.quoteBtn, styles.quoteBtnPrimary, bookingBusy && styles.quoteBtnDisabled]}
                disabled={bookingBusy}
                onPress={openBookingModal}
              >
                <Feather name="plus" size={14} color={Colors.light.white} />
                <Text style={styles.quoteBtnPrimaryText}>Propose a time</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      {/* Contact details (Part 7): the API only includes contactDetails after
          the customer accepted a quote / hired, so this section can never
          render pre-hire. Each viewer sees the OTHER party's details. */}
      {hired && contactDetails && conv.stage !== "CANCELLED" ? (
        <View style={styles.contactBar}>
          <View style={styles.contactBarHeader}>
            <Feather name="unlock" size={14} color={Colors.light.success} />
            <Text style={styles.contactBarTitle}>Contact details available</Text>
          </View>
          {(() => {
            const other = isTrader ? contactDetails.customer : contactDetails.trader;
            const otherLabel = isTrader
              ? contactDetails.customer?.name ?? "the customer"
              : contactDetails.trader?.businessName ?? contactDetails.trader?.name ?? "the trader";
            return (
              <>
                {other?.phone ? (
                  <Pressable
                    style={styles.contactBarRow}
                    onPress={() => Linking.openURL(`tel:${other.phone}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${otherLabel}`}
                  >
                    <Feather name="phone" size={14} color={Colors.light.primary} />
                    <Text style={styles.contactBarLink}>{other.phone}</Text>
                  </Pressable>
                ) : null}
                {other?.email ? (
                  <Pressable
                    style={styles.contactBarRow}
                    onPress={() => Linking.openURL(`mailto:${other.email}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Email ${otherLabel}`}
                  >
                    <Feather name="mail" size={14} color={Colors.light.primary} />
                    <Text style={styles.contactBarLink}>{other.email}</Text>
                  </Pressable>
                ) : null}
                <Text style={styles.contactBarHint}>
                  Keep important job details and agreements in this chat so there's a record you can both refer back to.
                </Text>
              </>
            );
          })()}
        </View>
      ) : null}

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
            hasLivePendingQuote ? (
              <View style={styles.lifecycleDone}>
                <Feather name="file-text" size={14} color={Colors.light.textSecondary} />
                <Text style={styles.lifecycleDoneText}>
                  Review the quote above to hire {otherName}.
                </Text>
              </View>
            ) : !traderHasEngaged ? (
              <View style={styles.lifecycleDone}>
                <Feather name="clock" size={14} color={Colors.light.textSecondary} />
                <Text style={styles.lifecycleDoneText}>
                  Waiting for {otherName} to reply. You can accept an offer once they respond.
                </Text>
              </View>
            ) : (
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
            )
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
      ) : isTrader && !closed && !claimedByOther ? (
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
            <>
              <View style={styles.lifecycleDone}>
                <Feather name="clock" size={14} color={Colors.light.textSecondary} />
                <Text style={styles.lifecycleDoneText}>
                  {hasLivePendingQuote
                    ? `Your quote has been sent. Waiting for ${otherName} to respond.`
                    : `Waiting for ${otherName} to hire you. Send a quote to set out your price.`}
                </Text>
              </View>
              {!currentQuote ? (
                <Pressable
                  style={styles.lifecycleBtn}
                  onPress={() => openQuoteForm("create")}
                  disabled={quoteBusy}
                >
                  <Feather name="file-text" size={16} color={Colors.light.white} />
                  <Text style={styles.lifecycleBtnText}>Send a quote</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {closed ? (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.closedText}>This conversation is {conv.status.toLowerCase()}.</Text>
        </View>
      ) : claimedByOther ? (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.closedText}>
            {assignedName ?? "A teammate"} is handling this job — it's read-only for you.
          </Text>
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

      <Modal
        visible={quoteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setQuoteOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.modalCard, { maxHeight: "85%" }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>
                {quoteMode === "revise" ? "Revise your quote" : "Send a quote"}
              </Text>
              <Text style={styles.modalSub}>
                {quoteMode === "revise"
                  ? "This replaces your previous quote. The customer will be notified."
                  : `Set out your price for ${conv.serviceRequired || "this job"}. The customer can accept it to hire you.`}
              </Text>

              <Text style={styles.quoteFieldLabel}>Price (£)</Text>
              <TextInput
                style={styles.quoteInput}
                value={quoteAmount}
                onChangeText={setQuoteAmount}
                placeholder="e.g. 450"
                placeholderTextColor={Colors.light.textMuted}
                keyboardType="decimal-pad"
                maxLength={12}
              />

              <Text style={styles.quoteFieldLabel}>Price type</Text>
              <View style={styles.quoteChipRow}>
                {(
                  [
                    { v: "FIXED", label: "Fixed price" },
                    { v: "ESTIMATE", label: "Estimate" },
                  ] as const
                ).map((opt) => (
                  <Pressable
                    key={opt.v}
                    style={[styles.quoteChip, quotePriceType === opt.v && styles.quoteChipActive]}
                    onPress={() => setQuotePriceType(opt.v)}
                  >
                    <Text
                      style={[
                        styles.quoteChipText,
                        quotePriceType === opt.v && styles.quoteChipTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.quoteFieldLabel}>What's included</Text>
              <TextInput
                style={[styles.quoteInput, styles.quoteInputMultiline]}
                value={quoteDescription}
                onChangeText={setQuoteDescription}
                placeholder="Describe the work this quote covers…"
                placeholderTextColor={Colors.light.textMuted}
                multiline
                maxLength={2000}
              />

              <Text style={styles.quoteFieldLabel}>Notes (optional)</Text>
              <TextInput
                style={[styles.quoteInput, styles.quoteInputMultiline]}
                value={quoteNotes}
                onChangeText={setQuoteNotes}
                placeholder="e.g. materials included, start date…"
                placeholderTextColor={Colors.light.textMuted}
                multiline
                maxLength={1000}
              />

              <Text style={styles.quoteFieldLabel}>Quote valid for</Text>
              <View style={styles.quoteChipRow}>
                {(
                  [
                    { v: 7, label: "7 days" },
                    { v: 14, label: "14 days" },
                    { v: 30, label: "30 days" },
                    { v: null, label: "No expiry" },
                  ] as const
                ).map((opt) => (
                  <Pressable
                    key={String(opt.v)}
                    style={[styles.quoteChip, quoteValidDays === opt.v && styles.quoteChipActive]}
                    onPress={() => setQuoteValidDays(opt.v)}
                  >
                    <Text
                      style={[
                        styles.quoteChipText,
                        quoteValidDays === opt.v && styles.quoteChipTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.modalActions}>
                <Pressable
                  style={[styles.modalBtn, styles.modalBtnGhost]}
                  onPress={() => setQuoteOpen(false)}
                >
                  <Text style={styles.modalBtnGhostText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modalBtn,
                    styles.modalBtnPrimary,
                    (createQuoteMutation.isPending || reviseQuoteMutation.isPending) &&
                      styles.modalBtnDisabled,
                  ]}
                  disabled={createQuoteMutation.isPending || reviseQuoteMutation.isPending}
                  onPress={onSubmitQuote}
                >
                  {createQuoteMutation.isPending || reviseQuoteMutation.isPending ? (
                    <ActivityIndicator size="small" color={Colors.light.white} />
                  ) : (
                    <Text style={styles.modalBtnPrimaryText}>
                      {quoteMode === "revise" ? "Send revised quote" : "Send quote"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={photoViewer !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoViewer(null)}
      >
        <View style={styles.photoViewerBackdrop}>
          <Pressable
            style={styles.photoViewerClose}
            onPress={() => setPhotoViewer(null)}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
          >
            <Feather name="x" size={26} color="#fff" />
          </Pressable>
          {photoViewer !== null && enquiryAttachments[photoViewer] ? (
            <Image
              source={{ uri: enquiryAttachments[photoViewer] }}
              style={styles.photoViewerImage}
              resizeMode="contain"
            />
          ) : null}
          {photoViewer !== null && enquiryAttachments.length > 1 ? (
            <View style={styles.photoViewerNav}>
              <Pressable
                disabled={photoViewer <= 0}
                onPress={() =>
                  setPhotoViewer((i) => (i != null ? Math.max(0, i - 1) : i))
                }
                style={styles.photoViewerNavBtn}
                accessibilityRole="button"
                accessibilityLabel="Previous photo"
              >
                <Feather
                  name="chevron-left"
                  size={28}
                  color={photoViewer <= 0 ? "#555" : "#fff"}
                />
              </Pressable>
              <Text style={styles.photoViewerCount}>
                {photoViewer + 1} / {enquiryAttachments.length}
              </Text>
              <Pressable
                disabled={photoViewer >= enquiryAttachments.length - 1}
                onPress={() =>
                  setPhotoViewer((i) =>
                    i != null ? Math.min(enquiryAttachments.length - 1, i + 1) : i,
                  )
                }
                style={styles.photoViewerNavBtn}
                accessibilityRole="button"
                accessibilityLabel="Next photo"
              >
                <Feather
                  name="chevron-right"
                  size={28}
                  color={photoViewer >= enquiryAttachments.length - 1 ? "#555" : "#fff"}
                />
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal
        visible={profilePhotoOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setProfilePhotoOpen(false)}
      >
        <View style={styles.photoViewerBackdrop}>
          <Text style={styles.profilePhotoTitle}>Profile photo</Text>
          <Pressable
            style={styles.photoViewerClose}
            onPress={() => setProfilePhotoOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close profile photo"
          >
            <Feather name="x" size={26} color="#fff" />
          </Pressable>
          {conv.traderAvatarUrl ? (
            <Image
              source={{
                uri: avatarImageUrl(conv.traderAvatarUrl)!,
                headers: { Authorization: `Bearer ${token}` },
              }}
              style={styles.photoViewerImage}
              resizeMode="contain"
            />
          ) : null}
        </View>
      </Modal>

      <Modal
        visible={bookingOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBookingOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {booking ? "Propose a new time" : "Propose an appointment"}
            </Text>
            <Text style={styles.bookingModalHint}>
              {booking
                ? "This replaces the current appointment once proposed — the other party will need to confirm the new time."
                : "Pick a date and time. The other party will be asked to confirm."}
            </Text>

            <Text style={styles.quoteFieldLabel}>Date</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.bookingChipRow}
            >
              {bookingDayOptions().map((d) => (
                <Pressable
                  key={d.key}
                  style={[styles.quoteChip, bookingDayKey === d.key && styles.quoteChipActive]}
                  onPress={() => {
                    setBookingDayKey(d.key);
                    setBookingSlot(null);
                  }}
                >
                  <Text
                    style={[
                      styles.quoteChipText,
                      bookingDayKey === d.key && styles.quoteChipTextActive,
                    ]}
                  >
                    {d.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.quoteFieldLabel}>Duration</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.bookingChipRow}
            >
              {BOOKING_DURATION_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.minutes}
                  style={[
                    styles.quoteChip,
                    bookingDuration === opt.minutes && styles.quoteChipActive,
                  ]}
                  onPress={() => {
                    setBookingDuration(opt.minutes);
                    setBookingSlot(null);
                  }}
                >
                  <Text
                    style={[
                      styles.quoteChipText,
                      bookingDuration === opt.minutes && styles.quoteChipTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.quoteFieldLabel}>Available times</Text>
            {!bookingDayKey ? (
              <Text style={styles.bookingModalHint}>Pick a date to see available times.</Text>
            ) : slotsQuery.isLoading ? (
              <ActivityIndicator size="small" color={Colors.light.primary} />
            ) : (slotsQuery.data?.slots?.length ?? 0) === 0 ? (
              <Text style={styles.bookingModalHint}>
                No available times for this day and duration. Try another day or a shorter
                appointment.
              </Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.bookingChipRow}
              >
                {(slotsQuery.data?.slots ?? []).map((iso) => (
                  <Pressable
                    key={iso}
                    style={[styles.quoteChip, bookingSlot === iso && styles.quoteChipActive]}
                    onPress={() => setBookingSlot(iso)}
                  >
                    <Text
                      style={[
                        styles.quoteChipText,
                        bookingSlot === iso && styles.quoteChipTextActive,
                      ]}
                    >
                      {fmtTime(iso)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            <Text style={styles.quoteFieldLabel}>Note (optional)</Text>
            <TextInput
              style={styles.quoteInput}
              value={bookingNote}
              onChangeText={setBookingNote}
              placeholder="e.g. Initial visit to look at the job"
              placeholderTextColor={Colors.light.textMuted}
              maxLength={300}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.quoteBtn, styles.quoteBtnGhost]}
                onPress={() => setBookingOpen(false)}
              >
                <Text style={styles.quoteBtnGhostText}>Back</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.quoteBtn,
                  styles.quoteBtnPrimary,
                  (proposeBookingMutation.isPending || !bookingDayKey || !bookingSlot) &&
                    styles.quoteBtnDisabled,
                ]}
                disabled={proposeBookingMutation.isPending || !bookingDayKey || !bookingSlot}
                onPress={submitBooking}
              >
                {proposeBookingMutation.isPending ? (
                  <ActivityIndicator size="small" color={Colors.light.white} />
                ) : (
                  <Text style={styles.quoteBtnPrimaryText}>Propose</Text>
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
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: Colors.light.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  headerName: { fontSize: 16, fontWeight: "700", color: Colors.light.text },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    backgroundColor: Colors.light.primaryMuted,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  headerSub: { fontSize: 12, color: Colors.light.textSecondary, marginTop: 2 },
  headerJobRef: { fontSize: 12, fontWeight: "600", color: Colors.light.textSecondary, marginTop: 2 },
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
  contactBar: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(6, 214, 160, 0.08)",
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    gap: 6,
  },
  contactBarHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  contactBarTitle: { fontSize: 13, fontWeight: "700", color: Colors.light.text },
  contactBarRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  contactBarLink: { fontSize: 14, fontWeight: "600", color: Colors.light.primary },
  contactBarHint: { fontSize: 11, color: Colors.light.textMuted, lineHeight: 15 },
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
  modalBtnPrimary: { backgroundColor: Colors.light.primary },
  modalBtnPrimaryText: { color: Colors.light.white, fontWeight: "700", fontSize: 14 },
  modalBtnDisabled: { opacity: 0.5 },

  quoteCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.surface,
    gap: 6,
  },
  bookingBar: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.surface,
    gap: 6,
  },
  bookingHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  bookingWhen: { fontSize: 17, fontWeight: "700", color: Colors.light.text },
  bookingEmptyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  bookingChipRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  bookingModalHint: { fontSize: 13, color: Colors.light.textMuted, marginBottom: 8, lineHeight: 18 },
  quoteHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  quoteTitleWrap: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  quoteTitle: { fontSize: 13, fontWeight: "700", color: Colors.light.text, flexShrink: 1 },
  quoteStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: Colors.light.primaryMuted,
  },
  quoteStatusPillText: {
    fontSize: 10,
    fontWeight: "700",
    color: Colors.light.primary,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  quotePillAccepted: { backgroundColor: "rgba(6, 214, 160, 0.14)" },
  quotePillAcceptedText: { color: Colors.light.success },
  quotePillEnded: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  quotePillEndedText: { color: Colors.light.textSecondary },
  quoteAmountRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  quoteAmount: { fontSize: 22, fontWeight: "800", color: Colors.light.text },
  quotePriceType: { fontSize: 12, fontWeight: "600", color: Colors.light.textSecondary },
  quoteDescription: { fontSize: 13, color: Colors.light.text, lineHeight: 18 },
  quoteNotes: { fontSize: 12, color: Colors.light.textSecondary, fontStyle: "italic" },
  quoteValidity: { fontSize: 11, fontWeight: "600", color: Colors.light.textSecondary },
  quoteActionsRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  quoteBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    borderRadius: 10,
  },
  quoteBtnPrimary: { backgroundColor: Colors.light.primary },
  quoteBtnPrimaryText: { color: Colors.light.white, fontWeight: "700", fontSize: 13 },
  quoteBtnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  quoteBtnGhostText: { color: Colors.light.text, fontWeight: "700", fontSize: 13 },
  quoteBtnDisabled: { opacity: 0.5 },
  quoteFieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.light.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 12,
    marginBottom: 6,
  },
  quoteInput: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.light.text,
    backgroundColor: Colors.light.background,
  },
  quoteInputMultiline: { minHeight: 70, textAlignVertical: "top" },
  quoteChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quoteChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  quoteChipActive: {
    borderColor: Colors.light.primary,
    backgroundColor: Colors.light.primaryMuted,
  },
  quoteChipText: { fontSize: 12, fontWeight: "600", color: Colors.light.textSecondary },
  quoteChipTextActive: { color: Colors.light.primary },
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
  enquiryPhotos: { marginBottom: 12 },
  enquiryPhotosLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.light.textMuted,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  enquiryPhotosRow: { gap: 8, paddingRight: 4 },
  enquiryPhotoThumb: {
    width: 84,
    height: 84,
    borderRadius: 10,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  photoViewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoViewerClose: {
    position: "absolute",
    top: 48,
    right: 20,
    zIndex: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  // Title row of the profile-photo viewer; inset from both edges so it never
  // overlaps the absolute-positioned close button.
  profilePhotoTitle: {
    position: "absolute",
    top: 58,
    left: 76,
    right: 76,
    zIndex: 1,
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  photoViewerImage: { width: "100%", height: "80%" },
  photoViewerNav: {
    position: "absolute",
    bottom: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
  },
  photoViewerNavBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  photoViewerCount: { color: "#fff", fontSize: 14, fontWeight: "600", minWidth: 54, textAlign: "center" },
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
  claimBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.light.primaryMuted,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  claimBannerText: {
    flex: 1,
    fontSize: 12,
    color: Colors.light.primary,
    fontWeight: "600",
    lineHeight: 16,
  },
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
