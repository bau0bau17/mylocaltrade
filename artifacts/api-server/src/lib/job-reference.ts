/**
 * Human-readable, unique job reference used for review verification.
 *
 * The reference is deterministic from the conversation id (e.g. id 123 ->
 * "MLT-000123"), which keeps it unique (conversation ids are unique) and lets us
 * derive it on the fly for older jobs that predate the stored `jobReference`
 * column. New hires persist the same value so it can be searched/audited.
 */
export function formatJobReference(id: number): string {
  return `MLT-${String(id).padStart(6, "0")}`;
}

/**
 * Returns the job reference for a conversation, preferring the stored value and
 * falling back to the deterministic format for already-hired jobs that have no
 * stored reference yet. Returns null for jobs that have not been hired.
 */
export function jobReferenceOf(
  c: { id: number; jobReference: string | null; customerAcceptedAt: Date | null },
): string | null {
  if (c.jobReference) return c.jobReference;
  return c.customerAcceptedAt ? formatJobReference(c.id) : null;
}
