import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiMock = vi.fn();
const downloadAuthedMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
  downloadAuthed: (...args: unknown[]) => downloadAuthedMock(...args),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/early-access", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import EarlyAccess from "./EarlyAccess";

const STATS = {
  total: 3,
  customers: 2,
  traders: 1,
  other: 0,
  launchConsent: 2,
  marketingConsent: 1,
  unsubscribed: 1,
  unknownLegacyConsent: 1,
};

function makeReg(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Alice Smith",
    email: "alice@example.test",
    audienceType: "customer",
    town: "Leeds",
    message: null,
    sourcePage: "/join",
    joinedAt: "2026-01-01T00:00:00.000Z",
    launchConsentAt: "2026-01-01T00:00:00.000Z",
    launchConsentVersion: "1",
    marketingConsentAt: null,
    marketingConsentVersion: null,
    unsubscribedAt: null,
    unsubscribeSource: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function setupApi(regs: ReturnType<typeof makeReg>[]) {
  apiMock.mockImplementation((path: string) => {
    if (path === "/api/admin/early-access/stats") return Promise.resolve(STATS);
    if (path === "/api/admin/early-access")
      return Promise.resolve({ registrations: regs, total: regs.length, limit: 50, offset: 0 });
    if (path.startsWith("/api/admin/early-access/") && path.endsWith("/suppress"))
      return Promise.resolve({ success: true, registration: regs[0] });
    if (path.startsWith("/api/admin/early-access/"))
      return Promise.resolve({ registration: regs[0], events: [] });
    return Promise.resolve({});
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EarlyAccess />
    </QueryClientProvider>,
  );
}

describe("EarlyAccess page", () => {
  beforeEach(() => {
    apiMock.mockReset();
    downloadAuthedMock.mockReset();
  });

  it("renders summary stats and a registration row with derived badges", async () => {
    setupApi([
      makeReg({ id: 1 }),
      makeReg({ id: 2, name: "Bob", unsubscribedAt: "2026-02-01T00:00:00.000Z", unsubscribeSource: "admin" }),
    ]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("stat-total")).toHaveTextContent("3"),
    );
    const row = await screen.findByTestId("row-registration-1");
    expect(within(row).getByText("Alice Smith")).toBeInTheDocument();
    expect(within(row).getByText("Subscribed")).toBeInTheDocument();
    // launchConsentAt is set → "Yes"; marketingConsentAt is null → "No".
    expect(within(row).getByText("Yes")).toBeInTheDocument();
    expect(within(row).getByText("No")).toBeInTheDocument();

    const suppressedRow = screen.getByTestId("row-registration-2");
    expect(within(suppressedRow).getByText("Suppressed")).toBeInTheDocument();
  });

  it("calls the default export without includeSuppressed", async () => {
    setupApi([makeReg({ id: 1 })]);
    renderPage();

    fireEvent.click(await screen.findByTestId("button-export-csv"));
    await waitFor(() => expect(downloadAuthedMock).toHaveBeenCalled());
    const url = downloadAuthedMock.mock.calls[0][0] as string;
    expect(url).not.toContain("includeSuppressed");
  });

  it("requires confirmation before exporting suppressed contacts", async () => {
    setupApi([makeReg({ id: 1 })]);
    renderPage();

    fireEvent.click(await screen.findByTestId("button-export-all"));
    fireEvent.click(await screen.findByTestId("button-confirm-export-all"));
    await waitFor(() => expect(downloadAuthedMock).toHaveBeenCalled());
    const url = downloadAuthedMock.mock.calls[0][0] as string;
    expect(url).toContain("includeSuppressed=true");
    expect(url).toContain("confirmAll=true");
  });
});
