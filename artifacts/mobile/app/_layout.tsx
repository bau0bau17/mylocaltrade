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

import Colors from "@/constants/colors";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
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
    <Stack screenOptions={{ headerBackTitle: "Back", headerTintColor: Colors.light.primary, headerStyle: { backgroundColor: Colors.light.background }, headerTitleStyle: { color: Colors.light.text } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="legal-support" options={{ headerShown: false }} />
      <Stack.Screen name="trader/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="auth/login" options={{ title: "Log In", presentation: "modal" }} />
      <Stack.Screen name="auth/register-customer" options={{ title: "Register", presentation: "modal" }} />
      <Stack.Screen name="auth/register-trader" options={{ title: "Join as Trader", presentation: "modal" }} />
      <Stack.Screen name="pricing" options={{ title: "Subscription Plans" }} />
      <Stack.Screen name="enquiry/[traderId]" options={{ title: "Send Enquiry", presentation: "modal" }} />
      <Stack.Screen name="trader-dashboard/edit-profile" options={{ title: "Edit Profile" }} />
      <Stack.Screen name="trader-dashboard/leads" options={{ title: "My Leads" }} />
      <Stack.Screen name="trader-dashboard/billing" options={{ title: "Billing & Plan" }} />
      <Stack.Screen name="trader-dashboard/services" options={{ title: "My Services" }} />
      <Stack.Screen name="trader-dashboard/gallery" options={{ title: "Gallery" }} />
      <Stack.Screen name="saved-traders" options={{ title: "Saved Traders" }} />
      <Stack.Screen name="my-enquiries" options={{ title: "My Enquiries" }} />
      <Stack.Screen name="compare-offers" options={{ title: "Compare Offers" }} />
      <Stack.Screen name="messages/index" options={{ title: "Messages" }} />
      <Stack.Screen name="messages/[id]" options={{ title: "Conversation" }} />
      <Stack.Screen name="about" options={{ title: "About Us" }} />
      <Stack.Screen name="privacy" options={{ title: "Privacy Policy" }} />
      <Stack.Screen name="terms" options={{ title: "Terms & Conditions" }} />
      <Stack.Screen name="refund" options={{ title: "Refund Policy" }} />
      <Stack.Screen name="cookie-policy" options={{ title: "Cookie Policy" }} />
      <Stack.Screen name="complaints" options={{ title: "Complaints Procedure" }} />
      <Stack.Screen name="report-trader" options={{ title: "Report a Trader" }} />
      <Stack.Screen name="safety-advice" options={{ title: "Customer Safety Advice" }} />
      <Stack.Screen name="code-of-conduct" options={{ title: "Trader Code of Conduct" }} />
      <Stack.Screen name="how-verification-works" options={{ title: "How Verification Works" }} />
      <Stack.Screen name="admin/index" options={{ headerShown: false }} />
      <Stack.Screen name="admin/[traderId]" options={{ headerShown: false }} />
      <Stack.Screen name="admin/stats" options={{ headerShown: false }} />
    </Stack>
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
            <GestureHandlerRootView>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
