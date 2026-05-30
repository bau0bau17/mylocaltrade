import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, act, waitFor } from "@testing-library/react";
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
  return {
    traders,
    counts: [],
    registerCounts: [],
    aiCounts: [],
    total: traders.length,
    limit: 50,
    offset: 0,
  };
}

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <Traders />
      </QueryClientProvider>,
    ),
  };
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

describe("Traders list — pagination", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  function paged(total: number) {
    return (
      _url: string,
      opts: { query: { offset?: number; limit?: number } },
    ) => {
      const offset = opts.query.offset ?? 0;
      const limit = opts.query.limit ?? 50;
      const traders = Array.from({ length: Math.min(limit, total - offset) }, (_, i) =>
        makeRow({ userId: offset + i + 1, businessName: `Trader ${offset + i + 1}` }),
      );
      return Promise.resolve({
        traders,
        counts: [],
        registerCounts: [],
        aiCounts: [],
        total,
        limit,
        offset,
      } satisfies TraderListResponse);
    };
  }

  it("loads only the first page and shows the total result count", async () => {
    apiMock.mockImplementation(paged(70));
    renderList();

    await screen.findByTestId("row-trader-1");
    expect(screen.getByTestId("text-trader-count")).toHaveTextContent("Showing 50 of 70 traders");
    expect(screen.queryByTestId("row-trader-51")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-load-more")).toBeInTheDocument();
  });

  it("appends the next page on 'Load more', requesting the right offset, and hides the control on the last page", async () => {
    apiMock.mockImplementation(paged(70));
    renderList();

    await screen.findByTestId("row-trader-1");
    expect(apiMock.mock.calls[0][1].query.offset).toBe(0);

    fireEvent.click(screen.getByTestId("button-load-more"));

    await screen.findByTestId("row-trader-51");

    const loadMoreCall = apiMock.mock.calls.find(([, opts]) => opts.query.offset === 50);
    expect(loadMoreCall).toBeTruthy();
    expect(loadMoreCall![1].query.limit).toBe(50);

    expect(screen.getByTestId("text-trader-count")).toHaveTextContent("Showing 70 of 70 traders");
    expect(screen.queryByTestId("button-load-more")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-trader-70")).toBeInTheDocument();
  });

  it("resets accumulation back to the first page when a filter changes", async () => {
    apiMock.mockImplementation(paged(70));
    renderList();

    await screen.findByTestId("row-trader-1");
    fireEvent.click(screen.getByTestId("button-load-more"));
    await screen.findByTestId("row-trader-51");
    expect(screen.getByTestId("text-trader-count")).toHaveTextContent("Showing 70 of 70 traders");

    fireEvent.change(screen.getByTestId("input-search-traders"), {
      target: { value: "plumbing" },
    });

    await waitFor(() =>
      expect(screen.getByTestId("text-trader-count")).toHaveTextContent("Showing 50 of 70 traders"),
    );
    expect(screen.queryByTestId("row-trader-51")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-load-more")).toBeInTheDocument();

    const resetCall = apiMock.mock.calls.find(
      ([, opts]) => opts.query.q === "plumbing" && opts.query.offset === 0,
    );
    expect(resetCall).toBeTruthy();
  });

  it("does not duplicate rows when the loaded pages are refetched", async () => {
    apiMock.mockImplementation(paged(70));
    const { client } = renderList();

    await screen.findByTestId("row-trader-1");
    fireEvent.click(screen.getByTestId("button-load-more"));
    await screen.findByTestId("row-trader-51");

    await act(async () => {
      await client.invalidateQueries();
    });

    await waitFor(() =>
      expect(screen.getByTestId("text-trader-count")).toHaveTextContent("Showing 70 of 70 traders"),
    );
    expect(screen.getAllByTestId("row-trader-1")).toHaveLength(1);
    expect(screen.getAllByTestId("row-trader-51")).toHaveLength(1);
    expect(screen.getAllByTestId("row-trader-70")).toHaveLength(1);
  });
});
