import test from "node:test";
import assert from "node:assert/strict";
import { formatUkPostcode, normalizeAddressQuery } from "../lib/address-search.ts";
import { handleAddressSearch, searchAddresses } from "../lib/server/address-search.ts";

function feature(kind = "address", postcode = "W1F 0UT", overrides: Record<string, unknown> = {}) {
  return { properties: {
    mapbox_id: `${kind}-${postcode}`,
    feature_type: kind,
    name: kind === "postcode" ? postcode : "20 Broadwick Street",
    full_address: kind === "postcode" ? `${postcode}, London, United Kingdom` : "20 Broadwick Street, London W1F 0UT, United Kingdom",
    coordinates: { latitude: 51.513, longitude: -0.135 },
    context: {
      country: { country_code: "GB" },
      address: { name: "20 Broadwick Street" },
      postcode: { name: postcode },
      place: { name: "London" },
      region: { name: "England" },
    },
    ...overrides,
  } };
}
const request = (body: unknown, origin = "http://localhost:4319") => new Request("http://localhost:4319/api/location/search", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
});

test("postcode normalization accepts compact lowercase and preserves street queries", () => {
  assert.equal(formatUkPostcode("w1f0ut"), "W1F 0UT");
  assert.equal(normalizeAddressQuery("  20   Broadwick Street  "), "20 Broadwick Street");
  assert.equal(formatUkPostcode("W1F"), null);
});

test("search projects only UK address fields using bounded London-biased no-store requests", async () => {
  for (const purpose of ["browse", "profile"] as const) {
    const results = await searchAddresses("20 Broadwick Street", purpose, async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.mapbox.com");
      assert.equal(url.pathname, "/search/geocode/v6/forward");
      assert.equal(url.searchParams.get("q"), "20 Broadwick Street");
      assert.equal(url.searchParams.get("country"), "gb");
      assert.equal(url.searchParams.get("proximity"), "-0.1278,51.5074");
      assert.equal(url.searchParams.get("limit"), "8");
      assert.equal(url.searchParams.get("types"), "address,postcode,place");
      assert.equal(url.searchParams.get("permanent"), String(purpose === "profile"));
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      return Response.json({ features: [feature("address", "W1F 0UT", { secret: "not-for-client" })] });
    }, "fixture-token");
    assert.deepEqual(results, [{ id: "address-W1F 0UT", kind: "address", label: "20 Broadwick Street, London W1F 0UT, United Kingdom", coordinates: { latitude: 51.513, longitude: -0.135 }, line1: "20 Broadwick Street", city: "London", state: "England", postcode: "W1F 0UT" }]);
  }
});

test("full postcodes exclude neighbouring matches and postcode results never invent a street", async () => {
  const results = await searchAddresses("w1f0ut", "browse", async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("q"), "W1F 0UT");
    assert.equal(url.searchParams.get("autocomplete"), "false");
    return Response.json({ features: [feature("postcode"), feature("address", "W1F 0UU")] });
  }, "fixture-token");
  assert.equal(results.length, 1);
  assert.equal(results[0].line1, "");
  assert.equal(results[0].postcode, "W1F 0UT");
});

test("malformed, foreign, unsupported and duplicate results cannot become selectable locations", async () => {
  const results = await searchAddresses("London", "browse", async () => Response.json({ features: [
    null, feature("address", "W1F 0UT", { coordinates: { latitude: 100, longitude: 0 } }),
    feature("address", "W1F 0UT", { context: { country: { country_code: "US" } } }),
    feature("country"), feature("address"), feature("address"),
    feature("place", "", { name: "London", full_address: "London, United Kingdom" }),
  ] }), "fixture-token");
  assert.equal(results.length, 2);
  assert.equal(results[1].city, "London");
  assert.equal(results[1].line1, "");
  assert.equal(results[1].postcode, "");
});

test("provider outages are distinct from no matches and never expose tokens", async () => {
  for (const fetcher of [
    async () => { throw Error("private-token-url"); },
    async () => new Response("private-token", { status: 403 }),
    async () => Response.json({ error: "private-token" }),
    async () => new Response("not json"),
  ]) {
    await assert.rejects(searchAddresses("London", "browse", fetcher, "fixture-token"), /Address search is unavailable/);
  }
  await assert.rejects(searchAddresses("London", "browse", async () => { throw Error("should not call"); }, ""), /Address search is unavailable/);
  assert.deepEqual(await searchAddresses("London", "browse", async () => Response.json({ features: [] }), "fixture-token"), []);
});

test("public search requires same-origin bounded JSON and rejects unknown provider options before fetching", async () => {
  let calls = 0;
  const lookup = async (query: string, purpose: string) => {
    calls++;
    assert.equal(query, "W1F 0UT");
    assert.equal(purpose, "browse");
    return [];
  };
  for (const body of [
    { query: "ab", purpose: "browse" }, { query: "a".repeat(121), purpose: "browse" },
    { query: null, purpose: "browse" }, { query: "London\n", purpose: "browse" },
    { query: "London", purpose: "other" }, { query: "London", purpose: "browse", url: "https://evil.test" },
  ]) assert.equal((await handleAddressSearch(request(body), lookup)).status, 400);
  assert.equal((await handleAddressSearch(request({ query: "London", purpose: "browse" }, "https://evil.test"), lookup)).status, 403);
  assert.equal((await handleAddressSearch(new Request("http://localhost:4319/api/location/search"), lookup)).status, 405);
  assert.equal((await handleAddressSearch(request({ query: "a".repeat(3000), purpose: "browse" }), lookup)).status, 413);
  assert.equal(calls, 0);
  const result = await handleAddressSearch(request({ query: "w1f0ut", purpose: "browse" }), lookup);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(await result.json(), { results: [] });
  assert.equal(calls, 1);
});
