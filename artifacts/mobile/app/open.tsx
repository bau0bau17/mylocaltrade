import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";

// Universal-link entry point. When iOS opens the app from an
// https://mylocaltrade.co.uk/open?... link (associated domains), expo-router
// lands on this /open route with the original query params. We map them to
// the same in-app destinations the web redirect page (server/serve.js) uses,
// so email buttons behave identically whether the app intercepted the link
// or the web page bounced via the custom scheme.
export default function OpenRedirect() {
  const params = useLocalSearchParams<{ c?: string; t?: string }>();

  const c = typeof params.c === "string" ? params.c : undefined;
  const t = typeof params.t === "string" ? params.t : undefined;

  if (c && /^[0-9]+$/.test(c)) {
    return <Redirect href={`/messages/${c}`} />;
  }
  if (t === "leads") {
    return <Redirect href="/trader-dashboard/leads" />;
  }
  if (t === "support") {
    return <Redirect href="/contact-support" />;
  }
  return <Redirect href="/" />;
}
