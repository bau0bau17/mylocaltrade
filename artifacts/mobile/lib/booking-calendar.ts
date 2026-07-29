import * as Calendar from "expo-calendar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Platform } from "react-native";

// "Add to Calendar" for CONFIRMED appointments. Deliberately minimal:
// - Nothing is written without an explicit user tap ("Add to Calendar").
// - Permission is requested only at that moment.
// - We remember the event we created (per booking id + start time) in
//   AsyncStorage so tapping again never creates a duplicate. A reschedule is
//   a NEW booking row (new id) server-side, so it naturally gets its own
//   fresh prompt — we never edit or delete the user's existing events.
// - Cancellation does not touch the calendar (no silent mutations of a
//   personal calendar in v1).

const EVENT_KEY = (bookingId: number, startAtIso: string) =>
  `booking_cal_event_${bookingId}_${startAtIso}`;
const PROMPT_KEY = (bookingId: number, startAtIso: string) =>
  `booking_cal_prompted_${bookingId}_${startAtIso}`;

export interface BookingCalendarInput {
  bookingId: number;
  startAtIso: string;
  /** Service or other party's name — used in the event title. */
  contextLabel: string | null;
  /** Job reference shown in the notes, e.g. conversation id. */
  jobRef: number;
  /** Appointment length in minutes; legacy bookings default to 60. */
  durationMinutes?: number | null;
}

const DEFAULT_DURATION_MINUTES = 60;

async function getWritableCalendarId(): Promise<string | null> {
  if (Platform.OS === "ios") {
    const def = await Calendar.getDefaultCalendarAsync();
    return def?.id ?? null;
  }
  // Android: prefer the primary calendar, else any that allows modifications.
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const primary = cals.find((c) => (c as { isPrimary?: boolean }).isPrimary && c.allowsModifications);
  return (primary ?? cals.find((c) => c.allowsModifications))?.id ?? null;
}

/** True if we've already created a calendar event for this exact booking+time. */
export async function isBookingInCalendar(bookingId: number, startAtIso: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(EVENT_KEY(bookingId, startAtIso))) != null;
  } catch {
    return false;
  }
}

export async function hasPromptedForBooking(bookingId: number, startAtIso: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PROMPT_KEY(bookingId, startAtIso))) != null;
  } catch {
    return true; // storage broken → fail quiet, don't nag
  }
}

export async function markPromptedForBooking(bookingId: number, startAtIso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PROMPT_KEY(bookingId, startAtIso), new Date().toISOString());
  } catch {
    // best-effort
  }
}

/**
 * Request permission (if needed) and create the calendar event. Idempotent:
 * if this booking+time was already added from this app, no duplicate is
 * created. Returns true when the event exists afterwards.
 */
export async function addBookingToCalendar(input: BookingCalendarInput): Promise<boolean> {
  try {
    if (await isBookingInCalendar(input.bookingId, input.startAtIso)) {
      Alert.alert("Already added", "This appointment is already in your calendar.");
      return true;
    }

    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Calendar access needed",
        "To add this appointment, allow calendar access for MyLocalTrade in Settings.",
      );
      return false;
    }

    const calendarId = await getWritableCalendarId();
    if (!calendarId) {
      Alert.alert("No calendar found", "We couldn't find a calendar to add the appointment to.");
      return false;
    }

    const start = new Date(input.startAtIso);
    const title = input.contextLabel
      ? `MyLocalTrade appointment — ${input.contextLabel}`
      : "MyLocalTrade appointment";
    const eventId = await Calendar.createEventAsync(calendarId, {
      title,
      startDate: start,
      endDate: new Date(
        start.getTime() + (input.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60 * 1000,
      ),
      notes: `MyLocalTrade job reference: MLT-${String(input.jobRef).padStart(6, "0")}`,
    });

    await AsyncStorage.setItem(EVENT_KEY(input.bookingId, input.startAtIso), eventId);
    await markPromptedForBooking(input.bookingId, input.startAtIso);
    Alert.alert("Added to calendar", "The appointment is in your calendar.");
    return true;
  } catch {
    Alert.alert("Error", "Could not add the appointment to your calendar.");
    return false;
  }
}
