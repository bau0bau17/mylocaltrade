import { sendPhoneVerificationCodeEmail } from "./email";

// Single delivery point for the trader phone OTP. The verification logic
// (generation, hashing, expiry, cooldown, attempt limits) lives unchanged in
// routes/trader-phone.ts — only the *channel* used to deliver the code is
// decided here, so switching from email to SMS at launch is a one-place change.
//
// Channel is selected via OTP_DELIVERY_CHANNEL ("email" | "sms"), defaulting to
// "email". At launch, set OTP_DELIVERY_CHANNEL=sms and implement the Brevo
// transactional SMS call in the "sms" branch below (POST
// https://api.brevo.com/v3/transactionalSMS/sms with BREVO_API_KEY_VERIFICATION).

export type OtpChannel = "email" | "sms";

export function getOtpChannel(): OtpChannel {
  return process.env.OTP_DELIVERY_CHANNEL === "sms" ? "sms" : "email";
}

export interface DeliverOtpOpts {
  code: string;
  email: string;
  name: string;
  phone: string;
  expiresInMinutes?: number;
}

export interface DeliverOtpResult {
  channel: OtpChannel;
  delivered: boolean;
}

export async function deliverTraderPhoneOtp(
  opts: DeliverOtpOpts,
): Promise<DeliverOtpResult> {
  const channel = getOtpChannel();

  if (channel === "sms") {
    // TODO (launch): send via Brevo transactional SMS to opts.phone.
    // Until that is implemented, fail loudly rather than silently emailing —
    // the operator opted into SMS by setting OTP_DELIVERY_CHANNEL=sms.
    throw new Error(
      "OTP_DELIVERY_CHANNEL=sms but SMS delivery is not implemented yet",
    );
  }

  const result = await sendPhoneVerificationCodeEmail(
    opts.email,
    opts.name,
    opts.code,
    opts.expiresInMinutes ?? 10,
  );
  return { channel: "email", delivered: result !== "none" };
}
