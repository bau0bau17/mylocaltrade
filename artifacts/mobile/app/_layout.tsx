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
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { View } from "react-native";

import Colors from "@/constants/colors";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ScreenHeader } from "@/components/ScreenHeader";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SubscriptionProvider } from "@/lib/revenuecat";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
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
      }
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

function RootLayoutNav() {
  useNotificationDeepLinks();

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
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
              <GestureHandlerRootView>
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
