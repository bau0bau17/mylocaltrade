import { BlurView } from "expo-blur";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { router, Tabs, usePathname, useGlobalSearchParams } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  useGetConversationsUnreadCount,
  getGetConversationsUnreadCountQueryKey,
} from "@workspace/api-client-react";

import Colors from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { ScreenHeader } from "@/components/ScreenHeader";

// Inner routes that live inside the (tabs) group so they inherit the same
// bottom tab bar as the four primary tabs. They are hidden from the bar
// (href: null) and use the shared ScreenHeader as their top bar.
const INNER_ROUTES: {
  name: string;
  title: string;
  parent: string;
  /** Optional decorative icon rendered in the header's top-right slot. */
  rightIcon?: React.ReactNode;
}[] = [
  { name: "legal-support", title: "Legal & Support", parent: "/account" },
  { name: "auth/login", title: "Log In", parent: "/account" },
  { name: "auth/register-customer", title: "Register", parent: "/account" },
  { name: "auth/register-trader", title: "Join as Trader", parent: "/account" },
  { name: "auth/verify-email", title: "Verify Email", parent: "/account" },
  { name: "auth/forgot-password", title: "Forgot Password", parent: "/auth/login" },
  { name: "auth/reset-password", title: "Reset Password", parent: "/auth/login" },
  { name: "pricing", title: "Subscription Plans", parent: "/account" },
  { name: "enquiry/[traderId]", title: "Send Enquiry", parent: "/traders" },
  {
    name: "trader-dashboard/index",
    title: "Trader Onboarding",
    parent: "/account",
    rightIcon: (
      <MaterialCommunityIcons
        name="shield-check"
        size={20}
        color={Colors.light.secondary}
      />
    ),
  },
  { name: "trader-dashboard/edit-profile", title: "Edit Profile", parent: "/account" },
  { name: "trader-dashboard/leads", title: "Enquiries & Leads", parent: "/account" },
  { name: "trader-dashboard/billing", title: "Billing & Plan", parent: "/account" },
  { name: "trader-dashboard/services", title: "My Services", parent: "/account" },
  { name: "trader-dashboard/gallery", title: "Gallery", parent: "/account" },
  { name: "trader-dashboard/business-profile", title: "Business Profile", parent: "/account" },
  { name: "trader-dashboard/documents", title: "Documents", parent: "/account" },
  { name: "trader-dashboard/reviews", title: "Reviews", parent: "/account" },
  { name: "trader-dashboard/verify-phone", title: "Verify Phone", parent: "/account" },
  { name: "verify-phone", title: "Verify Mobile Number", parent: "/account" },
  { name: "change-phone", title: "Change Phone Number", parent: "/account" },
  { name: "personal-details", title: "Personal Details", parent: "/account" },
  { name: "saved-traders", title: "Saved Traders", parent: "/account" },
  { name: "my-enquiries", title: "My Enquiries", parent: "/account" },
  { name: "compare-offers", title: "Compare Offers", parent: "/account" },
  // Traders directory moved off the tab bar (replaced by Messages); still
  // reachable from Home/Search links, so it lives on as a hidden inner route.
  { name: "traders", title: "Traders", parent: "/" },
  { name: "messages/[id]", title: "Conversation", parent: "/messages" },
  { name: "about", title: "About Us", parent: "/legal-support" },
  { name: "privacy", title: "Privacy Policy", parent: "/legal-support" },
  { name: "terms", title: "Terms & Conditions", parent: "/legal-support" },
  { name: "refund", title: "Subscription & Billing", parent: "/legal-support" },
  { name: "cookie-policy", title: "Cookie Policy", parent: "/legal-support" },
  { name: "complaints", title: "Complaints Procedure", parent: "/legal-support" },
  { name: "report-trader", title: "Report a Trader", parent: "/legal-support" },
  { name: "safety-advice", title: "Customer Safety Advice", parent: "/legal-support" },
  { name: "code-of-conduct", title: "Trader Code of Conduct", parent: "/legal-support" },
  { name: "how-verification-works", title: "How Verification Works", parent: "/legal-support" },
  { name: "contact-support", title: "Contact Support", parent: "/account" },
  { name: "write-review/[traderId]", title: "Write a Review", parent: "/traders" },
];

// ---------------------------------------------------------------------------
// iOS-style "swipe from the left edge to go back".
//
// The inner pages here are hidden Tabs screens, not native stack pushes, so
// the built-in iOS back gesture does not exist for them. This adds it
// manually: a pan gesture that only recognises touches STARTING within the
// left 40px of the screen, moving rightwards. On activation it navigates to
// the same destination the header back button would (returnTo param when
// present, otherwise the route's declared parent) — so the gesture and the
// button always agree.
//
// Safety: hitSlop confines recognition to the edge strip; failOffsetY hands
// vertical movements to ScrollViews untouched; failOffsetX kills leftward
// drags. Anywhere outside the edge strip the detector never engages, so
// lists, carousels and taps behave exactly as before.
// ---------------------------------------------------------------------------

function routeNameToPath(name: string): string {
  const path = "/" + name.replace(/\/index$/, "");
  return path === "/index" ? "/" : path;
}

const BACK_TARGETS = INNER_ROUTES.map((r) => ({
  pattern: new RegExp(
    "^" + routeNameToPath(r.name).replace(/\[[^/\]]+\]/g, "[^/]+") + "$",
  ),
  parent: r.parent,
}));

function resolveBackTarget(pathname: string): string | null {
  for (const t of BACK_TARGETS) {
    if (t.pattern.test(pathname)) return t.parent;
  }
  return null;
}

function EdgeSwipeBack({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ returnTo?: string }>();

  // Refs so the gesture callback always sees the CURRENT route without
  // having to rebuild the gesture on every navigation.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const returnToRef = useRef<string | undefined>(undefined);
  returnToRef.current =
    typeof params.returnTo === "string" ? params.returnTo : undefined;

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 0, width: 40 }) // only touches starting at the left edge
        .activeOffsetX(28) // must move 28px rightwards to count
        .failOffsetX(-12) // any leftward drag cancels it
        .failOffsetY([-16, 16]) // vertical movement = scrolling, not a back swipe
        .runOnJS(true)
        .onEnd((e, success) => {
          // Navigate only when the gesture COMPLETED as a deliberate back
          // swipe: released after dragging far enough or flicking fast
          // enough rightwards. This keeps it cancelable mid-gesture (like
          // the native iOS back swipe) and avoids accidental triggers.
          if (!success) return;
          if (e.translationX < 60 && e.velocityX < 500) return;
          const target =
            returnToRef.current ?? resolveBackTarget(pathnameRef.current);
          if (target) {
            router.replace(target as Parameters<typeof router.replace>[0]);
          }
        }),
    [],
  );

  if (Platform.OS === "web") return <>{children}</>;

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ flex: 1 }} collapsable={false}>
        {children}
      </View>
    </GestureDetector>
  );
}

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
      <NativeTabs.Trigger name="messages/index">
        <Icon sf={{ default: "message", selected: "message.fill" }} />
        <Label>Messages</Label>
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

// Unread-conversations count for the tab bar badge. Reuses the same endpoint
// and hook as the Account screen's "Messages" row badge. Refetches whenever
// the route changes (e.g. the user reads a thread and navigates away), since
// refetchOnWindowFocus does not fire on in-app navigation in React Native.
function useUnreadBadgeCount(): number {
  const { isAuthenticated, isAdmin } = useAuth();
  const pathname = usePathname();
  const enabled = isAuthenticated && !isAdmin;
  // Poll every 60s, but only while the app is actually in the foreground.
  // Users who denied push permission get no live badge updates from the
  // notification listener, so this keeps the badge honest for everyone.
  // React Query's own "background" detection relies on focusManager, which
  // is not wired to AppState in this app, so we gate the interval manually.
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
    });
    return () => sub.remove();
  }, []);
  const { data, refetch } = useGetConversationsUnreadCount({
    query: {
      queryKey: getGetConversationsUnreadCountQueryKey(),
      enabled,
      refetchOnWindowFocus: true,
      refetchInterval: enabled && appActive ? 60_000 : false,
    },
  });
  useEffect(() => {
    if (enabled) void refetch();
  }, [pathname, enabled, refetch]);
  return enabled ? (data?.unreadCount ?? 0) : 0;
}

function ClassicTabLayout() {
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const theme = Colors.light;
  const unreadCount = useUnreadBadgeCount();

  return (
    <EdgeSwipeBack>
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tabActive,
        tabBarInactiveTintColor: theme.tabInactive,
        headerShown: false,
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontWeight: "600",
          letterSpacing: 0.2,
        },
        tabBarItemStyle: {
          paddingTop: 4,
        },
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
        name="messages/index"
        options={{
          title: "Messages",
          headerShown: false,
          ...(unreadCount > 0
            ? {
                tabBarBadge: unreadCount > 99 ? "99+" : unreadCount,
                tabBarBadgeStyle: {
                  backgroundColor: theme.error,
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: "700" as const,
                },
              }
            : {}),
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="message" tintColor={color} size={24} />
            ) : (
              <Feather name="message-circle" size={22} color={color} />
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
        const hideTabBar =
          r.name === "messages/[id]" ||
          r.name === "enquiry/[traderId]" ||
          // Registration is a focused, form-heavy flow: hiding the tab bar
          // keeps it from covering the bottom CTA / legal links and avoids
          // accidental tab switches mid-form.
          r.name === "auth/register-customer" ||
          r.name === "auth/register-trader";
        // The conversation screen renders its own rich header (name, status,
        // actions) with its own back button, so hide the shared ScreenHeader
        // there to avoid a duplicate header stacked on top of it.
        const hideHeader = r.name === "messages/[id]";
        return (
          <Tabs.Screen
            key={r.name}
            name={r.name}
            options={{
              href: null,
              title: r.title,
              headerShown: !hideHeader,
              ...(hideTabBar ? { tabBarStyle: { display: "none" } } : {}),
              header: ({ route, options }) => (
                <ScreenHeader
                  title={(options.title as string) ?? r.title}
                  rightSlot={r.rightIcon}
                  showBack
                  onBack={() => {
                    // Inner routes are registered as hidden Tabs.Screen
                    // entries, which means expo-router treats them as tabs
                    // rather than stack pushes — router.back() (and the
                    // underlying navigation.goBack()) returns to the
                    // previously active tab (Home) instead of the screen
                    // the user came from. So we navigate to an explicit
                    // destination: a caller may pass a `returnTo` param to
                    // come back to the exact screen they opened this from
                    // (e.g. the trader signup form opening Terms/Privacy);
                    // otherwise we fall back to the route's declared parent.
                    const returnTo = (route.params as { returnTo?: string } | undefined)?.returnTo;
                    router.replace(
                      (returnTo ?? r.parent) as Parameters<typeof router.replace>[0],
                    );
                  }}
                />
              ),
            }}
          />
        );
      })}
    </Tabs>
    </EdgeSwipeBack>
  );
}

export default function TabLayout() {
  // NativeTabs (expo-router/unstable-native-tabs) is experimental: it renders
  // the four primary tabs natively, but navigation to the hidden inner-route
  // triggers (login, legal-support, pricing, contact-support, the trader
  // dashboard, etc.) silently fails — taps don't fire and the screens never
  // open. This reproduces both in Expo Go AND in native release builds on
  // iOS 26 (where liquid glass is available), which is where it bit users.
  // Until expo-router native tabs supports hidden-trigger pushes reliably,
  // always use the classic JS-based Tabs layout (BlurView tab bar on iOS).
  return <ClassicTabLayout />;
}
