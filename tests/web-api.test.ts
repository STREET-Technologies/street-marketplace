import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import {
  handleAuth,
  handleVendors,
  sessionCookies,
} from "../lib/server/web-api.ts";
import { ApiError, type StreetApi } from "../lib/server/street-api.ts";

const user = {
  id: "same-mobile-user",
  firstName: null,
  lastName: null,
  email: null,
  phone: "+447700900001",
};
const tokens = {
  accessToken: "private-access",
  refreshToken: "private-refresh",
};
function api(overrides: Partial<StreetApi> = {}): StreetApi {
  return {
    async updateProfile() {
      throw new Error("Not used in auth tests");
    },
    async saveAddress() {
      throw new Error("Not used in auth tests");
    },
    async deleteAddress() {
      throw new Error("Not used in auth tests");
    },
    async validateAddress() {
      throw new Error("Not used in auth tests");
    },
    async catalogue() {
      throw new Error("Not used in auth tests");
    },
    async outletForAddress() {
      return { outlet: null, delivery: { status: "unknown", isOpen: null } };
    },
    async addresses() {
      return [];
    },
    async customerContext() {
      return { userId: user.id, addresses: [], favourites: [] };
    },
    async setFavourite() {},
    async deliveryCheck() {
      return { status: "unknown", isOpen: null };
    },
    async requestOtp() {},
    async verifyOtp() {
      return { user, tokens };
    },
    async me() {
      return user;
    },
    async refresh() {
      return tokens;
    },
    async logout() {},
    async favourites() {
      return {
        products: { items: [], page: 1, total: 0, totalPages: 0 },
        shops: { items: [], page: 1, total: 0, totalPages: 0 },
      };
    },
    async vendors() {
      return { outlets: [], categories: [], total: 0, page: 1, totalPages: 0 };
    },
    ...overrides,
  };
}
function request(
  action: string,
  body: unknown = {},
  extra: Record<string, string> = {},
) {
  return new NextRequest(`https://marketplace.example/api/auth/${action}`, {
    method: action === "session" ? "GET" : "POST",
    headers: {
      origin: "https://marketplace.example",
      "content-type": "application/json",
      ...extra,
    },
    body: action === "session" ? undefined : JSON.stringify(body),
  });
}

test("verify OTP sets host-only HttpOnly cookies and returns no credentials", async () => {
  let called: unknown;
  const result = await handleAuth(
    request("verify-otp", { phone: "+44 7700 900001", code: "123456" }),
    "verify-otp",
    api({
      async verifyOtp(phone, code) {
        called = { phone, code };
        return { user, tokens };
      },
    }),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(called, { phone: "+447700900001", code: "123456" });
  assert.deepEqual(await result.json(), { user });
  for (const name of Object.values(sessionCookies)) {
    const cookie = result.cookies.get(name)!;
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.sameSite, "lax");
    assert.equal(cookie.path, "/");
    assert.equal(cookie.domain, undefined);
  }
  assert.match(result.headers.get("cache-control")!, /no-store/);
});

test("every mutation rejects foreign, absent and sibling origins before upstream", async () => {
  for (const action of [
    "request-otp",
    "verify-otp",
    "refresh",
    "logout",
  ] as const) {
    const origins: Record<string, string>[] = [
      { origin: "https://other.example" },
      { origin: "" },
      { "sec-fetch-site": "same-site" },
    ];
    for (const headers of origins) {
      let called = false;
      const result = await handleAuth(
        request(action, {}, headers),
        action,
        api({
          async requestOtp() {
            called = true;
          },
          async logout() {
            called = true;
          },
        }),
      );
      assert.equal(result.status, 403);
      assert.equal(called, false);
    }
  }
});

test("mutation validation rejects oversized, non-JSON and injected identity fields", async () => {
  const cases = [
    [request("request-otp", { phone: "x".repeat(3000) }), 413],
    [
      request(
        "request-otp",
        { phone: "+447700900001" },
        { "content-type": "text/plain" },
      ),
      415,
    ],
    [request("request-otp", { phone: "+447700900001", userId: "victim" }), 400],
    [request("request-otp", { phone: "07700900001" }), 400],
  ] as const;
  for (const [req, status] of cases)
    assert.equal((await handleAuth(req, "request-otp", api())).status, status);
  const malformed = new NextRequest(
    "https://marketplace.example/api/auth/request-otp",
    {
      method: "POST",
      headers: {
        origin: "https://marketplace.example",
        "content-type": "application/json",
      },
      body: "{",
    },
  );
  assert.equal((await handleAuth(malformed, "request-otp", api())).status, 400);
});

test("session uses only this request cookie; unauthenticated GET performs no refresh", async () => {
  let calls = 0;
  const service = api({
    async me(token) {
      calls++;
      return { ...user, id: token };
    },
    async refresh() {
      throw new Error("must not refresh on GET");
    },
  });
  assert.equal(
    (await handleAuth(request("session"), "session", service)).status,
    200,
  );
  assert.equal(
    (
      await handleAuth(
        request(
          "session",
          {},
          {
            cookie: `${sessionCookies.refresh}=existing-refresh`,
          },
        ),
        "session",
        service,
      )
    ).status,
    401,
  );
  const one = await handleAuth(
    request("session", {}, { cookie: `${sessionCookies.access}=user-one` }),
    "session",
    service,
  );
  const two = await handleAuth(
    request("session", {}, { cookie: `${sessionCookies.access}=user-two` }),
    "session",
    service,
  );
  assert.equal((await one.json()).user.id, "user-one");
  assert.equal((await two.json()).user.id, "user-two");
  assert.equal(calls, 2);
});

test("refresh consumes cookie, renews session without exposing tokens, rejects body tokens", async () => {
  let received = "";
  const service = api({
    async refresh(token) {
      received = token;
      return tokens;
    },
  });
  const result = await handleAuth(
    request(
      "refresh",
      {},
      { cookie: `${sessionCookies.refresh}=existing-refresh` },
    ),
    "refresh",
    service,
  );
  assert.equal(received, "existing-refresh");
  assert.deepEqual(await result.json(), { success: true });
  assert.equal(
    result.cookies.get(sessionCookies.access)?.value,
    tokens.accessToken,
  );
  assert.equal(
    (
      await handleAuth(
        request("refresh", { refreshToken: "attacker" }),
        "refresh",
        service,
      )
    ).status,
    400,
  );
});

test("invalid refresh clears both cookies, outage preserves them for retry", async () => {
  for (const status of [401, 503]) {
    const result = await handleAuth(
      request("refresh", {}, { cookie: `${sessionCookies.refresh}=old` }),
      "refresh",
      api({
        async refresh() {
          throw new ApiError(status, "failure");
        },
      }),
    );
    assert.equal(result.status, status);
    assert.equal(
      result.cookies.get(sessionCookies.refresh)?.maxAge,
      status === 401 ? 0 : undefined,
    );
  }
});

test("logout revokes supplied session before clearing and does not hide upstream failure", async () => {
  let revoked = "";
  const result = await handleAuth(
    request("logout", {}, { cookie: `${sessionCookies.refresh}=this-session` }),
    "logout",
    api({
      async logout(token) {
        revoked = token;
      },
    }),
  );
  assert.equal(revoked, "this-session");
  assert.equal(result.cookies.get(sessionCookies.access)?.maxAge, 0);
  assert.equal(result.cookies.get(sessionCookies.refresh)?.maxAge, 0);
  const failed = await handleAuth(
    request("logout", {}, { cookie: `${sessionCookies.refresh}=this-session` }),
    "logout",
    api({
      async logout() {
        throw new ApiError(503, "Unavailable");
      },
    }),
  );
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.has("set-cookie"), false);
});

test("catalogue adapter accepts only bounded pagination, never arbitrary upstream paths", async () => {
  for (const query of [
    "page=-1",
    "page=1.5",
    "page=1001",
    "url=https://api.street.london",
    "path=/auth/me",
  ]) {
    assert.equal(
      (
        await handleVendors(
          new NextRequest(
            `https://marketplace.example/api/catalogue/vendors?${query}`,
          ),
          api(),
        )
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await handleVendors(
        new NextRequest(
          "https://marketplace.example/api/catalogue/vendors?page=1",
        ),
        api(),
      )
    ).status,
    200,
  );
});

test("shop discovery validates location/category filters and forwards device coordinates", async () => {
  let captured: unknown[] = [];
  const service = api({
    async vendors(...args) {
      captured = args;
      return { outlets: [], categories: [], page: 1, total: 0, totalPages: 0 };
    },
  });
  const call = (query: string) =>
    handleVendors(
      new NextRequest(
        `https://marketplace.example/api/catalogue/vendors?${query}`,
      ),
      service,
    );
  assert.equal(
    (await call("latitude=51.5&longitude=-0.1&category=Fashion&page=2")).status,
    200,
  );
  assert.deepEqual(captured, [
    2,
    { latitude: 51.5, longitude: -0.1 },
    "Fashion",
  ]);
  for (const query of [
    "latitude=51",
    "longitude=0",
    "latitude=&longitude=0",
    "latitude=91&longitude=0",
    "latitude=0&longitude=181",
    "latitude=NaN&longitude=0",
    "page=1&page=2",
    "category=",
    "category=" + "a".repeat(121),
    "latitude=0&longitude=0&addressId=x",
  ])
    assert.equal((await call(query)).status, 400, query);
  assert.equal(
    (await call("addressId=17e49931-5ad0-44f8-895a-393752d2babb")).status,
    401,
  );
});
