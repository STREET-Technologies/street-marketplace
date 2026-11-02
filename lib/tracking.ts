import type { OrderDetail } from "./orders.ts";
import { orderGroup } from "./orders.ts";
export type Coordinates = { latitude: number; longitude: number };
export type DeliveryTracking = {
  jobId: string | null;
  topic: string | null;
  task: string | null;
  courier: { name: string | null; location: Coordinates | null } | null;
  pickupEta: string | null;
  deliveryEta: string | null;
  pin: string | null;
  destination: Coordinates | null;
  pickup: Coordinates | null;
};
export type TrackingBlob = {
  status: string | null;
  statusUpdatedAt: string | null;
  updatedAt: string | null;
  topic: string | null;
  task: string | null;
  courier?: DeliveryTracking["courier"];
  pickupEta?: string | null;
  deliveryEta?: string | null;
};
export type TrackingConnection =
  "connecting" | "live" | "offline" | "unavailable" | "signed-out";
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const text = (value: unknown) =>
  typeof value === "string" && value.length <= 200 ? value : null;
export function coordinates(value: unknown): Coordinates | null {
  const point = object(value),
    latitude = point.latitude ?? point.lat,
    longitude = point.longitude ?? point.lng;
  return typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null;
}
export function isoTime(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
export function trackingBlob(value: unknown): TrackingBlob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = object(value),
    courier = object(row.courier);
  return {
    status: text(row.status),
    statusUpdatedAt: isoTime(row.statusUpdatedAt),
    updatedAt: isoTime(row.updatedAt),
    topic: text(row.topic),
    task: text(row.task),
    ...(Object.hasOwn(row, "courier")
      ? {
          courier:
            row.courier === null
              ? null
              : { name: text(courier.name), location: coordinates(courier) },
        }
      : {}),
    ...(Object.hasOwn(row, "etaPickup")
      ? { pickupEta: isoTime(row.etaPickup) }
      : {}),
    ...(Object.hasOwn(row, "etaDelivery")
      ? { deliveryEta: isoTime(row.etaDelivery) }
      : {}),
  };
}
export function liveDelivery(
  base: DeliveryTracking,
  blob: TrackingBlob | null,
): DeliveryTracking {
  if (!blob) return base;
  return {
    ...base,
    topic: blob.topic ?? base.topic,
    task: blob.task ?? base.task,
    courier:
      blob.topic === "courier_reassigning"
        ? null
        : blob.courier === undefined
          ? base.courier
          : blob.courier,
    pickupEta: blob.pickupEta === undefined ? base.pickupEta : blob.pickupEta,
    deliveryEta:
      blob.deliveryEta === undefined ? base.deliveryEta : blob.deliveryEta,
  };
}
export const trackingStages = [
  "Order Placed",
  "Store Accepted",
  "Being Prepared",
  "Ready for Pickup",
  "Out for Delivery",
  "Delivered",
];
const ranks: Record<string, number> = {
  AWAITING_ACCEPTANCE: 0,
  CONFIRMED: 1,
  IN_PACKING: 2,
  READY_FOR_DELIVERY: 3,
  WAITING_FOR_PICKUP: 3,
  IN_DELIVERY: 4,
  DELIVERED: 5,
  COMPLETED: 5,
};
export const trackingStage = (status: string) =>
  Object.hasOwn(ranks, status) ? ranks[status] : -1;
// The REST snapshot remains authoritative for order status. RTDB signals a
// refetch rather than applying a stale initial status or numeric rank guess.
export function needsOrderRefresh(
  order: OrderDetail,
  blob: TrackingBlob,
): boolean {
  const topicStatus: Record<string, string> = {
    package_delivered: "DELIVERED",
    package_returning: "RETURNING",
    package_returned: "RETURNED",
    package_canceled: "CANCELLED",
  };
  const topic =
    blob.topic && Object.hasOwn(topicStatus, blob.topic)
      ? topicStatus[blob.topic]
      : null;
  return !!(
    (blob.status && blob.status !== order.status) ||
    (topic && topic !== order.status)
  );
}
export function trackingHeadline(
  status: string,
  delivery: DeliveryTracking,
): { label: string; eta: string | null } {
  const messages: Record<string, string> = {
    PENDING: "Confirming your payment",
    PENDING_PAYMENT: "Confirming your payment",
    PAYMENT_FAILED: "Payment failed",
    AWAITING_ACCEPTANCE: "Waiting for store confirmation",
    CONFIRMED: "Store accepted your order",
    IN_PACKING: "Store is preparing your order",
    READY_FOR_DELIVERY: "Order packed — ready for pickup",
    WAITING_FOR_PICKUP: "Waiting for a rider",
    IN_DELIVERY: "Your order is on the way",
    RETURNING: "Your order is being returned to the store",
    RETURNED: "Order returned to the store",
    CANCELLED: "Order cancelled",
    REJECTED: "Store declined your order",
    MISSED: "The store was unable to accept your order",
    DELIVERED: "Delivered — enjoy!",
    COMPLETED: "Delivered — enjoy!",
  };
  const fallback = Object.hasOwn(messages, status)
    ? messages[status]
    : "Checking your order status";
  if (
    orderGroup(status) === "past" ||
    [
      "RETURNING",
      "PENDING",
      "PENDING_PAYMENT",
      "PAYMENT_FAILED",
      "AWAITING_ACCEPTANCE",
      "CONFIRMED",
      "IN_PACKING",
    ].includes(status)
  )
    return { label: fallback, eta: null };
  const topic = delivery.topic,
    pickup = delivery.task === "pickup";
  if (topic === "courier_reassigning")
    return { label: "Finding a new rider", eta: null };
  if (topic === "courier_assigned")
    return {
      label: "Rider is on the way to the store",
      eta: delivery.pickupEta,
    };
  if (topic === "courier_arriving" && delivery.task)
    return {
      label: pickup
        ? "Rider has arrived at the store"
        : "Rider is almost at your address",
      eta: null,
    };
  if (topic === "courier_waiting")
    return { label: "Rider is waiting at the store", eta: null };
  if (topic === "courier_moving")
    return {
      label: pickup ? "Rider is heading to the store" : fallback,
      eta: pickup
        ? delivery.pickupEta
        : status === "IN_DELIVERY"
          ? delivery.deliveryEta
          : null,
    };
  if (status === "IN_DELIVERY")
    return { label: fallback, eta: delivery.deliveryEta };
  return { label: fallback, eta: null };
}
export function movementMetres(a: Coordinates, b: Coordinates) {
  const rad = Math.PI / 180,
    lat = (b.latitude - a.latitude) * rad,
    lng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(lng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function showDeliveryPin(status: string, pin: string | null): boolean {
  const stage = trackingStage(status);
  return !!pin && stage >= 0 && stage < trackingStages.length - 1;
}
