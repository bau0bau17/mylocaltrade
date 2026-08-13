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
  suppressed: 1,
  unknownLegacyConsent: 1,
  pendingConfirmation: 1,
  confirmationExpired: 1,
  confirmedLaunchOnly: 1,
  confirmedLaunchMarketing: 1,
  legacyUnconfirmed: 1,
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
    pendingRequestedAt: null,
    pendingLaunchConsentVersion: null,
    pendingMarketingConsentVersion: null,
    confirmationTokenExpiresAt: null,
    confirmationTokenUsedAt: null,
    confirmedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function setupApi(
  regs: ReturnType<typeof makeReg>[],
  opts: { events?: unknown[] } = {},
) {
  apiMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === "/api/admin/early-access/stats") return Promise.resolve(STATS);
    if (path === "/api/admin/early-access")
      return Promise.resolve({ registrations: regs, total: regs.length, limit: 50, offset: 0 });
    if (path.endsWith("/suppress"))
      return Promise.resolve({ success: true, registration: regs[0] });
    if (path.endsWith("/resend-confirmation"))
      return Promise.resolve({ success: true, sent: true, channel: "brevo" });
    if (path.startsWith("/api/admin/early-access/") && (!init || init.method !== "POST")) {
      const id = Number(path.split("/").pop());
      const reg = regs.find((r) => r.id === id) ?? regs[0];
      return Promise.resolve({ registration: reg, events: opts.events ?? [] });
    }
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
    // launchConsentAt set but never confirmed → legacy (pre double opt-in).
    expect(within(row).getByText("Legacy (pre-confirmation)")).toBeInTheDocument();
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

  it("derives pending / expired / confirmed status badges from confirmation fields", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    setupApi([
      makeReg({
        id: 10,
        name: "Pending Pat",
        launchConsentAt: null,
        pendingLaunchConsentVersion: "1",
        pendingRequestedAt: "2026-01-01T00:00:00.000Z",
        confirmationTokenExpiresAt: future,
      }),
      makeReg({
        id: 11,
        name: "Expired Erin",
        launchConsentAt: null,
        pendingLaunchConsentVersion: "1",
        pendingRequestedAt: "2026-01-01T00:00:00.000Z",
        confirmationTokenExpiresAt: past,
      }),
      makeReg({
        id: 12,
        name: "Confirmed Cass",
        confirmedAt: "2026-01-02T00:00:00.000Z",
        marketingConsentAt: null,
      }),
      makeReg({
        id: 13,
        name: "Marketing Mel",
        confirmedAt: "2026-01-02T00:00:00.000Z",
        marketingConsentAt: "2026-01-02T00:00:00.000Z",
      }),
    ]);
    renderPage();

    const pending = await screen.findByTestId("row-registration-10");
    expect(within(pending).getByText("Pending confirmation")).toBeInTheDocument();
    const expired = screen.getByTestId("row-registration-11");
    expect(within(expired).getByText("Confirmation expired")).toBeInTheDocument();
    const confirmed = screen.getByTestId("row-registration-12");
    expect(within(confirmed).getByText("Confirmed · launch only")).toBeInTheDocument();
    const marketing = screen.getByTestId("row-registration-13");
    expect(within(marketing).getByText("Confirmed · launch + marketing")).toBeInTheDocument();
  });

  it("shows the resend button for a pending contact and posts to resend-confirmation", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    setupApi([
      makeReg({
        id: 20,
        name: "Pending Pat",
        launchConsentAt: null,
        pendingLaunchConsentVersion: "1",
        confirmationTokenExpiresAt: future,
      }),
    ]);
    renderPage();

    fireEvent.click(await screen.findByTestId("row-registration-20"));
    const resend = await screen.findByTestId("button-resend-confirmation");
    fireEvent.click(resend);

    await waitFor(() =>
      expect(
        apiMock.mock.calls.some(
          ([path, init]) =>
            path === "/api/admin/early-access/20/resend-confirmation" &&
            (init as { method?: string })?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("hides the resend button for a confirmed contact with nothing pending", async () => {
    setupApi([
      makeReg({
        id: 30,
        name: "Confirmed Cass",
        confirmedAt: "2026-01-02T00:00:00.000Z",
        pendingLaunchConsentVersion: null,
        confirmationTokenUsedAt: "2026-01-02T00:00:00.000Z",
      }),
    ]);
    renderPage();

    fireEvent.click(await screen.findByTestId("row-registration-30"));
    // Detail dialog opens (Copy email is always present)…
    await screen.findByTestId("button-copy-email");
    // …but there is nothing to resend for a confirmed row.
    expect(screen.queryByTestId("button-resend-confirmation")).not.toBeInTheDocument();
  });

  /**
   * The shared DialogContent forces white via BOTH classes and inline styles,
   * so asserting classes alone is not enough — the inline style override is
   * what actually wins in the browser. Assert both layers.
   */
  function expectDarkSurface(dialog: HTMLElement) {
    expect(dialog.className).toContain("bg-background");
    expect(dialog.className).toContain("text-foreground");
    expect(dialog.className).not.toContain("bg-white");
    expect(dialog.className).not.toContain("text-slate-900");
    expect(dialog.style.backgroundColor).toBe("hsl(var(--background))");
    expect(dialog.style.color).toBe("hsl(var(--foreground))");
    const title = dialog.querySelector("h2");
    expect(title).not.toBeNull();
    expect((title as HTMLElement).style.color).toBe("hsl(var(--foreground))");
  }

  it("renders the registration detail dialog on the dark theme surface, not white", async () => {
    setupApi(
      [makeReg({ id: 50, name: "Dark Dana" })],
      {
        events: [
          {
            id: 1,
            kind: "LAUNCH_CONSENT",
            wordingVersion: "1",
            wording: "I agree to be contacted about the launch.",
            performedBy: null,
            details: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    );
    renderPage();

    fireEvent.click(await screen.findByTestId("row-registration-50"));
    const dialog = await screen.findByTestId("dialog-detail");
    await within(dialog).findByText("Dark Dana");

    expectDarkSurface(dialog);

    // Confirmation panel: dark secondary card via theme tokens, no light greys.
    const confirmationHeading = within(dialog).getByText("Confirmation");
    const confirmationCard = confirmationHeading.closest("div") as HTMLElement;
    expect(confirmationCard.className).toContain("bg-muted/40");
    expect(confirmationCard.className).toContain("border-border");
    expect(confirmationCard.className).not.toMatch(/bg-slate|bg-gray|bg-white/);

    // Consent history cards: same dark secondary card treatment.
    const eventList = within(dialog).getByTestId("event-list");
    const eventCards = Array.from(eventList.querySelectorAll("li"));
    expect(eventCards.length).toBeGreaterThan(0);
    for (const card of eventCards) {
      expect(card.className).toContain("bg-muted/40");
      expect(card.className).toContain("border-border");
      expect(card.className).not.toMatch(/bg-slate|bg-gray|bg-white/);
    }

    // Long values must be allowed to wrap (no clipping of emails/versions).
    expect(dialog.innerHTML).toContain("break-words");
  });

  it("keeps the suppress confirmation on the dark AlertDialog surface", async () => {
    setupApi([makeReg({ id: 60, name: "Suppress Sam" })]);
    renderPage();

    // Suppress confirmation (opened from the detail dialog).
    fireEvent.click(await screen.findByTestId("row-registration-60"));
    fireEvent.click(await screen.findByTestId("button-suppress"));
    const suppressDialog = await screen.findByTestId("dialog-suppress");
    expect(suppressDialog.className).toContain("bg-background");
    expect(suppressDialog.className).not.toMatch(/bg-white|bg-slate|text-slate-900/);
    // No inline white forced on AlertDialogContent.
    expect(suppressDialog.style.backgroundColor).toBe("");
  });

  it("keeps the export-all confirmation on the dark AlertDialog surface", async () => {
    setupApi([makeReg({ id: 61 })]);
    renderPage();

    fireEvent.click(await screen.findByTestId("button-export-all"));
    const exportDialog = await screen.findByTestId("dialog-export-all");
    expect(exportDialog.className).toContain("bg-background");
    expect(exportDialog.className).not.toMatch(/bg-white|bg-slate|text-slate-900/);
    expect(exportDialog.style.backgroundColor).toBe("");
  });

  it("never renders confirmation-token-hash data in the detail view", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    setupApi(
      [
        makeReg({
          id: 40,
          name: "Pending Pat",
          launchConsentAt: null,
          pendingLaunchConsentVersion: "1",
          confirmationTokenExpiresAt: future,
        }),
      ],
      {
        events: [
          {
            id: 1,
            kind: "CONFIRMATION_SENT",
            wordingVersion: null,
            wording: null,
            performedBy: 1,
            details: { channel: "brevo", ok: true, resend: true },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    );
    const { container } = renderPage();

    fireEvent.click(await screen.findByTestId("row-registration-40"));
    const dialog = await screen.findByTestId("dialog-detail");
    // Wait for the detail query to resolve before asserting on its content.
    await within(dialog).findByText("Pending Pat");
    // Readable event label is shown…
    expect(within(dialog).getByText(/Confirmation email sent \(brevo\)/)).toBeInTheDocument();
    // …and no token/hash-like field ever leaks into the UI.
    expect(container.textContent).not.toMatch(/confirmationTokenHash/i);
    expect(container.textContent).not.toMatch(/tokenHash/i);
  });
});
