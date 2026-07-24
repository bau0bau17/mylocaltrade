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
import React, { useEffect, useRef } from "react";
import {
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
import {
  setBaseUrl,
  setAuthTokenGetter,
  getGetConversationsUnreadCountQueryKey,
} from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/api-url";

SplashScreen.preventAutoHideAsync();

setBaseUrl(getApiUrl());
setAuthTokenGetter(() => AsyncStorage.getItem("auth_token"));

const queryClient = new QueryClient();

function useNotificationDeepLinks() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const navigatedFromInitialRef = useRef(false);

  useEffect(() => {
    // expo-notifications has no native module on web — every API throws
    // "is not available on web". Skip deep-link wiring entirely there.
    if (Platform.OS === "web") return;
    // Admins don't have customer/trader chats or leads — never deep-link them
    // into those surfaces (they'd hit the role-block screens).
    if (isAdmin) return;

    const handle = (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const d = data as { type?: string; conversationId?: number | string };
      if (d.type === "new_message" && d.conversationId != null) {
        router.push(`/messages/${d.conversationId}`);
      } else if (d.type === "new_enquiry" || d.type === "lead_reminder") {
        router.push("/trader-dashboard/leads");
      } else if (d.type === "verification_update") {
        // Verification status changes are surfaced on the trader dashboard.
        router.push("/trader-dashboard");
      } else if (d.type === "subscription_update") {
        // Subscription/billing changes deep-link to the billing screen.
        router.push("/trader-dashboard/billing");
      }
      // "report_update" intentionally has no deep-link target — there is no
      // report-status screen, so tapping simply opens the app; the body text
      // carries the outcome.
    };

    // App was opened by tapping a notification while killed.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && !navigatedFromInitialRef.current) {
        navigatedFromInitialRef.current = true;
        handle(response.notification.request.content.data);
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
      handle(response.notification.request.content.data);
    });
    return () => sub.remove();
  }, [router, isAdmin]);
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
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <SubscriptionProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </SubscriptionProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
