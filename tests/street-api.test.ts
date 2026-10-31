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
