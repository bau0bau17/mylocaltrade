import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type TraderStatus } from "@/lib/types";

const styleMap: Record<TraderStatus, string> = {
  PENDING_EMAIL_VERIFICATION: "bg-muted text-muted-foreground border-transparent",
  PENDING_PHONE_VERIFICATION: "bg-muted text-muted-foreground border-transparent",
  PROFILE_INCOMPLETE: "bg-muted text-muted-foreground border-transparent",
  PENDING_DOCUMENTS: "bg-blue-100 text-blue-800 border-transparent",
  UNDER_REVIEW: "bg-amber-100 text-amber-900 border-transparent",
  NEEDS_MORE_INFO: "bg-yellow-100 text-yellow-900 border-transparent",
  VERIFIED: "bg-emerald-100 text-emerald-800 border-transparent",
  REJECTED: "bg-red-100 text-red-800 border-transparent",
  SUSPENDED: "bg-zinc-200 text-zinc-800 border-transparent",
  EXPIRED_DOCUMENTS: "bg-orange-100 text-orange-900 border-transparent",
};

export function StatusBadge({ status }: { status: TraderStatus | string }) {
  const key = (status as TraderStatus) in styleMap ? (status as TraderStatus) : null;
  const label = key ? STATUS_LABELS[key] : status;
  const className = key ? styleMap[key] : "bg-muted text-muted-foreground border-transparent";
  return (
    <Badge variant="outline" className={`${className} font-medium`} data-testid={`status-${status}`}>
      {label}
    </Badge>
  );
}

const docStatusMap: Record<string, string> = {
  PENDING_REVIEW: "bg-amber-100 text-amber-900 border-transparent",
  APPROVED: "bg-emerald-100 text-emerald-800 border-transparent",
  REJECTED: "bg-red-100 text-red-800 border-transparent",
  EXPIRED: "bg-orange-100 text-orange-900 border-transparent",
};

export function DocumentStatusBadge({ status }: { status: string }) {
  const className = docStatusMap[status] ?? "bg-muted text-muted-foreground border-transparent";
  return <Badge variant="outline" className={`${className} font-medium`}>{status.replace("_", " ")}</Badge>;
}
