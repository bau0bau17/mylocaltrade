import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AiVerdictBadge, RegisterOverallBadge } from "./CheckBadges";
import type { RegisterCheckStatus, AiVerificationStatus } from "@/lib/types";

const GREEN = "bg-emerald-100";
const AMBER = "bg-amber-100";
const RED = "bg-red-100";
const GREY = "bg-muted";

const REGISTER_CASES: {
  status: RegisterCheckStatus;
  full: string;
  compact: string;
  colour: string;
}[] = [
  { status: "PASS", full: "Registers: Pass", compact: "Reg: Pass", colour: GREEN },
  { status: "REVIEW", full: "Registers: Review", compact: "Reg: Review", colour: AMBER },
  { status: "FAIL", full: "Registers: Fail", compact: "Reg: Fail", colour: RED },
  { status: "NOT_PROVIDED", full: "Registers: Nothing to check", compact: "Reg: None", colour: GREY },
  { status: "ERROR", full: "Registers: Check failed", compact: "Reg: Error", colour: GREY },
];

const AI_CASES: {
  status: AiVerificationStatus;
  full: string;
  compact: string;
  colour: string;
}[] = [
  { status: "MATCH", full: "AI: Match", compact: "AI: Match", colour: GREEN },
  { status: "PARTIAL_MATCH", full: "AI: Partial match", compact: "AI: Partial", colour: AMBER },
  { status: "NO_MATCH", full: "AI: No match", compact: "AI: No match", colour: RED },
  { status: "NOT_FOUND", full: "AI: Not found on CH", compact: "AI: Not found", colour: GREY },
  { status: "ERROR", full: "AI: Check failed", compact: "AI: Error", colour: GREY },
];

describe("RegisterOverallBadge", () => {
  it.each(REGISTER_CASES)(
    "$status renders the full label '$full' with the $colour colour",
    ({ status, full, colour }) => {
      render(<RegisterOverallBadge overall={status} />);
      const badge = screen.getByTestId("badge-register-overall");
      expect(badge).toHaveTextContent(full);
      expect(badge.className).toContain(colour);
      cleanup();
    },
  );

  it.each(REGISTER_CASES)(
    "$status renders the compact label '$compact' with the $colour colour",
    ({ status, compact, colour }) => {
      render(<RegisterOverallBadge overall={status} compact />);
      const badge = screen.getByTestId("badge-register-overall");
      expect(badge).toHaveTextContent(compact);
      expect(badge.className).toContain(colour);
      cleanup();
    },
  );
});

describe("AiVerdictBadge", () => {
  it.each(AI_CASES)(
    "$status renders the full label '$full' with the $colour colour",
    ({ status, full, colour }) => {
      render(<AiVerdictBadge verdict={status} />);
      const badge = screen.getByTestId("badge-ai-verdict");
      expect(badge).toHaveTextContent(full);
      expect(badge.className).toContain(colour);
      cleanup();
    },
  );

  it.each(AI_CASES)(
    "$status renders the compact label '$compact' with the $colour colour",
    ({ status, compact, colour }) => {
      render(<AiVerdictBadge verdict={status} compact />);
      const badge = screen.getByTestId("badge-ai-verdict");
      expect(badge).toHaveTextContent(compact);
      expect(badge.className).toContain(colour);
      cleanup();
    },
  );
});
