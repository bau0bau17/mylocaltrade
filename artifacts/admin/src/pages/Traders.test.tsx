import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TraderListResponse, TraderListRow } from "@/lib/types";

const apiMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
  downloadAuthed: vi.fn(),
  fetchAuthedBlob: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));

import Traders from "./Traders";

function makeRow(overrides: Partial<TraderListRow> = {}): TraderListRow {
  return {
    userId: 1,
    email: "trader@example.test",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    businessName: "Acme Plumbing Ltd",
    contactName: "Jane Doe",
    phone: "07000000000",
    town: "Leeds",
    postcode: "LS1 1AA",
    mainCategory: "Plumbing",
    verificationStatus: "UNDER_REVIEW",
    phoneVerified: false,
    businessProfileCompleted: true,
    documentsSubmitted: true,
    submittedForReviewAt: "2026-05-01T10:00:00.000Z",
    verifiedAt: null,
    rejectedAt: null,
    aiVerificationStatus: null,
    registerCheckStatus: null,
    ...overrides,
  };
}

function buildResponse(traders: TraderListRow[]): TraderListResponse {
  return { traders, counts: [] };
}

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Traders />
    </QueryClientProvider>,
  );
}

describe("Traders list — at-a-glance check badges", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("renders compact register and AI badges with the correct labels and colours", async () => {
    apiMock.mockResolvedValue(
      buildResponse([
        makeRow({
          userId: 1,
          verificationStatus: "VERIFIED",
          registerCheckStatus: "PASS",
          aiVerificationStatus: "MATCH",
        }),
      ]),
    );
    renderList();

    const checks = await screen.findByTestId("checks-trader-1");

    const registerBadge = within(checks).getByTestId("badge-register-overall");
    expect(registerBadge).toHaveTextContent("Reg: Pass");
    expect(registerBadge.className).toContain("bg-emerald-100");

    const aiBadge = within(checks).getByTestId("badge-ai-verdict");
    expect(aiBadge).toHaveTextContent("AI: Match");
    expect(aiBadge.className).toContain("bg-emerald-100");

    expect(screen.getByTestId("status-VERIFIED")).toHaveTextContent("Verified");
  });

  it("uses amber and red colours for review/fail and partial/no-match states", async () => {
    apiMock.mockResolvedValue(
      buildResponse([
        makeRow({
          userId: 2,
          verificationStatus: "REJECTED",
          registerCheckStatus: "FAIL",
          aiVerificationStatus: "NO_MATCH",
        }),
        makeRow({
          userId: 3,
          verificationStatus: "NEEDS_MORE_INFO",
          registerCheckStatus: "REVIEW",
          aiVerificationStatus: "PARTIAL_MATCH",
        }),
      ]),
    );
    renderList();

    const failChecks = await screen.findByTestId("checks-trader-2");
    expect(within(failChecks).getByTestId("badge-register-overall")).toHaveTextContent("Reg: Fail");
    expect(within(failChecks).getByTestId("badge-register-overall").className).toContain("bg-red-100");
    expect(within(failChecks).getByTestId("badge-ai-verdict")).toHaveTextContent("AI: No match");
    expect(within(failChecks).getByTestId("badge-ai-verdict").className).toContain("bg-red-100");

    const reviewChecks = await screen.findByTestId("checks-trader-3");
    expect(within(reviewChecks).getByTestId("badge-register-overall")).toHaveTextContent("Reg: Review");
    expect(within(reviewChecks).getByTestId("badge-register-overall").className).toContain("bg-amber-100");
    expect(within(reviewChecks).getByTestId("badge-ai-verdict")).toHaveTextContent("AI: Partial");
    expect(within(reviewChecks).getByTestId("badge-ai-verdict").className).toContain("bg-amber-100");
  });

  it("shows 'Not run' and no check badges when neither check has run", async () => {
    apiMock.mockResolvedValue(
      buildResponse([
        makeRow({ userId: 4, registerCheckStatus: null, aiVerificationStatus: null }),
      ]),
    );
    renderList();

    const checks = await screen.findByTestId("checks-trader-4");
    expect(checks).toHaveTextContent("Not run");
    expect(within(checks).queryByTestId("badge-register-overall")).not.toBeInTheDocument();
    expect(within(checks).queryByTestId("badge-ai-verdict")).not.toBeInTheDocument();
  });

  it("shows only the badge for the check that has run (visibility logic)", async () => {
    apiMock.mockResolvedValue(
      buildResponse([
        makeRow({ userId: 5, registerCheckStatus: "PASS", aiVerificationStatus: null }),
        makeRow({ userId: 6, registerCheckStatus: null, aiVerificationStatus: "MATCH" }),
      ]),
    );
    renderList();

    const registerOnly = await screen.findByTestId("checks-trader-5");
    expect(within(registerOnly).getByTestId("badge-register-overall")).toBeInTheDocument();
    expect(within(registerOnly).queryByTestId("badge-ai-verdict")).not.toBeInTheDocument();

    const aiOnly = await screen.findByTestId("checks-trader-6");
    expect(within(aiOnly).getByTestId("badge-ai-verdict")).toBeInTheDocument();
    expect(within(aiOnly).queryByTestId("badge-register-overall")).not.toBeInTheDocument();
  });

  it("applies a red risk accent for high-risk rows and amber for medium-risk rows", async () => {
    apiMock.mockResolvedValue(
      buildResponse([
        makeRow({ userId: 7, verificationStatus: "REJECTED" }),
        makeRow({ userId: 8, verificationStatus: "NEEDS_MORE_INFO" }),
        makeRow({ userId: 9, verificationStatus: "VERIFIED", registerCheckStatus: "PASS" }),
      ]),
    );
    renderList();

    const highRow = await screen.findByTestId("row-trader-7");
    expect(highRow.querySelector("td")?.className).toContain("border-l-red-500");

    const mediumRow = screen.getByTestId("row-trader-8");
    expect(mediumRow.querySelector("td")?.className).toContain("border-l-amber-400");

    const cleanRow = screen.getByTestId("row-trader-9");
    expect(cleanRow.querySelector("td")?.className).toContain("border-l-transparent");
  });
});
