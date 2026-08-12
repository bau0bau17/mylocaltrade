import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, downloadAuthed } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateTime } from "@/lib/format";
import { Search, Download, Rocket, Ban, Copy, Send } from "lucide-react";

// ---------------------------------------------------------------------------
// Types (local — this page is the only consumer of the early-access contract).
// ---------------------------------------------------------------------------

type AudienceType = "customer" | "trader" | "other";
type UnsubscribeSource = "user" | "admin" | null;

interface EarlyAccessStats {
  total: number;
  customers: number;
  traders: number;
  other: number;
  launchConsent: number;
  marketingConsent: number;
  unsubscribed: number;
  suppressed: number;
  unknownLegacyConsent: number;
  pendingConfirmation: number;
  confirmationExpired: number;
  confirmedLaunchOnly: number;
  confirmedLaunchMarketing: number;
  legacyUnconfirmed: number;
}

interface EarlyAccessRegistration {
  id: number;
  name: string | null;
  email: string;
  audienceType: AudienceType | string;
  town: string | null;
  message: string | null;
  sourcePage: string | null;
  joinedAt: string;
  launchConsentAt: string | null;
  launchConsentVersion: string | null;
  marketingConsentAt: string | null;
  marketingConsentVersion: string | null;
  unsubscribedAt: string | null;
  unsubscribeSource: UnsubscribeSource;
  pendingRequestedAt: string | null;
  pendingLaunchConsentVersion: string | null;
  pendingMarketingConsentVersion: string | null;
  confirmationTokenExpiresAt: string | null;
  confirmationTokenUsedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EarlyAccessListResponse {
  registrations: EarlyAccessRegistration[];
  total: number;
  limit: number;
  offset: number;
}

type EventKind =
  | "REGISTERED"
  | "DETAILS_UPDATED"
  | "LAUNCH_CONSENT"
  | "MARKETING_CONSENT"
  | "ADMIN_SUPPRESSED"
  | "CSV_EXPORTED"
  | "CONFIRMATION_SENT"
  | "EMAIL_CONFIRMED"
  | string;

interface EarlyAccessEvent {
  id: number;
  kind: EventKind;
  wordingVersion: string | null;
  wording: string | null;
  performedBy: number | null;
  details: unknown;
  createdAt: string;
}

interface EarlyAccessDetailResponse {
  registration: EarlyAccessRegistration;
  events: EarlyAccessEvent[];
}

// Query values the server understands for ?status= (distinct from the richer
// client-derived StatusKind used for the per-row badge).
type StatusFilter =
  | "subscribed"
  | "unsubscribed"
  | "suppressed"
  | "pending"
  | "expired"
  | "confirmed";

const PAGE_SIZE = 50;

const AUDIENCE_LABELS: Record<string, string> = {
  customer: "Customer",
  trader: "Trader",
  other: "Other",
};

const EVENT_LABELS: Record<string, string> = {
  REGISTERED: "Registered",
  DETAILS_UPDATED: "Details updated",
  LAUNCH_CONSENT: "Launch consent",
  MARKETING_CONSENT: "Marketing consent",
  ADMIN_SUPPRESSED: "Suppressed by admin",
  CSV_EXPORTED: "CSV exported",
  CONFIRMATION_SENT: "Confirmation email sent",
  EMAIL_CONFIRMED: "Email confirmed",
};

// Human-readable label for an event, taking into account its details payload
// (e.g. a CONFIRMATION_SENT with ok=false is a failure, not a success).
function eventLabel(e: EarlyAccessEvent): string {
  if (e.kind === "CONFIRMATION_SENT") {
    const d = (e.details ?? {}) as Record<string, unknown>;
    if (d.ok === false) return "Confirmation email failed";
    const channel = typeof d.channel === "string" ? d.channel : null;
    return channel ? `Confirmation email sent (${channel})` : "Confirmation email sent";
  }
  return EVENT_LABELS[e.kind] ?? e.kind;
}

type StatusKind =
  | "subscribed"
  | "unsubscribed"
  | "suppressed"
  | "pending"
  | "expired"
  | "confirmed-launch"
  | "confirmed-marketing"
  | "legacy"
  | "unknown";

// Client-side status precedence (mirrors the server's derivation). Suppression
// and user unsubscribe take priority; then confirmation-window state; then the
// confirmed/legacy consent buckets.
function deriveStatus(r: EarlyAccessRegistration): StatusKind {
  if (r.unsubscribedAt && r.unsubscribeSource === "admin") return "suppressed";
  if (r.unsubscribedAt && r.unsubscribeSource === "user") return "unsubscribed";
  if (
    !r.confirmedAt &&
    r.confirmationTokenExpiresAt &&
    !r.confirmationTokenUsedAt
  ) {
    const expiry = new Date(r.confirmationTokenExpiresAt).getTime();
    return expiry > Date.now() ? "pending" : "expired";
  }
  if (r.confirmedAt) {
    return r.marketingConsentAt ? "confirmed-marketing" : "confirmed-launch";
  }
  if (r.launchConsentAt) return "legacy";
  return "unknown";
}

const STATUS_LABELS: Record<StatusKind, string> = {
  subscribed: "Subscribed",
  unsubscribed: "Unsubscribed",
  suppressed: "Suppressed",
  pending: "Pending confirmation",
  expired: "Confirmation expired",
  "confirmed-launch": "Confirmed · launch only",
  "confirmed-marketing": "Confirmed · launch + marketing",
  legacy: "Legacy (pre-confirmation)",
  unknown: "Unknown consent",
};

function StatusBadge({ status }: { status: StatusKind }) {
  const label = STATUS_LABELS[status];
  const successClass =
    "bg-[hsl(var(--success-tint))] text-[hsl(var(--success))] border-transparent font-medium";
  const mutedClass = "bg-muted text-muted-foreground border-transparent font-medium";
  const destructiveClass =
    "bg-[hsl(var(--destructive-tint))] text-[hsl(var(--destructive))] border-transparent font-medium";
  const warnClass =
    "bg-[hsl(var(--warning-tint,var(--muted)))] text-[hsl(var(--warning,var(--foreground)))] border-transparent font-medium";

  let cls = mutedClass;
  if (status === "confirmed-launch" || status === "confirmed-marketing") cls = successClass;
  else if (status === "suppressed") cls = destructiveClass;
  else if (status === "expired") cls = destructiveClass;
  else if (status === "pending") cls = warnClass;
  else if (status === "subscribed") cls = successClass;
  else if (status === "unsubscribed" || status === "legacy" || status === "unknown")
    cls = mutedClass;

  return (
    <Badge variant="outline" className={cls}>
      {label}
    </Badge>
  );
}

function AudienceBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className="font-medium">
      {AUDIENCE_LABELS[type] ?? type}
    </Badge>
  );
}

function YesNoBadge({ yes, yesLabel = "Yes", noLabel = "No" }: { yes: boolean; yesLabel?: string; noLabel?: string }) {
  return yes ? (
    <Badge variant="outline" className="bg-[hsl(var(--success-tint))] text-[hsl(var(--success))] border-transparent font-medium">
      {yesLabel}
    </Badge>
  ) : (
    <Badge variant="outline" className="bg-muted text-muted-foreground border-transparent font-medium">
      {noLabel}
    </Badge>
  );
}

function useQueryParams() {
  // wouter's `useLocation()` returns the pathname only — read query params via
  // `useSearch()` so incoming filter links aren't silently dropped.
  const search = useSearch();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function EarlyAccess() {
  const params = useQueryParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [q, setQ] = useState(params.get("search") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(q);
  const [type, setType] = useState<AudienceType | "ALL">(
    (params.get("type") as AudienceType | null) ?? "ALL",
  );
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [launchConsent, setLaunchConsent] = useState<"yes" | "unknown" | "ALL">(
    (params.get("launchConsent") as "yes" | "unknown" | null) ?? "ALL",
  );
  const [marketing, setMarketing] = useState<"yes" | "no" | "ALL">(
    (params.get("marketing") as "yes" | "no" | null) ?? "ALL",
  );
  const [status, setStatus] = useState<StatusFilter | "ALL">(
    (params.get("status") as StatusFilter | null) ?? "ALL",
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [suppressOpen, setSuppressOpen] = useState(false);
  const [suppressReason, setSuppressReason] = useState("");
  const [exportAllOpen, setExportAllOpen] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  // Keep filter state in the URL query string.
  useEffect(() => {
    const sp = new URLSearchParams();
    if (debouncedQ) sp.set("search", debouncedQ);
    if (type !== "ALL") sp.set("type", type);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (launchConsent !== "ALL") sp.set("launchConsent", launchConsent);
    if (marketing !== "ALL") sp.set("marketing", marketing);
    if (status !== "ALL") sp.set("status", status);
    const qs = sp.toString();
    navigate(`/early-access${qs ? `?${qs}` : ""}`, { replace: true });
  }, [debouncedQ, type, from, to, launchConsent, marketing, status, navigate]);

  // ISO dates for the API — `from` covers the whole day, `to` the end of day.
  const fromIso = from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined;
  const toIso = to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined;

  const listQueryValues = {
    search: debouncedQ || undefined,
    type: type === "ALL" ? undefined : type,
    from: fromIso,
    to: toIso,
    launchConsent: launchConsent === "ALL" ? undefined : launchConsent,
    marketing: marketing === "ALL" ? undefined : marketing,
    status: status === "ALL" ? undefined : status,
  };

  const { data: stats } = useQuery({
    queryKey: ["admin", "early-access", "stats"],
    queryFn: () => api<EarlyAccessStats>("/api/admin/early-access/stats"),
  });

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, error } =
    useInfiniteQuery({
      queryKey: [
        "admin",
        "early-access",
        "list",
        debouncedQ,
        type,
        fromIso,
        toIso,
        launchConsent,
        marketing,
        status,
      ],
      initialPageParam: 0,
      queryFn: ({ pageParam }) =>
        api<EarlyAccessListResponse>("/api/admin/early-access", {
          query: { ...listQueryValues, limit: PAGE_SIZE, offset: pageParam },
        }),
      getNextPageParam: (lastPage, allPages) => {
        const loaded = allPages.reduce((n, p) => n + p.registrations.length, 0);
        return loaded < lastPage.total ? loaded : undefined;
      },
    });

  const pages = data?.pages ?? [];
  const total = pages[0]?.total ?? 0;
  const registrations = pages.flatMap((p) => p.registrations);

  const detailQuery = useQuery({
    queryKey: ["admin", "early-access", "detail", selectedId],
    queryFn: () => api<EarlyAccessDetailResponse>(`/api/admin/early-access/${selectedId}`),
    enabled: selectedId != null,
  });

  const suppressMutation = useMutation({
    mutationFn: (reason: string) =>
      api<{ success: boolean; registration: EarlyAccessRegistration }>(
        `/api/admin/early-access/${selectedId}/suppress`,
        { method: "POST", body: reason ? { reason } : {} },
      ),
    onSuccess: () => {
      toast({ title: "Contact suppressed", description: "They will be excluded from default exports." });
      queryClient.invalidateQueries({ queryKey: ["admin", "early-access", "list"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "early-access", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "early-access", "detail", selectedId] });
      setSuppressOpen(false);
      setSuppressReason("");
    },
    onError: (err) => {
      const isConflict = err instanceof ApiError && err.status === 409;
      toast({
        title: isConflict ? "Already unsubscribed" : "Suppression failed",
        description:
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
      if (isConflict) setSuppressOpen(false);
    },
  });

  function buildExportQuery(
    includeSuppressed: boolean,
    purpose?: "launch" | "marketing",
  ): string {
    const sp = new URLSearchParams();
    if (debouncedQ) sp.set("search", debouncedQ);
    if (type !== "ALL") sp.set("type", type);
    if (fromIso) sp.set("from", fromIso);
    if (toIso) sp.set("to", toIso);
    if (launchConsent !== "ALL") sp.set("launchConsent", launchConsent);
    if (marketing !== "ALL") sp.set("marketing", marketing);
    if (status !== "ALL") sp.set("status", status);
    // Consent-purpose exports are constrained server-side: only subscribed
    // contacts with the matching recorded consent can ever be included.
    if (purpose) sp.set("purpose", purpose);
    if (includeSuppressed) {
      sp.set("includeSuppressed", "true");
      sp.set("confirmAll", "true");
    }
    const qs = sp.toString();
    return `/api/admin/early-access/export${qs ? `?${qs}` : ""}`;
  }

  async function handleExport(
    includeSuppressed: boolean,
    purpose?: "launch" | "marketing",
  ) {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await downloadAuthed(
        buildExportQuery(includeSuppressed, purpose),
        `early-access-${purpose ? `${purpose}-` : includeSuppressed ? "all-" : ""}${stamp}.csv`,
      );
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  const resendMutation = useMutation({
    mutationFn: () =>
      api<{ success: boolean; sent: boolean; channel: string }>(
        `/api/admin/early-access/${selectedId}/resend-confirmation`,
        { method: "POST", body: {} },
      ),
    onSuccess: (res) => {
      toast({
        title: res.sent ? "Confirmation email sent" : "Confirmation not sent",
        description: res.sent
          ? `A fresh confirmation link was sent via ${res.channel}.`
          : `The email was not delivered (channel: ${res.channel}). A fresh token was still issued.`,
        variant: res.sent ? undefined : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["admin", "early-access", "detail", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "early-access", "stats"] });
    },
    onError: (err) => {
      toast({
        title: "Resend failed",
        description:
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  async function handleCopyEmail(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      toast({ title: "Email copied", description: email });
    } catch {
      toast({ title: "Could not copy email", variant: "destructive" });
    }
  }

  const selected = detailQuery.data?.registration ?? null;
  const selectedStatus = selected ? deriveStatus(selected) : null;
  // A resend only makes sense while there is an open pending request. The
  // server rejects everything else (suppressed / confirmed-without-pending /
  // legacy / unknown) with 409, so we hide the button in those states.
  const canResend =
    !!selected &&
    selectedStatus !== "suppressed" &&
    !!selected.pendingLaunchConsentVersion &&
    !selected.confirmationTokenUsedAt;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Early Access</h1>
          <p className="text-sm text-muted-foreground">
            Manage the launch waiting list, consent evidence and exports.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => navigate("/early-access/campaigns")}
            data-testid="button-campaigns"
          >
            <Rocket className="w-4 h-4 mr-1.5" /> Campaigns
          </Button>
          <Button variant="outline" onClick={() => handleExport(false)} data-testid="button-export-csv">
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport(false, "launch")}
            data-testid="button-export-launch"
          >
            <Download className="w-4 h-4 mr-1.5" /> Launch list
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport(false, "marketing")}
            data-testid="button-export-marketing"
          >
            <Download className="w-4 h-4 mr-1.5" /> Marketing list
          </Button>
          <Button
            variant="outline"
            onClick={() => setExportAllOpen(true)}
            data-testid="button-export-all"
          >
            <Download className="w-4 h-4 mr-1.5" /> Export all incl. suppressed
          </Button>
        </div>
      </div>

      <div className="space-y-3" data-testid="stat-cards">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
            Audience
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total" value={stats?.total} testId="stat-total" />
            <StatCard label="Customers" value={stats?.customers} testId="stat-customers" />
            <StatCard label="Traders" value={stats?.traders} testId="stat-traders" />
            <StatCard label="Other" value={stats?.other} testId="stat-other" />
          </div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
            Confirmation
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Pending confirmation" value={stats?.pendingConfirmation} testId="stat-pending-confirmation" />
            <StatCard label="Confirmation expired" value={stats?.confirmationExpired} testId="stat-confirmation-expired" />
            <StatCard label="Confirmed (launch only)" value={stats?.confirmedLaunchOnly} testId="stat-confirmed-launch-only" />
            <StatCard label="Confirmed (launch + marketing)" value={stats?.confirmedLaunchMarketing} testId="stat-confirmed-launch-marketing" />
          </div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
            Consent &amp; status
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Launch consent" value={stats?.launchConsent} testId="stat-launch-consent" />
            <StatCard label="Marketing consent" value={stats?.marketingConsent} testId="stat-marketing-consent" />
            <StatCard label="Unsubscribed" value={stats?.unsubscribed} testId="stat-unsubscribed" />
            <StatCard label="Suppressed" value={stats?.suppressed} testId="stat-suppressed" />
            <StatCard label="Legacy (pre-confirmation)" value={stats?.legacyUnconfirmed} testId="stat-legacy-unconfirmed" />
            <StatCard label="Unknown legacy consent" value={stats?.unknownLegacyConsent} testId="stat-unknown-legacy" />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="ea-search">Search</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="ea-search"
                placeholder="Name or email…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as AudienceType | "ALL")}>
              <SelectTrigger data-testid="select-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="trader">Trader</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ea-from">From</Label>
            <Input id="ea-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-from" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ea-to">To</Label>
            <Input id="ea-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="input-to" />
          </div>
          <div className="space-y-1.5">
            <Label>Launch consent</Label>
            <Select value={launchConsent} onValueChange={(v) => setLaunchConsent(v as "yes" | "unknown" | "ALL")}>
              <SelectTrigger data-testid="select-launch-consent"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any</SelectItem>
                <SelectItem value="yes">Consented</SelectItem>
                <SelectItem value="unknown">Unknown (legacy)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Marketing</Label>
            <Select value={marketing} onValueChange={(v) => setMarketing(v as "yes" | "no" | "ALL")}>
              <SelectTrigger data-testid="select-marketing"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any</SelectItem>
                <SelectItem value="yes">Opted in</SelectItem>
                <SelectItem value="no">Not opted in</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter | "ALL")}>
              <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="subscribed">Subscribed</SelectItem>
                <SelectItem value="pending">Pending confirmation</SelectItem>
                <SelectItem value="expired">Confirmation expired</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                <SelectItem value="suppressed">Suppressed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof ApiError ? error.message : "Could not load registrations."}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : registrations.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">
              No registrations match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Name</th>
                    <th className="text-left px-4 py-2.5 font-medium">Email</th>
                    <th className="text-left px-4 py-2.5 font-medium">Type</th>
                    <th className="text-left px-4 py-2.5 font-medium">Area</th>
                    <th className="text-left px-4 py-2.5 font-medium">Date joined</th>
                    <th className="text-left px-4 py-2.5 font-medium">Launch consent</th>
                    <th className="text-left px-4 py-2.5 font-medium">Marketing</th>
                    <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {registrations.map((r) => (
                    <tr
                      key={r.id}
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => setSelectedId(r.id)}
                      data-testid={`row-registration-${r.id}`}
                    >
                      <td className="px-4 py-3 font-medium">{r.name || "—"}</td>
                      <td className="px-4 py-3">{r.email}</td>
                      <td className="px-4 py-3"><AudienceBadge type={r.audienceType} /></td>
                      <td className="px-4 py-3">{r.town || "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(r.joinedAt)}</td>
                      <td className="px-4 py-3">
                        <YesNoBadge yes={!!r.launchConsentAt} yesLabel="Yes" noLabel="Unknown" />
                      </td>
                      <td className="px-4 py-3">
                        <YesNoBadge yes={!!r.marketingConsentAt} />
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={deriveStatus(r)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
                <p className="text-xs text-muted-foreground" data-testid="text-registration-count">
                  Showing {registrations.length} of {total} registration{total === 1 ? "" : "s"}
                </p>
                {hasNextPage && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    data-testid="button-load-more"
                  >
                    {isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={selectedId != null} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-detail">
          <DialogHeader>
            <DialogTitle>Registration detail</DialogTitle>
            <DialogDescription>Full record and consent history.</DialogDescription>
          </DialogHeader>

          {detailQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-24" />
              <Skeleton className="h-40" />
            </div>
          ) : detailQuery.error ? (
            <Alert variant="destructive">
              <AlertDescription>
                {detailQuery.error instanceof ApiError ? detailQuery.error.message : "Could not load registration."}
              </AlertDescription>
            </Alert>
          ) : selected ? (
            <div className="space-y-5">
              <div className="flex items-center gap-2 flex-wrap">
                {selectedStatus && <StatusBadge status={selectedStatus} />}
                <AudienceBadge type={selected.audienceType} />
                {selected.unsubscribeSource && (
                  <span className="text-xs text-muted-foreground">
                    via {selected.unsubscribeSource}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopyEmail(selected.email)}
                    data-testid="button-copy-email"
                  >
                    <Copy className="w-4 h-4 mr-1.5" /> Copy email
                  </Button>
                  {canResend && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => resendMutation.mutate()}
                      disabled={resendMutation.isPending}
                      data-testid="button-resend-confirmation"
                    >
                      <Send className="w-4 h-4 mr-1.5" />
                      {resendMutation.isPending ? "Sending…" : "Resend confirmation"}
                    </Button>
                  )}
                  {!selected.unsubscribedAt && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setSuppressReason(""); setSuppressOpen(true); }}
                      data-testid="button-suppress"
                    >
                      <Ban className="w-4 h-4 mr-1.5" /> Suppress
                    </Button>
                  )}
                </div>
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <h3 className="text-sm font-semibold mb-2">Confirmation</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <DetailField
                    label="Confirmation requested"
                    value={formatDateTime(selected.pendingRequestedAt)}
                  />
                  <DetailField
                    label="Link expires"
                    value={formatDateTime(selected.confirmationTokenExpiresAt)}
                  />
                  <DetailField
                    label="Confirmed at"
                    value={formatDateTime(selected.confirmedAt)}
                  />
                  <DetailField
                    label="Marketing requested"
                    value={selected.pendingMarketingConsentVersion != null ? "Yes" : "No"}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <DetailField label="Name" value={selected.name || "—"} />
                <DetailField label="Email" value={selected.email} />
                <DetailField label="Type" value={AUDIENCE_LABELS[selected.audienceType] ?? selected.audienceType} />
                <DetailField label="Area" value={selected.town || "—"} />
                <DetailField label="Source page" value={selected.sourcePage || "—"} />
                <DetailField label="Date joined" value={formatDateTime(selected.joinedAt)} />
                <DetailField
                  label="Launch consent"
                  value={
                    selected.launchConsentAt
                      ? `${formatDateTime(selected.launchConsentAt)} (v${selected.launchConsentVersion ?? "—"})`
                      : "Unknown (legacy)"
                  }
                />
                <DetailField
                  label="Marketing consent"
                  value={
                    selected.marketingConsentAt
                      ? `${formatDateTime(selected.marketingConsentAt)} (v${selected.marketingConsentVersion ?? "—"})`
                      : "Not opted in"
                  }
                />
                <DetailField label="Unsubscribed at" value={formatDateTime(selected.unsubscribedAt)} />
                <DetailField label="Unsubscribe source" value={selected.unsubscribeSource || "—"} />
                <DetailField label="Created" value={formatDateTime(selected.createdAt)} />
                <DetailField label="Updated" value={formatDateTime(selected.updatedAt)} />
                <DetailField label="Message" value={selected.message || "—"} full />
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Consent history</h3>
                {detailQuery.data && detailQuery.data.events.length > 0 ? (
                  <ul className="space-y-2" data-testid="event-list">
                    {detailQuery.data.events.map((e) => (
                      <li key={e.id} className="rounded-md border bg-muted/40 p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-sm font-medium">{eventLabel(e)}</span>
                          <span className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                        </div>
                        {e.wordingVersion && (
                          <div className="text-xs text-muted-foreground">Wording v{e.wordingVersion}</div>
                        )}
                        {e.wording && (
                          <p className="text-xs leading-relaxed whitespace-pre-wrap">{e.wording}</p>
                        )}
                        {renderEventDetails(e.details)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No consent history recorded.</p>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Suppress confirmation */}
      <AlertDialog open={suppressOpen} onOpenChange={(open) => { if (!suppressMutation.isPending) setSuppressOpen(open); }}>
        <AlertDialogContent data-testid="dialog-suppress">
          <AlertDialogHeader>
            <AlertDialogTitle>Suppress this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              They will be marked as suppressed and excluded from default exports. This cannot be undone here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="suppress-reason">Reason (optional)</Label>
            <Textarea
              id="suppress-reason"
              value={suppressReason}
              onChange={(e) => setSuppressReason(e.target.value)}
              placeholder="e.g. requested removal by email"
              data-testid="input-suppress-reason"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={suppressMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); suppressMutation.mutate(suppressReason.trim()); }}
              disabled={suppressMutation.isPending}
              data-testid="button-confirm-suppress"
            >
              {suppressMutation.isPending ? "Suppressing…" : "Suppress contact"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Export all confirmation */}
      <AlertDialog open={exportAllOpen} onOpenChange={setExportAllOpen}>
        <AlertDialogContent data-testid="dialog-export-all">
          <AlertDialogHeader>
            <AlertDialogTitle>Export all contacts, including suppressed?</AlertDialogTitle>
            <AlertDialogDescription>
              This export will include unsubscribed and admin-suppressed contacts who have opted out of
              communications. Only proceed for a legitimate purpose (e.g. a data-subject or ICO request).
              The current filters still apply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setExportAllOpen(false); handleExport(true); }}
              data-testid="button-confirm-export-all"
            >
              Export all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({ label, value, testId }: { label: string; value: number | undefined; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums mt-1">
          {value == null ? "—" : value.toLocaleString("en-GB")}
        </div>
      </CardContent>
    </Card>
  );
}

function DetailField({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words">{value}</div>
    </div>
  );
}

function renderEventDetails(details: unknown) {
  if (!details || typeof details !== "object") return null;
  const rec = details as Record<string, unknown>;
  const entries = Object.entries(rec).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) return null;
  return (
    <div className="text-xs text-muted-foreground space-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k}>
          <span className="font-medium">{k}:</span>{" "}
          {typeof v === "object" ? JSON.stringify(v) : String(v)}
        </div>
      ))}
    </div>
  );
}
