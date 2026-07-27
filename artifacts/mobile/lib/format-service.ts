/**
 * Display-only normalisation for common technical acronyms in service names,
 * e.g. "Ac installation" -> "AC installation". A small deliberate mapping —
 * only whole words are replaced, and stored data is never modified.
 */
const ACRONYMS: Record<string, string> = {
  ac: 'AC',
  ev: 'EV',
  epc: 'EPC',
  cctv: 'CCTV',
};

export function formatServiceLabel(label: string): string {
  if (!label) return label;
  return label
    .split(/(\s+)/)
    .map((part) => ACRONYMS[part.toLowerCase()] ?? part)
    .join('');
}
