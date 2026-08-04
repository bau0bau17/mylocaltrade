import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type TraderStatus } from "@/lib/types";

const styleMap: Record<TraderStatus, string> = {
  PENDING_EMAIL_VERIFICATION: "bg-muted text-muted-foreground border-transparent",
  PENDING_PHONE_VERIFICATION: "bg-muted text-muted-foreground border-transparent",
  PROFILE_INCOMPLETE: "bg-muted text-muted-foreground border-transparent",
  PENDING_DOCUMENTS: "bg-[hsl(var(--info-tint))] text-[hsl(var(--info))] border-transparent",
  UNDER_REVIEW: "bg-[hsl(var(--warning-tint))] text-[hsl(var(--warning))] border-transparent",
  NEEDS_MORE_INFO: "bg-[hsl(var(--warning-tint))] text-[hsl(var(--warning))] border-transparent",
  VERIFIED: "bg-[hsl(var(--success-tint))] text-[hsl(var(--success))] border-transparent",
  REJECTED: "bg-[hsl(var(--destructive-tint))] text-[hsl(var(--destructive))] border-transparent",
  SUSPENDED: "bg-muted text-muted-foreground border-transparent",
  EXPIRED_DOCUMENTS: "bg-[hsl(var(--warning-tint))] text-[hsl(var(--warning))] border-transparent",
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
  PENDING_REVIEW: "bg-[hsl(var(--warning-tint))] text-[hsl(var(--warning))] border-transparent",
  APPROVED: "bg-[hsl(var(--success-tint))] text-[hsl(var(--success))] border-transparent",
  REJECTED: "bg-[hsl(var(--destructive-tint))] text-[hsl(var(--destructive))] border-transparent",
  EXPIRED: "bg-[hsl(var(--warning-tint))] text-[hsl(var(--warning))] border-transparent",
};

export function DocumentStatusBadge({ status }: { status: string }) {
  const className = docStatusMap[status] ?? "bg-muted text-muted-foreground border-transparent";
  return <Badge variant="outline" className={`${className} font-medium`}>{status.replace("_", " ")}</Badge>;
}
