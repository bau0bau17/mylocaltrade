import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Star, Check, X, Flag, AlertTriangle, Eye } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { detectContactInfo, contactViolationMessage } from "@/lib/content-filter";

type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED" | "FLAGGED";

interface AdminReview {
  id: number;
  traderId: number;
  customerId: number;
  customerName: string;
  enquiryId: number;
  rating: number;
  text: string;
  status: ReviewStatus;
  traderReply: string | null;
  traderReplyAt: string | null;
  moderatedAt: string | null;
  moderationNotes: string | null;
  jobReference: string | null;
  createdAt: string;
}

interface JobView {
  jobReference: string | null;
  conversation: {
    id: number;
    customerId: number;
    customerName: string | null;
    customerEmail: string | null;
    traderProfileId: number;
    traderBusinessName: string | null;
    status: string;
    serviceRequired: string | null;
    postcode: string | null;
    createdAt: string;
    customerAcceptedAt: string | null;
    customerCompletedAt: string | null;
    cancelledAt: string | null;
  };
  enquiry: {
    id: number;
    message: string;
    serviceRequired: string;
    preferredDate: string | null;
    createdAt: string;
  } | null;
  messages: Array<{
    id: number;
    senderUserId: number;
    senderRole: string;
    body: string;
    systemMessage: boolean;
    createdAt: string;
  }>;
  attachments: string[];
}

const STATUS_FILTERS: Array<{ value: ReviewStatus | "ALL"; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "FLAGGED", label: "Flagged" },
  { value: "ALL", label: "All" },
];

const STATUS_VARIANT: Record<ReviewStatus, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "outline",
  APPROVED: "default",
  REJECTED: "destructive",
  FLAGGED: "secondary",
};

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`w-3.5 h-3.5 ${
            n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
          }`}
        />
      ))}
    </div>
  );
}

function JobModerationDialog({ review }: { review: AdminReview }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const job = useMutation({
    mutationFn: () =>
      api<JobView>(`/api/admin/reviews/${review.id}/job`, {
        query: { reason: reason.trim() },
      }),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setReason("");
      job.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`view-job-${review.id}`}>
          <Eye className="w-3.5 h-3.5 mr-1" /> View job
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Job {review.jobReference ?? (review.enquiryId ? `#${review.enquiryId}` : "")}
          </DialogTitle>
          <DialogDescription>
            Opening the full conversation and photos is recorded in the audit log. Enter a
            reason to continue.
          </DialogDescription>
        </DialogHeader>

        {!job.data ? (
          <div className="space-y-3">
            <Textarea
              placeholder="Reason for viewing this job (recorded in the audit log)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              data-testid={`job-reason-${review.id}`}
            />
            {job.error && (
              <Alert variant="destructive">
                <AlertDescription>{(job.error as Error).message}</AlertDescription>
              </Alert>
            )}
            <Button
              disabled={reason.trim().length < 5 || job.isPending}
              onClick={() => job.mutate()}
              data-testid={`job-confirm-${review.id}`}
            >
              View conversation &amp; photos
            </Button>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1 -mr-4 pr-4">
            <div className="space-y-4 text-sm">
              <div className="space-y-1">
                <div className="font-medium">
                  {job.data.conversation.traderBusinessName} · {job.data.conversation.customerName}
                </div>
                <div className="text-xs text-slate-500">
                  {job.data.jobReference ? `${job.data.jobReference} · ` : ""}
                  {job.data.conversation.serviceRequired ?? "Job"}
                  {job.data.conversation.postcode ? ` · ${job.data.conversation.postcode}` : ""}
                </div>
                <div className="text-xs text-slate-500">
                  Hired{" "}
                  {job.data.conversation.customerAcceptedAt
                    ? formatDateTime(job.data.conversation.customerAcceptedAt)
                    : "—"}
                  {job.data.conversation.customerCompletedAt
                    ? ` · Completed ${formatDateTime(job.data.conversation.customerCompletedAt)}`
                    : ""}
                </div>
              </div>

              {job.data.enquiry && (
                <div className="rounded-md bg-muted/30 p-3 space-y-1">
                  <div className="text-xs font-medium text-slate-700">Original enquiry</div>
                  <p className="whitespace-pre-line">{job.data.enquiry.message}</p>
                </div>
              )}

              {job.data.attachments.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-700">
                    Customer photos ({job.data.attachments.length})
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {job.data.attachments.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img
                          src={url}
                          alt={`Job photo ${i + 1}`}
                          className="w-full h-24 object-cover rounded-md border"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-700">
                  Conversation ({job.data.messages.length})
                </div>
                {job.data.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-md p-2 text-xs ${
                      m.systemMessage
                        ? "bg-muted/40 text-slate-600 italic text-center"
                        : m.senderRole === "trader"
                          ? "bg-primary/5 text-slate-900"
                          : "bg-muted/30 text-slate-900"
                    }`}
                  >
                    {!m.systemMessage && (
                      <div className="font-medium mb-0.5 capitalize">{m.senderRole}</div>
                    )}
                    <div className="whitespace-pre-line">{m.body}</div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      {formatDateTime(m.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ReviewsPage() {
  const [filter, setFilter] = useState<ReviewStatus | "ALL">("PENDING");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "reviews", filter],
    queryFn: () =>
      api<{ reviews: AdminReview[] }>("/api/admin/reviews", {
        query: filter === "ALL" ? undefined : { status: filter },
      }),
  });

  const moderate = useMutation({
    mutationFn: ({ id, action, notes: n }: { id: number; action: "approve" | "reject" | "flag"; notes?: string }) =>
      api<AdminReview>(`/api/admin/reviews/${id}/moderate`, {
        method: "POST",
        body: { action, ...(n ? { notes: n } : {}) },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "reviews"] });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Review moderation</h1>
        <p className="text-sm text-muted-foreground">
          Approve, reject, or flag customer reviews before they appear publicly on trader profiles.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            onClick={() => setFilter(f.value)}
            data-testid={`filter-${f.value.toLowerCase()}`}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {moderate.error && (
        <Alert variant="destructive">
          <AlertDescription>
            Moderation failed: {(moderate.error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {data ? `${data.reviews.length} review${data.reviews.length === 1 ? "" : "s"}` : "Loading…"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : !data?.reviews.length ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No reviews in this state.
            </div>
          ) : (
            <ul className="divide-y">
              {data.reviews.map((r) => {
                const pending = moderate.isPending && moderate.variables?.id === r.id;
                const noteText = notes[r.id] ?? "";
                const violation = detectContactInfo(noteText);
                const violationText = violation ? contactViolationMessage(violation) : null;
                const blocked = pending || !!violation;
                return (
                  <li key={r.id} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{r.customerName}</span>
                          <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                          <Stars rating={r.rating} />
                          {r.jobReference ? (
                            <Badge variant="outline" data-testid={`job-ref-${r.id}`}>
                              {r.jobReference}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Trader #{r.traderId} · enquiry #{r.enquiryId} · submitted {formatDateTime(r.createdAt)}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 whitespace-nowrap">
                        <JobModerationDialog review={r} />
                        {r.moderatedAt ? (
                          <span className="text-xs text-muted-foreground">
                            Moderated {formatDateTime(r.moderatedAt)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <p className="text-sm whitespace-pre-line bg-muted/30 rounded-md p-3">{r.text}</p>

                    {r.traderReply && (
                      <div className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-3">
                        <div className="font-medium text-foreground/80 mb-0.5">Trader reply</div>
                        {r.traderReply}
                      </div>
                    )}

                    {r.moderationNotes && (
                      <div className="text-xs text-muted-foreground italic">
                        Notes: {r.moderationNotes}
                      </div>
                    )}

                    {(r.status === "PENDING" || r.status === "FLAGGED") && (
                      <div className="space-y-2">
                        <Textarea
                          placeholder="Optional moderation notes (only visible to admins and in the audit log)"
                          value={noteText}
                          onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          rows={2}
                          className={`text-xs ${violationText ? "border-destructive focus-visible:ring-destructive" : ""}`}
                          data-testid={`notes-${r.id}`}
                        />
                        {violationText ? (
                          <Alert variant="destructive" data-testid={`violation-${r.id}`}>
                            <AlertTriangle className="w-4 h-4" />
                            <AlertDescription>{violationText}</AlertDescription>
                          </Alert>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={blocked}
                            onClick={() =>
                              moderate.mutate({ id: r.id, action: "approve", notes: noteText })
                            }
                            data-testid={`approve-${r.id}`}
                          >
                            <Check className="w-3.5 h-3.5 mr-1" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={blocked}
                            onClick={() =>
                              moderate.mutate({ id: r.id, action: "reject", notes: noteText })
                            }
                            data-testid={`reject-${r.id}`}
                          >
                            <X className="w-3.5 h-3.5 mr-1" /> Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={blocked}
                            onClick={() =>
                              moderate.mutate({ id: r.id, action: "flag", notes: noteText })
                            }
                            data-testid={`flag-${r.id}`}
                          >
                            <Flag className="w-3.5 h-3.5 mr-1" /> Flag
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
