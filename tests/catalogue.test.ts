import { NextRequest } from "next/server.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogueQuery,
  cataloguePath,
  productPageFrom,
  productDetailFrom,
} from "../lib/server/catalogue.ts";
import { createStreetApi, ApiError } from "../lib/server/street-api.ts";
import { handleCatalogue } from "../lib/server/web-api.ts";
const vendorId = "4a29e85a-92fd-47da-88a2-96fcbd78b557";
const productId = "576fa9b6-3775-426c-86d5-5ef8710c35e9";
const locationGid = "gid://shopify/Location/76565610630";
const params = (extra = {}) =>
  new URLSearchParams({ kind: "products", vendorId, locationGid, ...extra });
test("catalogue requires explicit outlet location and validates identifiers, paging and coordinates", () => {
  for (const extra of [
    { locationGid: "" },
    { vendorId: "../auth" },
    { locationGid: "https://evil.example" },
    { page: "0" },
    { page: "1.5" },
    { kind: "product", productId: "gid://shopify/Product/123" },
    { latitude: "90" },
    { latitude: "91", longitude: "0" },
    { latitude: "", longitude: "" },
    { userId: "another-user" },
  ]) {
    assert.throws(
      () => catalogueQuery(params(extra)),
      (error) => error instanceof ApiError && error.status === 400,
    );
  }
  const duplicate = params();
  duplicate.append("vendorId", vendorId);
  assert.throws(() => catalogueQuery(duplicate));
  const q = catalogueQuery(params({ query: "coat & dress", page: "2" }));
  const path = new URL(
    cataloguePath(q),
    "https://staging-api.street.london/v1/",
  );
  assert.equal(path.searchParams.get("locationGid"), locationGid);
  assert.equal(path.searchParams.get("search"), "coat & dress");
  assert.equal(path.searchParams.get("page"), "2");
});
test("catalogue projection excludes vendor secrets, rejects malformed data and retains unavailable prices", () => {
  const result = productPageFrom(
    {
      data: [
        {
          id: productId,
          title: "Coat",
          vendor: "Shop",
          price: "159",
          images: [{ src: "https://cdn.example/coat.jpg" }],
          description: "<script>bad</script>",
        },
        {
          id: "second",
          title: "Top",
          price: null,
          image: { src: "javascript:bad" },
        },
      ],
      meta: { total: 25 },
      vendor: { apiToken: "SECRET" },
    },
    catalogueQuery(params()),
  );
  assert.equal(result.totalPages, 3);
  assert.equal(result.products[0].price, 159);
  assert.equal(result.products[0].locationGid, locationGid);
  assert.equal(result.products[1].price, null);
  assert.equal(result.products[1].image, null);
  assert.ok(!JSON.stringify(result).includes("SECRET"));
  assert.throws(() =>
    productPageFrom(
      { data: [], meta: { total: -1 } },
      catalogueQuery(params()),
    ),
  );
});
test("search preserves each result outlet and mirror product identity; missing location is not ordinary empty results", () => {
  const query = catalogueQuery(
    new URLSearchParams({
      kind: "search",
      query: "coat",
      latitude: "0",
      longitude: "0",
    }),
  );
  assert.match(cataloguePath(query), /user_latitude=0/);
  const result = productPageFrom(
    {
      data: [
        {
          productId,
          productGid: "gid://shopify/Product/123",
          title: "Coat",
          price: 159,
          image: "https://cdn.example/coat.jpg",
          outlet: {
            vendorId,
            outletId: "branch-two",
            shopifyLocationGid: locationGid,
            outletName: "Soho",
          },
        },
      ],
      meta: { total: 1 },
    },
    query,
  );
  assert.equal(result.products[0].id, productId);
  assert.equal(result.products[0].outletId, "branch-two");
  assert.equal(
    productPageFrom(
      { data: [], meta: { total: 0 }, requiresLocation: true },
      query,
    ).requiresLocation,
    true,
  );
});
test("product details retain variant identity and unknown stock, dropping untrusted private fields", () => {
  const product = productDetailFrom({
    id: productId,
    title: "Coat",
    images: [
      { src: "https://cdn.example/coat.jpg" },
      { src: "data:text/html,bad" },
    ],
    variants: [
      {
        id: "44166662783110",
        title: "XS",
        price: "159",
        inventoryQuantity: 3,
        sku: "private",
      },
      { id: "two", title: "S", price: -1, inventoryQuantity: null },
    ],
    vendor: { token: "SECRET" },
  });
  assert.deepEqual(product.variants[0], {
    id: "44166662783110",
    title: "XS",
    price: 159,
    inventory: 3,
  });
  assert.equal(product.variants[1].inventory, null);
  assert.equal(product.variants[1].price, null);
  assert.equal(product.images.length, 1);
  assert.ok(!JSON.stringify(product).includes("SECRET"));
});
test("catalogue route forwards only validated staging queries and does not expose upstream objects", async () => {
  let calls = 0;
  const api = createStreetApi(async (url, init) => {
    calls++;
    const target = new URL(String(url));
    assert.equal(target.origin, "https://staging-api.street.london");
    assert.equal(target.searchParams.get("locationGid"), locationGid);
    assert.equal(init?.cache, "no-store");
    return Response.json({
      data: { data: [], meta: { total: 0 }, vendor: { token: "SECRET" } },
    });
  });
  const response = await handleCatalogue(
    new NextRequest(
      `https://marketplace.example/api/catalogue/browse?${params()}`,
    ),
    api,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.ok(!(await response.text()).includes("SECRET"));
  const bad = await handleCatalogue(
    new NextRequest(
      `https://marketplace.example/api/catalogue/browse?${params({ locationGid: "" })}`,
    ),
    api,
  );
  assert.equal(bad.status, 400);
  assert.equal(calls, 1);
});
