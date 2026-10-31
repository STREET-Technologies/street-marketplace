import test from "node:test";
import assert from "node:assert/strict";
import {
  createStreetApi,
  ApiError,
  customerFrom,
  vendorPageFrom,
} from "../lib/server/street-api.ts";
import { stagingUrl, STAGING_API } from "../lib/server/config.ts";

test("upstream paths cannot escape staging or API prefix", () => {
  assert.equal(stagingUrl("/auth/me").href, STAGING_API + "/auth/me");
  for (const path of [
    "https://api.street.london/v1",
    "//api.street.london/v1",
    "/../orders",
    "/%2e%2e/orders",
    "/\\evil",
    "/auth/me#fragment",
  ]) {
    assert.throws(() => stagingUrl(path));
  }
});

test("API pins origin, disables caching/redirects and never forwards browser cookies", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const api = createStreetApi(async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      data: { id: "canonical-id", phone: "+447700900001", password: "private" },
    });
  });
  const user = await api.me("access-token");
  assert.equal(user.id, "canonical-id");
  assert.equal("password" in user, false);
  assert.equal(calls[0].url, STAGING_API + "/auth/me");
  assert.equal(calls[0].init?.cache, "no-store");
  assert.equal(calls[0].init?.redirect, "error");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("authorization"), "Bearer access-token");
  assert.equal(headers.has("cookie"), false);
});

test("API does not retry mutations and sanitizes upstream errors", async () => {
  let calls = 0;
  const api = createStreetApi(async () => {
    calls++;
    return new Response("secret debug dump", { status: 500 });
  });
  await assert.rejects(
    api.verifyOtp("+447700900001", "123456"),
    (error) =>
      error instanceof ApiError &&
      error.status === 502 &&
      !error.message.includes("secret"),
  );
  assert.equal(calls, 1);
  const offline = createStreetApi(async () => {
    throw new Error("private URL/token");
  });
  await assert.rejects(
    offline.me("token"),
    (error) =>
      error instanceof ApiError &&
      error.status === 503 &&
      !error.message.includes("private"),
  );
});

test("OTP and refresh preserve existing STREET payloads and canonical identity", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const api = createStreetApi(async (url, init) => {
    calls.push({
      path: new URL(String(url)).pathname,
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({
      data: {
        accessToken: "new-access",
        refreshToken: "same-refresh",
        user: { id: "mobile-user-id" },
      },
    });
  });
  assert.equal(
    (await api.verifyOtp("+447700900001", "123456")).user.id,
    "mobile-user-id",
  );
  await api.refresh("refresh-token");
  await api.logout("refresh-token");
  assert.deepEqual(calls, [
    {
      path: "/v1/auth/verify-otp",
      body: { phone: "+447700900001", code: "123456" },
    },
    { path: "/v1/auth/refresh", body: { refreshToken: "refresh-token" } },
    { path: "/v1/auth/logout", body: { refreshToken: "refresh-token" } },
  ]);
});

test("projections keep outlet identity and exclude private/customer credential fields", () => {
  const page = vendorPageFrom({
    data: [
      {
        id: "vendor",
        outletId: "outlet",
        shopifyLocationGid: "gid://shopify/Location/1",
        storeName: "Test shop",
        storeImage: "javascript:alert(1)",
        email: "private",
        commissionPercentage: 20,
        storefrontAccessToken: "token",
      },
    ],
    meta: { total: 1, page: 1, totalPages: 1 },
  });
  assert.equal(page.outlets[0].outletId, "outlet");
  assert.equal(page.outlets[0].locationGid, "gid://shopify/Location/1");
  assert.equal(page.outlets[0].image, null);
  assert.equal(JSON.stringify(page).includes("token"), false);
  assert.equal(JSON.stringify(page).includes("commission"), false);
  assert.throws(() => vendorPageFrom({ data: [], meta: {} }), ApiError);
  assert.throws(() => customerFrom({ email: "no-id" }), ApiError);
});

test("nearby shops aggregate all vendor pages before sorting, category filtering and outlet pagination", async () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({
    id: "vendor",
    outletId: `outlet-${i}`,
    storeName: `Shop ${i}`,
    vendorCategory: i % 2 ? "Fashion" : "Activewear",
    address: `${i} High Street`,
    postcode: "W1F 9PT",
    distance: 14 - i,
    logo: "private-unused",
    storefrontAccessToken: "secret",
  }));
  const calls: URL[] = [];
  const api = createStreetApi(async (url) => {
    const query = new URL(String(url));
    calls.push(query);
    const page = Number(query.searchParams.get("page"));
    return Response.json({
      data: {
        data:
          page === 1
            ? rows.slice(0, 8)
            : page === 2
              ? []
              : [rows[0], ...rows.slice(8)],
        meta: { total: 14, page, totalPages: 3 },
      },
    });
  });
  const coordinates = { latitude: 51.5, longitude: -0.1 };
  const first = await api.vendors(1, coordinates);
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(
      (u) =>
        u.searchParams.get("user_latitude") === "51.5" &&
        u.searchParams.get("user_longitude") === "-0.1",
    ),
  );
  assert.deepEqual(first.categories, ["Activewear", "Fashion"]);
  assert.equal(first.total, 14);
  assert.equal(first.totalPages, 2);
  assert.deepEqual(
    first.outlets.map((o) => o.distanceMiles),
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  assert.equal(first.outlets[0].address, "13 High Street");
  assert.equal(first.outlets[0].postcode, "W1F 9PT");
  assert.equal(JSON.stringify(first).includes("secret"), false);
  const second = await api.vendors(2, coordinates);
  assert.deepEqual(
    second.outlets.map((o) => o.distanceMiles),
    [13, 14],
  );
  const filtered = await api.vendors(1, coordinates, "Fashion");
  assert.equal(filtered.total, 7);
  assert.deepEqual(filtered.categories, first.categories);
  assert.ok(filtered.outlets.every((o) => o.category === "Fashion"));
  const empty = await api.vendors(1, coordinates, "Missing");
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.categories, first.categories);
});

test("shop projection never presents unknown or invalid distance as zero", () => {
  for (const distance of [undefined, null, -1, "2", Infinity]) {
    const page = vendorPageFrom({
      data: [{ id: "v", storeName: "Shop", distance }],
      meta: { total: 1, page: 1, totalPages: 1 },
    });
    assert.equal(page.outlets[0].distanceMiles, null);
    assert.equal(page.outlets[0].address, null);
  }
});


test("shop cards project safe logos without vendor integration fields", () => {
  for (const [logo, expected] of [["https://cdn.example/logo.svg", "https://cdn.example/logo.svg"], [null,null], ["javascript:alert(1)",null], ["http://insecure.example/logo.png",null]]) {
    const result = vendorPageFrom({data:[{id:"v",storeName:"Shop",logo,storefrontAccessToken:"SECRET"}],meta:{total:1,page:1,totalPages:1}});
    assert.equal(result.outlets[0].logo,expected);
    assert.equal(JSON.stringify(result).includes("SECRET"),false);
  }
});
