import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { DARK_DIALOG_CLASS, DARK_DIALOG_STYLE, DARK_TITLE_STYLE } from "@/lib/dark-dialog";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  ArrowLeft,
  Rocket,
  Plus,
  Eye,
  Send,
  Pause,
  Play,
  Ban,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Trash2,
  Archive,
  ArchiveRestore,
  EyeOff,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (local — mirrors the admin-early-access-campaigns contract).
// ---------------------------------------------------------------------------

type CampaignType = "launch" | "marketing";

type CampaignStatus =
  | "draft"
  | "queued"
  | "sending"
  | "waiting_quota"
  | "paused"
  | "completed"
  | "partially_failed"
  | "cancelled"
  | string;

interface BrevoSending {
  enabled: boolean;
  reason?: string;
}

interface Allowance {
  accountDailyCap: number | null;
  accountMonthlyCap: number | null;
  monthlyResetDay: number;
  marketingDailyCap: number;
  transactionalDailyReserve: number;
  transactionalMonthlyReserve: number;
  sentThisPeriod: number | null;
  configIssues: string[];
  source: string;
  sourceNote: string;
}

interface Quota {
  dailyCap: number;
  sentToday: number;
  remainingToday: number;
  brevoSending: BrevoSending;
  allowance?: Allowance;
}

interface CampaignProgress {
  total: number;
  sent: number;
  queued: number;
}

type CampaignAudience = "early_access" | "outreach";

interface Campaign {
  id: number;
  type: CampaignType | string;
  audience: CampaignAudience | string;
  name: string;
  subject: string;
  previewText: string;
  heading: string;
  bodyText: string;
  ctaLabel: string;
  ctaUrl: string;
  status: CampaignStatus;
  snapshotCount: number | null;
  queuedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CampaignListItem extends Campaign {
  progress: CampaignProgress;
}

interface CampaignListResponse {
  campaigns: CampaignListItem[];
  archivedCount: number;
  quota: Quota;
}

interface RecipientCounts {
  total: number;
  queued: number;
  sending: number;
  sent: number;
  delivered: number;
  failed: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  suppressed: number;
  cancelled: number;
}

interface CampaignBatch {
  id: number;
  campaignId: number;
  batchNumber: number;
  recipientCount: number;
  status: string;
  sentAt: string | null;
  statusDetail: string | null;
  createdAt: string;
}

interface CampaignEvent {
  id: number;
  campaignId: number;
  kind: string;
  performedBy: number | null;
  details: unknown;
  createdAt: string;
}

interface AudienceBreakdown {
  eligible: number;
  total: number;
  // Early Access breakdown fields.
  excludedConsentMissing?: number;
  excludedConfirmationPending?: number;
  excludedUnsubscribedOrSuppressed?: number;
  // Outreach breakdown fields.
  excludedBlocked?: number;
  excludedOnSuppressionList?: number;
  excludedEarlyAccessDuplicate?: number;
  excludedByLiveRecheck?: number;
}

interface CampaignDetailResponse {
  campaign: Campaign;
  recipients: RecipientCounts;
  batches: CampaignBatch[];
  events: CampaignEvent[];
  contentErrors: string[];
  audience?: AudienceBreakdown;
  quota: Quota;
  testSendsToday: number;
  testSendDailyLimit: number;
  testSendsTodayGlobal: number;
  testSendDailyLimitGlobal: number;
  orphanedBrevoLists: number;
}

interface CleanupResult {
  checked: number;
  deleted: number;
  skippedStillActive: number;
  failed: number;
  orphanedBrevoLists: number;
}

interface AudienceResponse {
  audience: AudienceBreakdown;
  audienceKind?: "early_access" | "outreach";
  dailyCap: number;
  estimatedDays: number | null;
  confirmationPhrase: string;
  quota: Quota;
}

interface BatchResult {
  ok: true;
  batchNumber: number;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  remaining: number;
  campaignStatus: string;
}

// ---------------------------------------------------------------------------
// Shared labels + badges.
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  launch: "Launch",
  marketing: "Marketing",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  queued: "Queued",
  sending: "Sending",
  waiting_quota: "Waiting for quota",
  waiting_rate_limit: "Waiting for rate-limit reset",
  needs_attention: "Needs attention",
  paused: "Paused",
  completed: "Completed",
  partially_failed: "Finished with failures",
  cancelled: "Cancelled",
};

const SOURCE_NOTE =
  "Local safety estimate — Brevo's dashboard remains the source of truth.";

const WAITING_QUOTA_EXPLAINER =
  "Daily/monthly email allowance reached (or Brevo refused for lack of credits). Nothing was lost — press 'Send next batch' when the allowance resets or after upgrading the plan.";

const RECOVERED_ASSUMED_SENT_NOTE =
  "Assumed sent — send request failed mid-flight; recipients were conservatively marked sent and will never be re-emailed. Verify in Brevo.";

const WAITING_RATE_LIMIT_EXPLAINER =
  "Brevo's API rate limit was hit — this is request throttling, NOT credit exhaustion. Retry in a few minutes with Send next batch.";

const NEEDS_ATTENTION_EXPLAINER =
  "Brevo rejected the campaign configuration or the API key. Fix the reported issue, then press Send next batch — automatic waiting will not fix this.";

const EVENT_LABELS: Record<string, string> = {
  CAMPAIGN_CREATED: "Campaign created",
  CAMPAIGN_UPDATED: "Content updated",
  TEST_SENT: "Test email sent",
  CAMPAIGN_QUEUED: "Campaign queued",
  CAMPAIGN_PAUSED: "Campaign paused",
  CAMPAIGN_RESUMED: "Campaign resumed",
  BATCH_SENT: "Batch sent",
  CAMPAIGN_CANCELLED: "Campaign cancelled",
  CAMPAIGN_COMPLETED: "Campaign completed",
  CAMPAIGN_ARCHIVED: "Campaign archived",
  CAMPAIGN_UNARCHIVED: "Campaign unarchived",
  CAMPAIGN_DELETED: "Draft deleted",
  RECIPIENTS_ANONYMISED: "Recipient data anonymised",
};

function ArchivedBadge() {
  return (
    <Badge
      variant="outline"
      className="bg-muted text-muted-foreground border-transparent font-medium"
      data-testid="badge-archived"
    >
      <EyeOff className="w-3 h-3 mr-1" /> Archived
    </Badge>
  );
}

function TypeBadge({ type }: { type: string }) {
  const isLaunch = type === "launch";
  const cls = isLaunch
    ? "bg-[hsl(var(--success-tint))] text-[hsl(var(--success))] border-transparent font-medium"
    : "bg-muted text-muted-foreground border-transparent font-medium";
  return (
    <Badge variant="outline" className={cls} data-testid={`badge-type-${type}`}>
      {TYPE_LABELS[type] ?? type}
    </Badge>
  );
}

const AUDIENCE_LABELS: Record<string, string> = {
  early_access: "Early Access",
  outreach: "Outreach",
};

function AudienceBadge({ audience }: { audience: string }) {
  const cls =
    audience === "outreach"
      ? "bg-[hsl(var(--warning-tint,var(--muted)))] text-[hsl(var(--warning,var(--foreground)))] border-transparent font-medium"
      : "bg-muted text-muted-foreground border-transparent font-medium";
  return (
    <Badge variant="outline" className={cls} data-testid={`badge-audience-${audience}`}>
      {AUDIENCE_LABELS[audience] ?? audience}
    </Badge>
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const successClass =
    "bg-[hsl(var(--success-tint))] text-[hsl(var(--success))] border-transparent font-medium";
  const mutedClass = "bg-muted text-muted-foreground border-transparent font-medium";
  const destructiveClass =
    "bg-[hsl(var(--destructive-tint))] text-[hsl(var(--destructive))] border-transparent font-medium";
  const warnClass =
    "bg-[hsl(var(--warning-tint,var(--muted)))] text-[hsl(var(--warning,var(--foreground)))] border-transparent font-medium";
  const infoClass =
    "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] border-transparent font-medium";

  let cls = mutedClass;
  if (status === "completed") cls = successClass;
  else if (status === "sending") cls = infoClass;
  else if (status === "queued") cls = infoClass;
  else if (status === "waiting_quota" || status === "waiting_rate_limit" || status === "paused") cls = warnClass;
  else if (status === "partially_failed" || status === "needs_attention") cls = destructiveClass;
  else if (status === "cancelled") cls = mutedClass;
  else if (status === "draft") cls = mutedClass;

  return (
    <Badge variant="outline" className={cls} data-testid={`badge-status-${status}`}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function QuotaBanner({ quota }: { quota: Quota | undefined }) {
  if (!quota) return null;
  const allowance = quota.allowance;
  const hasMonthlyCap = allowance != null && allowance.accountMonthlyCap !== null;
  return (
    <div className="space-y-2" data-testid="quota-banner">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
          Sending allowance — today
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Daily send cap" value={quota.dailyCap} testId="stat-daily-cap" />
          <StatCard label="Sent today" value={quota.sentToday} testId="stat-sent-today" />
          <StatCard label="Remaining today" value={quota.remainingToday} testId="stat-remaining-today" />
        </div>
      </div>

      {hasMonthlyCap && allowance && (
        <div data-testid="monthly-usage">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
            This billing month (resets on the {ordinal(allowance.monthlyResetDay)} of each month)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Monthly cap" value={allowance.accountMonthlyCap ?? undefined} testId="stat-monthly-cap" />
            <StatCard label="Sent this billing month" value={allowance.sentThisPeriod ?? undefined} testId="stat-sent-this-period" />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground" data-testid="quota-source-note">
        {allowance?.sourceNote ?? SOURCE_NOTE}
      </p>

      {allowance && allowance.configIssues.length > 0 && (
        <Alert
          className="border-transparent bg-[hsl(var(--warning-tint,var(--muted)))] text-[hsl(var(--warning,var(--foreground)))]"
          data-testid="notice-config-issues"
        >
          <AlertDescription>
            <div className="font-medium mb-1">Email allowance configuration problems</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {allowance.configIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {!quota.brevoSending.enabled && (
        <Alert
          className="border-transparent bg-[hsl(var(--warning-tint,var(--muted)))] text-[hsl(var(--warning,var(--foreground)))]"
          data-testid="notice-sending-disabled"
        >
          <AlertDescription>
            Real sending is disabled
            {quota.brevoSending.reason ? ` (${quota.brevoSending.reason})` : ""}.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List page.
// ---------------------------------------------------------------------------

export default function Campaigns() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newType, setNewType] = useState<CampaignType>("launch");
  const [newAudience, setNewAudience] = useState<CampaignAudience>("early_access");
  const [newName, setNewName] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "early-access", "campaigns", "list", { showArchived }],
    queryFn: () =>
      api<CampaignListResponse>(
        `/api/admin/early-access/campaigns${showArchived ? "?includeArchived=1" : ""}`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: (input: { type: CampaignType; audience: CampaignAudience; name: string }) =>
      api<{ campaign: Campaign }>("/api/admin/early-access/campaigns", {
        method: "POST",
        body: input,
      }),
    onSuccess: (res) => {
      setCreateOpen(false);
      setNewName("");
      queryClient.invalidateQueries({
        queryKey: ["admin", "early-access", "campaigns", "list"],
      });
      navigate(`/early-access/campaigns/${res.campaign.id}`);
    },
    onError: (err) => {
      toast({
        title: "Could not create campaign",
        description: err instanceof ApiError ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const campaigns = data?.campaigns ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/early-access")}
              data-testid="button-back-early-access"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Early Access
            </Button>
          </div>
          <h1 className="text-2xl font-semibold mt-1">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Launch &amp; marketing email campaigns to the early-access list.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(data?.archivedCount ?? 0) > 0 && (
            <Button
              variant="outline"
              onClick={() => setShowArchived((v) => !v)}
              data-testid="button-toggle-archived"
            >
              <Archive className="w-4 h-4 mr-1.5" />
              {showArchived
                ? "Hide archived"
                : `Show archived (${data?.archivedCount ?? 0})`}
            </Button>
          )}
          <Button onClick={() => setCreateOpen(true)} data-testid="button-new-campaign">
            <Plus className="w-4 h-4 mr-1.5" /> New campaign
          </Button>
        </div>
      </div>

      <QuotaBanner quota={data?.quota} />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof ApiError ? error.message : "Could not load campaigns."}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm" data-testid="empty-campaigns">
              No campaigns yet. Create one to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Name</th>
                    <th className="text-left px-4 py-2.5 font-medium">Type</th>
                    <th className="text-left px-4 py-2.5 font-medium">Audience</th>
                    <th className="text-left px-4 py-2.5 font-medium">Status</th>
                    <th className="text-left px-4 py-2.5 font-medium">Progress</th>
                    <th className="text-left px-4 py-2.5 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {campaigns.map((row) => (
                    <tr
                      key={row.id}
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => navigate(`/early-access/campaigns/${row.id}`)}
                      data-testid={`row-campaign-${row.id}`}
                    >
                      <td className="px-4 py-3 font-medium">
                        <span className="inline-flex items-center gap-2">
                          {row.name || "—"}
                          {row.archivedAt && <ArchivedBadge />}
                        </span>
                      </td>
                      <td className="px-4 py-3"><TypeBadge type={row.type} /></td>
                      <td className="px-4 py-3"><AudienceBadge audience={row.audience} /></td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-3 tabular-nums" data-testid={`progress-campaign-${row.id}`}>
                        {row.progress.sent} / {row.progress.total}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDate(row.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* New campaign dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!createMutation.isPending) setCreateOpen(open); }}>
        <DialogContent className={DARK_DIALOG_CLASS} style={DARK_DIALOG_STYLE} data-testid="dialog-new-campaign">
          <DialogHeader>
            <DialogTitle style={DARK_TITLE_STYLE}>New campaign</DialogTitle>
            <DialogDescription>
              Pick a type and an internal name. You can edit the content next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as CampaignType)}>
                <SelectTrigger data-testid="select-new-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="launch">Launch</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Audience</Label>
              <Select value={newAudience} onValueChange={(v) => setNewAudience(v as CampaignAudience)}>
                <SelectTrigger data-testid="select-new-audience"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="early_access">Early Access list</SelectItem>
                  <SelectItem value="outreach">Outreach contacts</SelectItem>
                </SelectContent>
              </Select>
              {newAudience === "outreach" && (
                <p className="text-xs text-muted-foreground">
                  Sends only to imported contacts with a valid lawful route. Eligibility is
                  re-checked at queue time and again before every batch.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-name">Internal name</Label>
              <Input
                id="new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Launch announcement — March"
                data-testid="input-new-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate({ type: newType, audience: newAudience, name: newName.trim() })}
              disabled={createMutation.isPending || !newName.trim()}
              data-testid="button-create-campaign"
            >
              <Rocket className="w-4 h-4 mr-1.5" />
              {createMutation.isPending ? "Creating…" : "Create campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail page.
// ---------------------------------------------------------------------------

const EDITOR_FIELDS = [
  "name",
  "subject",
  "previewText",
  "heading",
  "bodyText",
  "ctaLabel",
  "ctaUrl",
] as const;
type EditorField = (typeof EDITOR_FIELDS)[number];

function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

export function CampaignDetail({ id }: { id: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const detailKey = ["admin", "early-access", "campaigns", "detail", id];

  const { data, isLoading, error } = useQuery({
    queryKey: detailKey,
    queryFn: () =>
      api<CampaignDetailResponse>(`/api/admin/early-access/campaigns/${id}`),
  });

  const campaign = data?.campaign;
  const isDraft = campaign?.status === "draft";

  const [form, setForm] = useState<Record<EditorField, string>>({
    name: "",
    subject: "",
    previewText: "",
    heading: "",
    bodyText: "",
    ctaLabel: "",
    ctaUrl: "",
  });
  const [editorError, setEditorError] = useState<string | null>(null);

  // Seed the editor from the loaded campaign (once per campaign identity).
  useEffect(() => {
    if (!campaign) return;
    setForm({
      name: campaign.name ?? "",
      subject: campaign.subject ?? "",
      previewText: campaign.previewText ?? "",
      heading: campaign.heading ?? "",
      bodyText: campaign.bodyText ?? "",
      ctaLabel: campaign.ctaLabel ?? "",
      ctaUrl: campaign.ctaUrl ?? "",
    });
  }, [campaign?.id, campaign?.updatedAt]);

  const setField = (field: EditorField, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: detailKey });
    queryClient.invalidateQueries({
      queryKey: ["admin", "early-access", "campaigns", "list"],
    });
  };

  // ---- Save (PATCH) ----
  const saveMutation = useMutation({
    mutationFn: () =>
      api<{ campaign: Campaign }>(`/api/admin/early-access/campaigns/${id}`, {
        method: "PATCH",
        body: { ...form },
      }),
    onSuccess: () => {
      setEditorError(null);
      toast({ title: "Content saved" });
      invalidate();
    },
    onError: (err) => {
      const conflict = err instanceof ApiError && err.status === 409;
      setEditorError(apiErrorMessage(err));
      toast({
        title: conflict ? "No longer editable" : "Could not save",
        description: apiErrorMessage(err),
        variant: "destructive",
      });
      if (conflict) invalidate();
    },
  });

  // ---- Preview ----
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">("desktop");
  const previewMutation = useMutation({
    mutationFn: () =>
      api<{ html: string; text: string }>(
        `/api/admin/early-access/campaigns/${id}/preview`,
      ),
    onSuccess: (res) => {
      setPreviewHtml(res.html);
      setPreviewOpen(true);
    },
    onError: (err) => {
      toast({
        title: "Could not render preview",
        description: apiErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  // ---- Test send ----
  const testSendMutation = useMutation({
    mutationFn: () =>
      api<{ success: boolean; channel: string }>(
        `/api/admin/early-access/campaigns/${id}/test-send`,
        { method: "POST", body: {} },
      ),
    onSuccess: (res) => {
      toast({
        title: "Test email sent",
        description: `Delivered to you via ${res.channel}.`,
      });
      invalidate();
    },
    onError: (err) => {
      let description = apiErrorMessage(err);
      if (err instanceof ApiError && err.status === 429 && data) {
        const isGlobal = err.message.startsWith("Global test-send limit");
        description = isGlobal
          ? `${err.message} (${data.testSendsTodayGlobal}/${data.testSendDailyLimitGlobal} global today)`
          : `${err.message} (${data.testSendsToday}/${data.testSendDailyLimit} for this campaign today)`;
      }
      toast({
        title: "Test send failed",
        description,
        variant: "destructive",
      });
    },
  });

  // ---- Queue ----
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueAudience, setQueueAudience] = useState<AudienceResponse | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [queueError, setQueueError] = useState<string | null>(null);

  const loadAudienceMutation = useMutation({
    mutationFn: () =>
      api<AudienceResponse>(`/api/admin/early-access/campaigns/${id}/audience`),
    onSuccess: (res) => {
      setQueueAudience(res);
      setConfirmationText("");
      setQueueError(null);
      setQueueOpen(true);
    },
    onError: (err) => {
      toast({
        title: "Could not load audience",
        description: apiErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  const queueMutation = useMutation({
    mutationFn: () =>
      api<{ success: boolean; snapshotCount: number }>(
        `/api/admin/early-access/campaigns/${id}/queue`,
        { method: "POST", body: { confirmation: confirmationText } },
      ),
    onSuccess: (res) => {
      setQueueOpen(false);
      toast({
        title: "Campaign queued",
        description: `${res.snapshotCount} recipients snapshotted.`,
      });
      invalidate();
    },
    onError: async (err) => {
      const message = apiErrorMessage(err);
      setQueueError(message);
      // 409 = phrase mismatch / audience changed → refetch fresh numbers.
      if (err instanceof ApiError && err.status === 409) {
        try {
          const fresh = await api<AudienceResponse>(
            `/api/admin/early-access/campaigns/${id}/audience`,
          );
          setQueueAudience(fresh);
          setConfirmationText("");
        } catch {
          /* keep the dialog open with the error */
        }
      }
    },
  });

  // ---- Batch + lifecycle ----
  const batchMutation = useMutation({
    mutationFn: () =>
      api<BatchResult>(`/api/admin/early-access/campaigns/${id}/send-batch`, {
        method: "POST",
        body: {},
      }),
    onSuccess: (res) => {
      toast({
        title: `Batch ${res.batchNumber} sent`,
        description: `Sent ${res.sent}, skipped ${res.skipped}, failed ${res.failed}. ${res.remaining} remaining. Status: ${STATUS_LABELS[res.campaignStatus] ?? res.campaignStatus}.`,
      });
      invalidate();
    },
    onError: (err) => {
      let title = "Batch send failed";
      let description = apiErrorMessage(err);
      if (err instanceof ApiError) {
        const code =
          err.details && typeof err.details === "object" && "code" in err.details
            ? String((err.details as { code: unknown }).code)
            : undefined;
        const verbatimCodes = [
          "brevo_credits",
          "brevo_rate_limited",
          "brevo_auth",
          "brevo_invalid",
        ];
        if (code && verbatimCodes.includes(code)) {
          // Brevo rejected the send (credits / rate limit / auth / invalid config)
          // — nothing sent, queue preserved. Show the server's message verbatim.
          title = "Brevo rejected the send";
          description =
            err.details && typeof err.details === "object" && "message" in err.details
              ? String((err.details as { message: unknown }).message)
              : err.message;
        } else if (err.status === 429) {
          title = "Daily quota exhausted";
          description = "Daily quota exhausted — continue tomorrow.";
        }
        // 502 (brevo_error / needs_recovery_review) → verbatim server message
        // contains recovery guidance; keep description as err.message.
      }
      toast({ title, description, variant: "destructive" });
      invalidate();
    },
  });

  const lifecycleMutation = useMutation({
    mutationFn: (action: "pause" | "resume") =>
      api<{ campaign: Campaign }>(
        `/api/admin/early-access/campaigns/${id}/${action}`,
        { method: "POST", body: {} },
      ),
    onSuccess: (_res, action) => {
      toast({ title: action === "pause" ? "Campaign paused" : "Campaign resumed" });
      invalidate();
    },
    onError: (err) => {
      toast({
        title: "Action failed",
        description: apiErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  const [cancelOpen, setCancelOpen] = useState(false);
  const cancelMutation = useMutation({
    mutationFn: () =>
      api<{ success: boolean; cancelledRecipients: number }>(
        `/api/admin/early-access/campaigns/${id}/cancel`,
        { method: "POST", body: {} },
      ),
    onSuccess: (res) => {
      setCancelOpen(false);
      toast({
        title: "Campaign cancelled",
        description: `${res.cancelledRecipients} queued recipients cancelled.`,
      });
      invalidate();
    },
    onError: (err) => {
      setCancelOpen(false);
      toast({
        title: "Could not cancel",
        description: apiErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  // ---- Retention lifecycle: delete draft / archive / anonymise ----
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () =>
      api<{ success: boolean }>(`/api/admin/early-access/campaigns/${id}`, {
        method: "DELETE",
        body: {},
      }),
    onSuccess: () => {
      setDeleteOpen(false);
      toast({ title: "Draft deleted" });
      queryClient.invalidateQueries({
        queryKey: ["admin", "early-access", "campaigns", "list"],
      });
      navigate("/early-access/campaigns");
    },
    onError: (err) => {
      setDeleteOpen(false);
      toast({
        title: "Could not delete draft",
        description: apiErrorMessage(err),
        variant: "destructive",
      });
      invalidate();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (action: "archive" | "unarchive") =>
      api<{ campaign: Campaign }>(
        `/api/admin/early-access/campaigns/${id}/${action}`,
        { method: "POST", body: {} },
      ),
    onSuccess: (_res, action) => {
      toast({
        title: action === "archive" ? "Campaign archived" : "Campaign unarchived",
        description:
          action === "archive"
            ? "Hidden from the campaign list. Audit history, delivery statistics and suppression records are fully preserved."
            : undefined,
      });
      invalidate();
    },
    onError: (err) => {
      toast({
        title: "Action failed",
        description: apiErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  const [anonymiseOpen, setAnonymiseOpen] = useState(false);
  const anonymiseMutation = useMutation({
    mutationFn: () =>
      api<{ success: boolean; anonymised: number }>(
        `/api/admin/early-access/campaigns/${id}/anonymise-recipients`,
        { method: "POST", body: {} },
      ),
    onSuccess: (res) => {
      setAnonymiseOpen(false);
      toast({
        title: "Recipient data anonymised",
        description:
          res.anonymised > 0
            ? `${res.anonymised} recipient record(s) stripped of personal data. Aggregate statistics kept.`
            : "Nothing left to anonymise — recipient data was already removed.",
      });
      invalidate();
    },
    onError: (err) => {
      setAnonymiseOpen(false);
      toast({
        title: "Could not anonymise",
        description: apiErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  // ---- Retry Brevo cleanup ----
  const cleanupMutation = useMutation({
    mutationFn: () =>
      api<CleanupResult>(`/api/admin/early-access/campaigns/${id}/cleanup`, {
        method: "POST",
        body: {},
      }),
    onSuccess: (res) => {
      toast({
        title: "Brevo cleanup complete",
        description: `Checked ${res.checked}, deleted ${res.deleted}, still active ${res.skippedStillActive}, failed ${res.failed}. ${res.orphanedBrevoLists} orphaned list(s) remain.`,
      });
      invalidate();
    },
    onError: (err) => {
      const disabled = err instanceof ApiError && err.status === 409;
      toast({
        title: disabled ? "Cleanup unavailable" : "Cleanup failed",
        description: apiErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  const status = campaign?.status ?? "";
  const canQueue = status === "draft";
  const showSendingControls =
    status === "queued" ||
    status === "waiting_quota" ||
    status === "waiting_rate_limit" ||
    status === "needs_attention" ||
    status === "sending" ||
    status === "paused";
  const canPause =
    status === "queued" ||
    status === "waiting_quota" ||
    status === "waiting_rate_limit" ||
    status === "needs_attention";
  const canResume = status === "paused";
  const canSendBatch =
    status === "queued" ||
    status === "waiting_quota" ||
    status === "waiting_rate_limit" ||
    status === "needs_attention" ||
    status === "sending";
  const isTerminal =
    status === "completed" || status === "partially_failed" || status === "cancelled";
  // Hard delete is offered only for never-queued drafts with no snapshot and
  // no send activity (test emails count) — mirrors the server rule, which
  // re-verifies all of it inside the delete transaction.
  const hasSendActivity = (data?.events ?? []).some((ev) => ev.kind === "TEST_SENT");
  const canDelete =
    status === "draft" &&
    !campaign?.queuedAt &&
    (data?.recipients.total ?? 0) === 0 &&
    !hasSendActivity;
  const isArchived = !!campaign?.archivedAt;

  const confirmationPhrase = queueAudience?.confirmationPhrase ?? "";
  const phraseMatches = confirmationText === confirmationPhrase && !!confirmationPhrase;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/early-access/campaigns")} data-testid="button-back-list">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Campaigns
        </Button>
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof ApiError ? error.message : "Campaign not found."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const recipients = data.recipients;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/early-access/campaigns")} data-testid="button-back-list">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Campaigns
          </Button>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <h1 className="text-2xl font-semibold" data-testid="text-campaign-name">{campaign.name}</h1>
            <TypeBadge type={campaign.type} />
            <AudienceBadge audience={campaign.audience} />
            <StatusBadge status={campaign.status} />
            {isArchived && <ArchivedBadge />}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canDelete && (
            <Button
              variant="outline"
              className="text-[hsl(var(--destructive))]"
              onClick={() => setDeleteOpen(true)}
              data-testid="button-delete-draft"
            >
              <Trash2 className="w-4 h-4 mr-1.5" /> Delete draft
            </Button>
          )}
          {isTerminal && !isArchived && (
            <Button
              variant="outline"
              onClick={() => archiveMutation.mutate("archive")}
              disabled={archiveMutation.isPending}
              data-testid="button-archive"
            >
              <Archive className="w-4 h-4 mr-1.5" /> Archive campaign
            </Button>
          )}
          {isArchived && (
            <Button
              variant="outline"
              onClick={() => archiveMutation.mutate("unarchive")}
              disabled={archiveMutation.isPending}
              data-testid="button-unarchive"
            >
              <ArchiveRestore className="w-4 h-4 mr-1.5" /> Unarchive
            </Button>
          )}
        </div>
      </div>

      <QuotaBanner quota={data.quota} />

      {campaign.status === "waiting_quota" && (
        <Alert
          className="border-transparent bg-[hsl(var(--warning-tint,var(--muted)))] text-[hsl(var(--warning,var(--foreground)))]"
          data-testid="notice-waiting-quota"
        >
          <AlertDescription>{WAITING_QUOTA_EXPLAINER}</AlertDescription>
        </Alert>
      )}

      {campaign.status === "waiting_rate_limit" && (
        <Alert
          className="border-transparent bg-[hsl(var(--warning-tint,var(--muted)))] text-[hsl(var(--warning,var(--foreground)))]"
          data-testid="notice-waiting-rate-limit"
        >
          <AlertDescription>{WAITING_RATE_LIMIT_EXPLAINER}</AlertDescription>
        </Alert>
      )}

      {campaign.status === "needs_attention" && (
        <Alert variant="destructive" data-testid="notice-needs-attention">
          <AlertDescription>
            <div>{NEEDS_ATTENTION_EXPLAINER}</div>
            {(() => {
              const lastFailed = [...data.batches]
                .reverse()
                .find((b) => b.status === "failed" && b.statusDetail);
              if (!lastFailed?.statusDetail) return null;
              return (
                <div className="mt-2">
                  <div className="text-xs font-medium uppercase tracking-wide mb-1">
                    Brevo's reason
                  </div>
                  <pre
                    className="text-xs font-mono whitespace-pre-wrap bg-[hsl(var(--muted))] text-muted-foreground rounded px-2 py-1.5"
                    data-testid="needs-attention-reason"
                  >
                    {lastFailed.statusDetail}
                  </pre>
                </div>
              );
            })()}
          </AlertDescription>
        </Alert>
      )}

      {data.orphanedBrevoLists > 0 && (
        <Alert
          className="border-transparent bg-[hsl(var(--warning-tint,var(--muted)))] text-[hsl(var(--warning,var(--foreground)))]"
          data-testid="notice-orphaned-lists"
        >
          <AlertDescription>
            <div className="font-medium mb-1">
              {data.orphanedBrevoLists} temporary Brevo contact list(s) could not be deleted
            </div>
            <p className="mb-2">
              Temporary lists from finished batches remained after repeated delete attempts. This does
              not affect recipients. Use “Retry Brevo cleanup” below, and check the Brevo dashboard if
              they persist.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => cleanupMutation.mutate()}
              disabled={cleanupMutation.isPending}
              data-testid="button-cleanup-orphaned"
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              {cleanupMutation.isPending ? "Cleaning…" : "Retry Brevo cleanup"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Content errors checklist */}
      {data.contentErrors.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-semibold mb-2">Before you can send</div>
            <ul className="space-y-1" data-testid="content-errors">
              {data.contentErrors.map((err) => (
                <li key={err} className="flex items-center gap-2 text-sm text-[hsl(var(--warning,var(--foreground)))]">
                  <XCircle className="w-4 h-4 shrink-0" /> {err}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Editor */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-base font-semibold">Content</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending}
                data-testid="button-preview"
              >
                <Eye className="w-4 h-4 mr-1.5" />
                {previewMutation.isPending ? "Rendering…" : "Preview"}
              </Button>
              {isDraft && (
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  data-testid="button-save-content"
                >
                  {saveMutation.isPending ? "Saving…" : "Save content"}
                </Button>
              )}
            </div>
          </div>

          {editorError && (
            <Alert variant="destructive" data-testid="editor-error">
              <AlertDescription>{editorError}</AlertDescription>
            </Alert>
          )}

          {!isDraft && (
            <p className="text-xs text-muted-foreground">
              Content is read-only — it becomes immutable once the campaign is queued.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="f-name">Internal name</Label>
              <Input id="f-name" value={form.name} disabled={!isDraft} onChange={(e) => setField("name", e.target.value)} data-testid="input-name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-subject">Subject</Label>
              <Input id="f-subject" value={form.subject} disabled={!isDraft} onChange={(e) => setField("subject", e.target.value)} data-testid="input-subject" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-preview">Preview text</Label>
              <Input id="f-preview" value={form.previewText} disabled={!isDraft} onChange={(e) => setField("previewText", e.target.value)} data-testid="input-preview-text" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-heading">Heading</Label>
              <Input id="f-heading" value={form.heading} disabled={!isDraft} onChange={(e) => setField("heading", e.target.value)} data-testid="input-heading" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="f-body">Message body</Label>
              <Textarea id="f-body" rows={6} value={form.bodyText} disabled={!isDraft} onChange={(e) => setField("bodyText", e.target.value)} data-testid="input-body-text" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-cta-label">CTA label</Label>
              <Input id="f-cta-label" value={form.ctaLabel} disabled={!isDraft} onChange={(e) => setField("ctaLabel", e.target.value)} data-testid="input-cta-label" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-cta-url">CTA URL</Label>
              <Input id="f-cta-url" value={form.ctaUrl} disabled={!isDraft} onChange={(e) => setField("ctaUrl", e.target.value)} placeholder="https://…" data-testid="input-cta-url" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Test send */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-base font-semibold">Test send</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => testSendMutation.mutate()}
              disabled={testSendMutation.isPending}
              data-testid="button-test-send"
            >
              <Send className="w-4 h-4 mr-1.5" />
              {testSendMutation.isPending ? "Sending…" : "Send test to me"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="test-send-note">
            Sends to your admin email only. Counts toward the daily send quota. Limit {data.testSendDailyLimit}/day per campaign
            {" "}({data.testSendsToday} used today).
          </p>
          <p className="text-xs text-muted-foreground" data-testid="test-send-note-global">
            Global today (all campaigns/admins): {data.testSendsTodayGlobal}/{data.testSendDailyLimitGlobal} used.
          </p>
        </CardContent>
      </Card>

      {/* Queue (draft only) */}
      {canQueue && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-base font-semibold">Queue campaign</h2>
                <p className="text-xs text-muted-foreground">
                  Snapshots the eligible audience and starts the sending workflow.
                </p>
              </div>
              <Button
                onClick={() => loadAudienceMutation.mutate()}
                disabled={loadAudienceMutation.isPending || data.contentErrors.length > 0}
                data-testid="button-open-queue"
              >
                <PlayCircle className="w-4 h-4 mr-1.5" />
                {loadAudienceMutation.isPending ? "Loading…" : "Queue campaign"}
              </Button>
            </div>
            {data.audience && (
              <div className="text-xs text-muted-foreground" data-testid="audience-preview">
                {data.audience.eligible} eligible of {data.audience.total}{" "}
                {campaign.audience === "outreach" ? "outreach contacts" : "registrations"}.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sending controls */}
      {showSendingControls && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="text-base font-semibold">Sending controls</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => batchMutation.mutate()}
                disabled={!canSendBatch || batchMutation.isPending}
                data-testid="button-send-batch"
              >
                <Send className="w-4 h-4 mr-1.5" />
                {batchMutation.isPending ? "Sending…" : "Send next batch"}
              </Button>
              {canPause && (
                <Button
                  variant="outline"
                  onClick={() => lifecycleMutation.mutate("pause")}
                  disabled={lifecycleMutation.isPending}
                  data-testid="button-pause"
                >
                  <Pause className="w-4 h-4 mr-1.5" /> Pause
                </Button>
              )}
              {canResume && (
                <Button
                  variant="outline"
                  onClick={() => lifecycleMutation.mutate("resume")}
                  disabled={lifecycleMutation.isPending}
                  data-testid="button-resume"
                >
                  <Play className="w-4 h-4 mr-1.5" /> Resume
                </Button>
              )}
              <Button
                variant="outline"
                className="text-[hsl(var(--destructive))]"
                onClick={() => setCancelOpen(true)}
                data-testid="button-cancel"
              >
                <Ban className="w-4 h-4 mr-1.5" /> Cancel remaining
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delivery summary */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <h2 className="text-base font-semibold">Delivery summary</h2>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3" data-testid="recipient-counts">
            <StatCard label="Queued" value={recipients.queued} testId="stat-r-queued" />
            <StatCard label="Sent" value={recipients.sent} testId="stat-r-sent" />
            <StatCard label="Delivered" value={recipients.delivered} testId="stat-r-delivered" />
            <StatCard label="Failed" value={recipients.failed} testId="stat-r-failed" />
            <StatCard label="Bounced" value={recipients.bounced} testId="stat-r-bounced" />
            <StatCard label="Complained" value={recipients.complained} testId="stat-r-complained" />
            <StatCard label="Unsubscribed" value={recipients.unsubscribed} testId="stat-r-unsubscribed" />
            <StatCard label="Suppressed" value={recipients.suppressed} testId="stat-r-suppressed" />
            <StatCard label="Cancelled" value={recipients.cancelled} testId="stat-r-cancelled" />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold">Batches</h3>
              {data.batches.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cleanupMutation.mutate()}
                  disabled={cleanupMutation.isPending}
                  data-testid="button-cleanup"
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  {cleanupMutation.isPending ? "Cleaning…" : "Retry Brevo cleanup"}
                </Button>
              )}
            </div>
            {data.batches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No batches sent yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">#</th>
                      <th className="text-left px-3 py-2 font-medium">Recipients</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                      <th className="text-left px-3 py-2 font-medium">Sent at</th>
                      <th className="text-left px-3 py-2 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.batches.map((batch) => {
                      const assumedSent = batch.statusDetail === "recovered_assumed_sent";
                      return (
                        <tr key={batch.id} data-testid={`row-batch-${batch.batchNumber}`}>
                          <td className="px-3 py-2 tabular-nums">{batch.batchNumber}</td>
                          <td className="px-3 py-2 tabular-nums">{batch.recipientCount}</td>
                          <td className="px-3 py-2">{batch.status}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{formatDateTime(batch.sentAt)}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {assumedSent ? (
                              <span
                                className="text-[hsl(var(--warning,var(--foreground)))]"
                                data-testid={`batch-assumed-sent-${batch.batchNumber}`}
                              >
                                {RECOVERED_ASSUMED_SENT_NOTE}
                              </span>
                            ) : (
                              batch.statusDetail || "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {isTerminal && recipients.total > 0 && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2" data-testid="retention-card">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="text-sm font-semibold">Data retention</div>
                  <p className="text-xs text-muted-foreground max-w-prose">
                    Per the retention schedule, recipient personal data (emails and names) can be
                    anonymised once it is no longer needed. Delivery statistics, the audit trail and
                    all suppression/unsubscribe records are kept. This cannot be undone.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAnonymiseOpen(true)}
                  disabled={anonymiseMutation.isPending}
                  data-testid="button-anonymise"
                >
                  <EyeOff className="w-4 h-4 mr-1.5" /> Anonymise recipient data
                </Button>
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold mb-2">Activity</h3>
            {data.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity recorded.</p>
            ) : (
              <ul className="space-y-2" data-testid="event-list">
                {data.events.map((ev) => (
                  <li key={ev.id} className="rounded-md border bg-muted/40 p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-sm font-medium">{EVENT_LABELS[ev.kind] ?? ev.kind}</span>
                      <span className="text-xs text-muted-foreground">{formatDateTime(ev.createdAt)}</span>
                    </div>
                    <EventDetails details={ev.details} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className={`max-w-3xl max-h-[85vh] overflow-y-auto ${DARK_DIALOG_CLASS}`} style={DARK_DIALOG_STYLE} data-testid="dialog-preview">
          <DialogHeader>
            <DialogTitle style={DARK_TITLE_STYLE}>Email preview</DialogTitle>
            <DialogDescription>
              Rendered with sample recipient values, using the exact production email renderer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={previewWidth === "desktop" ? "default" : "outline"}
              onClick={() => setPreviewWidth("desktop")}
              data-testid="button-preview-desktop"
            >
              Desktop
            </Button>
            <Button
              type="button"
              size="sm"
              variant={previewWidth === "mobile" ? "default" : "outline"}
              onClick={() => setPreviewWidth("mobile")}
              data-testid="button-preview-mobile"
            >
              Mobile
            </Button>
          </div>
          {previewHtml != null && (
            <div className="flex justify-center">
              <iframe
                title="Campaign email preview"
                srcDoc={previewHtml}
                sandbox=""
                style={{ width: previewWidth === "mobile" ? 375 : "100%" }}
                className="h-[60vh] rounded-md border bg-white"
                data-testid="preview-frame"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Queue confirmation dialog */}
      <Dialog open={queueOpen} onOpenChange={(open) => { if (!queueMutation.isPending) setQueueOpen(open); }}>
        <DialogContent className={`max-w-lg max-h-[85vh] overflow-y-auto ${DARK_DIALOG_CLASS}`} style={DARK_DIALOG_STYLE} data-testid="dialog-queue">
          <DialogHeader>
            <DialogTitle style={DARK_TITLE_STYLE}>Queue this campaign?</DialogTitle>
            <DialogDescription>
              Review the audience carefully — the recipient snapshot is fixed when you queue.
            </DialogDescription>
          </DialogHeader>
          {queueAudience && (
            <div className="space-y-4 text-foreground">
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-sm">
                <SummaryRow label="Type" value={TYPE_LABELS[campaign.type] ?? campaign.type} />
                <SummaryRow label="Audience" value={AUDIENCE_LABELS[campaign.audience] ?? campaign.audience} />
                <SummaryRow label="Subject" value={campaign.subject || "—"} />
                <SummaryRow label="Preview text" value={campaign.previewText || "—"} />
                <SummaryRow label="CTA" value={`${campaign.ctaLabel || "—"} → ${campaign.ctaUrl || "—"}`} />
              </div>

              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between font-semibold text-foreground">
                  <span>Eligible recipients</span>
                  <span className="tabular-nums" data-testid="queue-eligible">{queueAudience.audience.eligible}</span>
                </div>
                {queueAudience.audienceKind === "outreach" ? (
                  <>
                    <SummaryRow label="Blocked (no lawful route)" value={String(queueAudience.audience.excludedBlocked ?? 0)} />
                    <SummaryRow label="Unsubscribed or suppressed" value={String(queueAudience.audience.excludedUnsubscribedOrSuppressed ?? 0)} />
                    <SummaryRow label="On permanent suppression list" value={String(queueAudience.audience.excludedOnSuppressionList ?? 0)} />
                    <SummaryRow label="Already on Early Access list" value={String(queueAudience.audience.excludedEarlyAccessDuplicate ?? 0)} />
                    <SummaryRow label="Failed live evidence re-check" value={String(queueAudience.audience.excludedByLiveRecheck ?? 0)} />
                  </>
                ) : (
                  <>
                    <SummaryRow label="No consent for this email type" value={String(queueAudience.audience.excludedConsentMissing ?? 0)} />
                    <SummaryRow label="Confirmation still pending" value={String(queueAudience.audience.excludedConfirmationPending ?? 0)} />
                    <SummaryRow label="Unsubscribed or suppressed" value={String(queueAudience.audience.excludedUnsubscribedOrSuppressed ?? 0)} />
                  </>
                )}
                <div className="border-t border-border pt-2">
                  <SummaryRow label="Daily cap" value={String(queueAudience.dailyCap)} />
                  <SummaryRow
                    label="Estimated sending days"
                    value={queueAudience.estimatedDays == null ? "—" : String(queueAudience.estimatedDays)}
                  />
                </div>
              </div>

              {queueError && (
                <Alert variant="destructive" data-testid="queue-error">
                  <AlertDescription>{queueError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="queue-confirm" className="text-foreground">
                  Type <span className="font-mono font-semibold">{confirmationPhrase}</span> to confirm
                </Label>
                <Input
                  id="queue-confirm"
                  value={confirmationText}
                  onChange={(e) => setConfirmationText(e.target.value)}
                  placeholder={confirmationPhrase}
                  data-testid="input-confirmation"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setQueueOpen(false)} disabled={queueMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => queueMutation.mutate()}
              disabled={!phraseMatches || queueMutation.isPending}
              data-testid="button-confirm-queue"
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              {queueMutation.isPending ? "Queueing…" : "Queue campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation */}
      <AlertDialog open={cancelOpen} onOpenChange={(open) => { if (!cancelMutation.isPending) setCancelOpen(open); }}>
        <AlertDialogContent data-testid="dialog-cancel">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel remaining recipients?</AlertDialogTitle>
            <AlertDialogDescription>
              All queued recipients will be cancelled and the campaign stopped. Recipients already sent
              are unaffected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>Keep sending</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); cancelMutation.mutate(); }}
              disabled={cancelMutation.isPending}
              data-testid="button-confirm-cancel"
            >
              {cancelMutation.isPending ? "Cancelling…" : "Cancel campaign"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete draft confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={(open) => { if (!deleteMutation.isPending) setDeleteOpen(open); }}>
        <AlertDialogContent data-testid="dialog-delete-draft">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This draft was never queued and has no recipients, so it can be permanently deleted.
              An audit record of the deletion is kept. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); deleteMutation.mutate(); }}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Anonymise recipients confirmation */}
      <AlertDialog open={anonymiseOpen} onOpenChange={(open) => { if (!anonymiseMutation.isPending) setAnonymiseOpen(open); }}>
        <AlertDialogContent data-testid="dialog-anonymise">
          <AlertDialogHeader>
            <AlertDialogTitle>Anonymise recipient data?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes recipient emails and names from this campaign's snapshot and unlinks them from
              contacts/registrations. Delivery statistics and the audit trail are kept. Suppression,
              unsubscribe, complaint and consent records are not touched. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={anonymiseMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); anonymiseMutation.mutate(); }}
              disabled={anonymiseMutation.isPending}
              data-testid="button-confirm-anonymise"
            >
              {anonymiseMutation.isPending ? "Anonymising…" : "Anonymise"}
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground text-right break-words">{value}</span>
    </div>
  );
}

function EventDetails({ details }: { details: unknown }) {
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
