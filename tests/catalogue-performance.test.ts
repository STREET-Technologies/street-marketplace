import test from "node:test";
import assert from "node:assert/strict";
import { createAsyncCache } from "../lib/async-cache.ts";
import { responsiveImage, sizedImageUrl } from "../lib/commerce-images.ts";
import { createStreetApi } from "../lib/server/street-api.ts";

test("browsing cache coalesces reads, expires freshness, retains snapshots and bounds memory", async () => {
  let time = 1000,
    calls = 0;
  const cache = createAsyncCache<number>({
    maxEntries: 2,
    retentionMs: 500,
    now: () => time,
  });
  const load = async () => ++calls;
  assert.deepEqual(
    await Promise.all([cache.read("a", load, 100), cache.read("a", load, 100)]),
    [1, 1],
  );
  assert.equal(await cache.read("a", load, 100), 1);
  time += 101;
  assert.equal(cache.peek("a"), 1);
  assert.equal(await cache.read("a", load, 100), 2);
  assert.equal(await cache.read("a", load, 0), 3);
  time += 500;
  assert.equal(cache.peek("a"), undefined);
  await cache.read("b", load, 100);
  await cache.read("c", load, 100);
  assert.equal(cache.peek("a"), undefined);
});

test("clearing isolates sessions, ignores late responses and failed requests can retry", async () => {
  const cache = createAsyncCache<string>();
  let resolve!: (value: string) => void;
  const old = cache.read(
    "address",
    () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
    1000,
  );
  await Promise.resolve();
  cache.clear();
  await cache.read("address", async () => "new session", 1000);
  resolve("old session");
  await old;
  assert.equal(cache.peek("address"), "new session");
  await assert.rejects(
    cache.read(
      "failed",
      async () => {
        throw Error("offline");
      },
      1000,
    ),
  );
  assert.equal(
    await cache.read("failed", async () => "retry worked", 1000),
    "retry worked",
  );
  assert.equal(
    await cache.read("other-location", async () => "other stock", 1000),
    "other stock",
  );
});

test("Shopify image sizes retain version and aspect ratio; other hosts and vectors pass through", () => {
  const src = "https://cdn.shopify.com/s/files/1/image.jpg?v=123&height=1200";
  const image = responsiveImage(src, "thumbnail");
  assert.equal(new URL(image.src).searchParams.get("width"), "200");
  assert.equal(new URL(image.src).searchParams.get("v"), "123");
  assert.equal(new URL(image.src).searchParams.has("height"), false);
  assert.match(image.srcSet!, /width=2048 2048w/);
  assert.equal(image.sizes, "64px");
  for (const url of [
    "https://cdn.shopify.com.evil.test/photo.jpg",
    "/assets/local.jpg",
    "https://example.com/photo.jpg",
    "https://cdn.shopify.com/logo.svg",
  ]) {
    assert.equal(sizedImageUrl(url, 400), url);
    assert.deepEqual(responsiveImage(url, "shop"), { src: url });
  }
});

test("directory reuses public projection across categories and pages, isolates exact coordinates and retries failure", async () => {
  let calls = 0,
    fail = false;
  const api = createStreetApi(async () => {
    calls++;
    if (fail) return Response.json({}, { status: 503 });
    return Response.json({
      data: {
        data: [
          {
            id: "vendor",
            outletId: "branch",
            storeName: "Shop",
            vendorCategory: "Fashion",
            distance: 1,
          },
        ],
        meta: { total: 1, page: 1, totalPages: 1 },
      },
    });
  });
  const coordinates = { latitude: 51.5, longitude: -0.1 };
  await Promise.all([
    api.vendors(1, coordinates),
    api.vendors(1, coordinates, "Fashion"),
  ]);
  await api.vendors(2, coordinates);
  assert.equal(calls, 1);
  await api.vendors(1, { latitude: 51.51, longitude: -0.1 });
  assert.equal(calls, 2);
  fail = true;
  await assert.rejects(api.vendors(1));
  fail = false;
  await api.vendors(1);
  assert.equal(calls, 4);
});

test("catalogue reads separate branches and addresses, reuse intent requests, and clear on owner change", async (t) => {
  const { catalogueCache, readCatalogue, productUrl, setCatalogueOwner } =
    await import("../lib/client/catalogue.ts");
  catalogueCache.clear();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ request: ++calls }),
  );
  const product = productUrl({
    vendorId: "shop",
    productId: "product",
    locationGid: "branch-1",
  });
  assert.deepEqual(
    await Promise.all([readCatalogue(product), readCatalogue(product)]),
    [{ request: 1 }, { request: 1 }],
  );
  await readCatalogue(
    productUrl({
      vendorId: "shop",
      productId: "product",
      locationGid: "branch-2",
    }),
  );
  assert.equal(calls, 2);
  const home = "/api/catalogue/vendors?addressId=home&page=1";
  const work = "/api/catalogue/vendors?addressId=work&page=1";
  setCatalogueOwner("owner-a");
  await readCatalogue(home);
  await readCatalogue(work);
  await readCatalogue(home);
  assert.equal(calls, 4);
  setCatalogueOwner("owner-b");
  assert.equal(catalogueCache.peek(home), undefined);
  await readCatalogue(home);
  assert.equal(calls, 5);
  await readCatalogue(home, true);
  assert.equal(calls, 6);
  catalogueCache.clear();
});

test("gallery look-ahead is bounded, wraps and does not duplicate current or small-gallery images", async () => {
  const { adjacentGalleryImages } = await import("../lib/commerce-images.ts");
  assert.deepEqual(adjacentGalleryImages([], 0), []);
  assert.deepEqual(adjacentGalleryImages(["a"], 0), []);
  assert.deepEqual(adjacentGalleryImages(["a", "b"], 0), ["b"]);
  assert.deepEqual(adjacentGalleryImages(["a", "b", "c", "d", "e", "f"], 0), [
    "b",
    "c",
    "f",
  ]);
  assert.deepEqual(adjacentGalleryImages(["a", "b", "c", "d", "e", "f"], 5), [
    "a",
    "b",
    "e",
  ]);
});
