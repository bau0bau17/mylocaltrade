// Single source of truth for the lifecycle stage shown to both parties. Derived
// from the audit timestamps so the headline pill never contradicts the actual
// state (e.g. showing "Awaiting trader reply" after the customer has hired).
// Precedence: cancelled > job done > awaiting customer confirmation > hired >
// closed/blocked > awaiting reply.
export type StageSource = {
  status: string;
  cancelledAt: Date | null;
  customerAcceptedAt: Date | null;
  customerCompletedAt: Date | null;
  traderMarkedDoneAt: Date | null;
};

export function deriveStage(c: StageSource) {
  if (c.cancelledAt) return "CANCELLED" as const;
  if (c.customerCompletedAt) return "JOB_DONE" as const;
  if (c.traderMarkedDoneAt && c.customerAcceptedAt)
    return "AWAITING_CUSTOMER_CONFIRMATION" as const;
  if (c.customerAcceptedAt) return "HIRED" as const;
  if (c.status === "CLOSED" || c.status === "BLOCKED") return "CLOSED" as const;
  return "AWAITING_REPLY" as const;
}
