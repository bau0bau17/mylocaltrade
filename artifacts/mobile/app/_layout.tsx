import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef } from "react";
import {
  Appearance,
  Platform,
  Keyboard,
  TextInput,
  findNodeHandle,
  type GestureResponderEvent,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { View } from "react-native";

import Colors from "@/constants/colors";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ScreenHeader } from "@/components/ScreenHeader";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SubscriptionProvider } from "@/lib/revenuecat";
import { SearchRadiusProvider } from "@/contexts/SearchRadiusContext";
import {
  setBaseUrl,
  setAuthTokenGetter,
  getGetConversationsUnreadCountQueryKey,
} from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/api-url";
import {
  markNotificationResponseHandled,
  notificationDestination,
  notificationIsForUser,
} from "@/lib/notification-response-routing";

SplashScreen.preventAutoHideAsync();

// MyLocalTrade is a dark-mode-only app. Force the native appearance to dark
// at startup so system surfaces the app presents (keyboard, alerts, action
// sheets, date pickers, share sheets) never render light over the dark UI
// when the device itself is in Light mode. This is the runtime counterpart
// of `"userInterfaceStyle": "dark"` in app.json (which is baked into the
// native binary and only takes effect from the next build onward).
if (Platform.OS !== "web") {
  try {
    Appearance.setColorScheme("dark");
  } catch {
    // Very old runtimes without setColorScheme: the app.json setting covers
    // them from the next native build.
  }
}

setBaseUrl(getApiUrl());
setAuthTokenGetter(() => AsyncStorage.getItem("auth_token"));

const queryClient = new QueryClient();

function useNotificationDeepLinks() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const handledNotificationResponses = useRef(new Set<string>());

  useEffect(() => {
    // expo-notifications has no native module on web — every API throws
    // "is not available on web". Skip deep-link wiring entirely there.
    if (Platform.OS === "web") return;
    // Wait for the current authenticated identity. This avoids routing a
    // notification while auth hydration is still resolving and ensures that an
    // account switch gets a fresh, identity-scoped response handler.
    if (!user) return;
    // Admins don't have customer/trader chats or leads — never deep-link them
    // into those surfaces (they'd hit the role-block screens).
    if (isAdmin) return;

    let active = true;
    const handle = (response: Notifications.NotificationResponse) => {
      if (!active) return false;
      const request = response.notification.request;
      // Do this before any routing or dedupe state is changed. Push tokens can
      // be reassigned on a shared device; an old response must never steer the
      // newly authenticated account toward another account's conversation.
      if (!notificationIsForUser(request.content.data, user.id)) {
        return true; // consume stale/unbound cold-start responses without routing
      }
      if (!markNotificationResponseHandled(handledNotificationResponses.current, request.identifier)) {
        return false;
      }

      const destination = notificationDestination(request.content.data);
      if (destination) {
        // This only changes the route. Conversation screens continue to fetch
        // through the authenticated API, whose participant/company checks are
        // the source of truth for stale or cross-account payloads.
        router.push(destination);
      }
      return true;
    };

    // App was opened by tapping a notification while killed.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && handle(response)) {
        // Clear so a future cold start doesn't re-navigate to a stale thread.
        const maybeClear = (
          Notifications as unknown as {
            clearLastNotificationResponseAsync?: () => Promise<void>;
          }
        ).clearLastNotificationResponseAsync;
        if (typeof maybeClear === "function") {
          void maybeClear();
        }
      }
    });

    // Tap on a notification while app is foregrounded/backgrounded.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handle(response);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [router, user, isAdmin]);
}

// Keeps the unread-messages badges live: when a message push notification
// arrives while the app is foregrounded, invalidate the unread-count query so
// the tab-bar badge and the Account screen's Messages row update immediately,
// without waiting for navigation or an app refocus.
function useLiveUnreadBadge() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isAuthenticated = !!user;

  useEffect(() => {
    // expo-notifications has no native module on web, and admins have no
    // customer/trader chats — same gating as the deep-link wiring above.
    if (Platform.OS === "web") return;
    if (!isAuthenticated || isAdmin) return;

    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as
        | { type?: string }
        | null
        | undefined;
      if (data?.type === "new_message") {
        void queryClient.invalidateQueries({
          queryKey: getGetConversationsUnreadCountQueryKey(),
        });
      }
    });
    return () => sub.remove();
  }, [isAuthenticated, isAdmin]);
}

// App-wide "tap anywhere outside an input to close the keyboard".
//
// Deliberately NOT a Touchable/Pressable wrapper: a root-level touchable
// enters the responder negotiation and can conflict with ScrollView/gesture
// handling on some screens (reported: document-upload screen stopped
// scrolling after a tap). Instead we use the passive onTouchStart/onTouchEnd
// View props, which merely observe touches during bubbling and NEVER claim
// the gesture — so scrolling, buttons, swipes and list rows are untouched.
//
// A touch counts as a "tap" only if the finger barely moved between start
// and end (drags/scrolls move further and are ignored). We also skip the
// dismiss when the tap landed on the currently focused TextInput itself, so
// tapping inside the field to move the cursor doesn't close the keyboard.
function useTapOutsideKeyboardDismiss() {
  // Keyed by touch identifier so simultaneous fingers don't overwrite each
  // other's start position (a second finger would otherwise corrupt the
  // tap-vs-drag measurement of the first).
  const touchStarts = useRef(new Map<string, { x: number; y: number }>());

  const onTouchStart = (e: GestureResponderEvent) => {
    const { identifier, pageX, pageY } = e.nativeEvent;
    touchStarts.current.set(String(identifier), { x: pageX, y: pageY });
  };

  const onTouchEnd = (e: GestureResponderEvent) => {
    const key = String(e.nativeEvent.identifier);
    const start = touchStarts.current.get(key);
    touchStarts.current.delete(key);
    if (!start) return;

    const dx = Math.abs(e.nativeEvent.pageX - start.x);
    const dy = Math.abs(e.nativeEvent.pageY - start.y);
    if (dx > 10 || dy > 10) return; // it was a drag/scroll, not a tap

    const focusedInput = TextInput.State.currentlyFocusedInput?.();
    if (!focusedInput) return; // keyboard not open — nothing to do

    // Fail-safe: only dismiss when we can positively establish that the tap
    // landed on a DIFFERENT view than the focused input. If either tag is
    // unavailable (e.g. renderer internals change), do nothing rather than
    // risk closing the keyboard while the user taps their own input.
    const focusedTag = findNodeHandle(focusedInput as unknown as React.Component);
    const rawTarget = e.nativeEvent.target as unknown;
    const targetTag = typeof rawTarget === "number" ? rawTarget : null;
    if (focusedTag == null || targetTag == null) return;
    if (targetTag === focusedTag) return; // tap on the input itself

    Keyboard.dismiss();
  };

  return { onTouchStart, onTouchEnd };
}

function RootLayoutNav() {
  useNotificationDeepLinks();
  useLiveUnreadBadge();
  const tapDismiss = useTapOutsideKeyboardDismiss();

  return (
    <View
      style={{ flex: 1, backgroundColor: Colors.light.background }}
      onTouchStart={tapDismiss.onTouchStart}
      onTouchEnd={tapDismiss.onTouchEnd}
    >
      <View style={{ flex: 1 }}>
      <Stack
      screenOptions={{
        header: ({ options, navigation, back }) => (
          <ScreenHeader
            title={(options.title as string) ?? ""}
            showBack={!!back}
            onBack={() => navigation.goBack()}
          />
        ),
        contentStyle: { paddingBottom: 0 },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="trader/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="admin/index" options={{ headerShown: false }} />
      <Stack.Screen name="admin/[traderId]" options={{ headerShown: false }} />
      <Stack.Screen name="admin/stats" options={{ headerShown: false }} />
    </Stack>
      </View>
    </View>
  );
}

/**
 * Query cache eviction happens before AuthProvider exposes a new identity.
 * Remounting account-bound providers and routes afterwards releases any active
 * observers from the prior session, so a late Account A request has nowhere to
 * render once Account B becomes active. The QueryClient itself stays mounted,
 * retaining only the reviewed public cache entries.
 */
function IdentityScopedApp() {
  const { user } = useAuth();
  const identityKey = user ? `account:${user.id}` : "signed-out";

  return (
    <React.Fragment key={identityKey}>
      <SubscriptionProvider>
        <SearchRadiusProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <RootLayoutNav />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </SearchRadiusProvider>
      </SubscriptionProvider>
    </React.Fragment>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      {/* Dark app chrome: status bar icons/text always light. */}
      <StatusBar style="light" />
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
              <IdentityScopedApp />
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
