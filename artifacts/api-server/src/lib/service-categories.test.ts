import { describe, expect, it } from "vitest";
import { expandServiceTerms, SERVICE_CATEGORIES } from "./service-categories";

describe("canonical category ↔ service mapping", () => {
  it("maps display labels to their trader-service synonyms", () => {
    expect(expandServiceTerms("Electrical")).toEqual(expect.arrayContaining(["Electrician"]));
    expect(expandServiceTerms("Building")).toEqual(expect.arrayContaining(["Builder"]));
    expect(expandServiceTerms("Plumbing")).toEqual(expect.arrayContaining(["Plumber"]));
    expect(expandServiceTerms("Roofing")).toEqual(expect.arrayContaining(["Roofer"]));
    expect(expandServiceTerms("Painting")).toEqual(expect.arrayContaining(["Painter & Decorator"]));
    expect(expandServiceTerms("Cleaning")).toEqual(expect.arrayContaining(["Cleaner"]));
    expect(expandServiceTerms("Gardening & landscaping")).toEqual(
      expect.arrayContaining(["Gardener", "Landscaping"]),
    );
    expect(expandServiceTerms("Heating")).toEqual(expect.arrayContaining(["Heating engineer"]));
    expect(expandServiceTerms("Gas engineers")).toEqual(expect.arrayContaining(["Gas engineer"]));
    expect(expandServiceTerms("Locksmiths")).toEqual(expect.arrayContaining(["Locksmith"]));
    expect(expandServiceTerms("EV chargers")).toEqual(
      expect.arrayContaining(["EV charger installation"]),
    );
    expect(expandServiceTerms("Solar panels")).toEqual(
      expect.arrayContaining(["Solar panel installation"]),
    );
    expect(expandServiceTerms("Heat pumps")).toEqual(
      expect.arrayContaining(["Heat pump installation", "Heat pump engineer"]),
    );
  });

  it("is case-insensitive and reverse-maps service values", () => {
    expect(expandServiceTerms("electrical")).toEqual(expect.arrayContaining(["Electrician"]));
    // A trader-side value resolves to the same category terms.
    expect(expandServiceTerms("Electrician")).toEqual(expect.arrayContaining(["Electrical"]));
    expect(expandServiceTerms("Builder")).toEqual(expect.arrayContaining(["Building"]));
  });

  it("returns null for unknown values (falls back to plain substring search)", () => {
    expect(expandServiceTerms("Astrologer")).toBeNull();
    expect(expandServiceTerms("")).toBeNull();
  });

  it("never cross-matches unrelated categories", () => {
    const electrical = expandServiceTerms("Electrical")!;
    expect(electrical).not.toEqual(expect.arrayContaining(["Roofer"]));
    const roofing = expandServiceTerms("Roofing")!;
    expect(roofing).not.toEqual(expect.arrayContaining(["Electrician"]));
    // Generic terms must not bleed between maintenance-adjacent categories.
    const handyman = expandServiceTerms("Handyman")!;
    expect(handyman).not.toEqual(expect.arrayContaining(["Leasehold repairs"]));
    const leasehold = expandServiceTerms("Leasehold repairs")!;
    expect(leasehold).not.toEqual(expect.arrayContaining(["Handyman"]));
    const maintenance = expandServiceTerms("General maintenance")!;
    expect(maintenance).not.toEqual(expect.arrayContaining(["Electrician", "Roofer"]));
  });

  it("unions terms deterministically for ambiguous shared values", () => {
    // "Heating & Gas" is the legacy combined category value — it must expand
    // to BOTH heating and gas terms, not whichever category was declared last.
    const combined = expandServiceTerms("Heating & Gas")!;
    expect(combined).toEqual(expect.arrayContaining(["Heating engineer", "Gas engineer"]));
  });

  it("covers the mobile app's category labels", () => {
    // Labels shown on Home popular categories + Traders screen chips must all
    // resolve — otherwise that screen silently degrades to substring search.
    const labels = [
      "Plumbing", "Electrical", "Roofing", "Gas engineers", "Heating",
      "Solar panels", "EV chargers", "Heat pumps", "Insulation",
      "EPC improvements", "Damp & mould", "Cladding & remediation",
      "General maintenance", "Leasehold repairs", "Locksmiths", "Cleaning",
      "Gardening & landscaping", "Painting", "Building", "Handyman",
      "Plumber", "Electrician", "Roofer", "Cleaner", "Painter", "Builder",
    ];
    for (const label of labels) {
      expect(expandServiceTerms(label), label).not.toBeNull();
    }
    expect(SERVICE_CATEGORIES.length).toBeGreaterThan(0);
  });
});
