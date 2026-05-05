import { Platform } from "react-native";

export function getApiUrl(): string {
  if (Platform.OS === "web") {
    return "/api-server";
  }
  const domain = process.env.EXPO_PUBLIC_API_URL;
  if (domain) {
    return domain;
  }
  const devDomain = process.env.EXPO_PUBLIC_DEV_DOMAIN;
  if (devDomain) {
    return `https://${devDomain}/api-server`;
  }
  return "/api-server";
}
