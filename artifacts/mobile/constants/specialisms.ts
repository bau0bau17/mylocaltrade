import type { FeatherIconName } from '@/types/feather-icons';

export type SpecialismKey =
  | 'solar'
  | 'ev_chargers'
  | 'heat_pumps'
  | 'insulation'
  | 'epc'
  | 'damp'
  | 'cladding'
  | 'leasehold';

export interface Specialism {
  key: SpecialismKey;
  label: string;
  icon: FeatherIconName;
  keywords: string[];
}

export const SPECIALISMS: Specialism[] = [
  { key: 'solar', label: 'Solar panels', icon: 'sun', keywords: ['solar'] },
  { key: 'ev_chargers', label: 'EV chargers', icon: 'battery-charging', keywords: ['ev charger', 'ev chargers', 'electric vehicle'] },
  { key: 'heat_pumps', label: 'Heat pumps', icon: 'wind', keywords: ['heat pump'] },
  { key: 'insulation', label: 'Insulation', icon: 'layers', keywords: ['insulation'] },
  { key: 'epc', label: 'EPC improvements', icon: 'bar-chart-2', keywords: ['epc', 'energy performance'] },
  { key: 'damp', label: 'Damp & mould', icon: 'cloud-drizzle', keywords: ['damp', 'mould', 'mold'] },
  { key: 'cladding', label: 'Cladding & remediation', icon: 'shield', keywords: ['cladding', 'remediation'] },
  { key: 'leasehold', label: 'Leasehold repairs', icon: 'file-text', keywords: ['leasehold'] },
];

export const SPECIALISM_BY_KEY: Record<SpecialismKey, Specialism> = SPECIALISMS.reduce(
  (acc, s) => {
    acc[s.key] = s;
    return acc;
  },
  {} as Record<SpecialismKey, Specialism>,
);

function normalise(value: string): string {
  return value.toLowerCase().trim();
}

// Detect which specialisms are reflected in a trader's free-text services /
// main category. We match on keyword substrings so a service entry like
// "Solar PV install" still surfaces the Solar badge.
export function detectSpecialisms(
  mainCategory: string | null | undefined,
  additionalServices: string[] | null | undefined,
): SpecialismKey[] {
  const haystacks = [
    ...(mainCategory ? [normalise(mainCategory)] : []),
    ...(additionalServices ?? []).map(normalise),
  ];
  if (haystacks.length === 0) return [];
  const found: SpecialismKey[] = [];
  for (const spec of SPECIALISMS) {
    const hit = spec.keywords.some((kw) =>
      haystacks.some((h) => h.includes(kw)),
    );
    if (hit) found.push(spec.key);
  }
  return found;
}

// Should the customer enquiry form show the optional "specialist fields"
// (property type / tenure / urgency) for this trader? Yes whenever the
// trader has at least one detected specialism.
export function traderHasAnySpecialism(
  mainCategory: string | null | undefined,
  additionalServices: string[] | null | undefined,
): boolean {
  return detectSpecialisms(mainCategory, additionalServices).length > 0;
}

export type PropertyType = 'house' | 'flat' | 'commercial' | 'other';
export type Tenure = 'owner' | 'tenant' | 'landlord' | 'leaseholder';
export type Urgency = 'routine' | 'soon' | 'urgent';

export const PROPERTY_TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: 'house', label: 'House' },
  { value: 'flat', label: 'Flat' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'other', label: 'Other' },
];

export const TENURE_OPTIONS: { value: Tenure; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'landlord', label: 'Landlord' },
  { value: 'leaseholder', label: 'Leaseholder' },
];

export const URGENCY_OPTIONS: { value: Urgency; label: string }[] = [
  { value: 'routine', label: 'No rush' },
  { value: 'soon', label: 'Within a month' },
  { value: 'urgent', label: 'ASAP' },
];

export interface SpecialistFields {
  propertyType?: PropertyType;
  tenure?: Tenure;
  urgency?: Urgency;
}
