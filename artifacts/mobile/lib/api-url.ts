import { Platform } from "react-native";

export function getApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit;

  const devDomain = process.env.EXPO_PUBLIC_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host.includes(".expo.kirk.replit.dev")) {
      return `https://${host.replace(".expo.kirk.replit.dev", ".kirk.replit.dev")}`;
    }
    return window.location.origin;
  }

  return "";
}

// Turn a stored gallery object path (e.g. "/objects/customer-uploads/42/v/uuid")
// into an absolute URL that React Native <Image> can load via the public
// gallery-file serving endpoint. Local picker URIs (file://, ph://, etc.) and
// already-absolute http(s) URLs are returned unchanged so freshly-picked images
// can be previewed before they are saved.
export function objectImageUrl(
  path: string | null | undefined,
): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|file:|content:|data:|assets-library:|ph:)/i.test(path)) {
    return path;
  }
  if (path.startsWith("/objects/")) {
    return `${getApiUrl()}/api/customer/uploads/gallery-file?path=${encodeURIComponent(
      path,
    )}`;
  }
  return path;
}
