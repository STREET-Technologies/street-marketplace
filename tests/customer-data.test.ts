import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { createStreetApi, ApiError } from "../lib/server/street-api.ts";
import { addressesFrom } from "../lib/server/customer-data.ts";
import {
  handleFavouriteChange,
  handleDeliveryCheck,
  handleCatalogue,
  handleCustomerContext,
  handleVendors,
} from "../lib/server/web-api.ts";
const vendorId = "4a29e85a-92fd-47da-88a2-96fcbd78b557",
  outletId = "c769d5ce-e495-41c9-a5a9-88a7f2826484",
  productId = "576fa9b6-3775-426c-86d5-5ef8710c35e9",
  addressId = "17e49931-5ad0-44f8-895a-393752d2babb";
const address = {
  id: addressId,
  label: "Home",
  line1: "1 Test Street",
  city: "London",
  postcode: "W1F 9PT",
  latitude: "51.51",
  longitude: "-0.13",
  isDefault: true,
  userId: "private-owner",
  deliveryInstructions: "Leave with reception",
  internalNotes: "PRIVATE",
};
const cookie = { cookie: "street_staging_access=customer-token" };
function request(
  path: string,
  body?: unknown,
  origin = "https://marketplace.example",
) {
  return new NextRequest(`https://marketplace.example/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...cookie, origin, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const envelope = (data: unknown) => Response.json({ data });
test("addresses accept decimal strings, reject missing/zero coordinates and omit private fields", () => {
  const rows = addressesFrom([
    address,
    { ...address, latitude: null, longitude: null },
    { ...address, latitude: 0, longitude: 0 },
  ]);
  assert.deepEqual(rows[0].coordinates, { latitude: 51.51, longitude: -0.13 });
  assert.equal(rows[1].coordinates, null);
  assert.equal(rows[2].coordinates, null);
  assert.ok(!JSON.stringify(rows).includes("PRIVATE"));
  assert.ok(!JSON.stringify(rows).includes("private-owner"));
  assert.equal(rows[0].deliveryInstructions, "Leave with reception");
});
test("favourite changes require same origin, authenticated cookie and exact body; no mutation on invalid input", async () => {
  let calls = 0;
  const api = createStreetApi(async () => {
    calls++;
    return envelope(null);
  });
  const good = { kind: "product", vendorId, productId, saved: true };
  for (const [body, origin] of [
    [good, "https://evil.example"],
    [{ ...good, userId: "someone" }, "https://marketplace.example"],
    [
      { ...good, productId: "gid://shopify/Product/123" },
      "https://marketplace.example",
    ],
    [{ ...good, saved: "yes" }, "https://marketplace.example"],
  ] as const) {
    const result = await handleFavouriteChange(
      request("favourites/change", body, origin),
      api,
    );
    assert.ok(result.status >= 400);
  }
  const noCookie = new NextRequest(
    "https://marketplace.example/api/favourites/change",
    {
      method: "POST",
      headers: {
        origin: "https://marketplace.example",
        "content-type": "application/json",
      },
      body: JSON.stringify(good),
    },
  );
  assert.equal((await handleFavouriteChange(noCookie, api)).status, 401);
  assert.equal(calls, 0);
});
test("product/outlet mutations preserve IDs and use the authenticated customer; only absent DELETE is accepted", async () => {
  const calls: { url: URL; method: string; body: unknown }[] = [];
  const api = createStreetApi(async (url, init) => {
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer customer-token",
    );
    calls.push({
      url: new URL(String(url)),
      method: init!.method!,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return envelope({ userId: "PRIVATE" });
  });
  assert.equal(
    (
      await handleFavouriteChange(
        request("favourites/change", {
          kind: "product",
          vendorId,
          productId,
          saved: true,
        }),
        api,
      )
    ).status,
    200,
  );
  await api.setFavourite(
    "customer-token",
    { kind: "shop", vendorId, outletId },
    true,
  );
  await api.setFavourite(
    "customer-token",
    { kind: "shop", vendorId, outletId },
    false,
  );
  await api.setFavourite(
    "customer-token",
    { kind: "product", vendorId, productId },
    false,
  );
  assert.deepEqual(calls[0].body, { vendorId, productShopifyId: productId });
  assert.deepEqual(calls[1].body, { vendorId, outletId });
  assert.ok(calls[2].url.pathname.endsWith(outletId));
  assert.equal(calls[3].url.searchParams.get("productShopifyId"), productId);
  const absent = createStreetApi(async () => new Response("", { status: 404 }));
  await absent.setFavourite(
    "t",
    { kind: "product", vendorId, productId },
    false,
  );
  await assert.rejects(
    absent.setFavourite("t", { kind: "product", vendorId, productId }, true),
    (e) => e instanceof ApiError && e.status === 404,
  );
});
test("saved-address queries resolve ownership on server, replace injected coordinates, and fail closed for missing addresses", async () => {
  let searchCalls = 0;
  const api = createStreetApi(async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/user-addresses")) {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer customer-token",
      );
      return envelope([address]);
    }
    searchCalls++;
    assert.equal(u.searchParams.get("user_latitude"), "51.51");
    assert.equal(u.searchParams.get("user_longitude"), "-0.13");
    return envelope({ data: [], meta: { total: 0 } });
  });
  const good = await handleCatalogue(
    request(
      `catalogue/browse?kind=search&query=coat&addressId=${addressId}&latitude=0&longitude=0`,
    ),
    api,
  );
  assert.equal(good.status, 200);
  const missing = await handleCatalogue(
    request(`catalogue/browse?kind=search&query=coat&addressId=${productId}`),
    api,
  );
  assert.equal(missing.status, 404);
  assert.equal(searchCalls, 1);
  const guest = await handleCatalogue(
    new NextRequest(
      `https://marketplace.example/api/catalogue/browse?kind=search&query=coat&addressId=${addressId}`,
    ),
    api,
  );
  assert.equal(guest.status, 401);
});
test("delivery check traverses empty vendor pages, matches exact outlet, and checks hours only after a match", async () => {
  const pages: number[] = [];
  const api = createStreetApi(async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/user-addresses")) return envelope([address]);
    if (u.pathname.endsWith("/online-status")) {
      assert.equal(u.searchParams.get("outletId"), outletId);
      return envelope({ isCurrentlyOpen: false });
    }
    const page = Number(u.searchParams.get("page"));
    pages.push(page);
    return envelope({
      data:
        page === 1
          ? []
          : [{ id: vendorId, outletId, storeName: "Shop", isOnline: true }],
      meta: { page, total: 2, totalPages: 2 },
    });
  });
  const result = await handleDeliveryCheck(
    request(
      `delivery-check?addressId=${addressId}&vendorId=${vendorId}&outletId=${outletId}`,
    ),
    api,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { status: "available", isOpen: false });
  assert.deepEqual(pages, [1, 2]);
});
test("customer context is cookie scoped and strips personal upstream metadata from favourites", async () => {
  const api = createStreetApi(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/auth/me")) return envelope({ id: "customer" });
    if (path.endsWith("/user-addresses")) return envelope([address]);
    if (path.endsWith("/favorites/products"))
      return envelope([
        { vendorId, productShopifyId: productId, userId: "PRIVATE" },
      ]);
    return envelope([
      { vendorId, outletId, userId: "PRIVATE" },
      { vendorId, outletId: null },
    ]);
  });
  const response = await handleCustomerContext(
    request("customer-context"),
    api,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  const data = await response.json();
  assert.equal(data.userId, "customer");
  assert.equal(data.favourites.length, 2);
  assert.ok(!JSON.stringify(data).includes("PRIVATE"));
});

test("nearby shops resolve only the signed-in customer's saved address", async () => {
  const calls: URL[] = [];
  const api = createStreetApi(async (url, init) => {
    const parsed = new URL(String(url));
    calls.push(parsed);
    if (parsed.pathname.endsWith("/user-addresses")) {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer customer-token",
      );
      return envelope([address]);
    }
    assert.equal(parsed.searchParams.get("user_latitude"), "51.51");
    assert.equal(parsed.searchParams.get("user_longitude"), "-0.13");
    return envelope({ data: [], meta: { total: 0, page: 1, totalPages: 0 } });
  });
  assert.equal(
    (
      await handleVendors(
        request(`catalogue/vendors?addressId=${addressId}`),
        api,
      )
    ).status,
    200,
  );
  assert.equal(calls.length, 2);
  assert.equal(
    (
      await handleVendors(
        request(`catalogue/vendors?addressId=${productId}`),
        api,
      )
    ).status,
    404,
  );
  assert.equal(calls.length, 3);
});
