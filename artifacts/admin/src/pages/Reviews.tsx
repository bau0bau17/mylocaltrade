import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Star, Check, X, Flag } from "lucide-react";
import { formatDateTime } from "@/lib/format";

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
  createdAt: string;
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
                return (
                  <li key={r.id} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{r.customerName}</span>
                          <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                          <Stars rating={r.rating} />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Trader #{r.traderId} · enquiry #{r.enquiryId} · submitted {formatDateTime(r.createdAt)}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {r.moderatedAt ? `Moderated ${formatDateTime(r.moderatedAt)}` : null}
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
                          value={notes[r.id] ?? ""}
                          onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          rows={2}
                          className="text-xs"
                          data-testid={`notes-${r.id}`}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              moderate.mutate({ id: r.id, action: "approve", notes: notes[r.id] })
                            }
                            data-testid={`approve-${r.id}`}
                          >
                            <Check className="w-3.5 h-3.5 mr-1" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={pending}
                            onClick={() =>
                              moderate.mutate({ id: r.id, action: "reject", notes: notes[r.id] })
                            }
                            data-testid={`reject-${r.id}`}
                          >
                            <X className="w-3.5 h-3.5 mr-1" /> Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              moderate.mutate({ id: r.id, action: "flag", notes: notes[r.id] })
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
