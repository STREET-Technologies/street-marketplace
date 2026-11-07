import { formatUkPostcode } from "../address-search.ts";
// Temporary reverse-geocoding results stay in browser memory only.
export async function locationPostcode(
  coordinates: { latitude: number; longitude: number },
  fetcher: typeof fetch = fetch,
  token = process.env.MAPBOX_ACCESS_TOKEN,
): Promise<string | null> {
  if (!token) return null;
  const url = new URL("https://api.mapbox.com/search/geocode/v6/reverse");
  url.search = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    types: "postcode",
    country: "gb",
    access_token: token,
  }).toString();
  try {
    const response = await fetcher(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    for (const feature of Array.isArray(data?.features) ? data.features : []) {
      if (feature?.properties?.feature_type !== "postcode") continue;
      const name = feature.properties.name;
      if (typeof name !== "string") continue;
      const postcode = formatUkPostcode(name);
      if (postcode) return postcode;
    }
  } catch {
    // Lookup must never block browsing or leak provider details/token to clients.
  }
  return null;
}
