import test from "node:test";
import assert from "node:assert/strict";
import { locationPostcode } from "../lib/server/location-postcode.ts";
import { handleLocationPostcode } from "../lib/server/web-api.ts";
const coords = { latitude: 51.513, longitude: -0.139 };
const request = (body: unknown, origin = "http://localhost:4319") =>
  new Request("http://localhost:4319/api/location/postcode", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
test("reverse lookup uses fixed Mapbox endpoint, UK postcode-only query and temporary no-store result", async () => {
  const result = await locationPostcode(
    coords,
    async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.mapbox.com");
      assert.equal(url.pathname, "/search/geocode/v6/reverse");
      assert.equal(url.searchParams.get("types"), "postcode");
      assert.equal(url.searchParams.get("latitude"), String(coords.latitude));
      assert.equal(url.searchParams.get("country"), "gb");
      assert.equal(url.searchParams.has("permanent"), false);
      assert.equal(init?.cache, "no-store");
      return Response.json({
        features: [
          {
            properties: {
              feature_type: "postcode",
              name: "w1f0ut",
              secret: "private",
            },
          },
        ],
      });
    },
    "fixture-token",
  );
  assert.equal(result, "W1F 0UT");
});
test("missing token, provider failures and non-postcode data preserve fallback", async () => {
  let called = false;
  assert.equal(
    await locationPostcode(
      coords,
      async () => {
        called = true;
        throw Error();
      },
      "",
    ),
    null,
  );
  assert.equal(called, false);
  for (const fetcher of [
    async () => new Response("", { status: 429 }),
    async () => {
      throw Error("provider secret");
    },
    async () =>
      Response.json({
        features: [
          { properties: { feature_type: "address", name: "W1F 0UT" } },
        ],
      }),
    async () =>
      Response.json({
        features: [
          { properties: { feature_type: "postcode", name: "not a postcode" } },
        ],
      }),
  ])
    assert.equal(
      await locationPostcode(coords, fetcher, "fixture-token"),
      null,
    );
});
test("lookup route rejects foreign origins, invalid coordinates and extra fields before provider call", async () => {
  let calls = 0;
  const lookup = async () => {
    calls++;
    return "W1F 0UT";
  };
  assert.equal(
    (
      await handleLocationPostcode(
        request(coords, "https://other.invalid"),
        lookup,
      )
    ).status,
    403,
  );
  for (const body of [
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: -181 },
    { latitude: "51", longitude: 0 },
    { latitude: null, longitude: 0 },
    { ...coords, url: "https://other.invalid" },
  ])
    assert.equal(
      (await handleLocationPostcode(request(body), lookup)).status,
      400,
    );
  assert.equal(calls, 0);
  const result = await handleLocationPostcode(request(coords), lookup);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { postcode: "W1F 0UT" });
  assert.match(result.headers.get("cache-control")!, /no-store/);
});
