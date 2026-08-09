// Matching helper for the small "search by job number" boxes on the enquiry
// and lead lists. References look like "MLT-000123"; users may type the full
// reference, just the digits ("000123"), or a partial fragment of either.
// Comparison happens on an uppercased, alphanumeric-only form so case,
// dashes and whitespace never matter. An empty query matches everything
// (the list stays unfiltered); enquiries without a reference yet only match
// the empty query.
const normalise = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

// Strips leading zeros from every digit run ("MLT000012" -> "MLT12") so
// queries like "mlt 12" match zero-padded references. A lone "0" survives.
const collapseZeros = (value: string) =>
  value.replace(/\d+/g, (run) => run.replace(/^0+(?=\d)/, ''));

export function matchesJobReference(
  jobReference: string | null | undefined,
  query: string,
): boolean {
  const q = normalise(query);
  if (!q) return true;
  if (!jobReference) return false;
  const ref = normalise(jobReference);
  if (ref.includes(q)) return true;
  return collapseZeros(ref).includes(collapseZeros(q));
}

// Broader search for the trader "Enquiries & Leads" list: matches the job
// reference (case/dash-insensitive, partial — reuses matchesJobReference) OR
// a case-insensitive substring of the job/category title, the customer name,
// or the enquiry description. Empty queries match everything.
export function matchesLeadSearch(
  lead: {
    jobReference?: string | null;
    serviceRequired?: string | null;
    customerName?: string | null;
    message?: string | null;
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // Only let the reference matcher decide when the query still has
  // alphanumeric content — otherwise "&&" would normalise to "" and match all.
  if (normalise(q) && matchesJobReference(lead.jobReference, q)) return true;
  return [lead.serviceRequired, lead.customerName, lead.message].some(
    (field) => field != null && field.toLowerCase().includes(q),
  );
}
