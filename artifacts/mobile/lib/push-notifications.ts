import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  registerPushToken as apiRegisterPushToken,
  unregisterPushToken as apiUnregisterPushToken,
} from "@workspace/api-client-react";

const STORAGE_KEY = "push_token";

let handlerConfigured = false;
function ensureForegroundHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#00B4D8",
  });
}

async function getProjectId(): Promise<string | undefined> {
  const fromEas =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
      ?.projectId;
  const fromEasConfig = (Constants.easConfig as { projectId?: string } | undefined)?.projectId;
  return fromEas ?? fromEasConfig ?? undefined;
}

/**
 * Ask the user for permission, fetch the Expo push token, and register it
 * with the API for the currently-authenticated user. Safe to call multiple
 * times — it no-ops on simulators and on permission denial.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  ensureForegroundHandler();

  if (!Device.isDevice) {
    console.log("[push] Skipping — not a physical device");
    return null;
  }
  if (Platform.OS === "web") {
    return null;
  }

  await ensureAndroidChannel();

  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== "granted") {
      console.log("[push] Permission not granted");
      return null;
    }

    const projectId = await getProjectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse.data;
    if (!token) return null;

    await AsyncStorage.setItem(STORAGE_KEY, token);
    await apiRegisterPushToken({
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
    });
    return token;
  } catch (err) {
    console.warn("[push] Failed to register for push notifications:", err);
    return null;
  }
}

/**
 * Best-effort: tell the API to forget this device's push token. Called on
 * logout so the previous user no longer receives notifications on this device.
 */
export async function unregisterPushNotificationsAsync(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(STORAGE_KEY);
    if (!token) return;
    try {
      await apiUnregisterPushToken({ token });
    } catch (err) {
      console.warn("[push] Failed to unregister token with API:", err);
    }
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("[push] Failed to clear push token:", err);
  }
}
