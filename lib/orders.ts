export type OrderGroup = "active" | "past" | "returns";
export type OrderItem = {
  name: string;
  image: string | null;
  quantity: number;
  price: number;
  options: { name: string; value: string }[];
  unavailable: boolean;
};
export type OrderCard = {
  trackingId: string | null;
  reference: string;
  store: string;
  image: string | null;
  createdAt: string;
  status: string;
  returnStatus: string;
  total: number;
};
export type OrderPage = { orders: OrderCard[]; nextPage: number | null };
export type OrderReturn = {
  status: string;
  note: string | null;
  createdAt: string | null;
  refunded: number;
  quantity: number;
  reasons: string[];
};
export type OrderDetail = OrderCard & {
  returns: OrderReturn[];
  tracking: import("./tracking.ts").DeliveryTracking;
  items: OrderItem[];
  address: string;
  instructions: string;
  subtotal: number;
  deliveryFee: number;
  packagingFee: number;
  discount: number;
  refunded: number;
  shippingRefunded: number;
  paymentStatus: string;
  paymentMethod: string | null;
  returnsPolicy: string | null;
};
// Mirrors mobile OrderEntity: RETURNING remains active.
const past = new Set([
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "MISSED",
  "RETURNED",
]);
export const orderGroup = (status: string): OrderGroup =>
  past.has(status) ? "past" : "active";
const returnLabels: Record<string, string> = {
  REQUESTED: "Return requested",
  IN_PROGRESS: "Return in progress",
  PARTIAL: "Partially returned",
  COMPLETE: "Returned",
};
export const hasReturn = (status: string) =>
  Object.hasOwn(returnLabels, status);
const orderLabels: Record<string, string> = {
  PENDING: "Pending",
  PENDING_PAYMENT: "Pending Payment",
  PAYMENT_FAILED: "Payment Failed",
  AWAITING_ACCEPTANCE: "Awaiting Acceptance",
  REJECTED: "Declined",
  MISSED: "Missed",
  CONFIRMED: "Confirmed",
  IN_PACKING: "In Packing",
  READY_FOR_DELIVERY: "Ready for Delivery",
  WAITING_FOR_PICKUP: "Waiting for Pickup",
  IN_DELIVERY: "In Delivery",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  RETURNING: "Returning to store",
  RETURNED: "Returned to store",
};
export function orderStatus(order: Pick<OrderCard, "status" | "returnStatus">) {
  return {
    label: hasReturn(order.returnStatus)
      ? returnLabels[order.returnStatus]
      : Object.hasOwn(orderLabels, order.status)
        ? orderLabels[order.status]
        : "Status unavailable",
    tone: ["REQUESTED", "IN_PROGRESS"].includes(order.returnStatus)
      ? "attention"
      : hasReturn(order.returnStatus)
        ? "neutral"
        : ["CANCELLED", "REJECTED", "MISSED", "PAYMENT_FAILED"].includes(
              order.status,
            )
          ? "negative"
          : "neutral",
  };
}
export const orderMoney = (amount: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    amount,
  );
export const orderDate = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(date));
export function orderTotals(order: OrderDetail) {
  const pennies = (amount: number) => Math.round(amount * 100);
  return {
    current:
      (pennies(order.subtotal) +
        pennies(order.deliveryFee) +
        pennies(order.packagingFee) -
        pennies(order.discount)) /
      100,
    netPaid: Math.max(0, pennies(order.total) - pennies(order.refunded)) / 100,
    deliveryKept:
      order.refunded > 0 &&
      order.deliveryFee > 0 &&
      order.shippingRefunded <= 0,
  };
}

export function returnStatusLabel(status: string) {
  const labels: Record<string, string> = {
    REQUESTED: "Return requested",
    OPEN: "Return in progress",
    CLOSED: "Return completed",
    DECLINED: "Return declined",
    CANCELED: "Return cancelled",
    CANCELLED: "Return cancelled",
  };
  return Object.hasOwn(labels, status)
    ? labels[status]
    : "Return status unavailable";
}

export function paymentMethodLabel(method: string | null): string | null {
  const value = method?.trim();
  if (!value || ["others", "unknown"].includes(value.toLowerCase()))
    return null;
  return ["shopify_checkout", "shopify"].includes(value.toLowerCase())
    ? "Shopify"
    : value;
}

export type OrderCounts = Record<OrderGroup, number>;
export function matchesOrderGroup(
  order: Pick<OrderCard, "status" | "returnStatus">,
  group: OrderGroup,
) {
  return (
    order.status !== "PAYMENT_CANCELLED" &&
    (group === "returns"
      ? hasReturn(order.returnStatus)
      : orderGroup(order.status) === group)
  );
}
