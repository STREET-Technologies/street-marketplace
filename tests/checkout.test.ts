import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import {
  checkoutVisibility,
  checkoutAddressIssue,
  CHECKOUT_VENDOR,
  CHECKOUT_OUTLET,
  checkoutStorageKey,
  restoreCheckout,
  safeCheckoutUrl,
  sameSubmittedBag,
  type SavedCheckout,
} from "../lib/checkout.ts";
import { cartIntent } from "../lib/cart.ts";
import {
  checkoutProjection,
  handleCheckout,
} from "../lib/server/checkout-api.ts";
import { createStreetApi } from "../lib/server/street-api.ts";
import { requestCheckout } from "../lib/client/checkout.ts";
const owner = "576fa9b6-3775-426c-86d5-5ef8710c35e9",
  addressId = "17e49931-5ad0-44f8-895a-393752d2babb",
  id = "4a29e85a-92fd-47da-88a2-96fcbd78b557";
const cart = {
  vendorId: CHECKOUT_VENDOR,
  outletId: CHECKOUT_OUTLET,
  shopName: "Gymshark",
  branch: "Regent Street",
  lines: [
    {
      productId: owner,
      variantId: "1234",
      quantity: 1,
      title: "Shirt",
      variantTitle: "M",
      image: null,
      unitPrice: 25,
    },
  ],
};
const saved: SavedCheckout = {
  owner,
  attemptKey: id,
  intent: cartIntent(cart, addressId),
  snapshot: cart,
};
const url = "https://gymshark-10024.myshopify.com/checkouts/cn/abc?key=secret";
test("checkout host, scheme, credentials and path are pinned", () => {
  assert.equal(safeCheckoutUrl(url), url);
  const cartCheckoutUrl =
    "https://gymshark-10024.myshopify.com/cart/c/example?key=secret";
  assert.equal(safeCheckoutUrl(cartCheckoutUrl), cartCheckoutUrl);
  assert.equal(
    checkoutProjection(
      { id, status: "ready", orderId: "ST-123", checkoutUrl: cartCheckoutUrl },
      owner,
    ).checkoutUrl,
    cartCheckoutUrl,
  );
  for (const value of [
    "https://evil.test/checkouts/x",
    "http://gymshark-10024.myshopify.com/checkouts/x",
    "https://gymshark-10024.myshopify.com.evil.test/checkouts/x",
    "https://user:pass@gymshark-10024.myshopify.com/checkouts/x",
    "https://gymshark-10024.myshopify.com/cart/x",
  ])
    assert.throws(() => safeCheckoutUrl(value));
});
test("durable attempt is account scoped, exact fingerprint retained, corruption fails closed", () => {
  const restored = restoreCheckout(JSON.stringify(saved), owner)!;
  assert.equal(restored.attemptKey, id);
  assert.deepEqual(restored.intent, saved.intent);
  assert.notEqual(checkoutStorageKey(owner), checkoutStorageKey(addressId));
  assert.throws(() => restoreCheckout(JSON.stringify(saved), addressId));
  assert.throws(() => restoreCheckout("{", owner));
  assert.throws(() =>
    restoreCheckout(
      JSON.stringify({
        ...saved,
        intent: { ...saved.intent, addressId: "bad" },
      }),
      owner,
    ),
  );
  assert.equal(sameSubmittedBag(cart, saved), true);
  assert.equal(
    sameSubmittedBag(
      { ...cart, lines: [{ ...cart.lines[0], quantity: 2 }] },
      saved,
    ),
    false,
  );
});
test("projection drops secrets, uses only backend status and never hands off nonready", () => {
  const value = {
    id,
    status: "ready",
    orderId: "123",
    checkoutUrl: url,
    cartId: "secret",
    token: "private",
    message: "raw leak",
  };
  assert.deepEqual(checkoutProjection(value, owner), {
    userId: owner,
    id,
    status: "ready",
    orderId: "123",
    checkoutUrl: url,
  });
  for (const status of ["preparing", "uncertain", "failed", "cancelled"])
    assert.equal(
      checkoutProjection({ ...value, status }, owner).checkoutUrl,
      undefined,
    );
  assert.throws(() =>
    checkoutProjection({ ...value, checkoutUrl: "https://evil.test" }, owner),
  );
  assert.throws(() =>
    checkoutProjection({ ...value, status: "paid-from-browser" }, owner),
  );
});
function request(body: unknown, origin = "https://street.test") {
  return new NextRequest("https://street.test/api/checkout/attempts", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: "street_staging_access=private",
    },
    body: JSON.stringify(body),
  });
}
test("adapter gates off, rejects cross-origin, extra prices, unsupported outlet and changed account before mutation", async () => {
  const prior = process.env.CHECKOUT_ENABLED;
  let writes = 0;
  const api = {
    ...createStreetApi(),
    me: async () => ({
      id: owner,
      firstName: null,
      lastName: null,
      email: null,
      phone: null,
      ssoProvider: null,
    }),
    checkoutStart: async () => {
      writes++;
      return { id, status: "preparing", orderId: null };
    },
  };
  const body = { ...saved.intent, attemptKey: id, expectedUserId: owner };
  try {
    delete process.env.CHECKOUT_ENABLED;
    assert.equal((await handleCheckout(request(body), api)).status, 403);
    process.env.CHECKOUT_ENABLED = "true";
    for (const [input, origin, status] of [
      [body, "https://evil.test", 403],
      [{ ...body, total: 25 }, undefined, 400],
      [{ ...body, expectedUserId: addressId }, undefined, 409],
      [{ ...body, outletId: addressId }, undefined, 403],
    ] as const)
      assert.equal(
        (await handleCheckout(request(input, origin), api)).status,
        status,
      );
    assert.equal(writes, 0);
    const response = await handleCheckout(request(body), api);
    assert.equal(response.status, 200);
    assert.equal(writes, 1);
    assert.equal((await response.json()).userId, owner);
  } finally {
    if (prior === undefined) delete process.env.CHECKOUT_ENABLED;
    else process.env.CHECKOUT_ENABLED = prior;
  }
});
test("ambiguous mutation never retries automatically; explicit replay has identical key/intent, resume reads only", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; body?: string; method?: string }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body as string,
      method: init?.method,
    });
    throw new TypeError("Lost response");
  };
  try {
    await assert.rejects(requestCheckout(owner, saved, true));
    assert.equal(calls.length, 1);
    await assert.rejects(requestCheckout(owner, saved, true));
    assert.equal(calls[0].body, calls[1].body);
    await assert.rejects(requestCheckout(owner, { ...saved, id }));
    assert.equal(calls[2].method, "GET");
    assert.equal(calls[2].body, undefined);
  } finally {
    globalThis.fetch = original;
  }
});
test("owned active attempt conflict is projected narrowly and recoverable without leaking upstream details", async () => {
  const api = createStreetApi(
    async () =>
      new Response(
        JSON.stringify({
          attemptId: id,
          message: "private diagnostics",
          token: "secret",
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
  );
  await assert.rejects(
    api.checkoutStart("token", { ...saved.intent, attemptKey: id }),
    (error) => {
      assert.equal((error as { attemptId?: string }).attemptId, id);
      assert.equal(
        (error as Error).message,
        "Resume your existing checkout before starting another.",
      );
      return true;
    },
  );
  const bad = createStreetApi(
    async () =>
      new Response(
        JSON.stringify({ attemptId: "https://evil.test", message: "secret" }),
        { status: 409 },
      ),
  );
  await assert.rejects(
    bad.checkoutStart("token", { ...saved.intent, attemptKey: id }),
    (error) => !(error as { attemptId?: string }).attemptId,
  );
});
test("only typed definitive preflight rejection permits explicit reset, generic errors remain ambiguous", async () => {
  const typed = createStreetApi(
    async () =>
      new Response(
        JSON.stringify({
          code: "CHECKOUT_NOT_STARTED",
          message: "upstream detail",
        }),
        { status: 400 },
      ),
  );
  await assert.rejects(
    typed.checkoutStart("token", { ...saved.intent, attemptKey: id }),
    (error) => (error as Error).constructor.name === "CheckoutNotStarted",
  );
  for (const [status, body] of [
    [400, {}],
    [503, { code: "CHECKOUT_NOT_STARTED" }],
  ] as const) {
    const api = createStreetApi(
      async () => new Response(JSON.stringify(body), { status }),
    );
    await assert.rejects(
      api.checkoutStart("token", { ...saved.intent, attemptKey: id }),
      (error) => (error as Error).constructor.name !== "CheckoutNotStarted",
    );
  }
});

test("empty bags hide checkout, while unfinished checkout recovery remains accessible", () => {
  assert.equal(checkoutVisibility(null, false), "hidden");
  assert.equal(checkoutVisibility({ ...cart, lines: [] }, false), "hidden");
  assert.equal(checkoutVisibility(null, true), "resume");
});

test("pilot restriction is explicit for other shops and branches, not caused by the address quote", () => {
  assert.equal(checkoutVisibility(cart, false), "start");
  assert.equal(
    checkoutVisibility(
      { ...cart, vendorId: owner, shopName: "Footpatrol" },
      false,
    ),
    "pilot-only",
  );
  assert.equal(
    checkoutVisibility({ ...cart, outletId: id }, false),
    "pilot-only",
  );
  assert.equal(
    checkoutVisibility({ ...cart, vendorId: owner }, true),
    "resume",
  );
});

test("resuming requires the original delivery address to be selected", () => {
  assert.match(
    checkoutAddressIssue(saved, undefined)!,
    /Select the delivery address/,
  );
  assert.match(checkoutAddressIssue(saved, id)!, /different delivery address/);
  assert.equal(checkoutAddressIssue(saved, addressId), null);
  // Re-evaluating after a selection is cleared must block handoff as well.
  assert.notEqual(checkoutAddressIssue(saved, undefined), null);
});
