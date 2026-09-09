import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
  ApiError: class ApiError extends Error { status = 500; },
}));

import ReportAppeals from "./ReportAppeals";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ReportAppeals /></QueryClientProvider>);
}

describe("report appeal queue", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({
      appeals: [{
        id: 9, reportId: 7, conversationReportId: null, appellantUserId: 11,
        reason: "I disagree with the decision.", status: "OPEN", resolution: null,
        resolutionNotes: null, createdAt: "2026-01-01T00:00:00.000Z", resolvedAt: null,
      }],
    });
  });

  it("renders the appeal and all four explicit decision outcomes", async () => {
    renderPage();
    expect(await screen.findByTestId("appeal-9")).toBeInTheDocument();
    expect(screen.getByText(/Decisions are never shown to the reported user/)).toBeInTheDocument();
    const select = screen.getByTestId("appeal-outcome-9") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "ACTION_TAKEN", "NO_VIOLATION", "INSUFFICIENT_EVIDENCE", "REFERRED_ESCALATED",
    ]);
  });

  it("posts an audited appeal decision with the selected outcome and notes", async () => {
    renderPage();
    const select = await screen.findByTestId("appeal-outcome-9");
    fireEvent.change(select, { target: { value: "INSUFFICIENT_EVIDENCE" } });
    fireEvent.click(screen.getByPlaceholderText(/Internal decision notes/i));
    fireEvent.input(screen.getByPlaceholderText(/Internal decision notes/i), { target: { value: "Reviewed evidence." } });
    fireEvent.click(screen.getByTestId("appeal-resolve-9"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/admin/report-appeals/9/resolve", expect.objectContaining({
      method: "POST",
      body: { action: "resolve", outcome: "INSUFFICIENT_EVIDENCE", notes: "Reviewed evidence." },
    })));
  });
});