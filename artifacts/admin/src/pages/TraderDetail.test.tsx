import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TraderDetailResponse } from "@/lib/types";

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

import TraderDetail from "./TraderDetail";

const USER_ID = 42;

function baseProfile(): TraderDetailResponse["profile"] {
  return {
    id: 1,
    userId: USER_ID,
    businessName: "Acme Plumbing Ltd",
    contactName: "Jane Doe",
    email: "jane@acme.test",
    phone: "07000000000",
    mainCategory: "Plumbing",
    additionalServices: null,
    businessAddress: null,
    town: "Leeds",
    postcode: "LS1 1AA",
    serviceAreas: null,
    businessDescription: null,
    website: null,
    openingHours: null,
    businessRole: "OWNER",
    authorisedRepresentative: false,
    businessEmailDomain: null,
    businessEmailVerified: false,
    businessEmailVerifiedAddress: null,
    businessEmailVerifiedAt: null,
    businessEmailVerificationTarget: null,
    needsMoreInfoReason: null,
    logoUrl: null,
    galleryUrls: null,
    socialLinks: null,
    plan: "free",
    isFeatured: false,
    isActive: false,
    rating: null,
    reviewCount: 0,
    verificationStatus: "UNDER_REVIEW",
    phoneVerified: false,
    businessProfileCompleted: true,
    documentsSubmitted: true,
    submittedForReviewAt: null,
    verifiedAt: null,
    revalidationDueAt: null,
    revalidationRemindedAt: null,
    revalidationOverdue: false,
    rejectedAt: null,
    rejectionReason: null,
    adminNotes: null,
    verificationNotes: null,
    companyNumber: null,
    vatNumber: null,
    aiVerificationStatus: null,
    aiVerificationCheckedAt: null,
    aiVerificationData: null,
    registerCheckStatus: null,
    registerCheckCheckedAt: null,
    registerCheckData: null,
    termsAcceptedAt: null,
    termsVersion: null,
    privacyAcceptedAt: null,
    privacyVersion: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function buildResponse(
  overrides: Partial<TraderDetailResponse["profile"]> = {},
): TraderDetailResponse {
  return {
    user: {
      id: USER_ID,
      email: "jane@acme.test",
      fullName: "Jane Doe",
      role: "TRADER",
      isActive: true,
      emailVerified: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    profile: { ...baseProfile(), ...overrides },
    documents: [],
    documentsEvaluation: {
      complete: true,
      byType: [],
      hasExpiredRequired: false,
      hasExpiringSoonRequired: false,
    },
    auditLog: [],
  };
}

const POPULATED_AI: TraderDetailResponse["profile"]["aiVerificationData"] = {
  verdict: "MATCH",
  reasoning: "Submitted details match the Companies House record.",
  submitted: { businessName: "Acme Plumbing Ltd", address: "1 High St", postcode: "LS1 1AA" },
  companiesHouse: {
    companyNumber: "12345678",
    companyName: "Acme Plumbing Ltd",
    address: "1 High St",
    postcode: "LS1 1AA",
    status: "active",
  },
};

const POPULATED_REGISTER: TraderDetailResponse["profile"]["registerCheckData"] = {
  overall: "PASS",
  company: {
    submittedNumber: "12345678",
    status: "MATCH",
    detail: "Company number matches an active Companies House record.",
    companiesHouse: {
      companyNumber: "12345678",
      companyName: "Acme Plumbing Ltd",
      status: "active",
      address: "1 High St",
      postcode: "LS1 1AA",
    },
  },
  vat: {
    submittedNumber: "GB123456789",
    status: "MATCH",
    detail: "VAT number matches the HMRC register.",
    hmrc: {
      vatNumber: "GB123456789",
      name: "Acme Plumbing Ltd",
      address: "1 High St",
    },
  },
};

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TraderDetail userId={USER_ID} />
    </QueryClientProvider>,
  );
}

async function openChecksTab(user: ReturnType<typeof userEvent.setup>) {
  const tab = await screen.findByTestId("tab-checks");
  await user.click(tab);
}

describe("TraderDetail — Checks tab", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("shows empty states and a 'Run register check' button when no checks have run", async () => {
    apiMock.mockResolvedValue(buildResponse());
    const user = userEvent.setup();
    renderDetail();

    await openChecksTab(user);

    expect(await screen.findByTestId("text-ai-none")).toBeInTheDocument();
    expect(screen.getByTestId("text-register-none")).toBeInTheDocument();

    const runButton = screen.getByTestId("button-run-register-check");
    expect(runButton).toHaveTextContent("Run register check");
    expect(runButton).not.toHaveTextContent("Re-run");

    expect(screen.queryByTestId("badge-ai-verdict")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-register-overall")).not.toBeInTheDocument();
  });

  it("renders AI verdict and register-check badges when data is populated", async () => {
    apiMock.mockResolvedValue(
      buildResponse({
        aiVerificationStatus: "MATCH",
        aiVerificationCheckedAt: "2026-05-01T10:00:00.000Z",
        aiVerificationData: POPULATED_AI,
        registerCheckStatus: "PASS",
        registerCheckCheckedAt: "2026-05-01T10:05:00.000Z",
        registerCheckData: POPULATED_REGISTER,
      }),
    );
    const user = userEvent.setup();
    renderDetail();

    await openChecksTab(user);

    const aiBadge = await screen.findByTestId("badge-ai-verdict");
    expect(aiBadge).toHaveTextContent("AI: Match");

    const overallBadge = screen.getByTestId("badge-register-overall");
    expect(overallBadge).toHaveTextContent("Registers: Pass");

    const companySection = screen.getByTestId("register-company");
    expect(within(companySection).getByText("Match")).toBeInTheDocument();
    expect(within(companySection).getByText(/12345678/)).toBeInTheDocument();

    const vatSection = screen.getByTestId("register-vat");
    expect(within(vatSection).getByText("Match")).toBeInTheDocument();
    expect(within(vatSection).getByText(/GB123456789/)).toBeInTheDocument();

    expect(screen.getByTestId("button-run-register-check")).toHaveTextContent(
      "Re-run register check",
    );
    expect(screen.queryByTestId("text-ai-none")).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-register-none")).not.toBeInTheDocument();
  });

  it("surfaces error messages from AI and register-check data", async () => {
    apiMock.mockResolvedValue(
      buildResponse({
        aiVerificationStatus: "ERROR",
        aiVerificationCheckedAt: "2026-05-01T10:00:00.000Z",
        aiVerificationData: {
          verdict: "ERROR",
          reasoning: "Lookup could not be completed.",
          submitted: { businessName: "Acme Plumbing Ltd", address: "", postcode: "LS1 1AA" },
          companiesHouse: null,
          error: "Companies House timed out",
        },
        registerCheckStatus: "ERROR",
        registerCheckCheckedAt: "2026-05-01T10:05:00.000Z",
        registerCheckData: {
          overall: "ERROR",
          company: {
            submittedNumber: null,
            status: "ERROR",
            detail: "Could not reach Companies House.",
            companiesHouse: null,
          },
          vat: {
            submittedNumber: null,
            status: "ERROR",
            detail: "Could not reach HMRC.",
            hmrc: null,
          },
          error: "Upstream registers unavailable",
        },
      }),
    );
    const user = userEvent.setup();
    renderDetail();

    await openChecksTab(user);

    expect(await screen.findByText(/Companies House timed out/)).toBeInTheDocument();
    expect(screen.getByText(/Upstream registers unavailable/)).toBeInTheDocument();

    expect(screen.getByTestId("badge-ai-verdict")).toHaveTextContent("AI: Check failed");
    expect(screen.getByTestId("badge-register-overall")).toHaveTextContent(
      "Registers: Check failed",
    );
  });

  it("POSTs to the register-check run endpoint and refreshes the detail query when re-run is clicked", async () => {
    const withChecks = buildResponse({
      registerCheckStatus: "PASS",
      registerCheckCheckedAt: "2026-05-01T10:05:00.000Z",
      registerCheckData: POPULATED_REGISTER,
    });

    apiMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve(withChecks);
    });

    const user = userEvent.setup();
    renderDetail();

    await openChecksTab(user);

    const initialGetCalls = apiMock.mock.calls.filter(
      ([, opts]) => !(opts as { method?: string } | undefined)?.method,
    ).length;

    await user.click(screen.getByTestId("button-run-register-check"));

    await waitFor(() => {
      expect(
        apiMock.mock.calls.some(
          ([path, opts]) =>
            path === `/api/admin/traders/${USER_ID}/register-check/run` &&
            (opts as { method?: string } | undefined)?.method === "POST",
        ),
      ).toBe(true);
    });

    await waitFor(() => {
      const getCalls = apiMock.mock.calls.filter(
        ([path, opts]) =>
          path === `/api/admin/traders/${USER_ID}` &&
          !(opts as { method?: string } | undefined)?.method,
      ).length;
      expect(getCalls).toBeGreaterThan(initialGetCalls);
    });
  });
});
