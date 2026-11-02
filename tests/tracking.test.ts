import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { createStreetApi } from "../lib/server/street-api.ts";
import { handleTrackingSession } from "../lib/server/tracking-api.ts";
import { orderDetailFrom } from "../lib/server/orders.ts";
import {
  trackingBlob,
  liveDelivery,
  trackingHeadline,
  trackingStage,
  showDeliveryPin,
  needsOrderRefresh,
  movementMetres,
  type DeliveryTracking,
} from "../lib/tracking.ts";
import {
  createTrackingHub,
  type TrackingTransport,
} from "../lib/client/tracking-hub.ts";
const empty: DeliveryTracking = {
  jobId: null,
  topic: null,
  task: null,
  courier: null,
  pickupEta: null,
  deliveryEta: null,
  pin: null,
  destination: null,
  pickup: null,
};
const order = () =>
  orderDetailFrom({
    id: "11111111-1111-4111-8111-111111111111",
    orderId: "ST-001234",
    createdAt: "2026-11-02T11:00:00Z",
    status: "IN_DELIVERY",
    totalAmount: 20,
    subtotal: 10,
    items: [],
    vendor: { storeName: "Shop" },
    delivery: {
      pinCode: "1234",
      courier: {
        name: "Rider",
        phone: "private",
        location: { latitude: 51.5, longitude: -0.1 },
      },
    },
    deliveryLocation: { latitude: 51.6, longitude: -0.2 },
  });
test("tracking projection exposes only owner detail fields; no phone/provider links or RTDB PIN", () => {
  const result = order();
  assert.equal(result.tracking.pin, "1234");
  assert.equal(result.trackingId, "11111111-1111-4111-8111-111111111111");
  assert.doesNotMatch(JSON.stringify(result), /private|phone|trackingUrl/);
  const blob = trackingBlob({
    pinCode: "5678",
    courier: { name: "Rider", lat: 51.5, lng: -0.1, phone: "private" },
    etaDelivery: "invalid",
  })!;
  assert.doesNotMatch(JSON.stringify(blob), /5678|private|phone/);
  assert.equal(blob.deliveryEta, null);
  assert.equal(liveDelivery(result.tracking, blob).pin, "1234");
});
test("reassignment clears courier and explicit null fields never retain prior rider", () => {
  const base = {
    ...empty,
    courier: { name: "Old rider", location: { latitude: 51, longitude: 0 } },
  };
  assert.equal(
    liveDelivery(base, trackingBlob({ topic: "courier_reassigning" })).courier,
    null,
  );
  assert.equal(
    liveDelivery(base, trackingBlob({ courier: null })).courier,
    null,
  );
  assert.equal(
    liveDelivery(base, trackingBlob({ status: "IN_DELIVERY" })).courier?.name,
    "Old rider",
  );
});
test("timeline distinguishes unpaid, off-path and normal stages without invented timestamps", () => {
  assert.equal(trackingStage("PENDING_PAYMENT"), -1);
  assert.equal(trackingStage("RETURNING"), -1);
  assert.equal(trackingStage("CONFIRMED"), 1);
  assert.equal(trackingStage("DELIVERED"), 5);
  assert.equal(
    trackingHeadline("WAITING_FOR_PICKUP", empty).label,
    "Waiting for a rider",
  );
  assert.equal(
    trackingHeadline("RETURNING", { ...empty, topic: "courier_moving" }).label,
    "Your order is being returned to the store",
  );
  assert.equal(
    trackingHeadline("CANCELLED", { ...empty, topic: "courier_moving" }).label,
    "Order cancelled",
  );
});
test("pickup and dropoff use their own ETA; stale realtime statuses only request authoritative REST", () => {
  const delivery = {
    ...empty,
    topic: "courier_moving",
    task: "pickup",
    pickupEta: "2026-11-02T12:00:00Z",
    deliveryEta: "2026-11-02T13:00:00Z",
  };
  assert.equal(
    trackingHeadline("WAITING_FOR_PICKUP", delivery).eta,
    delivery.pickupEta,
  );
  assert.equal(
    trackingHeadline("IN_DELIVERY", { ...delivery, task: "dropoff" }).eta,
    delivery.deliveryEta,
  );
  const current = order();
  for (const status of ["CONFIRMED", "RETURNING", "CANCELLED", "DELIVERED"])
    assert.equal(needsOrderRefresh(current, trackingBlob({ status })!), true);
  assert.equal(current.status, "IN_DELIVERY");
  assert.equal(
    needsOrderRefresh(current, trackingBlob({ status: "IN_DELIVERY" })!),
    false,
  );
  assert.ok(
    movementMetres(
      { latitude: 51.5, longitude: 0 },
      { latitude: 51.5001, longitude: 0 },
    ) < 50,
  );
});
function request(
  body: unknown = {},
  origin = "https://marketplace.example",
  cookie = "street_staging_access=access",
) {
  return new NextRequest("https://marketplace.example/api/tracking/session", {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
test("custom-token bridge derives owner from session and forwards no caller identity or STREET token", async () => {
  const calls: string[] = [];
  const api = createStreetApi(async (url, init) => {
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer access",
    );
    calls.push(String(url));
    return Response.json({
      data: String(url).endsWith("/auth/me")
        ? { id: "owner" }
        : { token: "firebase-custom", adminKey: "never" },
    });
  });
  const response = await handleTrackingSession(request(), api);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  const data = await response.json();
  assert.equal(data.userId, "owner");
  assert.equal(data.token, "firebase-custom");
  assert.doesNotMatch(JSON.stringify(data), /adminKey|never|Bearer access/);
  assert.ok(calls[1].endsWith("/auth/firebase-token"));
  for (const req of [
    request({ userId: "foreign" }),
    request({}, "https://evil.example"),
    request({}, "https://marketplace.example", ""),
  ]) {
    const before = calls.length;
    assert.ok((await handleTrackingSession(req, api)).status >= 400);
    assert.equal(calls.length, before);
  }
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fakeTransport() {
  let disposed = 0,
    subscriptions = 0,
    unsubscribed = 0;
  const values = new Map<string, (value: unknown) => void>(),
    errors = new Map<string, () => void>();
  const transport: TrackingTransport = {
    mapboxToken: "pk.fixture",
    listen(id, value, error) {
      subscriptions++;
      values.set(id, value);
      errors.set(id, error);
      return () => {
        unsubscribed++;
        values.delete(id);
      };
    },
    async dispose() {
      disposed++;
    },
  };
  return {
    transport,
    values,
    errors,
    get counts() {
      return { disposed, subscriptions, unsubscribed };
    },
  };
}
test("shared tracking subscription releases only final holder and clears cached data on account change", async () => {
  const fake = fakeTransport();
  const owners: string[] = [];
  const hub = createTrackingHub(async (owner, state) => {
    owners.push(owner);
    state("live");
    return fake.transport;
  });
  const a: unknown[] = [],
    b: unknown[] = [];
  const stopA = hub.subscribe("one", "uuid", (value) => a.push(value));
  const stopB = hub.subscribe("one", "uuid", (value) => b.push(value));
  await tick();
  assert.equal(fake.counts.subscriptions, 1);
  fake.values.get("uuid")!({ status: "CONFIRMED" });
  assert.equal((a.at(-1) as any).blob.status, "CONFIRMED");
  stopA();
  assert.equal(fake.counts.unsubscribed, 0);
  stopB();
  assert.equal(fake.counts.unsubscribed, 1);
  assert.equal(fake.counts.disposed, 1);
  const fresh: unknown[] = [];
  hub.subscribe("two", "uuid", (value) => fresh.push(value));
  await tick();
  assert.deepEqual(owners, ["one", "two"]);
  assert.equal((fresh[0] as any).blob, null);
  hub.reset();
  assert.equal((fresh.at(-1) as any).connection, "signed-out");
});
test("late authentication cannot revive a signed-out tracking session", async () => {
  const fake = fakeTransport();
  let resolve!: (transport: TrackingTransport) => void;
  const hub = createTrackingHub(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  hub.subscribe("one", "uuid", () => {});
  hub.reset();
  resolve(fake.transport);
  await tick();
  assert.equal(fake.counts.subscriptions, 0);
  assert.equal(fake.counts.disposed, 1);
});
test("permission failures retry once, and older courier snapshots cannot move marker backwards", async () => {
  const transports: ReturnType<typeof fakeTransport>[] = [];
  const hub = createTrackingHub(async (_, state) => {
    const f = fakeTransport();
    transports.push(f);
    state("live");
    return f.transport;
  });
  const events: any[] = [];
  hub.subscribe("one", "uuid", (event) => events.push(event));
  await tick();
  transports[0].errors.get("uuid")!();
  await tick();
  assert.equal(transports.length, 2);
  transports[1].values.get("uuid")!({
    updatedAt: "2026-11-02T12:00:00Z",
    courier: { lat: 51.6, lng: 0 },
  });
  transports[1].values.get("uuid")!({
    updatedAt: "2026-11-02T11:00:00Z",
    courier: { lat: 51.5, lng: 0 },
  });
  assert.equal(events.at(-1).blob.courier.location.latitude, 51.6);
  transports[1].errors.get("uuid")!();
  await tick();
  assert.equal(transports.length, 2);
  assert.equal(events.at(-1).connection, "unavailable");
  hub.reset();
});

test("delivery PIN is visible before pickup when available, but hidden for unpaid and terminal orders", () => {
  for (const status of [
    "CONFIRMED",
    "IN_PACKING",
    "READY_FOR_DELIVERY",
    "WAITING_FOR_PICKUP",
    "IN_DELIVERY",
  ]) {
    assert.equal(showDeliveryPin(status, "1234"), true);
    assert.equal(showDeliveryPin(status, null), false);
  }
  for (const status of [
    "PENDING_PAYMENT",
    "RETURNING",
    "RETURNED",
    "CANCELLED",
    "DELIVERED",
    "COMPLETED",
    "REJECTED",
    "MISSED",
  ]) {
    assert.equal(showDeliveryPin(status, "1234"), false);
  }
});
