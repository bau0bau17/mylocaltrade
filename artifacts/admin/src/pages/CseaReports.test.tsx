import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
  ApiError: class ApiError extends Error { status = 403; },
}));
import CseaReports from "./CseaReports";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><CseaReports /></QueryClientProvider>);
}

describe("restricted specialist CSEA queue", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => Promise.resolve(path.endsWith("csea-candidates") ? {
      userReports: [{ id: 4, reporterUserId: 2, reportedUserId: 3, reportedRole: "trader", category: "SUSPECTED_ILLEGAL_CONTENT", detail: null, reviewId: 8, cseaEscalatedAt: null, cseaEscalatedByAdminId: null, createdAt: "2026-01-01T00:00:00.000Z" }],
      conversationReports: [{ id: 5, conversationId: 10, reportedByUserId: 2, reason: "Illegal content", messageId: 22, category: "SUSPECTED_ILLEGAL_CONTENT", detail: null, cseaEscalatedAt: null, cseaEscalatedByAdminId: null, createdAt: "2026-01-01T00:00:00.000Z" }],
    } : {
      userReports: [{ id: 14, reporterUserId: 2, reportedUserId: 3, reportedRole: "trader", category: "SUSPECTED_ILLEGAL_CONTENT", detail: null, reviewId: 8, cseaEscalatedAt: "2026-01-01T00:00:00.000Z", cseaEscalatedByAdminId: 1, createdAt: "2026-01-01T00:00:00.000Z" }],
      conversationReports: [{ id: 15, conversationId: 10, reportedByUserId: 2, reason: "Illegal content", messageId: 22, category: "SUSPECTED_ILLEGAL_CONTENT", detail: null, cseaEscalatedAt: "2026-01-01T00:00:00.000Z", cseaEscalatedByAdminId: 1, createdAt: "2026-01-01T00:00:00.000Z" }],
    }));
  });

  it("loads both report types with specialist-only manual handling wording", async () => {
    renderPage();
    expect(await screen.findByTestId("csea-candidate-user-4")).toBeInTheDocument();
    expect(screen.getByTestId("csea-active-conversation-15")).toBeInTheDocument();
    expect(screen.getByText(/Access is limited to authorised CSEA specialist admins/)).toBeInTheDocument();
    expect(screen.getAllByText(/manual handling only/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Do not copy sensitive content/i).length).toBeGreaterThanOrEqual(2);
  });

  it("uses the dedicated escalation endpoint for specialist handling", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("csea-candidate-conversation-5"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/admin/conversation-reports/5/csea-escalate", { method: "POST" }));
    fireEvent.click(screen.getByTestId("csea-active-user-14"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/admin/csea-reports/user/14/complete", { method: "POST" }));
  });
});