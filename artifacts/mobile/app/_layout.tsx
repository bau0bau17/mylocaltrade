import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/contexts/AuthContext";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/api-url";

SplashScreen.preventAutoHideAsync();

setBaseUrl(getApiUrl());
setAuthTokenGetter(() => AsyncStorage.getItem("auth_token"));

const queryClient = new QueryClient();

function RootLayoutNav() {
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
      <Stack.Screen name="about" options={{ title: "About Us" }} />
      <Stack.Screen name="privacy" options={{ title: "Privacy Policy" }} />
      <Stack.Screen name="terms" options={{ title: "Terms & Conditions" }} />
      <Stack.Screen name="refund" options={{ title: "Refund Policy" }} />
      <Stack.Screen name="admin/index" options={{ title: "Admin · Trader Review" }} />
      <Stack.Screen name="admin/[traderId]" options={{ title: "Trader Review" }} />
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
