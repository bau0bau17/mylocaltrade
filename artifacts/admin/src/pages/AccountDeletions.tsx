import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatDate } from "@/lib/format";
import { Trash2, ChevronDown, ChevronRight, Search } from "lucide-react";

interface DeletionRow {
  id: number;
  email: string;
  fullName: string;
  role: string;
  deletionStatus: string;
  deletionRequestedAt: string | null;
  deletionReason: string | null;
  deletionProcessedAt: string | null;
  retentionUntil: string | null;
  retentionReason: string | null;
  anonymisedAt: string | null;
  accountDisabledAt: string | null;
  adminDeletionNotes: string | null;
  processedByAdminId: number | null;
}

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "REQUESTED", label: "Requested" },
  { value: "DISABLED_PENDING_RETENTION", label: "Retention" },
  { value: "ANONYMISED", label: "Anonymised" },
  { value: "COMPLETED", label: "Completed" },
] as const;

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "REQUESTED") return "destructive";
  if (status === "DISABLED_PENDING_RETENTION") return "secondary";
  if (status === "ANONYMISED") return "outline";
  return "default";
}

export default function AccountDeletionsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "account-deletions", statusFilter, search],
    queryFn: () =>
      api<{ items: DeletionRow[]; total: number }>("/api/admin/account-deletions", {
        query: {
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
        },
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Trash2 className="w-5 h-5" /> Account deletions
          </h1>
          <p className="text-sm text-muted-foreground">
            GDPR / right-to-be-forgotten queue. Users in this list are already locked out and (if traders) hidden
            from public listings.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {STATUS_TABS.map((t) => (
          <Button
            key={t.value || "all"}
            size="sm"
            variant={statusFilter === t.value ? "default" : "outline"}
            onClick={() => setStatusFilter(t.value)}
          >
            {t.label}
          </Button>
        ))}
        <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search email or name"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{data ? `${data.items.length} accounts` : "Loading…"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : data?.items.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No accounts match this filter.
            </div>
          ) : (
            <div className="divide-y">
              {data?.items.map((row) => (
                <DeletionRowItem
                  key={row.id}
                  row={row}
                  expanded={expandedId === row.id}
                  onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  onChanged={() =>
                    qc.invalidateQueries({ queryKey: ["admin", "account-deletions"] })
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DeletionRowItem({
  row,
  expanded,
  onToggle,
  onChanged,
}: {
  row: DeletionRow;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 text-left"
      >
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{row.fullName}</span>
            <Badge variant="outline" className="text-[10px]">
              {row.role}
            </Badge>
            <Badge variant={statusBadgeVariant(row.deletionStatus)} className="text-[10px]">
              {row.deletionStatus}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground truncate">{row.email}</div>
        </div>
        <div className="text-xs text-muted-foreground hidden sm:block">
          {row.deletionRequestedAt ? formatDate(row.deletionRequestedAt) : "—"}
        </div>
      </button>
      {expanded && (
        <DeletionDetail userId={row.id} status={row.deletionStatus} onChanged={onChanged} />
      )}
    </div>
  );
}

interface DetailResponse {
  user: {
    id: number;
    email: string;
    fullName: string;
    role: string;
    deletionStatus: string;
    deletionRequestedAt: string | null;
    deletionReason: string | null;
    retentionUntil: string | null;
    retentionReason: string | null;
    anonymisedAt: string | null;
    deletionProcessedAt: string | null;
    accountDisabledAt: string | null;
    adminDeletionNotes: string | null;
  };
  traderProfile: {
    id: number;
    businessName: string;
    town: string;
    postcode: string;
    isActive: boolean;
    verificationStatus: string;
  } | null;
  recentAudit: Array<{
    id: number;
    action: string;
    notes: string | null;
    createdAt: string;
  }>;
}

function DeletionDetail({
  userId,
  status,
  onChanged,
}: {
  userId: number;
  status: string;
  onChanged: () => void;
}) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "account-deletions", userId, "detail"],
    queryFn: () => api<DetailResponse>(`/api/admin/account-deletions/${userId}`),
  });

  const [notes, setNotes] = useState("");
  const [retentionReason, setRetentionReason] = useState("");
  const [retentionUntil, setRetentionUntil] = useState("");

  const retainMut = useMutation({
    mutationFn: (body: { retentionReason: string; retentionUntil?: string | null; notes?: string }) =>
      api(`/api/admin/account-deletions/${userId}/retain`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      onChanged();
      refetch();
    },
  });

  const anonymiseMut = useMutation({
    mutationFn: (body: { notes?: string }) =>
      api(`/api/admin/account-deletions/${userId}/anonymise`, { method: "POST", body }),
    onSuccess: () => {
      onChanged();
      refetch();
    },
  });

  const completeMut = useMutation({
    mutationFn: () =>
      api(`/api/admin/account-deletions/${userId}/complete`, { method: "POST", body: {} }),
    onSuccess: () => {
      onChanged();
      refetch();
    },
  });

  const notesMut = useMutation({
    mutationFn: (text: string) =>
      api(`/api/admin/account-deletions/${userId}/notes`, {
        method: "POST",
        body: { notes: text },
      }),
    onSuccess: () => {
      onChanged();
      refetch();
    },
  });

  if (isLoading) {
    return (
      <div className="p-4">
        <Skeleton className="h-32" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!data) return null;

  const u = data.user;
  const completed = u.deletionStatus === "COMPLETED";
  const anonymised = u.deletionStatus === "ANONYMISED" || completed;

  return (
    <div className="bg-muted/30 px-4 py-4 space-y-4 text-sm">
      <div className="grid sm:grid-cols-2 gap-4">
        <DetailField label="Status" value={u.deletionStatus} />
        <DetailField label="Role" value={u.role} />
        <DetailField label="Requested at" value={u.deletionRequestedAt ? formatDate(u.deletionRequestedAt) : "—"} />
        <DetailField label="Disabled at" value={u.accountDisabledAt ? formatDate(u.accountDisabledAt) : "—"} />
        <DetailField label="Anonymised at" value={u.anonymisedAt ? formatDate(u.anonymisedAt) : "—"} />
        <DetailField label="Completed at" value={u.deletionProcessedAt ? formatDate(u.deletionProcessedAt) : "—"} />
        {u.retentionUntil && (
          <DetailField label="Retention until" value={formatDate(u.retentionUntil)} />
        )}
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wide">Reason given by user</Label>
        <div className="mt-1 rounded-md border bg-background p-3 text-sm whitespace-pre-wrap">
          {u.deletionReason || <span className="text-muted-foreground">(none)</span>}
        </div>
      </div>

      {u.retentionReason && (
        <div>
          <Label className="text-xs uppercase tracking-wide">Retention reason</Label>
          <div className="mt-1 rounded-md border bg-background p-3 text-sm whitespace-pre-wrap">
            {u.retentionReason}
          </div>
        </div>
      )}

      {data.traderProfile && (
        <div>
          <Label className="text-xs uppercase tracking-wide">Trader profile</Label>
          <div className="mt-1 rounded-md border bg-background p-3 text-sm">
            <div className="font-medium">{data.traderProfile.businessName}</div>
            <div className="text-muted-foreground text-xs">
              {data.traderProfile.town}, {data.traderProfile.postcode} ·{" "}
              {data.traderProfile.verificationStatus} ·{" "}
              {data.traderProfile.isActive ? "ACTIVE" : "HIDDEN"}
            </div>
          </div>
        </div>
      )}

      <div>
        <Label className="text-xs uppercase tracking-wide">Admin notes</Label>
        <Textarea
          className="mt-1"
          rows={3}
          placeholder="Internal notes (visible to admins only)"
          defaultValue={u.adminDeletionNotes ?? ""}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== (u.adminDeletionNotes ?? "")) notesMut.mutate(v);
          }}
        />
      </div>

      {!completed && !anonymised && (
        <div className="rounded-md border bg-background p-3 space-y-2">
          <Label className="text-xs uppercase tracking-wide">Apply legal-retention hold</Label>
          <Input
            placeholder="Retention reason (required)"
            value={retentionReason}
            onChange={(e) => setRetentionReason(e.target.value)}
          />
          <Input
            type="datetime-local"
            placeholder="Retention until (optional)"
            value={retentionUntil}
            onChange={(e) => setRetentionUntil(e.target.value)}
          />
          <Input
            placeholder="Internal notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={retentionReason.trim().length < 3 || retainMut.isPending}
            onClick={() =>
              retainMut.mutate({
                retentionReason: retentionReason.trim(),
                retentionUntil: retentionUntil ? new Date(retentionUntil).toISOString() : null,
                notes: notes.trim() || undefined,
              })
            }
          >
            {retainMut.isPending ? "Saving…" : "Mark as retention required"}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!anonymised && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="destructive"
                disabled={anonymiseMut.isPending}
              >
                {anonymiseMut.isPending ? "Anonymising…" : "Anonymise PII"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Anonymise this user's PII?</AlertDialogTitle>
                <AlertDialogDescription>
                  This wipes the user's name, email, phone and other personal data and cannot be undone.
                  The row itself is kept so reviews, conversations and audit history stay intact.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    anonymiseMut.mutate({ notes: notes.trim() || undefined })
                  }
                >
                  Anonymise
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {!completed && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="default"
                disabled={completeMut.isPending}
              >
                {completeMut.isPending ? "Completing…" : "Mark as completed"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Finalise the deletion?</AlertDialogTitle>
                <AlertDialogDescription>
                  The account will be soft-deleted and the user signed out of every device.
                  This is a terminal state and cannot be reversed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => completeMut.mutate()}>
                  Mark as completed
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {data.recentAudit.length > 0 && (
        <div>
          <Label className="text-xs uppercase tracking-wide">Recent activity</Label>
          <div className="mt-1 rounded-md border bg-background divide-y text-xs">
            {data.recentAudit.map((a) => (
              <div key={a.id} className="px-3 py-2 flex items-start gap-2">
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                  {formatDate(a.createdAt)}
                </span>
                <span className="font-medium">{a.action}</span>
                {a.notes ? <span className="text-muted-foreground">— {a.notes}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
