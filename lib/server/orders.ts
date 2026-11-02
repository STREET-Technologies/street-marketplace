import { coordinates, isoTime } from "../tracking.ts";
import { UUID_PATTERN } from "./api-values.ts";
import {
  ApiError,
  record,
  requiredString,
  optionalString,
  imageUrl,
} from "./api-values.ts";
import {
  orderGroup,
  matchesOrderGroup,
  type OrderCounts,
  type OrderCard,
  type OrderDetail,
  type OrderGroup,
  type OrderItem,
  type OrderPage,
} from "../orders.ts";
const object = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? record(value)
    : {};
function amount(value: unknown, fallback?: number): number {
  if (value == null && fallback !== undefined) return fallback;
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    value === "" ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0
  )
    throw new ApiError(502, "STREET returned an invalid order amount.");
  return Number(value);
}
export function orderReference(value: unknown): string {
  // Includes historical ST-W references as well as canonical ST-00xxxx IDs.
  if (typeof value !== "string" || !/^ST-[A-Z0-9]{1,64}$/i.test(value))
    throw new ApiError(400, "Choose a valid order.");
  return value;
}
function itemFrom(value: unknown): OrderItem {
  const item = record(value),
    metadata = object(item.metadata);
  const images = Array.isArray(metadata.images) ? metadata.images : [];
  let options: OrderItem["options"] = [];
  if (Array.isArray(metadata.optionValues)) {
    options = metadata.optionValues.flatMap((value) => {
      const option = object(value),
        name = optionalString(object(option.option).name),
        text = optionalString(option.value);
      return name && text && text !== "Default Title"
        ? [
            {
              name: name.toLowerCase() === "color" ? "Colour" : name,
              value: text,
            },
          ]
        : [];
    });
  }
  if (!options.length)
    options = Object.entries(object(item.selectedOptions)).flatMap(
      ([name, value]) =>
        typeof value === "string" && value !== "Default Title"
          ? [{ name, value }]
          : [],
    );
  if (
    !options.length &&
    typeof metadata.variantTitle === "string" &&
    metadata.variantTitle !== "Default Title"
  )
    options = [{ name: "Variant", value: metadata.variantTitle }];
  if (!Number.isSafeInteger(item.quantity) || Number(item.quantity) < 0)
    throw new ApiError(502, "STREET returned invalid order items.");
  return {
    name:
      optionalString(metadata.productName) ??
      optionalString(metadata.title) ??
      optionalString(item.productName) ??
      "Product",
    image:
      imageUrl(item.productImage) ??
      imageUrl(object(images[0]).src) ??
      imageUrl(images[0]) ??
      imageUrl(metadata.imageUrl),
    quantity: Number(item.quantity),
    price: amount(item.price),
    options,
    unavailable: object(metadata.packingState).status === "cancelled",
  };
}
export function orderCardFrom(value: unknown): OrderCard {
  const order = record(value),
    vendor = object(order.vendor);
  const items = Array.isArray(order.orderItems)
    ? order.orderItems
    : Array.isArray(order.items)
      ? order.items
      : [];
  const createdAt = requiredString(order.createdAt);
  if (!Number.isFinite(Date.parse(createdAt)))
    throw new ApiError(502, "STREET returned an invalid order date.");
  return {
    trackingId:
      typeof order.id === "string" && UUID_PATTERN.test(order.id)
        ? order.id
        : null,
    reference: orderReference(order.orderId),
    store: optionalString(vendor.storeName) ?? "Shop",
    image: items.length ? itemFrom(items[0]).image : null,
    createdAt,
    status: requiredString(order.status),
    returnStatus: optionalString(order.returnStatus) ?? "NONE",
    total: amount(order.totalAmount),
  };
}
export function orderDetailFrom(value: unknown): OrderDetail {
  const order = record(value),
    vendor = object(order.vendor);
  if (!Array.isArray(order.items))
    throw new ApiError(502, "STREET returned incomplete order details.");
  const delivery = object(order.delivery),
    courier = object(delivery.courier);
  const returns = Array.isArray(order.returns) ? order.returns : [];
  return {
    ...orderCardFrom(order),
    returns: returns.map((value) => {
      const row = object(value);
      const lines = Array.isArray(row.lineItems)
        ? row.lineItems.map(object)
        : [];
      return {
        status: optionalString(row.status) ?? "UNKNOWN",
        note: optionalString(row.customerNote),
        createdAt: isoTime(row.createdAt),
        refunded: amount(row.refundedAmount, 0),
        quantity: lines.reduce(
          (sum, line) =>
            sum +
            (Number.isSafeInteger(line.quantity) && Number(line.quantity) > 0
              ? Number(line.quantity)
              : 0),
          0,
        ),
        reasons: [
          ...new Set(
            lines
              .map((line) => optionalString(line.reason))
              .filter(
                (reason): reason is string =>
                  !!reason && reason.toLowerCase() !== "unknown",
              ),
          ),
        ],
      };
    }),
    tracking: {
      jobId: optionalString(delivery.jobId),
      topic: optionalString(delivery.status),
      task: null,
      courier:
        Object.keys(courier).length || coordinates(delivery.courierLocation)
          ? {
              name: optionalString(courier.name),
              location:
                coordinates(delivery.courierLocation) ??
                coordinates(courier.location),
            }
          : null,
      pickupEta: isoTime(delivery.estimatedPickupTime),
      deliveryEta: isoTime(delivery.estimatedDeliveryTime),
      pin:
        typeof delivery.pinCode === "string" &&
        /^[0-9]{4,8}$/.test(delivery.pinCode)
          ? delivery.pinCode
          : null,
      pickup: coordinates(order.storeLocation),
      destination: coordinates(order.deliveryLocation),
    },
    items: order.items.map(itemFrom),
    address: optionalString(order.deliveryAddress) ?? "",
    instructions: optionalString(order.deliveryNote) ?? "",
    subtotal: amount(order.subtotal),
    deliveryFee: amount(order.deliveryFee, 0),
    packagingFee: amount(order.packagingFee, 0),
    discount: amount(order.discount, 0),
    refunded:
      order.totalRefundedAmount == null
        ? returns.reduce<number>(
            (sum, value) => sum + amount(object(value).refundedAmount, 0),
            0,
          )
        : amount(order.totalRefundedAmount),
    shippingRefunded: amount(order.totalShippingRefundedAmount, 0),
    paymentStatus: optionalString(order.paymentStatus) ?? "UNKNOWN",
    paymentMethod: optionalString(order.paymentMethod),
    returnsPolicy: imageUrl(vendor.shippingReturnsUrl),
  };
}
// Bounded reads, continuing from the next upstream page. Never silently truncate
// history or claim an empty group until the backend's final page is reached.
export async function orderPageFrom(
  read: (page: number, limit: number) => Promise<unknown>,
  group: OrderGroup,
  page: number,
): Promise<OrderPage> {
  for (let scanned = 0; scanned < 5; scanned++, page++) {
    const data = record(await read(page, 20)),
      meta = record(data.meta);
    if (
      !Array.isArray(data.orders) ||
      !Number.isSafeInteger(meta.total) ||
      Number(meta.total) < 0 ||
      meta.page !== page ||
      meta.limit !== 20
    )
      throw new ApiError(502, "STREET returned an unexpected order history.");
    const orders = data.orders
      .map(orderCardFrom)
      .filter((o) => matchesOrderGroup(o, group));
    const nextPage = page * 20 < Number(meta.total) ? page + 1 : null;
    if (orders.length || nextPage === null || scanned === 4)
      return { orders, nextPage };
  }
  throw new ApiError(502, "Unable to read order history.");
}

// Count independently of visible pagination. Never expose a partial scan as a total.
export async function orderCountsFrom(
  read: (page: number, limit: number) => Promise<unknown>,
): Promise<OrderCounts> {
  const counts: OrderCounts = { active: 0, past: 0, returns: 0 };
  const seen = new Set<string>();
  let expectedTotal: number | null = null;
  const limit = 100;
  for (let page = 1; page <= 10; page++) {
    const data = record(await read(page, limit)),
      meta = record(data.meta);
    if (
      !Array.isArray(data.orders) ||
      !Number.isSafeInteger(meta.total) ||
      Number(meta.total) < 0 ||
      meta.page !== page ||
      meta.limit !== limit ||
      (expectedTotal !== null && meta.total !== expectedTotal)
    )
      throw new ApiError(502, "Order totals are temporarily unavailable.");
    expectedTotal = Number(meta.total);
    for (const value of data.orders) {
      const row = record(value),
        reference = orderReference(row.orderId);
      if (seen.has(reference))
        throw new ApiError(502, "Order totals are temporarily unavailable.");
      seen.add(reference);
      const order = {
        status: requiredString(row.status),
        returnStatus: optionalString(row.returnStatus) ?? "NONE",
      };
      for (const group of ["active", "past", "returns"] as const)
        if (matchesOrderGroup(order, group)) counts[group]++;
    }
    if (page * limit >= expectedTotal) {
      if (seen.size !== expectedTotal)
        throw new ApiError(502, "Order totals are temporarily unavailable.");
      return counts;
    }
  }
  throw new ApiError(502, "Order totals are temporarily unavailable.");
}
