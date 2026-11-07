import test from "node:test";
import assert from "node:assert/strict";
import { appleProof } from "../lib/client/apple.ts";
import { NextRequest } from "next/server.js";
import { createStreetApi } from "../lib/server/street-api.ts";
import {
  appleChallengeCookie,
  handleAppleStart,
  handleAppleFinish,
} from "../lib/server/apple-auth.ts";

const origin = "https://marketplace-staging.street.london";
const request = (body: unknown, cookie = "", from = origin) =>
  new NextRequest(`${origin}/api/auth/apple`, {
    method: "POST",
    headers: { origin: from, "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
function upstream(user = { id: "existing-user", ssoProvider: "apple" }) {
  const calls: { path: string; body: unknown; authorization: string | null }[] =
    [];
  const api = createStreetApi(async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({
      path,
      body: JSON.parse(String(init?.body)),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return Response.json({
      data: path.endsWith("/challenge")
        ? {
            challengeId: "11111111-1111-4111-8111-111111111111",
            nonce: "n".repeat(43),
            expiresIn: 300,
            clientId: "london.street.web",
            redirectUri: `${origin}/api/auth/apple/callback`,
          }
        : path.endsWith("/link")
          ? { linked: true }
          : {
              accessToken: "street-access",
              refreshToken: "street-refresh",
              user,
            },
    });
  });
  return { api, calls };
}
async function begin(u = upstream(), intent = "login", session = "") {
  const response = await handleAppleStart(
    request({ intent }, session),
    u.api,
    true,
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  const cookie = `${appleChallengeCookie()}=${response.cookies.get(appleChallengeCookie())?.value}`;
  return { u, data, cookie, response };
}
const proof = (state: string) => ({
  state,
  authorizationCode: "apple-code",
  identityToken: "signed.apple.token",
});

test("Apple login uses a backend challenge and returns the existing STREET session only", async () => {
  const { u, data, cookie, response } = await begin();
  assert.equal(response.cookies.get(appleChallengeCookie())?.httpOnly, true);
  assert.equal(
    response.cookies.get(appleChallengeCookie())?.sameSite,
    "strict",
  );
  const result = await handleAppleFinish(
    request(proof(data.state), cookie),
    u.api,
    "login",
    true,
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).user.id, "existing-user");
  assert.equal(result.cookies.get("street_staging_access")?.httpOnly, true);
  assert.equal(result.cookies.get(appleChallengeCookie())?.maxAge, 0);
  assert.deepEqual(u.calls[1].body, {
    challengeId: data.challengeId,
    authorizationCode: "apple-code",
    identityToken: "signed.apple.token",
  });
  assert.equal(u.calls[1].authorization, null);
});
test("Apple origin, state and unsolicited identity fields fail before exchange", async () => {
  const { u, data, cookie } = await begin();
  for (const body of [
    proof("wrong"),
    { ...proof(data.state), email: "forged@example.test" },
    { ...proof(data.state), userId: "other" },
    { ...proof(data.state), challengeId: "injected" },
  ]) {
    assert.ok(
      (await handleAppleFinish(request(body, cookie), u.api, "login", true))
        .status >= 400,
    );
  }
  const foreign = await handleAppleFinish(
    request(proof(data.state), cookie, "https://evil.test"),
    u.api,
    "login",
    true,
  );
  assert.equal(foreign.status, 403);
  assert.equal(foreign.cookies.get(appleChallengeCookie()), undefined);
  assert.equal(
    (await handleAppleFinish(request(proof(data.state)), u.api, "login", true))
      .status,
    401,
  );
  assert.equal(u.calls.length, 1);
});
test("Apple linking is explicit and tied to the initiating STREET session", async () => {
  const session = "street_staging_access=current-access";
  const { u, data, cookie } = await begin(upstream(), "link", session);
  assert.equal(u.calls[0].authorization, "Bearer current-access");
  assert.equal(
    (
      await handleAppleFinish(
        request(
          proof(data.state),
          cookie + "; street_staging_access=other-access",
        ),
        u.api,
        "link",
        true,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await handleAppleFinish(
        request(proof(data.state), cookie + "; " + session),
        u.api,
        "login",
        true,
      )
    ).status,
    409,
  );
  const result = await handleAppleFinish(
    request(proof(data.state), cookie + "; " + session),
    u.api,
    "link",
    true,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { linked: true });
  assert.equal(result.cookies.get("street_staging_access"), undefined);
  assert.equal(u.calls[1].authorization, "Bearer current-access");
});
test("disabled configuration and wrong account state never start Apple authentication", async () => {
  const u = upstream();
  assert.deepEqual(
    await (
      await handleAppleStart(request({ intent: "login" }), u.api, false)
    ).json(),
    { enabled: false },
  );
  assert.equal(
    (await handleAppleStart(request({ intent: "link" }), u.api, true)).status,
    401,
  );
  assert.equal(
    (
      await handleAppleStart(
        request({ intent: "login" }, "street_staging_refresh=active"),
        u.api,
        true,
      )
    ).status,
    409,
  );
  assert.equal(u.calls.length, 0);
});

test("Apple challenge redirects must be the same HTTPS website and a fixed callback path", async () => {
  for (const redirectUri of [
    "https://evil.test/api/auth/apple/callback",
    `${origin}/other`,
    `http://marketplace-staging.street.london/api/auth/apple/callback`,
    `${origin}/api/auth/apple/callback?next=evil`,
  ]) {
    const api = createStreetApi(async () =>
      Response.json({
        data: {
          challengeId: "11111111-1111-4111-8111-111111111111",
          nonce: "n".repeat(43),
          expiresIn: 300,
          clientId: "london.street.web",
          redirectUri,
        },
      }),
    );
    const result = await handleAppleStart(
      request({ intent: "login" }),
      api,
      true,
    );
    assert.equal(result.status, 503);
    assert.equal(result.cookies.get(appleChallengeCookie()), undefined);
  }
});
test("expired transactions are rejected, upstream failures clear challenge without leaking diagnostics or setting a session", async () => {
  const { data, cookie } = await begin();
  const raw = JSON.parse(
    Buffer.from(cookie.split("=")[1], "base64url").toString(),
  );
  raw.expiresAt = Date.now() - 1;
  const u = upstream();
  const expired = `${appleChallengeCookie()}=${Buffer.from(JSON.stringify(raw)).toString("base64url")}`;
  assert.equal(
    (
      await handleAppleFinish(
        request(proof(data.state), expired),
        u.api,
        "login",
        true,
      )
    ).status,
    401,
  );
  assert.equal(u.calls.length, 0);
  let calls = 0;
  const api = createStreetApi(async () => {
    calls++;
    return Response.json({ private: "provider-secret" }, { status: 503 });
  });
  const result = await handleAppleFinish(
    request(proof(data.state), cookie),
    api,
    "login",
    true,
  );
  assert.equal(result.status, 503);
  assert.equal(calls, 1);
  assert.equal(result.cookies.get(appleChallengeCookie())?.maxAge, 0);
  assert.equal(result.cookies.get("street_staging_access"), undefined);
  assert.doesNotMatch(JSON.stringify(await result.json()), /provider-secret/);
});
test("unbound Apple identity gives confirmation guidance rather than generic duplicate email advice", async () => {
  const { data, cookie } = await begin();
  const api = createStreetApi(async () =>
    Response.json({ code: "APPLE_ACCOUNT_LINK_REQUIRED" }, { status: 409 }),
  );
  const result = await handleAppleFinish(
    request(proof(data.state), cookie),
    api,
    "login",
    true,
  );
  assert.equal(result.status, 409);
  assert.match((await result.json()).error, /existing STREET account/);
  assert.equal(result.cookies.get("street_staging_access"), undefined);
});

test("first Apple authorization forwards optional profile names without client email ownership", () => {
  const result = {
    authorization: { code: "code", id_token: "token", state: "state" },
    user: {
      name: { firstName: "Ada", lastName: "Lovelace" },
      email: "untrusted@example.test",
    },
  };
  assert.deepEqual(appleProof(result), {
    authorizationCode: "code",
    identityToken: "token",
    state: "state",
    givenName: "Ada",
    familyName: "Lovelace",
  });
  const returning = { authorization: result.authorization };
  assert.deepEqual(appleProof(returning), {
    authorizationCode: "code",
    identityToken: "token",
    state: "state",
  });
  assert.deepEqual(appleProof(result, false), appleProof(returning));
});

test("new Apple customer receives the ordinary session with optional normalized names", async () => {
  const { u, data, cookie } = await begin(
    upstream({ id: "new-canonical-user", ssoProvider: "apple" }),
  );
  const result = await handleAppleFinish(
    request(
      {
        ...proof(data.state),
        givenName: " Ada ",
        familyName: "Lovelace",
      },
      cookie,
    ),
    u.api,
    "login",
    true,
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).user.id, "new-canonical-user");
  assert.equal(result.cookies.get("street_staging_access")?.httpOnly, true);
  assert.equal(result.cookies.get(appleChallengeCookie())?.maxAge, 0);
  assert.deepEqual(u.calls[1].body, {
    challengeId: data.challengeId,
    authorizationCode: "apple-code",
    identityToken: "signed.apple.token",
    givenName: "Ada",
    familyName: "Lovelace",
  });
});

test("Apple profile names are optional, bounded and never accepted by linking", async () => {
  for (const names of [
    { givenName: 123 },
    { familyName: null },
    { givenName: "a".repeat(101) },
    { familyName: {} },
  ]) {
    const { u, data, cookie } = await begin();
    const result = await handleAppleFinish(
      request({ ...proof(data.state), ...names }, cookie),
      u.api,
      "login",
      true,
    );
    assert.equal(result.status, 400);
    assert.equal(u.calls.length, 1);
    assert.equal(result.cookies.get("street_staging_access"), undefined);
  }
  const { u, data, cookie } = await begin();
  const result = await handleAppleFinish(
    request({ ...proof(data.state), givenName: "  " }, cookie),
    u.api,
    "login",
    true,
  );
  assert.equal(result.status, 200);
  assert.equal("givenName" in (u.calls[1].body as object), false);

  const session = "street_staging_access=current-access";
  const link = await begin(upstream(), "link", session);
  const linked = await handleAppleFinish(
    request(
      { ...proof(link.data.state), givenName: "Ada" },
      `${link.cookie}; ${session}`,
    ),
    link.u.api,
    "link",
    true,
  );
  assert.equal(linked.status, 400);
  assert.equal(link.u.calls.length, 1);
});

test("Apple signup without verified email gives a safe alternative sign-in message", async () => {
  const { data, cookie } = await begin();
  const api = createStreetApi(async () =>
    Response.json(
      { code: "APPLE_VERIFIED_EMAIL_REQUIRED", message: "provider-secret" },
      { status: 400 },
    ),
  );
  const result = await handleAppleFinish(
    request(proof(data.state), cookie),
    api,
    "login",
    true,
  );
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), {
    error:
      "Apple did not provide a verified email. Try another sign-in method.",
  });
  assert.equal(result.cookies.get("street_staging_access"), undefined);
  assert.equal(result.cookies.get(appleChallengeCookie())?.maxAge, 0);
});
