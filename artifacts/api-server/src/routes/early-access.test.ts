import { describe, it, beforeEach, expect, vi } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// The lead IS the notification email (no waitlist table), so the transport
// layer is mocked: tests must never hold real transport creds, and the route's
// behaviour is defined by the channel the dispatcher reports.
vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendEarlyAccessNotificationEmail: vi.fn(async () => "brevo" as const),
    sendEarlyAccessConfirmationEmail: vi.fn(async () => {}),
  };
});

import app from "../app";
import {
  sendEarlyAccessConfirmationEmail,
  sendEarlyAccessNotificationEmail,
} from "../lib/email";

const notifyMock = vi.mocked(sendEarlyAccessNotificationEmail);
const confirmMock = vi.mocked(sendEarlyAccessConfirmationEmail);

const VALID = {
  name: "Test Person",
  email: "Early.Access@Example.com",
  type: "customer",
  town: "MK44",
  message: "Looking forward to it",
  consent: true,
  _hp: "",
  _t: null,
};

function submit(body: Record<string, unknown>) {
  return request(app).post("/api/early-access").send(body);
}

describe("POST /api/early-access", () => {
  beforeEach(async () => {
    notifyMock.mockClear();
    confirmMock.mockClear();
    notifyMock.mockResolvedValue("brevo");
    // Each test submits from the same test IP; keep the per-IP limiter fresh.
    await db.execute(sql`DELETE FROM rate_limit_hits`);
  });

  it("valid signup notifies the inbox and auto-replies to the visitor", async () => {
    const res = await submit(VALID);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({
      name: "Test Person",
      email: "early.access@example.com", // trimmed + lowercased
      type: "customer",
      town: "MK44",
      message: "Looking forward to it",
    });
    // Auto-reply is fire-and-forget; give the microtask a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledWith({
      toEmail: "early.access@example.com",
      toName: "Test Person",
    });
  });

  it("filled honeypot pretends success and sends nothing", async () => {
    const res = await submit({ ...VALID, _hp: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("rejects missing consent, bad email and unknown type", async () => {
    for (const bad of [
      { ...VALID, consent: false },
      { ...VALID, email: "not-an-email" },
      { ...VALID, type: "alien" },
    ]) {
      const res = await submit(bad);
      expect(res.status).toBe(400);
    }
    expect(notifyMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("fails loudly when no transport delivered the notification", async () => {
    notifyMock.mockResolvedValueOnce("none");
    const res = await submit(VALID);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to submit/i);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("optional fields may be omitted", async () => {
    const res = await submit({
      name: "Minimal Person",
      email: "minimal@example.com",
      type: "trader",
      consent: true,
    });
    expect(res.status).toBe(200);
    expect(notifyMock).toHaveBeenCalledWith({
      name: "Minimal Person",
      email: "minimal@example.com",
      type: "trader",
      town: null,
      message: null,
    });
  });
});
