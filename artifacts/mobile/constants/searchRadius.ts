// Fixed customer search-radius options, in miles. `null` = UK-wide (no
// distance filter). Deliberately a fixed list rather than a slider: simpler,
// faster and easier to understand — and future options are a one-line change
// here (the Home sheet, the Search filter chips, validation and persistence
// all render from this list).
export type SearchRadius = number | null;

export const DEFAULT_SEARCH_RADIUS: SearchRadius = 20;

export const SEARCH_RADIUS_OPTIONS: ReadonlyArray<SearchRadius> = [5, 10, 20, 30, 50, null];

/** Option label: "5 miles" … "UK-wide". */
export function radiusChipLabel(radius: SearchRadius): string {
  return radius === null ? 'UK-wide' : `${radius} miles`;
}

/** Inline/summary label: "Within 20 miles" / "UK-wide". */
export function radiusRowLabel(radius: SearchRadius): string {
  return radius === null ? 'UK-wide' : `Within ${radius} miles`;
}

/** Guards persisted values: unknown/legacy entries fall back to the default. */
export function isValidSearchRadius(value: unknown): value is SearchRadius {
  return SEARCH_RADIUS_OPTIONS.includes(value as SearchRadius);
}
