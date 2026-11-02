"use client";
import dynamic from "next/dynamic";
import type { OrderDetail } from "../lib/orders";
import {
  trackingHeadline,
  trackingStage,
  showDeliveryPin,
  trackingStages,
  type DeliveryTracking,
  type TrackingConnection,
} from "../lib/tracking";
const CourierMap = dynamic(() => import("./courier-map"), {
  ssr: false,
  loading: () => <p role="status">Loading delivery map…</p>,
});
export default function OrderTracking({
  order,
  delivery,
  connection,
  mapboxToken,
}: {
  order: OrderDetail;
  delivery: DeliveryTracking;
  connection: TrackingConnection;
  mapboxToken: string | null;
}) {
  const headline = trackingHeadline(order.status, delivery),
    stage = trackingStage(order.status);
  const returning = order.status === "RETURNING";
  const inDelivery = order.status === "IN_DELIVERY";
  const hasCourier = !!delivery.courier?.name;
  return (
    <section className="order-tracking" aria-label="Live order tracking">
      <div className="tracking-headline" role="status" aria-live="polite">
        <h3>{headline.label}</h3>
        {headline.eta && (
          <p>
            Estimated arrival{" "}
            {new Intl.DateTimeFormat("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Europe/London",
            }).format(new Date(headline.eta))}
          </p>
        )}
      </div>
      <p className="tracking-connection" role="status">
        {connection === "live"
          ? "Updates automatically"
          : connection === "connecting"
            ? "Connecting to live updates…"
            : "Live updates interrupted. Showing the last known details and checking for updates."}
      </p>
      {stage >= 0 && (
        <ol className="tracking-timeline" aria-label="Order progress">
          {trackingStages.map((label, index) => (
            <li
              key={label}
              data-progress={
                index < stage
                  ? "complete"
                  : index === stage
                    ? "current"
                    : "next"
              }
              aria-current={index === stage ? "step" : undefined}
            >
              <span className="tracking-step-icon" aria-hidden="true">
                {index < stage ? "✓" : index + 1}
              </span>
              <span>
                {label}
                <small>
                  {index < stage
                    ? "Complete"
                    : index === stage
                      ? "Current step"
                      : ""}
                </small>
              </span>
            </li>
          ))}
        </ol>
      )}
      {order.status === "PENDING_PAYMENT" && (
        <p>
          Payment has not been confirmed. This checkout has not been completed.
        </p>
      )}
      {returning && <p>We’ll update your order when it reaches the store.</p>}
      {!returning && hasCourier && (
        <p className="tracking-courier">
          Your rider: <strong>{delivery.courier!.name}</strong>
        </p>
      )}
      {delivery.pin && showDeliveryPin(order.status, delivery.pin) && (
        <div className="tracking-pin">
          <div>
            <h4>Delivery PIN</h4>
            <p>Share this with your rider when your order arrives.</p>
          </div>
          <strong
            aria-label={`Delivery PIN ${delivery.pin.split("").join(" ")}`}
          >
            {delivery.pin}
          </strong>
        </div>
      )}
      {inDelivery && (
        <>
          {delivery.destination && delivery.courier?.location && mapboxToken ? (
            <CourierMap
              destination={delivery.destination}
              courier={delivery.courier.location}
              token={mapboxToken}
            />
          ) : (
            <p className="tracking-map-message">
              {!mapboxToken && connection === "live"
                ? "The delivery map is temporarily unavailable."
                : "Waiting for the rider’s location. Your order status will continue to update here."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
