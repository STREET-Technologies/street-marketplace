import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { createStreetApi } from "../lib/server/street-api.ts";
import {
  handleProfile,
  handleAddressChange,
} from "../lib/server/profile-api.ts";

const user = {
  id: "mobile-account",
  firstName: "Alex",
  lastName: "Test",
  email: "alex@example.com",
  phone: "+447700900001",
  ssoProvider: null as string | null,
};
const address = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "Home",
  line1: "1 Test Street",
  line2: "",
  city: "London",
  state: "London",
  postcode: "W1F 9PT",
  deliveryInstructions: "Reception",
  latitude: 51.51,
  longitude: -0.13,
  isDefault: true,
};
const { id, latitude, longitude, isDefault, ...addressFields } = address;
function request(
  body: unknown,
  origin = "https://marketplace.example",
  cookie = "street_staging_access=token",
) {
  return new NextRequest("https://marketplace.example/api/profile", {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function fixture(
  options: {
    provider?: string | null;
    verdict?: string;
    validationStatus?: number;
    writeStatus?: number;
  } = {},
) {
  const calls: {
    path: string;
    method: string;
    body: Record<string, unknown> | undefined;
  }[] = [];
  const api = createStreetApi(async (url, init) => {
    const path = new URL(String(url)).pathname.replace("/v1", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (path === "/auth/me")
      return Response.json({
        data: { ...user, ssoProvider: options.provider ?? null },
      });
    if (path === "/user-addresses" && method === "GET")
      return Response.json({ data: [address] });
    if (path === "/user-addresses/validate")
      return options.validationStatus
        ? new Response("private failure", { status: options.validationStatus })
        : Response.json({ data: { verdict: options.verdict ?? "valid" } });
    if (options.writeStatus)
      return new Response("private error details", {
        status: options.writeStatus,
      });
    return Response.json({
      data: path.startsWith("/users/")
        ? {
            ...user,
            ...body,
            ssoProvider: options.provider ?? null,
            password: "private",
          }
        : { ...address, ...body },
    });
  });
  return {
    api,
    calls,
    writes: () =>
      calls.filter(
        (c) => c.method !== "GET" && c.path !== "/user-addresses/validate",
      ),
  };
}

test("profile edits use canonical identity and project safe fields; OTP phone and Google email stay locked", async () => {
  const otp = fixture();
  const result = await handleProfile(
    request({ firstName: "  Jamie  ", email: "jamie@example.com" }),
    otp.api,
  );
  assert.equal(result.status, 200);
  assert.match(result.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(otp.writes(), [
    {
      path: "/users/mobile-account",
      method: "PATCH",
      body: { firstName: "Jamie", email: "jamie@example.com" },
    },
  ]);
  assert.equal("password" in (await result.json()).user, false);
  const locked = fixture();
  assert.equal(
    (await handleProfile(request({ phone: "+447700900002" }), locked.api))
      .status,
    403,
  );
  assert.equal(locked.writes().length, 0);
  const google = fixture({ provider: "google" });
  assert.equal(
    (await handleProfile(request({ email: "other@example.com" }), google.api))
      .status,
    403,
  );
  assert.equal(google.writes().length, 0);
  assert.equal(
    (await handleProfile(request({ phone: "+44 7700 900002" }), google.api))
      .status,
    200,
  );
  assert.equal(google.writes()[0].body?.phone, "+447700900002");
});

test("account writes reject forged ownership/provider, cross-origin, missing sessions and invalid inputs before mutation", async () => {
  for (const body of [
    { id: "another-user" },
    { ssoProvider: "google" },
    { email: "wrong" },
    { firstName: "x".repeat(101) },
  ]) {
    const f = fixture();
    assert.equal((await handleProfile(request(body), f.api)).status, 400);
    assert.equal(f.writes().length, 0);
  }
  for (const handler of [handleProfile, handleAddressChange]) {
    const f = fixture();
    assert.equal(
      (await handler(request({}, "https://evil.example"), f.api)).status,
      403,
    );
    assert.equal(
      (await handler(request({}, "https://marketplace.example", ""), f.api))
        .status,
      401,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("profile conflicts are actionable and do not leak upstream details or retry", async () => {
  const f = fixture({ writeStatus: 409 });
  const response = await handleProfile(
    request({ email: "taken@example.com" }),
    f.api,
  );
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already used/);
  assert.equal(f.writes().length, 1);
});

test("address creation validates with shared backend and leaves first-address default and coordinates to backend", async () => {
  const f = fixture();
  assert.equal(
    (
      await handleAddressChange(
        request({ action: "save", ...addressFields }),
        f.api,
      )
    ).status,
    200,
  );
  assert.deepEqual(
    f.calls.map((c) => c.path),
    ["/user-addresses/validate", "/user-addresses"],
  );
  assert.deepEqual(f.writes()[0].body, {
    ...addressFields,
    country: "United Kingdom",
    countryCode: "GB",
  });
  const injected = fixture();
  assert.equal(
    (
      await handleAddressChange(
        request({ action: "save", ...addressFields, latitude: 0 }),
        injected.api,
      )
    ).status,
    400,
  );
  assert.equal(injected.calls.length, 0);
});

test("label-only updates preserve app pin, while street edits force backend re-geocoding", async () => {
  const label = fixture();
  assert.equal(
    (
      await handleAddressChange(
        request({ action: "save", id, ...addressFields, label: "Work" }),
        label.api,
      )
    ).status,
    200,
  );
  assert.deepEqual(label.writes()[0].body, { label: "Work" });
  assert.equal(
    label.calls.some((c) => c.path.endsWith("validate")),
    false,
  );
  const moved = fixture();
  assert.equal(
    (
      await handleAddressChange(
        request({
          action: "save",
          id,
          ...addressFields,
          line1: "2 Test Street",
        }),
        moved.api,
      )
    ).status,
    200,
  );
  assert.deepEqual(moved.writes()[0].body, { line1: "2 Test Street" });
  assert.equal(
    moved.calls.some((c) => c.path.endsWith("validate")),
    true,
  );
});

test("invalid or mismatched postcodes block writes; unknown/outage follows mobile fail-open, auth failures stop", async () => {
  for (const verdict of ["invalid_postcode", "postcode_mismatch"]) {
    const f = fixture({ verdict });
    assert.equal(
      (
        await handleAddressChange(
          request({ action: "save", ...addressFields }),
          f.api,
        )
      ).status,
      400,
    );
    assert.equal(f.writes().length, 0);
  }
  for (const options of [{ verdict: "unknown" }, { validationStatus: 503 }]) {
    const f = fixture(options);
    assert.equal(
      (
        await handleAddressChange(
          request({ action: "save", ...addressFields }),
          f.api,
        )
      ).status,
      200,
    );
    assert.equal(f.writes().length, 1);
  }
  const expired = fixture({ validationStatus: 401 });
  assert.equal(
    (
      await handleAddressChange(
        request({ action: "save", ...addressFields }),
        expired.api,
      )
    ).status,
    401,
  );
  assert.equal(expired.writes().length, 0);
});

test("default and deletion verify ownership before side effects and send minimal payloads", async () => {
  for (const action of ["default", "delete"]) {
    const foreign = fixture();
    assert.equal(
      (
        await handleAddressChange(
          request({ action, id: "22222222-2222-4222-8222-222222222222" }),
          foreign.api,
        )
      ).status,
      404,
    );
    assert.equal(foreign.writes().length, 0);
    const owned = fixture();
    assert.equal(
      (await handleAddressChange(request({ action, id }), owned.api)).status,
      200,
    );
    assert.deepEqual(owned.writes()[0], {
      path: `/user-addresses/${id}`,
      method: action === "delete" ? "DELETE" : "PATCH",
      body: action === "delete" ? undefined : { isDefault: true },
    });
  }
});
