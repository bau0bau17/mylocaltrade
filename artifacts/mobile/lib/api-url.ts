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
