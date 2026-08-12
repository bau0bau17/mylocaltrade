import type { ReactElement } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiMock = vi.fn();
const navigateMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/early-access/campaigns", navigateMock],
  useSearch: () => "",
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import Campaigns, { CampaignDetail } from "./Campaigns";
import { ApiError } from "@/lib/api";

const QUOTA = {
  dailyCap: 300,
  sentToday: 50,
  remainingToday: 250,
  brevoSending: { enabled: false, reason: "MARKETING_BREVO_ENABLED is not set to 'true'" },
};

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    type: "launch",
    name: "Launch announcement",
    subject: "We're live!",
    previewText: "The wait is over",
    heading: "Welcome",
    bodyText: "Hello there",
    ctaLabel: "Open app",
    ctaUrl: "https://mylocaltrade.co.uk",
    status: "draft",
    snapshotCount: null,
    queuedAt: null,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const EMPTY_RECIPIENTS = {
  total: 0,
  queued: 0,
  sending: 0,
  sent: 0,
  delivered: 0,
  failed: 0,
  bounced: 0,
  complained: 0,
  unsubscribed: 0,
  suppressed: 0,
  cancelled: 0,
};

function detailResponse(overrides: Record<string, unknown> = {}) {
  const { campaign: campaignOverride, ...rest } = overrides;
  const campaign = makeCampaign((campaignOverride as Record<string, unknown>) ?? {});
  return {
    campaign,
    recipients: EMPTY_RECIPIENTS,
    batches: [],
    events: [],
    contentErrors: [],
    quota: QUOTA,
    testSendsToday: 0,
    testSendDailyLimit: 3,
    ...rest,
  };
}

function renderPage(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("Campaigns list page", () => {
  beforeEach(() => {
    apiMock.mockReset();
    navigateMock.mockReset();
    toastMock.mockReset();
  });

  it("renders the quota banner with the disabled-sending notice and a campaign row", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/admin/early-access/campaigns")
        return Promise.resolve({
          campaigns: [
            { ...makeCampaign({ id: 7, name: "Spring push", status: "sending" }), progress: { total: 100, sent: 42, queued: 58 } },
          ],
          quota: QUOTA,
        });
      return Promise.resolve({});
    });
    renderPage(<Campaigns />);

    await waitFor(() => expect(screen.getByTestId("stat-daily-cap")).toHaveTextContent("300"));
    expect(screen.getByTestId("notice-sending-disabled")).toHaveTextContent(/Real sending is disabled/);
    const row = await screen.findByTestId("row-campaign-7");
    expect(within(row).getByText("Spring push")).toBeInTheDocument();
    expect(within(row).getByTestId("progress-campaign-7")).toHaveTextContent("42 / 100");
  });

  it("posts the new campaign and navigates to its detail", async () => {
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/admin/early-access/campaigns" && init?.method === "POST")
        return Promise.resolve({ campaign: makeCampaign({ id: 99 }) });
      if (path === "/api/admin/early-access/campaigns")
        return Promise.resolve({ campaigns: [], quota: QUOTA });
      return Promise.resolve({});
    });
    renderPage(<Campaigns />);

    fireEvent.click(await screen.findByTestId("button-new-campaign"));
    fireEvent.change(screen.getByTestId("input-new-name"), { target: { value: "My campaign" } });
    fireEvent.click(screen.getByTestId("button-create-campaign"));

    await waitFor(() =>
      expect(
        apiMock.mock.calls.some(
          ([p, init]) =>
            p === "/api/admin/early-access/campaigns" &&
            (init as { method?: string })?.method === "POST",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/early-access/campaigns/99"));
  });
});

describe("Campaign detail page", () => {
  beforeEach(() => {
    apiMock.mockReset();
    navigateMock.mockReset();
    toastMock.mockReset();
  });

  it("saves editor content and shows a validation error on 400", async () => {
    let patchCalls = 0;
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/admin/early-access/campaigns/1" && init?.method === "PATCH") {
        patchCalls += 1;
        return Promise.reject(new ApiError("Subject is required.", 400));
      }
      if (path === "/api/admin/early-access/campaigns/1")
        return Promise.resolve(detailResponse());
      return Promise.resolve({});
    });
    renderPage(<CampaignDetail id={1} />);

    fireEvent.click(await screen.findByTestId("button-save-content"));
    await waitFor(() => expect(patchCalls).toBe(1));
    expect(await screen.findByTestId("editor-error")).toHaveTextContent("Subject is required.");
  });

  it("requires the exact confirmation phrase before queueing", async () => {
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/admin/early-access/campaigns/1/audience")
        return Promise.resolve({
          audience: {
            eligible: 123,
            excludedConsentMissing: 5,
            excludedConfirmationPending: 2,
            excludedUnsubscribedOrSuppressed: 1,
            total: 131,
          },
          dailyCap: 300,
          estimatedDays: 1,
          confirmationPhrase: "SEND TO 123 PEOPLE",
          quota: QUOTA,
        });
      if (path === "/api/admin/early-access/campaigns/1/queue" && init?.method === "POST")
        return Promise.resolve({ success: true, snapshotCount: 123 });
      if (path === "/api/admin/early-access/campaigns/1")
        return Promise.resolve(detailResponse());
      return Promise.resolve({});
    });
    renderPage(<CampaignDetail id={1} />);

    fireEvent.click(await screen.findByTestId("button-open-queue"));
    const confirmBtn = await screen.findByTestId("button-confirm-queue");
    expect(confirmBtn).toBeDisabled();
    expect(screen.getByTestId("queue-eligible")).toHaveTextContent("123");

    fireEvent.change(screen.getByTestId("input-confirmation"), { target: { value: "wrong" } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId("input-confirmation"), { target: { value: "SEND TO 123 PEOPLE" } });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());

    fireEvent.click(confirmBtn);
    await waitFor(() =>
      expect(
        apiMock.mock.calls.some(
          ([p, init]) =>
            p === "/api/admin/early-access/campaigns/1/queue" &&
            (init as { body?: { confirmation?: string } })?.body?.confirmation === "SEND TO 123 PEOPLE",
        ),
      ).toBe(true),
    );
  });

  it("shows a success toast when a batch sends", async () => {
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/admin/early-access/campaigns/1/send-batch" && init?.method === "POST")
        return Promise.resolve({
          ok: true,
          batchNumber: 2,
          attempted: 50,
          sent: 48,
          skipped: 2,
          failed: 0,
          remaining: 10,
          campaignStatus: "sending",
        });
      if (path === "/api/admin/early-access/campaigns/1")
        return Promise.resolve(detailResponse({ campaign: { status: "queued" } }));
      return Promise.resolve({});
    });
    renderPage(<CampaignDetail id={1} />);

    fireEvent.click(await screen.findByTestId("button-send-batch"));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Batch 2 sent" }),
      ),
    );
  });

  it("shows a quota-exhausted error toast on 429 from send-batch", async () => {
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/admin/early-access/campaigns/1/send-batch" && init?.method === "POST")
        return Promise.reject(new ApiError("Daily send quota is exhausted.", 429));
      if (path === "/api/admin/early-access/campaigns/1")
        return Promise.resolve(detailResponse({ campaign: { status: "queued" } }));
      return Promise.resolve({});
    });
    renderPage(<CampaignDetail id={1} />);

    fireEvent.click(await screen.findByTestId("button-send-batch"));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Daily quota exhausted",
          description: "Daily quota exhausted — continue tomorrow.",
          variant: "destructive",
        }),
      ),
    );
  });

  it("calls pause and cancel endpoints from the sending controls", async () => {
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/admin/early-access/campaigns/1/pause" && init?.method === "POST")
        return Promise.resolve({ campaign: makeCampaign({ status: "paused" }) });
      if (path === "/api/admin/early-access/campaigns/1/cancel" && init?.method === "POST")
        return Promise.resolve({ success: true, cancelledRecipients: 12 });
      if (path === "/api/admin/early-access/campaigns/1")
        return Promise.resolve(detailResponse({ campaign: { status: "queued" } }));
      return Promise.resolve({});
    });
    renderPage(<CampaignDetail id={1} />);

    fireEvent.click(await screen.findByTestId("button-pause"));
    await waitFor(() =>
      expect(
        apiMock.mock.calls.some(([p]) => p === "/api/admin/early-access/campaigns/1/pause"),
      ).toBe(true),
    );

    fireEvent.click(screen.getByTestId("button-cancel"));
    fireEvent.click(await screen.findByTestId("button-confirm-cancel"));
    await waitFor(() =>
      expect(
        apiMock.mock.calls.some(([p]) => p === "/api/admin/early-access/campaigns/1/cancel"),
      ).toBe(true),
    );
  });

  it("resumes a paused campaign", async () => {
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/admin/early-access/campaigns/1/resume" && init?.method === "POST")
        return Promise.resolve({ campaign: makeCampaign({ status: "queued" }) });
      if (path === "/api/admin/early-access/campaigns/1")
        return Promise.resolve(detailResponse({ campaign: { status: "paused" } }));
      return Promise.resolve({});
    });
    renderPage(<CampaignDetail id={1} />);

    fireEvent.click(await screen.findByTestId("button-resume"));
    await waitFor(() =>
      expect(
        apiMock.mock.calls.some(([p]) => p === "/api/admin/early-access/campaigns/1/resume"),
      ).toBe(true),
    );
  });
});
