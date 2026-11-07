export const addressSearchMinLength = 3;
export const addressSearchMaxLength = 120;
export type AddressSearchPurpose = "browse" | "profile";
export interface AddressSearchResult {
  id: string;
  label: string;
  kind: "address" | "postcode" | "place";
  coordinates: { latitude: number; longitude: number };
  line1: string;
  city: string;
  state: string;
  postcode: string;
}

export function formatUkPostcode(value: string): string | null {
  const compact = value.toUpperCase().replace(/\s/g, "");
  return /^(?:GIR0AA|[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/.test(compact)
    ? `${compact.slice(0, -3)} ${compact.slice(-3)}`
    : null;
}

export function normalizeAddressQuery(value: string): string {
  return formatUkPostcode(value) ?? value.trim().replace(/\s+/g, " ");
}
