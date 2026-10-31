import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import {
  addCartLine,
  restoreCart,
  cartStorageKey,
  cartIntent,
} from "../lib/cart.ts";
import { cartIntentFrom, checkCart } from "../lib/server/cart-check.ts";
import { createStreetApi } from "../lib/server/street-api.ts";
import { handleCartCheck } from "../lib/server/web-api.ts";
const vendorId = "4a29e85a-92fd-47da-88a2-96fcbd78b557",
  outletId = "c769d5ce-e495-41c9-a5a9-88a7f2826484",
  productId = "576fa9b6-3775-426c-86d5-5ef8710c35e9",
  addressId = "17e49931-5ad0-44f8-895a-393752d2babb";
const outlet = { vendorId, outletId, shopName: "Shop", branch: "Soho" };
const line = {
  productId,
  variantId: "44166662783110",
  quantity: 1,
  title: "Coat",
  variantTitle: "XS",
  image: null,
  unitPrice: 159,
};
const draft = { ...outlet, lines: [line] };
const intent = cartIntent(draft, addressId);
test("one-outlet cart merges exact variants, respects stock, and requires explicit branch replacement", () => {
  const first = addCartLine(null, outlet, line, 3).cart;
  const second = addCartLine(first, outlet, line, 3).cart;
  assert.equal(second.lines[0].quantity, 2);
  const different = addCartLine(
    second,
    outlet,
    { ...line, variantId: "2" },
    3,
  ).cart;
  assert.equal(different.lines.length, 2);
  const blocked = addCartLine(
    different,
    { ...outlet, outletId: addressId },
    line,
    3,
  );
  assert.equal(blocked.conflict, true);
  assert.deepEqual(blocked.cart, different);
  const replaced = addCartLine(
    different,
    { ...outlet, outletId: addressId },
    line,
    3,
    true,
  );
  assert.equal(replaced.cart.outletId, addressId);
  assert.equal(replaced.cart.lines.length, 1);
  assert.throws(() => addCartLine(second, outlet, line, 2));
});
test("persistence is account/environment scoped and rejects corrupted or duplicate cart lines", () => {
  assert.notEqual(cartStorageKey("one"), cartStorageKey("two"));
  assert.match(cartStorageKey("one"), /staging/);
  assert.deepEqual(restoreCart(JSON.stringify(draft)), draft);
  assert.equal(restoreCart("{bad"), null);
  for (const bad of [
    { ...draft, lines: [line, line] },
    { ...draft, lines: [{ ...line, quantity: 0 }] },
    { ...draft, lines: [{ ...line, image: "javascript:alert(1)" }] },
    { ...draft, outletId: "bogus" },
  ])
    assert.equal(restoreCart(JSON.stringify(bad)), null);
});
test("cart request accepts identities and quantities only; prices, user identity and location overrides are rejected", () => {
  assert.deepEqual(cartIntentFrom(intent), intent);
  for (const bad of [
    { ...intent, userId: "other" },
    { ...intent, locationGid: "gid://shopify/Location/1" },
    { ...intent, lines: [{ ...intent.lines[0], price: 1 }] },
    { ...intent, lines: [intent.lines[0], intent.lines[0]] },
    { ...intent, lines: [{ ...intent.lines[0], quantity: 1.5 }] },
    { ...intent, lines: [{ ...intent.lines[0], variantId: productId }] },
  ])
    assert.throws(() => cartIntentFrom(bad));
});
function apiFixture(
  options: {
    stock?: number;
    listed?: boolean;
    detailFail?: boolean;
    address?: boolean;
    outlet?: boolean;
    pages?: number;
  } = {},
) {
  const calls: string[] = [];
  const api = createStreetApi(async (url, init) => {
    const u = new URL(String(url));
    calls.push(u.pathname + u.search);
    assert.equal(init?.method, "GET");
    const data = (value: unknown) => Response.json({ data: value });
    if (u.pathname.endsWith("/auth/me")) return data({ id: "customer" });
    if (u.pathname.endsWith("/user-addresses"))
      return data(
        options.address === false
          ? []
          : [
              {
                id: addressId,
                label: "Home",
                line1: "1 Test Street",
                city: "London",
                postcode: "W1F",
                latitude: 51.51,
                longitude: -0.13,
              },
            ],
      );
    if (u.pathname.endsWith("/vendors"))
      return data({
        data:
          options.outlet === false
            ? []
            : [
                {
                  id: vendorId,
                  outletId,
                  storeName: "Shop",
                  shopifyLocationGid: "gid://shopify/Location/76565610630",
                  isOnline: true,
                },
              ],
        meta: { page: 1, total: 1, totalPages: 1 },
      });
    if (u.pathname.endsWith("/online-status"))
      return data({ isCurrentlyOpen: true });
    assert.equal(
      u.searchParams.get("locationGid"),
      "gid://shopify/Location/76565610630",
    );
    if (u.pathname.endsWith("/products"))
      return data({
        data:
          options.listed === false
            ? []
            : [{ id: productId, title: "Coat", vendor: "Shop", price: 179 }],
        meta: { total: options.pages ? options.pages * 12 : 1 },
      });
    if (options.detailFail) return new Response("", { status: 503 });
    return data({
      id: productId,
      title: "Coat",
      images: [],
      variants: [
        {
          id: line.variantId,
          title: "XS",
          price: "179",
          inventoryQuantity: options.stock ?? 3,
        },
      ],
    });
  });
  return { api, calls };
}
test("cart revalidation uses catalogue membership and server outlet location; prices come from the backend", async () => {
  const { api, calls } = apiFixture();
  const result = await checkCart(intent, "customer-token", api);
  assert.equal(result.userId, "customer");
  assert.equal(result.lines[0].unitPrice, 179);
  assert.equal(result.subtotal, 179);
  assert.equal(result.lines[0].issue, null);
  assert.ok(
    calls.findIndex((p) => p.includes("/products?")) <
      calls.findIndex((p) => p.includes("/products/" + productId)),
  );
});
test("low stock, missing membership and unresolved outlet never become a confirmed subtotal", async () => {
  let fixture = apiFixture({ stock: 0 });
  let result = await checkCart(intent, "token", fixture.api);
  assert.equal(result.lines[0].issue, "stock");
  assert.equal(result.subtotal, null);
  fixture = apiFixture({ listed: false });
  result = await checkCart(intent, "token", fixture.api);
  assert.equal(result.lines[0].issue, "unavailable");
  assert.ok(!fixture.calls.some((p) => p.includes("/products/" + productId)));
  fixture = apiFixture({ outlet: false });
  result = await checkCart(intent, "token", fixture.api);
  assert.equal(result.delivery.status, "unavailable");
  assert.equal(result.subtotal, null);
  assert.ok(!fixture.calls.some((p) => p.includes("/products")));
  fixture = apiFixture({ listed: false, pages: 21 });
  result = await checkCart(intent, "token", fixture.api);
  assert.equal(result.lines[0].issue, "unknown");
});
test("cart checking fails on foreign address or upstream outage, not a false valid review", async () => {
  await assert.rejects(
    checkCart(intent, "token", apiFixture({ address: false }).api),
  );
  await assert.rejects(
    checkCart(intent, "token", apiFixture({ detailFail: true }).api),
  );
});
test("cart route requires authenticated same-origin JSON and ignores no caller-supplied prices", async () => {
  const { api, calls } = apiFixture();
  const request = (origin: string, cookie = "street_staging_access=token") =>
    new NextRequest("https://marketplace.example/api/cart/check", {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify(intent),
    });
  assert.equal(
    (await handleCartCheck(request("https://evil.example"), api)).status,
    403,
  );
  assert.equal(
    (await handleCartCheck(request("https://marketplace.example", ""), api))
      .status,
    401,
  );
  assert.equal(calls.length, 0);
  const good = await handleCartCheck(
    request("https://marketplace.example"),
    api,
  );
  assert.equal(good.status, 200);
  assert.match(good.headers.get("cache-control")!, /no-store/);
});
