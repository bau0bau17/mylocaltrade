// Matching helper for the small "search by job number" boxes on the enquiry
// and lead lists. References look like "MLT-000123"; users may type the full
// reference, just the digits ("000123"), or a partial fragment of either.
// Comparison happens on an uppercased, alphanumeric-only form so case,
// dashes and whitespace never matter. An empty query matches everything
// (the list stays unfiltered); enquiries without a reference yet only match
// the empty query.
const normalise = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function matchesJobReference(
  jobReference: string | null | undefined,
  query: string,
): boolean {
  const q = normalise(query);
  if (!q) return true;
  if (!jobReference) return false;
  return normalise(jobReference).includes(q);
}
