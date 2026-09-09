import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
  ApiError: class ApiError extends Error { status = 500; },
}));

import UserReports from "./UserReports";

const report = {
  id: 7, reporterUserId: 1, reporterRole: "customer", reporterName: "Reporter", reporterEmail: "reporter@test",
  reportedUserId: 2, reportedRole: "trader", reportedName: "Subject", reportedEmail: "subject@test",
  reportedTraderProfileId: 3, reportedTraderBusinessName: "Subject Ltd", category: "SUSPECTED_ILLEGAL_CONTENT",
  categoryLabel: "Suspected illegal content", detail: "Internal detail", status: "OPEN",
  outcome: "REFERRED_ESCALATED", outcomeAt: "2026-01-02T00:00:00.000Z", reviewId: 12,
  cseaEscalatedAt: null, cseaEscalatedByAdminId: null, resolutionNotes: null, resolvedAt: null,
  conversationId: null, createdAt: "2026-01-01T00:00:00.000Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><UserReports /></QueryClientProvider>);
}

describe("user report safety moderation controls", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({ reports: [report] });
  });

  it("displays the backend outcome and all explicit outcome choices", async () => {
    renderPage();
    expect((await screen.findAllByText("REFERRED ESCALATED")).length).toBeGreaterThan(0);
    const select = await screen.findByTestId("outcome-7");
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      "ACTION_TAKEN", "NO_VIOLATION", "INSUFFICIENT_EVIDENCE", "REFERRED_ESCALATED",
    ]);
    expect(screen.getByText("Linked review #12")).toBeInTheDocument();
  });

  it("makes suspected illegal content prominent without ordinary-admin CSEA controls", async () => {
    renderPage();
    expect((await screen.findAllByText("Suspected illegal content")).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("btn-csea-escalate-7")).not.toBeInTheDocument();
    expect(screen.queryByText(/Internal-only action/i)).not.toBeInTheDocument();
  });
});