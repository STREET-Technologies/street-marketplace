import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { createStreetApi } from "../lib/server/street-api.ts";
import { handleOrders } from "../lib/server/orders-api.ts";
import {
  orderDetailFrom,
  orderPageFrom,
  orderCountsFrom,
} from "../lib/server/orders.ts";
import {
  orderGroup,
  orderStatus,
  orderTotals,
  paymentMethodLabel,
} from "../lib/orders.ts";

const item = {
  quantity: 2,
  price: "30.00",
  productName: "T-shirt",
  metadata: {
    productName: "Training T-shirt",
    images: [{ src: "https://images.example/shirt.jpg" }],
    optionValues: [
      { option: { name: "Size" }, value: "M" },
      { option: { name: "Color" }, value: "Black" },
    ],
    internalSecret: "private-metadata",
  },
};
const order = {
  id: "internal-uuid",
  orderId: "ST-001234",
  status: "DELIVERED",
  returnStatus: "NONE",
  totalAmount: "69.99",
  createdAt: "2026-11-01T12:00:00.000Z",
  vendor: {
    storeName: "Gymshark",
    email: "private-contact",
    stripeAccountId: "private-stripe",
    storefrontAccessToken: "private-token",
    shippingReturnsUrl: "https://example.com/returns",
  },
  orderItems: [item],
  items: [item],
  subtotal: 60,
  deliveryFee: 9.99,
  packagingFee: 0,
  discount: null,
  totalRefundedAmount: 0,
  totalShippingRefundedAmount: 0,
  paymentStatus: "PAID",
  paymentMethod: "card",
  deliveryAddress: "1 Test Street, London",
  deliveryNote: "Reception",
  delivery: { pinCode: "private-pin", courier: { phone: "private-phone" } },
};
function req(query = "", token = "one") {
  return new NextRequest(`https://marketplace.example/api/orders${query}`, {
    headers: token ? { cookie: `street_staging_access=${token}` } : {},
  });
}
function fixture(status = 200) {
  const calls: {
    path: string;
    auth: string | null;
    cache: RequestCache | undefined;
  }[] = [];
  const api = createStreetApi(async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      path: url.pathname + url.search,
      auth: new Headers(init?.headers).get("authorization"),
      cache: init?.cache,
    });
    if (status !== 200) return new Response("private-upstream", { status });
    return Response.json({
      data: url.pathname.endsWith("/my")
        ? {
            orders: [order],
            meta: {
              page: Number(url.searchParams.get("page")),
              limit: 20,
              total: 1,
            },
          }
        : order,
    });
  });
  return { api, calls };
}
test("orders use signed-in bearer context, private responses and explicit list/detail allowlists", async () => {
  const f = fixture();
  for (const query of ["?group=past", "?reference=ST-001234"]) {
    const response = await handleOrders(req(query), f.api);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /private, no-store/);
    assert.equal(response.headers.get("vary"), "Cookie");
    const body = await response.text();
    assert.doesNotMatch(
      body,
      /private-|internal-uuid|storefrontAccessToken|stripeAccountId|pinCode|metadata/,
    );
    assert.match(body, /ST-001234/);
  }
  assert.deepEqual(
    f.calls.map((c) => c.path),
    ["/v1/orders/my?page=1&limit=20", "/v1/orders/ST-001234"],
  );
  assert.ok(
    f.calls.every((c) => c.auth === "Bearer one" && c.cache === "no-store"),
  );
  await handleOrders(req("?group=past", "two"), f.api);
  assert.equal(f.calls[2].auth, "Bearer two");
});
test("guest and forged identifiers, query paths and unbounded pagination never reach upstream", async () => {
  const f = fixture();
  assert.equal((await handleOrders(req("", ""), f.api)).status, 401);
  for (const query of [
    "?userId=someone",
    "?page=0",
    "?page=1.5",
    "?page=Infinity",
    "?page=100001",
    "?group=all",
    "?reference=../../users",
    "?reference=ST-123&page=1",
    "?page=1&page=2",
    "?limit=10000",
  ])
    assert.equal((await handleOrders(req(query), f.api)).status, 400, query);
  assert.equal(f.calls.length, 0);
});
test("backend ownership denial is preserved without leakage or retry", async () => {
  for (const status of [401, 403, 404, 500]) {
    const f = fixture(status),
      response = await handleOrders(req("?reference=ST-001234"), f.api);
    assert.equal(response.status, status === 500 ? 502 : status);
    assert.doesNotMatch(await response.text(), /private-upstream/);
    assert.equal(f.calls.length, 1);
  }
});
test("history scans past pages containing only active orders and exposes remaining pages", async () => {
  const calls: number[] = [];
  const result = await orderPageFrom(
    async (page) => {
      calls.push(page);
      return {
        orders: [{ ...order, status: page < 4 ? "CONFIRMED" : "DELIVERED" }],
        meta: { page, limit: 20, total: 120 },
      };
    },
    "past",
    1,
  );
  assert.deepEqual(calls, [1, 2, 3, 4]);
  assert.equal(result.orders.length, 1);
  assert.equal(result.nextPage, 5);
});
test("bounded scans keep continuation when no matches; only final page establishes empty", async () => {
  const read = async (page: number) => ({
    orders: [order],
    meta: { page, limit: 20, total: 150 },
  });
  assert.deepEqual(await orderPageFrom(read, "active", 1), {
    orders: [],
    nextPage: 6,
  });
  assert.deepEqual(await orderPageFrom(read, "active", 6), {
    orders: [],
    nextPage: null,
  });
});
test("status contract preserves mobile grouping and return precedence", () => {
  for (const status of [
    "DELIVERED",
    "COMPLETED",
    "CANCELLED",
    "REJECTED",
    "MISSED",
    "RETURNED",
  ])
    assert.equal(orderGroup(status), "past");
  for (const status of [
    "RETURNING",
    "PENDING_PAYMENT",
    "PAYMENT_FAILED",
    "IN_PACKING",
  ])
    assert.equal(orderGroup(status), "active");
  assert.equal(orderStatus({ ...order, status: "REJECTED" }).label, "Declined");
  assert.equal(
    orderStatus({ ...order, status: "RETURNED" }).label,
    "Returned to store",
  );
  assert.equal(
    orderStatus({ ...order, returnStatus: "COMPLETE" }).label,
    "Returned",
  );
  assert.equal(
    orderStatus({ ...order, returnStatus: "DECLINED" }).label,
    "Delivered",
  );
  assert.equal(
    orderStatus({ ...order, status: "FUTURE_STATUS" }).label,
    "Status unavailable",
  );
});
test("details retain item variant metadata while excluding non-customer data and unsafe links", () => {
  const detail = orderDetailFrom(order);
  assert.deepEqual(detail.items[0].options, [
    { name: "Size", value: "M" },
    { name: "Colour", value: "Black" },
  ]);
  assert.equal(detail.items[0].name, "Training T-shirt");
  const fallback = orderDetailFrom({
    ...order,
    vendor: { shippingReturnsUrl: "javascript:alert(1)" },
    items: [
      {
        ...item,
        metadata: {
          variantTitle: "UK 8 / White",
          imageUrl: "javascript:x",
          packingState: { status: "cancelled" },
        },
      },
    ],
  });
  assert.equal(fallback.returnsPolicy, null);
  assert.equal(fallback.items[0].image, null);
  assert.equal(fallback.items[0].unavailable, true);
  assert.deepEqual(fallback.items[0].options, [
    { name: "Variant", value: "UK 8 / White" },
  ]);
});
test("refund arithmetic preserves original charge and keeps current total separate", () => {
  const detail = orderDetailFrom({
    ...order,
    subtotal: 30,
    totalRefundedAmount: 30,
  });
  assert.equal(detail.total, 69.99);
  assert.deepEqual(orderTotals(detail), {
    current: 39.99,
    netPaid: 39.99,
    deliveryKept: true,
  });
  const fallback = orderDetailFrom({
    ...order,
    totalRefundedAmount: undefined,
    returns: [{ refundedAmount: 10 }, { refundedAmount: "20" }],
  });
  assert.equal(fallback.refunded, 30);
  assert.equal(orderTotals({ ...detail, refunded: 100 }).netPaid, 0);
  assert.equal(
    orderTotals({ ...detail, shippingRefunded: 9.99 }).deliveryKept,
    false,
  );
});
test("malformed financial data fails visibly rather than rendering a zero amount", () => {
  for (const totalAmount of ["bad", -1, null, {}])
    assert.throws(() => orderDetailFrom({ ...order, totalAmount }));
});

test("returns filter mirrors mobile and keeps declined/cancelled returns in history", async () => {
  const statuses = [
    "NONE",
    "REQUESTED",
    "IN_PROGRESS",
    "PARTIAL",
    "COMPLETE",
    "DECLINED",
    "CANCELLED",
  ];
  const result = await orderPageFrom(
    async (page) => ({
      orders: statuses.map((returnStatus) => ({ ...order, returnStatus })),
      meta: { page, limit: 20, total: 7 },
    }),
    "returns",
    1,
  );
  assert.deepEqual(
    result.orders.map((row) => row.returnStatus),
    ["REQUESTED", "IN_PROGRESS", "PARTIAL", "COMPLETE"],
  );
  assert.equal(result.nextPage, null);
  const f = fixture();
  assert.equal((await handleOrders(req("?group=returns"), f.api)).status, 200);
});
test("returns scan older pages and never show a false empty state at the scan limit", async () => {
  const read = async (page: number) => ({
    orders: [{ ...order, returnStatus: page === 7 ? "COMPLETE" : "NONE" }],
    meta: { page, limit: 20, total: 140 },
  });
  assert.deepEqual(await orderPageFrom(read, "returns", 1), {
    orders: [],
    nextPage: 6,
  });
  const result = await orderPageFrom(read, "returns", 6);
  assert.equal(result.orders.length, 1);
  assert.equal(result.nextPage, null);
});
test("return projection exposes customer notes, reasons and actual refunds without Shopify identifiers", () => {
  const result = orderDetailFrom({
    ...order,
    returns: [
      {
        id: "private-return-id",
        shopifyReturnId: "private-shopify-id",
        status: "OPEN",
        refundAmount: 99,
        refundedAmount: 10,
        customerNote: "Retailer received your parcel",
        createdAt: "2026-11-02T12:00:00Z",
        lineItems: [
          {
            orderItemId: "private-item-id",
            quantity: 2,
            reason: "Size",
            restockType: "private-restock",
          },
          { quantity: 1, reason: "Size" },
        ],
      },
    ],
  });
  assert.deepEqual(result.returns, [
    {
      status: "OPEN",
      note: "Retailer received your parcel",
      createdAt: "2026-11-02T12:00:00.000Z",
      refunded: 10,
      quantity: 3,
      reasons: ["Size"],
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result.returns), /private-|99/);
});

test("payment display names hide internal Shopify checkout identifiers", () => {
  assert.equal(paymentMethodLabel("shopify_checkout"), "Shopify");
  assert.equal(paymentMethodLabel("Shopify"), "Shopify");
  assert.equal(paymentMethodLabel("card"), "card");
  assert.equal(paymentMethodLabel("unknown"), null);
  assert.equal(paymentMethodLabel(null), null);
});

test("counts scan all pages with the same overlapping return/history filters", async () => {
  const rows = Array.from({ length: 105 }, (_, i) => ({
    ...order,
    orderId: `ST-${String(i + 1).padStart(6, "0")}`,
    status: i < 3 ? "CONFIRMED" : "DELIVERED",
    returnStatus: i >= 100 ? "COMPLETE" : "NONE",
  }));
  const calls: number[] = [];
  const result = await orderCountsFrom(async (page, limit) => {
    calls.push(page);
    return {
      orders: rows.slice((page - 1) * limit, page * limit),
      meta: { page, limit, total: rows.length },
    };
  });
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(result, { active: 3, past: 102, returns: 5 });
});
test("count scan refuses partial or changing histories instead of reporting false totals", async () => {
  await assert.rejects(() =>
    orderCountsFrom(async (page, limit) => ({
      orders: [],
      meta: { page, limit, total: 1 },
    })),
  );
  await assert.rejects(() =>
    orderCountsFrom(async (page, limit) => ({
      orders: [],
      meta: { page, limit, total: page === 1 ? 101 : 102 },
    })),
  );
  await assert.rejects(() =>
    orderCountsFrom(async (page, limit) => ({
      orders: [],
      meta: { page, limit, total: 1001 },
    })),
  );
  assert.deepEqual(
    await orderCountsFrom(async (page, limit) => ({
      orders: [],
      meta: { page, limit, total: 0 },
    })),
    { active: 0, past: 0, returns: 0 },
  );
});
test("counts route is private, authenticated and rejects mixed queries", async () => {
  const f = fixture();
  assert.equal(
    (await handleOrders(req("?counts=true", ""), f.api)).status,
    401,
  );
  for (const query of [
    "?counts=false",
    "?counts=true&group=returns",
    "?counts=true&page=2",
  ])
    assert.equal((await handleOrders(req(query), f.api)).status, 400);
  assert.equal(f.calls.length, 0);
});
