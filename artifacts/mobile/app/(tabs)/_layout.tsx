import { BlurView } from "expo-blur";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { router, Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

import Colors from "@/constants/colors";
import { ScreenHeader } from "@/components/ScreenHeader";

// Inner routes that live inside the (tabs) group so they inherit the same
// bottom tab bar as the four primary tabs. They are hidden from the bar
// (href: null) and use the shared ScreenHeader as their top bar.
const INNER_ROUTES: { name: string; title: string; parent: string }[] = [
  { name: "legal-support", title: "Legal & Support", parent: "/account" },
  { name: "auth/login", title: "Log In", parent: "/account" },
  { name: "auth/register-customer", title: "Register", parent: "/account" },
  { name: "auth/register-trader", title: "Join as Trader", parent: "/account" },
  { name: "auth/verify-email", title: "Verify Email", parent: "/account" },
  { name: "pricing", title: "Subscription Plans", parent: "/account" },
  { name: "enquiry/[traderId]", title: "Send Enquiry", parent: "/traders" },
  { name: "trader-dashboard/index", title: "Trader Onboarding", parent: "/account" },
  { name: "trader-dashboard/edit-profile", title: "Edit Profile", parent: "/account" },
  { name: "trader-dashboard/leads", title: "My Leads", parent: "/account" },
  { name: "trader-dashboard/billing", title: "Billing & Plan", parent: "/account" },
  { name: "trader-dashboard/services", title: "My Services", parent: "/account" },
  { name: "trader-dashboard/gallery", title: "Gallery", parent: "/account" },
  { name: "trader-dashboard/business-profile", title: "Business Profile", parent: "/account" },
  { name: "trader-dashboard/documents", title: "Documents", parent: "/account" },
  { name: "trader-dashboard/reviews", title: "Reviews", parent: "/account" },
  { name: "trader-dashboard/verify-phone", title: "Verify Phone", parent: "/account" },
  { name: "saved-traders", title: "Saved Traders", parent: "/account" },
  { name: "my-enquiries", title: "My Enquiries", parent: "/account" },
  { name: "compare-offers", title: "Compare Offers", parent: "/account" },
  { name: "messages/index", title: "Messages", parent: "/account" },
  { name: "messages/[id]", title: "Conversation", parent: "/messages" },
  { name: "about", title: "About Us", parent: "/legal-support" },
  { name: "privacy", title: "Privacy Policy", parent: "/legal-support" },
  { name: "terms", title: "Terms & Conditions", parent: "/legal-support" },
  { name: "refund", title: "Refund Policy", parent: "/legal-support" },
  { name: "cookie-policy", title: "Cookie Policy", parent: "/legal-support" },
  { name: "complaints", title: "Complaints Procedure", parent: "/legal-support" },
  { name: "report-trader", title: "Report a Trader", parent: "/legal-support" },
  { name: "safety-advice", title: "Customer Safety Advice", parent: "/legal-support" },
  { name: "code-of-conduct", title: "Trader Code of Conduct", parent: "/legal-support" },
  { name: "how-verification-works", title: "How Verification Works", parent: "/legal-support" },
  { name: "contact-support", title: "Contact Support", parent: "/account" },
  { name: "write-review/[traderId]", title: "Write a Review", parent: "/traders" },
];

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search">
        <Icon sf={{ default: "magnifyingglass", selected: "magnifyingglass" }} />
        <Label>Search</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="traders">
        <Icon sf={{ default: "briefcase", selected: "briefcase.fill" }} />
        <Label>Traders</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <Icon sf={{ default: "person", selected: "person.fill" }} />
        <Label>Account</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved" hidden>
        <Icon sf={{ default: "bookmark", selected: "bookmark.fill" }} />
        <Label>Saved</Label>
      </NativeTabs.Trigger>
      {INNER_ROUTES.map((r) => (
        <NativeTabs.Trigger key={r.name} name={r.name} hidden>
          <Icon sf={{ default: "circle", selected: "circle.fill" }} />
          <Label>{r.title}</Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const theme = Colors.light;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tabActive,
        tabBarInactiveTintColor: theme.tabInactive,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : theme.surface,
          borderTopWidth: 1,
          borderTopColor: theme.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={80}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: theme.surface },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerShown: false,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={24} />
            ) : (
              <Feather name="home" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          headerShown: false,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="magnifyingglass" tintColor={color} size={24} />
            ) : (
              <Feather name="search" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="traders"
        options={{
          title: "Traders",
          headerShown: false,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="briefcase" tintColor={color} size={24} />
            ) : (
              <Feather name="briefcase" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          headerShown: false,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person" tintColor={color} size={24} />
            ) : (
              <Feather name="user" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen name="saved" options={{ href: null }} />
      {INNER_ROUTES.map((r) => {
        // Some inner screens own their own bottom UI (chat composer, etc.)
        // and the absolutely-positioned tab bar would cover it. Hide the
        // tab bar on those routes so the bottom controls are visible.
        const hideTabBar = r.name === "messages/[id]";
        return (
          <Tabs.Screen
            key={r.name}
            name={r.name}
            options={{
              href: null,
              title: r.title,
              headerShown: true,
              ...(hideTabBar ? { tabBarStyle: { display: "none" } } : {}),
              header: ({ navigation, options }) => (
                <ScreenHeader
                  title={(options.title as string) ?? r.title}
                  showBack
                  onBack={() => {
                    // Inner routes are registered as hidden Tabs.Screen
                    // entries, which means expo-router treats them as tabs
                    // rather than stack pushes — router.back() (and the
                    // underlying navigation.goBack()) returns to the
                    // previously active tab (Home) instead of the screen
                    // the user came from. So we always navigate to the
                    // explicit parent declared for the route.
                    router.replace(r.parent as Parameters<typeof router.replace>[0]);
                  }}
                />
              ),
            }}
          />
        );
      })}
    </Tabs>
  );
}

export default function TabLayout() {
  // NativeTabs (expo-router/unstable-native-tabs) requires custom native code
  // and does not work reliably inside Expo Go — the screens render but become
  // unresponsive (taps don't fire, navigation to hidden triggers freezes).
  // Force the classic JS-based Tabs layout whenever we're running in Expo Go.
  const isExpoGo =
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  if (!isExpoGo && isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
