/**
 * Regression tests for the Outreach Contacts page:
 *
 * 1. The "real sending is disabled" warning is driven by the SERVER-reported
 *    sending status (same endpoint the Campaigns page uses) — shown when the
 *    server says disabled, and absent only when the server says enabled.
 * 2. Outreach dialogs use the Admin dark-theme surface tokens, not the
 *    white-forced shared dialog surface.
 * 3. Contact eligibility stays server-decided: the UI renders exactly the
 *    eligibility the server returns and the add-contact call sends only the
 *    recorded form fields (no client-side eligibility/sending decisions).
 */
import type { ReactElement } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
  downloadAuthed: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    details?: unknown;
    constructor(message: string, status = 500, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import OutreachContacts from "./OutreachContacts";

function makeContact(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: "info@example-builders.co.uk",
    emailNormalized: "info@example-builders.co.uk",
    contactName: "Jo Builder",
    companyName: "Example Builders Ltd",
    businessType: "ltd",
    companyNumber: "12345678",
    website: null,
    sourceName: "Companies House",
    sourceDetail: "https://find-and-update.company-information.service.gov.uk",
    obtainedAt: "2026-08-01",
    country: "United Kingdom",
    lawfulRoute: "confirmed_consent",
    consentAt: "2026-08-01",
    consentEvidence: "Signed consent form",
    soiSaleEvidence: null,
    soiRelevanceEvidence: null,
    soiOptOutEvidence: null,
    b2bCompanyEvidence: null,
    b2bRelevanceEvidence: null,
    b2bLiaEvidence: null,
    notes: null,
    importedAt: "2026-08-01T00:00:00.000Z",
    eligibilityStatus: "eligible",
    eligibilityCategory: "CONFIRMED_CONSENT",
    eligibilityReason: "Confirmed consent recorded.",
    unsubscribedAt: null,
    emailSuppressedAt: null,
    emailSuppressionReason: null,
    ...overrides,
  };
}

const STATS = {
  total: 0,
  eligible: 0,
  blocked: 0,
  unsubscribed: 0,
  suppressed: 0,
  suppressionList: 0,
  byCategory: {},
};

function mockRoutes({
  sendingEnabled,
  contacts = [] as ReturnType<typeof makeContact>[],
}: {
  sendingEnabled: boolean;
  contacts?: ReturnType<typeof makeContact>[];
}) {
  apiMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path.startsWith("/api/admin/outreach-contacts/stats")) {
      return Promise.resolve(STATS);
    }
    if (path.startsWith("/api/admin/early-access/campaigns")) {
      return Promise.resolve({
        campaigns: [],
        quota: {
          brevoSending: {
            enabled: sendingEnabled,
            reason: sendingEnabled ? null : "MARKETING_BREVO_ENABLED is not set to 'true'",
          },
        },
      });
    }
    if (path.startsWith("/api/admin/outreach-contacts") && opts?.method === "POST") {
      return Promise.resolve({ contact: makeContact() });
    }
    if (/^\/api\/admin\/outreach-contacts\/\d+$/.test(path)) {
      return Promise.resolve({ contact: contacts[0] ?? makeContact(), events: [] });
    }
    if (path.startsWith("/api/admin/outreach-contacts")) {
      return Promise.resolve({ contacts, total: contacts.length, limit: 50, offset: 0 });
    }
    return Promise.reject(new Error(`unmocked path: ${path}`));
  });
}

function renderPage(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OutreachContacts sending-disabled warning (server-driven)", () => {
  it("shows the persistent warning when the SERVER reports sending disabled", async () => {
    mockRoutes({ sendingEnabled: false });
    renderPage(<OutreachContacts />);

    const notice = await screen.findByTestId("notice-sending-disabled");
    expect(notice.textContent).toContain("Real sending is disabled");
    expect(notice.textContent).toContain("MARKETING_BREVO_ENABLED is not set to 'true'");
    // Status came from the server endpoint, not a client assumption.
    expect(apiMock).toHaveBeenCalledWith("/api/admin/early-access/campaigns");
  });

  it("hides the warning only when the server reports sending enabled", async () => {
    mockRoutes({ sendingEnabled: true });
    renderPage(<OutreachContacts />);

    // Wait for the sending-status query to resolve, then assert absence.
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/admin/early-access/campaigns"),
    );
    await screen.findByTestId("empty-contacts");
    expect(screen.queryByTestId("notice-sending-disabled")).toBeNull();
  });
});

describe("OutreachContacts dialog theming", () => {
  /**
   * The shared DialogContent forces white via BOTH classes and inline styles,
   * so asserting classes alone is not enough — the inline style override is
   * what actually wins in the browser. Assert both layers.
   */
  function expectDarkSurface(dialog: HTMLElement) {
    // Class layer: theme tokens present, forced-white classes merged away.
    expect(dialog.className).toContain("bg-background");
    expect(dialog.className).toContain("text-foreground");
    expect(dialog.className).not.toContain("bg-white");
    expect(dialog.className).not.toContain("text-slate-900");
    // Inline-style layer: theme variables override the hardcoded #ffffff/#0f172a.
    expect(dialog.style.backgroundColor).toBe("hsl(var(--background))");
    expect(dialog.style.color).toBe("hsl(var(--foreground))");
    // Title must not keep the hardcoded near-black (invisible on dark).
    const title = dialog.querySelector("h2");
    expect(title).not.toBeNull();
    expect((title as HTMLElement).style.color).toBe("hsl(var(--foreground))");
  }

  it("renders the add-contact dialog on the dark theme surface, not white", async () => {
    mockRoutes({ sendingEnabled: false });
    renderPage(<OutreachContacts />);
    await screen.findByTestId("empty-contacts");

    fireEvent.click(screen.getByTestId("button-add-contact"));
    expectDarkSurface(await screen.findByTestId("dialog-add-contact"));
  });

  it("renders the CSV import dialog on the dark theme surface, not white", async () => {
    mockRoutes({ sendingEnabled: false });
    renderPage(<OutreachContacts />);
    await screen.findByTestId("empty-contacts");

    fireEvent.click(screen.getByTestId("button-import"));
    expectDarkSurface(await screen.findByTestId("dialog-import"));
  });

  it("renders the contact detail dialog on the dark theme surface, not white", async () => {
    mockRoutes({ sendingEnabled: false, contacts: [makeContact()] });
    renderPage(<OutreachContacts />);

    fireEvent.click(await screen.findByTestId("row-contact-1"));
    expectDarkSurface(await screen.findByTestId("dialog-contact-detail"));
  });
});

describe("OutreachContacts eligibility & sending behaviour unchanged", () => {
  it("renders eligibility exactly as the server reports it (no client override)", async () => {
    mockRoutes({
      sendingEnabled: false,
      contacts: [
        makeContact({ id: 1, eligibilityStatus: "eligible" }),
        makeContact({
          id: 2,
          email: "blocked@example.co.uk",
          emailNormalized: "blocked@example.co.uk",
          eligibilityStatus: "blocked",
          eligibilityReason: "No lawful route evidence.",
        }),
      ],
    });
    renderPage(<OutreachContacts />);

    expect((await screen.findByTestId("badge-eligibility-1")).textContent).toBe("Eligible");
    expect((await screen.findByTestId("badge-eligibility-2")).textContent).toBe("Blocked");
  });

  it("saving a contact posts only the recorded form fields — no eligibility or send fields", async () => {
    mockRoutes({ sendingEnabled: false });
    renderPage(<OutreachContacts />);
    await screen.findByTestId("empty-contacts");

    fireEvent.click(screen.getByTestId("button-add-contact"));
    await screen.findByTestId("dialog-add-contact");
    fireEvent.change(screen.getByTestId("input-email"), {
      target: { value: "new@example.co.uk" },
    });
    fireEvent.click(screen.getByTestId("button-save-contact"));

    await waitFor(() => {
      const post = apiMock.mock.calls.find(
        ([path, opts]) =>
          path === "/api/admin/outreach-contacts" &&
          (opts as { method?: string } | undefined)?.method === "POST",
      );
      expect(post).toBeDefined();
      const body = (post![1] as { body: Record<string, unknown> }).body;
      expect(body.email).toBe("new@example.co.uk");
      // The client never claims eligibility or triggers sending.
      for (const forbidden of ["eligibility", "eligibilityStatus", "send", "sendNow"]) {
        expect(body).not.toHaveProperty(forbidden);
      }
    });
  });
});
