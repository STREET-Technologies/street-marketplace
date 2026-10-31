import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { NextRequest } from "next/server.js";
import { createStreetApi } from "../lib/server/street-api.ts";
import {
  googleChallengeCookie,
  handleGoogleStart,
  handleGoogleLogin,
  verifyGoogleCredential,
} from "../lib/server/google-auth.ts";

const clientId = "staging-web.apps.googleusercontent.com";
const origin = "https://marketplace.example";
const request = (body: unknown, cookie = "", requestOrigin = origin) =>
  new NextRequest(`${origin}/api/auth/google`, {
    method: "POST",
    headers: {
      origin: requestOrigin,
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
const { publicKey, privateKey } = await generateKeyPair("RS256");
const publicJwk = await exportJWK(publicKey);
const keys = createLocalJWKSet({
  keys: [{ ...publicJwk, kid: "test", alg: "RS256" }],
});
const verify = (token: string, audience: string, nonce: string) =>
  verifyGoogleCredential(token, audience, nonce, keys);
async function token(nonce: string, overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    sub: "google-subject",
    email: "test@example.com",
    email_verified: true,
    nonce,
    iss: "https://accounts.google.com",
    aud: clientId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(privateKey);
}
async function challenge() {
  const response = await handleGoogleStart(request({}), clientId);
  const { nonce } = await response.json();
  return { nonce, cookie: `${googleChallengeCookie()}=${nonce}`, response };
}
function upstream(status = 200) {
  const calls: { path: string; body: unknown; authorization: string | null }[] =
    [];
  const api = createStreetApi(async (url, init) => {
    calls.push({
      path: new URL(String(url)).pathname,
      body: JSON.parse(String(init?.body)),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return status === 200
      ? Response.json({
          data: {
            accessToken: "street-access",
            refreshToken: "street-refresh",
            user: {
              id: "existing-app-id",
              email: "test@example.com",
              ssoProvider: "google",
              password: "secret",
            },
          },
        })
      : new Response("private diagnostics", { status });
  });
  return { api, calls };
}

test("Google is disabled without configuration; start creates a fresh private host-only challenge", async () => {
  const off = await handleGoogleStart(request({}), null);
  assert.deepEqual(await off.json(), { enabled: false });
  assert.equal(off.cookies.get(googleChallengeCookie()), undefined);
  const a = await challenge(),
    b = await challenge();
  assert.notEqual(a.nonce, b.nonce);
  const cookie = a.response.cookies.get(googleChallengeCookie())!;
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.sameSite, "strict");
  assert.equal(cookie.path, "/");
  assert.equal(cookie.domain, undefined);
  assert.match(a.response.headers.get("cache-control")!, /no-store/);
});

test("verified Google token exchanges only with staging; canonical user and HttpOnly session follow OTP boundary", async () => {
  const c = await challenge(),
    u = upstream(),
    idToken = await token(c.nonce);
  const result = await handleGoogleLogin(
    request({ idToken }, c.cookie),
    u.api,
    verify,
    clientId,
  );
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.user.id, "existing-app-id");
  assert.equal(data.user.ssoProvider, "google");
  assert.equal("password" in data.user, false);
  assert.equal("accessToken" in data, false);
  assert.deepEqual(u.calls, [
    { path: "/v1/auth/google/token", body: { idToken }, authorization: null },
  ]);
  assert.equal(result.cookies.get("street_staging_access")?.httpOnly, true);
  assert.equal(result.cookies.get("street_staging_refresh")?.httpOnly, true);
  assert.equal(result.cookies.get(googleChallengeCookie())?.maxAge, 0);
  // An ordinary browser applies cookie clearing; repeating the credential then fails.
  assert.equal(
    (await handleGoogleLogin(request({ idToken }), u.api, verify, clientId))
      .status,
    401,
  );
  assert.equal(u.calls.length, 1);
});

test("Google login rejects invalid signatures, issuer, audience/azp, unverified email, nonce and expired tokens before STREET", async () => {
  const c = await challenge();
  for (const overrides of [
    { iss: "https://evil.example" },
    { aud: "other.apps.googleusercontent.com", azp: clientId },
    { aud: [clientId, "other"] },
    { azp: "other" },
    { email_verified: false },
    { email_verified: "true" },
    { sub: "" },
    { nonce: "wrong" },
    { exp: 1 },
    { iat: Math.floor(Date.now() / 1000) - 700 },
  ]) {
    const u = upstream();
    assert.equal(
      (
        await handleGoogleLogin(
          request({ idToken: await token(c.nonce, overrides) }, c.cookie),
          u.api,
          verify,
          clientId,
        )
      ).status,
      401,
    );
    assert.equal(u.calls.length, 0);
  }
  const valid = await token(c.nonce),
    u = upstream();
  const parts = valid.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  assert.equal(
    (
      await handleGoogleLogin(
        request({ idToken: parts.join(".") }, c.cookie),
        u.api,
        verify,
        clientId,
      )
    ).status,
    401,
  );
  assert.equal(u.calls.length, 0);
});

test("origin, signed-in account, missing/expired challenge, oversized and injected bodies are rejected", async () => {
  const c = await challenge(),
    u = upstream(),
    idToken = await token(c.nonce);
  const foreign = await handleGoogleLogin(
    request({ idToken }, c.cookie, "https://evil.example"),
    u.api,
    verify,
    clientId,
  );
  assert.equal(foreign.status, 403);
  assert.equal(foreign.cookies.get(googleChallengeCookie()), undefined);
  assert.equal(
    (await handleGoogleStart(request({}, "", "https://evil.example"), clientId))
      .status,
    403,
  );
  assert.equal(
    (
      await handleGoogleStart(
        request({}, "street_staging_access=active"),
        clientId,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await handleGoogleLogin(
        request({ idToken }, c.cookie + "; street_staging_refresh=active"),
        u.api,
        verify,
        clientId,
      )
    ).status,
    409,
  );
  const stale = c.nonce.split(".")[0] + "." + (Date.now() - 700000);
  assert.equal(
    (
      await handleGoogleLogin(
        request({ idToken }, `${googleChallengeCookie()}=${stale}`),
        u.api,
        verify,
        clientId,
      )
    ).status,
    401,
  );
  for (const extra of [
    { email: "forged@example.com" },
    { userId: "forged" },
    { clientId: "forged" },
  ])
    assert.equal(
      (
        await handleGoogleLogin(
          request({ idToken, ...extra }, c.cookie),
          u.api,
          verify,
          clientId,
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await handleGoogleLogin(
        request({ idToken: "a".repeat(9000) }, c.cookie),
        u.api,
        verify,
        clientId,
      )
    ).status,
    413,
  );
  assert.equal(u.calls.length, 0);
});

test("upstream outage never retries, exposes credentials, or creates a false session", async () => {
  const c = await challenge(),
    u = upstream(503);
  const result = await handleGoogleLogin(
    request({ idToken: await token(c.nonce) }, c.cookie),
    u.api,
    verify,
    clientId,
  );
  assert.equal(result.status, 502);
  assert.equal(u.calls.length, 1);
  assert.equal(result.cookies.get("street_staging_access"), undefined);
  assert.equal(result.cookies.get(googleChallengeCookie())?.maxAge, 0);
  assert.doesNotMatch(
    JSON.stringify(await result.json()),
    /private diagnostics|street-access/,
  );
});
