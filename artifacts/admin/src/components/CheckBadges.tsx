import { Badge } from "@/components/ui/badge";
import type { TraderDetailResponse } from "@/lib/types";

export const CHECK_GREEN = "bg-emerald-100 text-emerald-800 border-transparent";
export const CHECK_AMBER = "bg-amber-100 text-amber-900 border-transparent";
export const CHECK_RED = "bg-red-100 text-red-800 border-transparent";
export const CHECK_GREY = "bg-muted text-muted-foreground border-transparent";

function CheckBadge({ label, className, testId }: { label: string; className: string; testId?: string }) {
  return (
    <Badge variant="outline" className={`${className} font-medium`} data-testid={testId}>
      {label}
    </Badge>
  );
}

type AiVerdict = NonNullable<TraderDetailResponse["profile"]["aiVerificationStatus"]>;
type RegisterOverall = NonNullable<TraderDetailResponse["profile"]["registerCheckStatus"]>;
type CompanyStatus = NonNullable<TraderDetailResponse["profile"]["registerCheckData"]>["company"]["status"];
type VatStatus = NonNullable<TraderDetailResponse["profile"]["registerCheckData"]>["vat"]["status"];

export function AiVerdictBadge({ verdict }: { verdict: AiVerdict }) {
  const map: Record<string, { label: string; className: string }> = {
    MATCH: { label: "AI: Match", className: CHECK_GREEN },
    PARTIAL_MATCH: { label: "AI: Partial match", className: CHECK_AMBER },
    NO_MATCH: { label: "AI: No match", className: CHECK_RED },
    NOT_FOUND: { label: "AI: Not found on CH", className: CHECK_GREY },
    ERROR: { label: "AI: Check failed", className: CHECK_GREY },
  };
  const v = map[verdict] ?? map.ERROR;
  return <CheckBadge label={v.label} className={v.className} testId="badge-ai-verdict" />;
}

export function RegisterOverallBadge({ overall }: { overall: RegisterOverall }) {
  const map: Record<string, { label: string; className: string }> = {
    PASS: { label: "Registers: Pass", className: CHECK_GREEN },
    REVIEW: { label: "Registers: Review", className: CHECK_AMBER },
    FAIL: { label: "Registers: Fail", className: CHECK_RED },
    NOT_PROVIDED: { label: "Registers: Nothing to check", className: CHECK_GREY },
    ERROR: { label: "Registers: Check failed", className: CHECK_GREY },
  };
  const v = map[overall] ?? map.ERROR;
  return <CheckBadge label={v.label} className={v.className} testId="badge-register-overall" />;
}

const REGISTER_STATUS_MAP: Record<string, { label: string; className: string }> = {
  MATCH: { label: "Match", className: CHECK_GREEN },
  NAME_MISMATCH: { label: "Name mismatch", className: CHECK_AMBER },
  INACTIVE: { label: "Inactive", className: CHECK_RED },
  NOT_FOUND: { label: "Not found", className: CHECK_RED },
  INVALID: { label: "Invalid format", className: CHECK_RED },
  NOT_PROVIDED: { label: "Not provided", className: CHECK_GREY },
  ERROR: { label: "Check failed", className: CHECK_GREY },
};

export function CompanyStatusBadge({ status }: { status: CompanyStatus }) {
  const v = REGISTER_STATUS_MAP[status] ?? REGISTER_STATUS_MAP.ERROR;
  return <CheckBadge label={v.label} className={v.className} />;
}

export function VatStatusBadge({ status }: { status: VatStatus }) {
  const v = REGISTER_STATUS_MAP[status] ?? REGISTER_STATUS_MAP.ERROR;
  return <CheckBadge label={v.label} className={v.className} />;
}
