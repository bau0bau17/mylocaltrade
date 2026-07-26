import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { setPendingDeepLink } from "@/lib/pending-deep-link";

// Universal-link entry point. When iOS opens the app from an
// https://mylocaltrade.co.uk/open?... link (associated domains), expo-router
// lands on this /open route with the original query params. We map them to
// the same in-app destinations the web redirect page (server/serve.js) uses,
// so email buttons behave identically whether the app intercepted the link
// or the web page bounced via the custom scheme.
//
// Logged-out recovery: if there's no session, stash the destination and send
// the user to login — the login screen continues to the destination after a
// successful sign-in instead of dumping them on the account tab.
export default function OpenRedirect() {
  const params = useLocalSearchParams<{ c?: string; t?: string }>();
  const { token, isLoading } = useAuth();

  const c = typeof params.c === "string" ? params.c : undefined;
  const t = typeof params.t === "string" ? params.t : undefined;

  let destination: string | null = null;
  if (c && /^[0-9]+$/.test(c)) {
    destination = `/messages/${c}`;
  } else if (t === "leads") {
    destination = "/trader-dashboard/leads";
  } else if (t === "support") {
    destination = "/contact-support";
  }

  // Wait for the stored session to load before deciding — otherwise a
  // logged-in user would be bounced to login on every cold-start deep link.
  if (isLoading) return null;

  if (!destination) return <Redirect href="/" />;

  if (!token) {
    setPendingDeepLink(destination);
    return <Redirect href="/(tabs)/auth/login" />;
  }
  return <Redirect href={destination as Parameters<typeof Redirect>[0]["href"]} />;
}
