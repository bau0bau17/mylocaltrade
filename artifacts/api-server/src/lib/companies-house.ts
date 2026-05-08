const COMPANIES_HOUSE_API = "https://api.company-information.service.gov.uk";

export interface CompaniesHouseSearchHit {
  company_number?: string;
  title?: string;
  address_snippet?: string;
  company_status?: string;
  date_of_creation?: string;
  address?: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
}

interface CompaniesHouseSearchResponse {
  items?: CompaniesHouseSearchHit[];
}

export interface CompaniesHouseProfile {
  company_number?: string;
  company_name?: string;
  company_status?: string;
  sic_codes?: string[];
  registered_office_address?: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
}

function chAuthHeader(): string {
  const raw = process.env.COMPANIES_HOUSE_API_KEY;
  if (!raw) throw new Error("COMPANIES_HOUSE_API_KEY not configured");
  // Defensively strip any whitespace / newlines that may have been pasted
  // into the secret — Companies House rejects the Basic header otherwise
  // with "Invalid Authorization header".
  const key = raw.replace(/\s+/g, "");
  if (!key) throw new Error("COMPANIES_HOUSE_API_KEY is empty after trim");
  return "Basic " + Buffer.from(`${key}:`).toString("base64");
}

export async function searchCompanies(
  q: string,
  itemsPerPage = 5,
): Promise<CompaniesHouseSearchHit[]> {
  const url = `${COMPANIES_HOUSE_API}/search/companies?q=${encodeURIComponent(q)}&items_per_page=${itemsPerPage}`;
  const res = await fetch(url, { headers: { Authorization: chAuthHeader() } });
  if (!res.ok) throw new Error(`Companies House search failed: ${res.status}`);
  const data = (await res.json()) as CompaniesHouseSearchResponse;
  return data.items ?? [];
}

export async function searchCompanyTopHit(
  name: string,
): Promise<CompaniesHouseSearchHit | null> {
  const items = await searchCompanies(name, 5);
  return items[0] ?? null;
}

export async function getCompanyProfile(
  companyNumber: string,
): Promise<CompaniesHouseProfile | null> {
  const url = `${COMPANIES_HOUSE_API}/company/${encodeURIComponent(companyNumber)}`;
  const res = await fetch(url, { headers: { Authorization: chAuthHeader() } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Companies House profile failed: ${res.status}`);
  return (await res.json()) as CompaniesHouseProfile;
}

export function formatChAddress(p: CompaniesHouseProfile): string {
  const a = p.registered_office_address;
  if (!a) return "";
  return [a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code, a.country]
    .filter(Boolean)
    .join(", ");
}
