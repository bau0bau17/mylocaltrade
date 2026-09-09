import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

describe("Online Safety reporting API guards", () => {
  it("publishes suspected illegal content without exposing CSEA escalation", async () => {
    const response = await request(app).get("/api/report-categories");
    expect(response.status).toBe(200);
    expect(response.body.categories.trader).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "SUSPECTED_ILLEGAL_CONTENT" })]),
    );
    expect(JSON.stringify(response.body)).not.toContain("CSEA");
  });

  it("rejects unauthenticated profile, chat, review appeal and status access", async () => {
    for (const response of await Promise.all([
      request(app).post("/api/reports").send({ reportedRole: "trader", traderProfileId: 1, category: "SUSPECTED_ILLEGAL_CONTENT" }),
      request(app).get("/api/reports"),
      request(app).post("/api/reports/1/appeal").send({ reason: "I disagree with this decision." }),
      request(app).post("/api/conversation-reports/1/appeal").send({ reason: "I disagree with this decision." }),
      request(app).post("/api/admin/user-reports/1/csea-escalate"),
      request(app).get("/api/admin/csea-candidates"),
      request(app).get("/api/admin/csea-reports"),
      request(app).post("/api/admin/csea-reports/user/1/complete"),
      request(app).post("/api/admin/csea-reports/conversation/1/complete"),
    ])) {
      expect(response.status).toBe(401);
    }
  });

  it("keeps the existing authenticated chat report contract reachable", async () => {
    // Authentication and participant checks are intentionally server-side; an
    // invalid token must not turn this into an IDOR probe.
    const response = await request(app)
      .post("/api/conversations/999999/report")
      .set("Authorization", "Bearer not-a-token")
      .send({ category: "SUSPECTED_ILLEGAL_CONTENT", reason: "Potentially illegal content" });
    expect(response.status).toBe(401);
  });
});