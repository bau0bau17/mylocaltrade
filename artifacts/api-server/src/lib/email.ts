import nodemailer from "nodemailer";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const FROM_NAME = "MyLocalTrade";
const FROM_EMAIL = process.env.SMTP_FROM ?? "noreply@mylocaltrade.co.uk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_CANDIDATES = [
  path.resolve(__dirname, "../assets/logo.png"),
  path.resolve(__dirname, "./assets/logo.png"),
  path.resolve(process.cwd(), "src/assets/logo.png"),
  path.resolve(process.cwd(), "dist/assets/logo.png"),
];
const LOGO_PATH = LOGO_CANDIDATES.find((p) => fs.existsSync(p)) ?? LOGO_CANDIDATES[0];
const LOGO_CID = "mylocaltrade-logo";

function logoAttachment() {
  return {
    filename: "logo.png",
    path: LOGO_PATH,
    cid: LOGO_CID,
  };
}

const LOGO_IMG_HTML = `<img src="cid:${LOGO_CID}" alt="MyLocalTrade" width="72" height="72" style="display: block; width: 72px; height: 72px; border-radius: 16px; margin: 0 auto;">`;

function createTransport() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return null;
}

function getApiBaseUrl() {
  if (process.env.API_BASE_URL) return process.env.API_BASE_URL;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (domain) return `https://${domain}`;
  return "http://localhost:8080";
}

export async function sendVerificationEmail(
  toEmail: string,
  toName: string,
  token: string
): Promise<void> {
  const verifyUrl = `${getApiBaseUrl()}/api/auth/verify-email?token=${token}`;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Verify your email</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0B1120; margin: 0; padding: 40px 20px;">
  <div style="max-width: 520px; margin: 0 auto; background: #111827; border-radius: 16px; padding: 40px; border: 1px solid #1F2937;">
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="margin-bottom: 16px;">${LOGO_IMG_HTML}</div>
      <h1 style="color: #F9FAFB; font-size: 24px; font-weight: 700; margin: 0 0 8px;">MyLocalTrade</h1>
      <p style="color: #9CA3AF; font-size: 14px; margin: 0;">Verify your email address</p>
    </div>
    <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${toName},</p>
    <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 32px;">
      Thanks for signing up to MyLocalTrade. Please verify your email address to activate your account.
    </p>
    <div style="text-align: center; margin-bottom: 32px;">
      <a href="${verifyUrl}"
         style="display: inline-block; background: #00B4D8; color: #0B1120; font-weight: 700; font-size: 16px; padding: 14px 40px; border-radius: 12px; text-decoration: none;">
        Verify Email Address
      </a>
    </div>
    <p style="color: #6B7280; font-size: 13px; line-height: 1.6; margin: 0 0 8px;">
      If the button above doesn't work, copy and paste this link into your browser:
    </p>
    <p style="color: #00B4D8; font-size: 13px; word-break: break-all; margin: 0 0 32px;">${verifyUrl}</p>
    <hr style="border: none; border-top: 1px solid #1F2937; margin: 0 0 24px;">
    <p style="color: #6B7280; font-size: 12px; text-align: center; margin: 0;">
      This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.<br><br>
      Service Provider LTD · Company No: 15830141 · 71-75 Shelton Street, London, WC2H 9JQ
    </p>
  </div>
</body>
</html>`;

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: toEmail,
      subject: "Verify your MyLocalTrade email address",
      html,
      attachments: [logoAttachment()],
    });
    console.log(`[email] Verification email sent to ${toEmail}`);
  } else {
    console.log(`[email] SMTP not configured — verification link for ${toEmail}:`);
    console.log(`[email] ${verifyUrl}`);
  }
}

export async function sendContactEmail(opts: {
  fromName: string;
  fromEmail: string;
  subject: string;
  message: string;
}): Promise<void> {
  const SUPPORT_EMAIL = "lucian.sabau@serviceproviderltd.co.uk";
  const CONTACT_FROM_EMAIL = "noreply@mylocaltrade.co.uk";
  const replyByDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toUTCString();
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Contact Support</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0B1120; margin: 0; padding: 40px 20px;">
  <div style="max-width: 520px; margin: 0 auto; background: #111827; border-radius: 16px; padding: 40px; border: 1px solid #1F2937;">
    <div style="background: #F59E0B; color: #111827; padding: 12px 16px; border-radius: 10px; margin-bottom: 24px; text-align: center; font-size: 13px; font-weight: 700; letter-spacing: 0.5px;">
      🚩 CONTACT SUPPORT — REPLY WITHIN 48 HOURS
    </div>
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="margin-bottom: 12px;">${LOGO_IMG_HTML}</div>
      <h1 style="color: #F9FAFB; font-size: 22px; font-weight: 700; margin: 0 0 6px;">MyLocalTrade</h1>
      <p style="color: #9CA3AF; font-size: 14px; margin: 0;">New support message received via in-app form</p>
    </div>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px; width: 110px;">From</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${opts.fromName} &lt;${opts.fromEmail}&gt;</td></tr>
      <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Subject</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${opts.subject}</td></tr>
      <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Reply by</td><td style="padding: 8px 0; color: #F59E0B; font-size: 13px; font-weight: 600;">${replyByDate}</td></tr>
    </table>
    <hr style="border: none; border-top: 1px solid #1F2937; margin: 0 0 24px;">
    <p style="color: #E5E7EB; font-size: 15px; line-height: 1.7; white-space: pre-wrap; margin: 0;">${opts.message}</p>
    <hr style="border: none; border-top: 1px solid #1F2937; margin: 24px 0 16px;">
    <p style="color: #6B7280; font-size: 12px; text-align: center; margin: 0;">
      Sent via MyLocalTrade app · Service Provider LTD · 48h SLA
    </p>
  </div>
</body>
</html>`;

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"MyLocalTrade Contact Form" <${CONTACT_FROM_EMAIL}>`,
      to: SUPPORT_EMAIL,
      replyTo: `"${opts.fromName}" <${opts.fromEmail}>`,
      subject: `[CONTACT - Reply within 48h] ${opts.subject}`,
      html,
      priority: "high",
      headers: {
        "X-Priority": "1",
        "X-MSMail-Priority": "High",
        Importance: "High",
        "X-MyLocalTrade-Type": "contact-support",
        "X-MyLocalTrade-SLA": "48h",
      },
      attachments: [logoAttachment()],
    });
    console.log(`[email] Contact email sent to ${SUPPORT_EMAIL} from ${CONTACT_FROM_EMAIL}`);

    const ackHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Thanks for contacting MyLocalTrade</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0B1120; margin: 0; padding: 40px 20px;">
  <div style="max-width: 520px; margin: 0 auto; background: #111827; border-radius: 16px; padding: 40px; border: 1px solid #1F2937;">
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="margin-bottom: 16px;">${LOGO_IMG_HTML}</div>
      <h1 style="color: #F9FAFB; font-size: 24px; font-weight: 700; margin: 0 0 8px;">Thank you for contacting MyLocalTrade</h1>
    </div>
    <p style="color: #E5E7EB; font-size: 16px; line-height: 1.7; margin: 0 0 16px;">Hi ${opts.fromName},</p>
    <p style="color: #E5E7EB; font-size: 16px; line-height: 1.7; margin: 0 0 16px;">
      Thanks for reaching out — we've received your message and our support team will get back to you as soon as possible.
    </p>
    <div style="background: #0E2A3A; border-left: 3px solid #00B4D8; padding: 14px 16px; border-radius: 8px; margin: 0 0 24px;">
      <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0;">
        We aim to reply within <strong style="color: #00B4D8;">48 working hours</strong>, though occasionally it may take a little longer during busy periods. Thank you for your patience.
      </p>
    </div>
    <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0 0 32px;">
      There's no need to reply to this email — we already have your message and will respond to you directly.
    </p>
    <hr style="border: none; border-top: 1px solid #1F2937; margin: 0 0 16px;">
    <p style="color: #6B7280; font-size: 12px; text-align: center; margin: 0;">
      MyLocalTrade · Service Provider LTD · Company No: 15830141<br>
      71-75 Shelton Street, Covent Garden, London, WC2H 9JQ
    </p>
  </div>
</body>
</html>`;

    try {
      await transporter.sendMail({
        from: `"MyLocalTrade" <${CONTACT_FROM_EMAIL}>`,
        to: opts.fromEmail,
        subject: "Thanks for contacting MyLocalTrade — we've received your message",
        html: ackHtml,
        headers: {
          "X-MyLocalTrade-Type": "contact-acknowledgement",
          "Auto-Submitted": "auto-replied",
        },
        attachments: [logoAttachment()],
      });
      console.log(`[email] Acknowledgement sent to ${opts.fromEmail}`);
    } catch (err) {
      console.error(`[email] Failed to send acknowledgement to ${opts.fromEmail}:`, err);
    }
  } else {
    console.log(`[email] SMTP not configured — contact message from ${opts.fromEmail}: ${opts.message}`);
  }
}

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
