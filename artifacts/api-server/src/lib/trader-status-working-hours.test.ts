import { describe, it, expect } from "vitest";
import { evaluateBusinessProfileComplete } from "./trader-status";

/**
 * Working-hours onboarding requirement matrix.
 *
 * Structured working_hours is the availability source of truth:
 *  - structured hours configured (>=1 enabled day) → satisfied
 *  - legacy free-text openingHours only → grandfathered (satisfied)
 *  - neither → NOT satisfied
 * Legacy text is never required when structured hours exist.
 */

// Note: no `as const` — the evaluator's parameter derives from the DB row
// type, whose JSON array fields are mutable string[] (readonly tuples fail
// to typecheck against them).
const base = {
  businessDescription: "x".repeat(100),
  businessAddress: "1 High Street",
  additionalServices: ["Boiler service"],
  serviceAreas: ["London"],
  town: "London",
  postcode: "SW1A 1AA",
  mainCategory: "plumbing",
  businessType: "SOLE_TRADER",
  companyNumber: null,
};

const structuredHours = {
  mon: { enabled: true, start: "08:00", end: "18:00" },
  sun: { enabled: false, start: "09:00", end: "13:00" },
};

const req = (r: ReturnType<typeof evaluateBusinessProfileComplete>) =>
  r.requirements.find((x) => x.field === "workingHours");

describe("evaluateBusinessProfileComplete — working hours requirement", () => {
  it("satisfied with structured hours only (no legacy text needed)", () => {
    const r = evaluateBusinessProfileComplete({
      ...base,
      openingHours: null,
      workingHours: structuredHours,
    });
    expect(req(r)?.satisfied).toBe(true);
    expect(r.complete).toBe(true);
  });

  it("grandfathers legacy free-text opening hours (no structured hours)", () => {
    const r = evaluateBusinessProfileComplete({
      ...base,
      openingHours: "Mon–Fri: 8am – 6pm",
      workingHours: null,
    });
    expect(req(r)?.satisfied).toBe(true);
    expect(r.complete).toBe(true);
  });

  it("not satisfied when neither structured hours nor legacy text exist", () => {
    const r = evaluateBusinessProfileComplete({
      ...base,
      openingHours: "   ",
      workingHours: null,
    });
    expect(req(r)?.satisfied).toBe(false);
    expect(r.complete).toBe(false);
  });

  it("all-days-disabled structured hours do NOT count as configured", () => {
    const r = evaluateBusinessProfileComplete({
      ...base,
      openingHours: null,
      workingHours: { mon: { enabled: false, start: "08:00", end: "18:00" } },
    });
    expect(req(r)?.satisfied).toBe(false);
  });

  it("requirement is exposed under the workingHours field name", () => {
    const r = evaluateBusinessProfileComplete({
      ...base,
      openingHours: null,
      workingHours: structuredHours,
    });
    expect(r.requirements.some((x) => x.field === "openingHours")).toBe(false);
    expect(req(r)).toBeTruthy();
  });
});
