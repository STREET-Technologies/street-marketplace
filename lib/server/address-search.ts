import {
  addressSearchMaxLength,
  addressSearchMinLength,
  formatUkPostcode,
  normalizeAddressQuery,
  type AddressSearchPurpose,
  type AddressSearchResult,
} from "../address-search.ts";
import { ApiError } from "./street-api.ts";
import { errorResponse, fields, json, requireSameOrigin, smallJson } from "./web-api.ts";

const unavailable = "Address search is unavailable right now. Please try again.";
const text = (value: unknown, max = 200): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export async function searchAddresses(
  query: string,
  purpose: AddressSearchPurpose,
  fetcher: typeof fetch = fetch,
  token = process.env.MAPBOX_ACCESS_TOKEN,
): Promise<AddressSearchResult[]> {
  if (!token) throw new ApiError(503, unavailable);
  const normalized = normalizeAddressQuery(query);
  const exactPostcode = formatUkPostcode(normalized);
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.search = new URLSearchParams({
    q: normalized,
    access_token: token,
    country: "gb",
    language: "en",
    proximity: "-0.1278,51.5074",
    types: "address,postcode,place",
    limit: "8",
    autocomplete: exactPostcode ? "false" : "true",
    // Profile results can become saved addresses; browsing results stay in memory.
    permanent: String(purpose === "profile"),
  }).toString();
  try {
    const response = await fetcher(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!Array.isArray(data?.features)) throw new Error();
    const results: AddressSearchResult[] = [];
    for (const feature of data.features.slice(0, 8)) {
      const properties = record(record(feature).properties);
      const context = record(properties.context);
      const country = record(context.country);
      const coordinates = record(properties.coordinates);
      const kind = properties.feature_type;
      const id = text(properties.mapbox_id, 2048);
      const name = text(properties.name_preferred) || text(properties.name);
      const label = text(properties.full_address, 400) ||
        [name, text(properties.place_formatted)].filter(Boolean).join(", ");
      const postcode = formatUkPostcode(
        kind === "postcode" ? name : text(record(context.postcode).name),
      ) ?? "";
      const { latitude, longitude } = coordinates;
      if (
        !id || !label ||
        !["address", "postcode", "place"].includes(String(kind)) ||
        String(country.country_code).toLowerCase() !== "gb" ||
        typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
        (exactPostcode && postcode !== exactPostcode) ||
        results.some((result) => result.id === id)
      ) continue;
      results.push({
        id, label, kind: kind as AddressSearchResult["kind"],
        coordinates: { latitude, longitude },
        line1: kind === "address" ? text(record(context.address).name) || name : "",
        city: kind === "place" ? name : text(record(context.place).name, 100),
        state: text(record(context.region).name, 100),
        postcode,
      });
    }
    return results;
  } catch {
    // Never forward provider responses, request URLs or access tokens.
    throw new ApiError(503, unavailable);
  }
}

export async function handleAddressSearch(request: Request, search = searchAddresses) {
  try {
    if (request.method !== "POST") throw new ApiError(405, "Method not allowed.");
    requireSameOrigin(request);
    const body = await smallJson(request);
    fields(body, ["query", "purpose"]);
    if (typeof body.query !== "string" ||
      body.query.trim().length < addressSearchMinLength ||
      body.query.length > addressSearchMaxLength || /[\u0000-\u001f]/.test(body.query))
      throw new ApiError(400, "Enter a postcode or address of at least 3 characters.");
    if (body.purpose !== "browse" && body.purpose !== "profile")
      throw new ApiError(400, "Choose a valid address search.");
    return json({ results: await search(normalizeAddressQuery(body.query), body.purpose) });
  } catch (error) {
    return errorResponse(error);
  }
}
