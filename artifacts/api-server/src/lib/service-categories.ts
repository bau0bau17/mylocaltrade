// Canonical category ↔ trader-service mapping — the ONE place where a
// customer-facing category label (Home "Popular categories", Traders screen
// chips, free-text search) is expanded to the trader service values it should
// match (mainCategory + additionalServices entries).
//
// Deliberately NOT fuzzy matching: every synonym is listed explicitly. Terms
// are matched case-insensitively as substrings (ILIKE %term%), so "Painter"
// also matches "Painter & Decorator" and "Building" matches "General
// building" — but "Electrical" never matches "Roofer".
//
// Existing trader data is never rewritten; the expansion happens at query
// time only. Keep the vocabulary aligned with the mobile "Services offered"
// autocomplete list (artifacts/mobile/constants/uk-services.ts) and the
// category lists in routes/categories.ts + the Home/Traders screens.

export interface ServiceCategory {
  id: string;
  label: string;
  /** Trader service values / synonyms this category matches (besides label). */
  terms: string[];
}

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  {
    id: "plumbing",
    label: "Plumbing",
    terms: ["Plumber", "Emergency plumbing", "Bathroom installation", "Bathroom fitting", "Leak detection", "Drain unblocking", "Pipework"],
  },
  {
    id: "electrical",
    label: "Electrical",
    terms: ["Electrician", "Electrical installation", "Electrical repairs", "Electrical rewiring", "Rewiring", "Emergency electrician", "Fuse board", "Consumer unit", "EICR", "PAT testing", "Lighting installation"],
  },
  {
    id: "roofing",
    label: "Roofing",
    terms: ["Roofer", "Roof repairs", "Roof replacement", "Flat roofing", "Pitched roofing", "Guttering", "Fascias", "Soffits"],
  },
  {
    id: "building",
    label: "Building",
    terms: ["Builder", "General building", "Extensions", "Loft conversions", "Renovations", "Bricklaying", "Groundworks", "Structural work"],
  },
  {
    id: "painting",
    label: "Painting",
    terms: ["Painter", "Painter & Decorator", "Decorator", "Decorating", "Interior painting", "Exterior painting", "Wallpapering"],
  },
  {
    id: "cleaning",
    label: "Cleaning",
    terms: ["Cleaner", "Domestic cleaning", "End of tenancy cleaning", "Carpet cleaning", "Window cleaning", "Pressure washing", "Gutter cleaning"],
  },
  {
    id: "gardening",
    label: "Gardening & landscaping",
    terms: ["Gardener", "Gardening", "Landscaping", "Landscaper", "Garden maintenance", "Lawn care", "Hedge trimming", "Tree surgery", "Fencing", "Decking", "Paving", "Patio"],
  },
  {
    id: "heating",
    label: "Heating",
    terms: ["Heating engineer", "Heating & Gas", "Central heating", "Boiler installation", "Boiler servicing", "Boiler repair", "Radiator installation", "Underfloor heating"],
  },
  {
    id: "gas",
    label: "Gas engineers",
    terms: ["Gas engineer", "Gas services", "Gas safety checks", "Gas appliance installation", "Heating & Gas"],
  },
  {
    id: "locksmiths",
    label: "Locksmiths",
    terms: ["Locksmith", "Lock repairs", "Lock replacement", "Emergency locksmith"],
  },
  {
    id: "ev-chargers",
    label: "EV chargers",
    terms: ["EV charger installation", "EV charging", "Electric vehicle charger"],
  },
  {
    id: "solar-panels",
    label: "Solar panels",
    terms: ["Solar panel installation", "Solar PV", "Solar installation", "Battery storage"],
  },
  {
    id: "heat-pumps",
    label: "Heat pumps",
    terms: ["Heat pump installation", "Heat pump engineer", "Air source heat pump", "Ground source heat pump"],
  },
  {
    id: "insulation",
    label: "Insulation",
    terms: ["Insulation installation", "Loft insulation", "Cavity wall insulation", "External wall insulation"],
  },
  {
    id: "epc",
    label: "EPC improvements",
    terms: ["EPC assessment", "EPC improvements", "Energy assessment", "Energy efficiency"],
  },
  {
    id: "damp",
    label: "Damp & mould",
    terms: ["Damp proofing", "Damp treatment", "Mould removal", "Mould treatment", "Condensation control", "Timber treatment"],
  },
  {
    id: "cladding",
    label: "Cladding & remediation",
    terms: ["Cladding", "Cladding remediation", "Fire safety remediation", "Render", "Rendering"],
  },
  {
    id: "maintenance",
    label: "General maintenance",
    terms: ["Property maintenance", "Home repairs"],
  },
  {
    id: "leasehold",
    label: "Leasehold repairs",
    terms: ["Block maintenance", "Communal repairs"],
  },
  {
    id: "handyman",
    label: "Handyman",
    terms: ["Handyman services", "Odd jobs", "Flat pack assembly"],
  },
  {
    id: "carpentry",
    label: "Carpentry",
    terms: ["Carpenter", "Joinery", "Joiner", "Kitchen fitting", "Door hanging", "Skirting", "Built-in wardrobes"],
  },
  {
    id: "removals",
    label: "Removals",
    terms: ["Removals", "House removals", "Man and van", "Office removals"],
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

// Lookup index: id, label, and every term map to their categorIES. A term may
// legitimately belong to more than one category (e.g. "Heating & Gas" is the
// legacy combined category value → both heating and gas): expansion then
// deterministically unions the terms of every category that lists it, rather
// than silently picking whichever was declared last.
const LOOKUP = new Map<string, ServiceCategory[]>();
function addKey(key: string, cat: ServiceCategory): void {
  const norm = normalize(key);
  const existing = LOOKUP.get(norm);
  if (existing) {
    if (!existing.includes(cat)) existing.push(cat);
  } else {
    LOOKUP.set(norm, [cat]);
  }
}
for (const cat of SERVICE_CATEGORIES) {
  addKey(cat.id, cat);
  addKey(cat.label, cat);
  for (const term of cat.terms) addKey(term, cat);
}

/**
 * Expand a customer-facing category label (or a known service synonym) into
 * the full list of matching terms. Ambiguous inputs (terms shared by several
 * categories) return the union of all their terms. Returns null when the
 * input is not a known category/synonym — callers then fall back to plain
 * substring search, preserving the previous free-text behaviour.
 */
export function expandServiceTerms(input: string): string[] | null {
  const cats = LOOKUP.get(normalize(input));
  if (!cats || cats.length === 0) return null;
  const out = new Set<string>();
  for (const cat of cats) {
    out.add(cat.label);
    for (const term of cat.terms) out.add(term);
  }
  return Array.from(out);
}
