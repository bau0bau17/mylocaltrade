import type { Quote, QuoteStatus } from "@workspace/db/schema";

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

// Prices are integer pence throughout; formatting happens only at the edges
// (system messages, push notification bodies). 45000 -> "£450.00".
export function formatPence(amountPence: number): string {
  return gbp.format(amountPence / 100);
}

export function priceTypeLabel(priceType: string): string {
  return priceType === "ESTIMATE" ? "Estimate" : "Fixed price";
}

// Effective status: rows stored as PENDING whose validUntil has passed are
// EXPIRED on the wire. No background sweep mutates rows; write paths enforce
// expiry with conditional updates instead.
export function effectiveQuoteStatus(
  q: Pick<Quote, "status" | "validUntil">,
  now: Date = new Date(),
): QuoteStatus {
  if (
    q.status === "PENDING" &&
    q.validUntil != null &&
    q.validUntil.getTime() <= now.getTime()
  ) {
    return "EXPIRED";
  }
  return q.status as QuoteStatus;
}

export function serializeQuote(q: Quote, now: Date = new Date()) {
  return {
    id: q.id,
    conversationId: q.conversationId,
    enquiryId: q.enquiryId,
    traderProfileId: q.traderProfileId,
    amountPence: q.amountPence,
    priceType: q.priceType,
    description: q.description,
    notes: q.notes,
    validUntil: q.validUntil?.toISOString() ?? null,
    status: effectiveQuoteStatus(q, now),
    revisionOfQuoteId: q.revisionOfQuoteId,
    acceptedAt: q.acceptedAt?.toISOString() ?? null,
    declinedAt: q.declinedAt?.toISOString() ?? null,
    withdrawnAt: q.withdrawnAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
  };
}

export type SerializedQuote = ReturnType<typeof serializeQuote>;

// One-line summary used in system messages and push bodies, e.g.
// "£450.00 (Fixed price) — valid until 12 Aug 2026".
export function quoteSummaryLine(q: Pick<Quote, "amountPence" | "priceType" | "validUntil">): string {
  const base = `${formatPence(q.amountPence)} (${priceTypeLabel(q.priceType)})`;
  if (!q.validUntil) return base;
  const until = q.validUntil.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  });
  return `${base} — valid until ${until}`;
}
