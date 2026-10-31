import test from "node:test";
import assert from "node:assert/strict";
import {
  readAccountData,
  changeFavourite,
  SessionError,
} from "../lib/client/session.ts";

test("protected reads refresh an expired session once and retry without exposing tokens", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith("/refresh")) {
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, "{}");
      return Response.json({ success: true });
    }
    assert.equal(init?.cache, "no-store");
    return calls.length === 1
      ? Response.json({ error: "expired" }, { status: 401 })
      : Response.json({ products: [] });
  };
  try {
    assert.deepEqual(
      await readAccountData("/api/favourites", new URLSearchParams()),
      { products: [] },
    );
    assert.deepEqual(calls, [
      "/api/favourites?",
      "/api/auth/refresh",
      "/api/favourites?",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("expired refresh ends at signed-out instead of looping or showing an empty list", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: "Sign in again" }, { status: 401 });
  };
  try {
    await assert.rejects(
      readAccountData("/api/favourites", new URLSearchParams()),
      (error) => error instanceof SessionError && error.status === 401,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("non-JSON server failures show a useful error and do not attempt refresh", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("", { status: 500 });
  };
  try {
    await assert.rejects(
      readAccountData("/api/favourites", new URLSearchParams()),
      (error) =>
        error instanceof SessionError &&
        error.status === 500 &&
        !error.message.includes("JSON"),
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("favourite writes retry only an explicit authentication rejection, never an ambiguous failure", async () => {
  const original = globalThis.fetch;
  const target = {
    kind: "product" as const,
    vendorId: "vendor",
    productId: "mirror-product",
  };
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return calls === 1
        ? Response.json({ error: "expired" }, { status: 401 })
        : Response.json({ success: true });
    };
    await changeFavourite(target, true);
    assert.equal(calls, 3);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error("network failed");
    };
    await assert.rejects(changeFavourite(target, true));
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ error: "upstream failed" }, { status: 503 });
    };
    await assert.rejects(changeFavourite(target, false));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
