import React from "react";

jest.mock("expo-router", () => ({
  Redirect: "Redirect",
  useLocalSearchParams: jest.fn(),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/pending-deep-link", () => ({
  setPendingDeepLink: jest.fn(),
}));

import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { setPendingDeepLink } from "@/lib/pending-deep-link";
import OpenRedirect from "../../app/open";

const mockUseLocalSearchParams = useLocalSearchParams as jest.MockedFunction<
  typeof useLocalSearchParams
>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockSetPendingDeepLink = setPendingDeepLink as jest.MockedFunction<
  typeof setPendingDeepLink
>;

function redirectFor(
  params: { c?: unknown; t?: unknown; j?: unknown },
  token: string | null = "session-token",
): React.ReactElement<{ href: unknown }> {
  mockUseLocalSearchParams.mockReturnValue(
    params as ReturnType<typeof useLocalSearchParams>,
  );
  mockUseAuth.mockReturnValue({ token, isLoading: false } as ReturnType<typeof useAuth>);

  const result = OpenRedirect() as React.ReactElement<{ href: unknown }>;
  expect(result).toBeTruthy();
  return result;
}

describe("/open deep-link routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("routes Universal Link named targets and numeric conversations only", () => {
    expect(redirectFor({ t: "leads" }).props.href).toBe("/trader-dashboard/leads");
    expect(redirectFor({ t: "support" }).props.href).toBe("/contact-support");
    expect(redirectFor({ c: "842" }).props.href).toBe("/messages/842");
  });

  it("accepts percent-encoded safe query values after URL parsing", () => {
    const url = new URL("https://mylocaltrade.co.uk/open?t=%6C%65%61%64%73");
    expect(redirectFor({ t: url.searchParams.get("t") ?? undefined }).props.href).toBe(
      "/trader-dashboard/leads",
    );
  });

  it("rejects malformed or unrecognised query values without navigation", () => {
    expect(redirectFor({ c: "842/../../account" }).props.href).toBe("/");
    expect(redirectFor({ c: ["842", "843"] }).props.href).toBe("/");
    expect(redirectFor({ t: "https://attacker.example" }).props.href).toBe("/");
    expect(redirectFor({ c: "%E0%A4%A" }).props.href).toBe("/");
  });

  it("keeps team invitation links in the dedicated join flow for signed-out and signed-in users", () => {
    const token = "a".repeat(32);
    const expected = {
      pathname: "/(tabs)/auth/join-team",
      params: { token },
    };

    expect(redirectFor({ j: token }, null).props.href).toEqual(expected);
    expect(redirectFor({ j: token }, "account-b-token").props.href).toEqual(expected);
  });

  it("preserves a valid destination through logged-out sign-in without accepting arbitrary targets", () => {
    expect(redirectFor({ c: "842" }, null).props.href).toBe("/(tabs)/auth/login");
    expect(mockSetPendingDeepLink).toHaveBeenCalledWith("/messages/842");

    jest.clearAllMocks();
    expect(redirectFor({ t: "https://attacker.example" }, null).props.href).toBe("/");
    expect(mockSetPendingDeepLink).not.toHaveBeenCalled();
  });
});