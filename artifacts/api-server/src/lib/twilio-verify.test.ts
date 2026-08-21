import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockTwilio } = vi.hoisted(() => ({
  mockTwilio: vi.fn(),
}));

vi.mock("twilio", () => ({ default: mockTwilio }));

import {
  checkPhoneVerification,
  fetchVerificationAttemptOutcome,
  isTwilioVerifyConfigured,
  normalizeVerificationDeliveryChannel,
  startPhoneVerification,
  twilioCreds,
} from "./twilio-verify";

const traderServiceSid = "VA11111111111111111111111111111111";
const customerServiceSid = "VA22222222222222222222222222222222";
const attemptSid = "VL33333333333333333333333333333333";

const mockCreate = vi.fn();
const mockCheck = vi.fn();
const mockAttemptFetch = vi.fn();
const mockServices = vi.fn(() => ({
  verifications: { create: mockCreate },
  verificationChecks: { create: mockCheck },
}));
const mockVerificationAttempts = vi.fn(() => ({ fetch: mockAttemptFetch }));

describe("Twilio Verify routing and delivery outcome mapping", () => {
  beforeEach(() => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC44444444444444444444444444444444");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "auth-token-is-test-only");
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", traderServiceSid);
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID_CUSTOMER", undefined);

    mockTwilio.mockReturnValue({
      verify: {
        v2: {
          services: mockServices,
          verificationAttempts: mockVerificationAttempts,
        },
      },
    });
    mockCreate.mockReset();
    mockCheck.mockReset();
    mockAttemptFetch.mockReset();
    mockServices.mockClear();
    mockVerificationAttempts.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the trader service and records the Verify attempt SID", async () => {
    mockCreate.mockResolvedValue({
      status: "pending",
      sid: "VE55555555555555555555555555555555",
      sendCodeAttempts: [{ attemptSid }],
    });

    expect(isTwilioVerifyConfigured("trader")).toBe(true);
    const result = await startPhoneVerification("+447700900123", "trader");

    expect(result).toEqual({ ok: true, status: "pending", verificationAttemptSid: attemptSid });
    expect(mockServices).toHaveBeenCalledWith(traderServiceSid);
    expect(mockCreate).toHaveBeenCalledWith({
      to: "+447700900123",
      channel: "sms",
    });
  });

  it("uses the dedicated customer service when configured, otherwise the shared service", async () => {
    expect(twilioCreds("customer").serviceSid).toBe(traderServiceSid);

    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID_CUSTOMER", customerServiceSid);
    mockCreate.mockResolvedValue({
      status: "pending",
      sendCodeAttempts: [{ attemptSid }],
    });

    expect(twilioCreds("customer").serviceSid).toBe(customerServiceSid);
    await startPhoneVerification("+447700900123", "customer");

    expect(mockServices).toHaveBeenCalledWith(customerServiceSid);
  });

  it("checks the code against the same role-specific Verify service", async () => {
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID_CUSTOMER", customerServiceSid);
    mockCheck.mockResolvedValue({ status: "approved" });

    const result = await checkPhoneVerification(
      "+447700900123",
      "123456",
      "customer",
    );

    expect(result).toEqual({ approved: true, status: "approved" });
    expect(mockServices).toHaveBeenCalledWith(customerServiceSid);
    expect(mockCheck).toHaveBeenCalledWith({
      to: "+447700900123",
      code: "123456",
    });
  });

  it.each([
    ["rbm", "RCS"],
    ["rcs", "RCS"],
    ["sms", "SMS fallback"],
    ["voice", "unknown"],
    [undefined, "unknown"],
  ] as const)("normalizes %s to %s", (input, expected) => {
    expect(normalizeVerificationDeliveryChannel(input)).toBe(expected);
  });

  it("reads final channel and status from the mocked Verify attempt", async () => {
    mockAttemptFetch.mockResolvedValue({
      channel: "rbm",
      messageStatus: "delivered",
      conversionStatus: "converted",
    });

    const outcome = await fetchVerificationAttemptOutcome(attemptSid);

    expect(outcome).toEqual({
      channel: "RCS",
      messageStatus: "delivered",
      conversionStatus: "converted",
    });
    expect(mockVerificationAttempts).toHaveBeenCalledWith(attemptSid);
  });
});