import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import {
  ApiError,
  createStreetApi,
  favouriteRefs,
} from "../lib/server/street-api.ts";
import { handleFavourites, sessionCookies } from "../lib/server/web-api.ts";

test("saved data comes from authenticated account references, not sample IDs or browser identity", async () => {
  const paths: string[] = [];
  const api = createStreetApi(async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    assert.equal(init?.method, "GET");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer customer-session",
    );
    if (path.endsWith("/favorites/products"))
      return Response.json({
        data: [
          {
            vendorId: "vendor-1",
            productShopifyId: "gid://shopify/Product/123",
            userId: "private-user",
            id: "private-row",
          },
        ],
      });
    if (path.endsWith("/favorites/vendors"))
      return Response.json({
        data: [
          { vendorId: "vendor-1", outletId: "branch-2" },
          { vendorId: "vendor-1", outletId: "branch-3" },
        ],
      });
    if (path.includes("/products/"))
      return Response.json({
        data: {
          title: "Dress saved on mobile",
          images: [{ src: "https://cdn.shopify.com/dress.jpg" }],
          vendor: {
            storeName: "Test retailer",
            storefrontAccessToken: "secret",
            commissionPercentage: 10,
          },
        },
      });
    return Response.json({
      data: {
        storeName: "Test retailer",
        storeImage: "https://cdn.shopify.com/shop.jpg",
        outletId: "primary-branch",
        outletName: "Wrong branch",
        email: "private-email",
      },
    });
  });
  const result = await api.favourites("customer-session");
  assert.equal(result.products.items[0].name, "Dress saved on mobile");
  assert.equal(result.products.items[0].productId, "gid://shopify/Product/123");
  assert.ok(
    paths.some((path) => path.endsWith("gid%3A%2F%2Fshopify%2FProduct%2F123")),
  );
  assert.deepEqual(
    result.shops.items.map((item) => item.outletId),
    ["branch-2", "branch-3"],
  );
  assert.notEqual(result.shops.items[0].key, result.shops.items[1].key);
  assert.equal(
    paths.filter((path) => path === "/v1/vendors/vendor-1").length,
    1,
  );
  for (const excluded of [
    "private-user",
    "private-row",
    "secret",
    "commissionPercentage",
    "private-email",
    "Wrong branch",
    "primary-branch",
  ])
    assert.equal(JSON.stringify(result).includes(excluded), false);
});

test("pagination limits detail fanout and preserves total/order", async () => {
  let details = 0;
  const refs = Array.from({ length: 25 }, (_, i) => ({
    vendorId: "shop",
    productShopifyId: `product-${i}`,
  }));
  const api = createStreetApi(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/favorites/products"))
      return Response.json({ data: refs });
    if (path.endsWith("/favorites/vendors")) return Response.json({ data: [] });
    details++;
    return Response.json({
      data: { title: path.split("/").pop(), images: [] },
    });
  });
  const page = await api.favourites("token", 2);
  assert.equal(details, 12);
  assert.equal(page.products.total, 25);
  assert.equal(page.products.totalPages, 3);
  assert.equal(page.products.items[0].productId, "product-12");
  assert.equal(page.products.items[11].productId, "product-23");
});

test("deleted and temporarily unavailable details retain saved entries; auth failures propagate", async () => {
  for (const status of [404, 503, 401]) {
    const api = createStreetApi(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/favorites/products"))
        return Response.json({
          data: [{ vendorId: "shop", productShopifyId: "product" }],
        });
      if (path.endsWith("/favorites/vendors"))
        return Response.json({ data: [] });
      return new Response(null, { status });
    });
    if (status === 401)
      await assert.rejects(
        api.favourites("expired"),
        (error) => error instanceof ApiError && error.status === 401,
      );
    else {
      const result = await api.favourites("token");
      assert.equal(result.products.total, 1);
      assert.equal(
        result.products.items[0].status,
        status === 404 ? "unavailable" : "error",
      );
    }
  }
});

test("invalid or failed favourite lists are never reported as empty", async () => {
  assert.throws(() => favouriteRefs({}, "products"), ApiError);
  assert.throws(
    () => favouriteRefs([{ vendorId: "vendor" }], "products"),
    ApiError,
  );
  const api = createStreetApi(
    async () => new Response("down", { status: 503 }),
  );
  await assert.rejects(api.favourites("token"), ApiError);
});

test("favourites route requires cookie, rejects identity injection, and never caches personal data", async () => {
  let calls = 0;
  const api = createStreetApi(async (_url, init) => {
    calls++;
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer account-a",
    );
    return Response.json({ data: [] });
  });
  assert.equal(
    (
      await handleFavourites(
        new NextRequest("https://marketplace.example/api/favourites"),
        api,
      )
    ).status,
    401,
  );
  assert.equal(calls, 0);
  const headers = { cookie: `${sessionCookies.access}=account-a` };
  for (const query of [
    "userId=account-b",
    "productsPage=-1",
    "shopsPage=1.5",
  ]) {
    assert.equal(
      (
        await handleFavourites(
          new NextRequest(
            `https://marketplace.example/api/favourites?${query}`,
            { headers },
          ),
          api,
        )
      ).status,
      400,
    );
  }
  assert.equal(calls, 0);
  const response = await handleFavourites(
    new NextRequest("https://marketplace.example/api/favourites", { headers }),
    api,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(calls, 2);
});
