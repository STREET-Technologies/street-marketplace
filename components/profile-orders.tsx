"use client";
import { useEffect, useRef, useState } from "react";
import { CustomerEmptyState } from "./customer-page";
import CustomerTabs from "./customer-tabs";
import NavigationIcon from "./navigation-icon";
import OrderTracking from "./order-tracking";
import { useTrackedOrder } from "../lib/client/use-tracked-order";
import { orderGroup } from "../lib/orders";
import { readAccountData, SessionError } from "../lib/client/session";
import {
  hasReturn,
  orderDate,
  orderMoney,
  orderStatus,
  orderTotals,
  type OrderCard,
  type OrderDetail,
  type OrderGroup,
  type OrderPage,
} from "../lib/orders";

function Status({ order }: { order: OrderCard }) {
  const status = orderStatus(order);
  return (
    <span className="order-status" data-tone={status.tone}>
      {status.label}
    </span>
  );
}
function Thumbnail({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="order-thumbnail">
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <NavigationIcon name="bag" />
      )}
    </span>
  );
}
function OrderError({ error, retry }: { error: Error; retry: () => void }) {
  if (error instanceof SessionError && error.status === 401)
    return (
      <CustomerEmptyState
        icon="history"
        title="Sign in required"
        message="Please sign in to view your order history and past deliveries."
      >
        <a className="primary" href="/account">
          Sign In
        </a>
      </CustomerEmptyState>
    );
  return (
    <div className="order-error" role="alert">
      <p>{error.message}</p>
      <button className="text-link" onClick={retry}>
        Try again
      </button>
    </div>
  );
}

export default function ProfileOrders({ userId }: { userId: string }) {
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [group, setGroup] = useState<OrderGroup>("active");
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    const visible = () => {
      if (!selected && document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [selected]);
  function close() {
    const reference = selected;
    setSelected(null);
    requestAnimationFrame(() => {
      const button = [
        ...(list.current?.querySelectorAll<HTMLButtonElement>("[data-order]") ??
          []),
      ].find((button) => button.dataset.order === reference);
      (button ?? list.current)?.focus();
    });
  }
  return (
    <section className="profile-section orders-section">
      {selected && (
        <button className="text-link order-back" onClick={close}>
          ← Back to my orders
        </button>
      )}
      <div className="order-heading">
        <div className="profile-heading-title">
          <h2>
            {selected
              ? selectedStatus && orderGroup(selectedStatus) === "active"
                ? "Live tracking"
                : "Order Summary"
              : "My orders"}
          </h2>
          <button
            className="profile-heading-action"
            onClick={refresh}
            aria-label="Refresh"
            title="Refresh orders"
          >
            <NavigationIcon name="refresh" />
          </button>
        </div>
        {selected && <p>{selected}</p>}
      </div>
      {selected && (
        <div className="order-detail-view">
          <OrderSummary
            key={`${selected}:${revision}`}
            reference={selected}
            userId={userId}
            onStatus={setSelectedStatus}
            retry={refresh}
          />
        </div>
      )}
      <div hidden={!!selected} ref={list} tabIndex={-1}>
        <CustomerTabs
          label="Order views"
          value={group}
          onChange={(value) => setGroup(value as OrderGroup)}
          tabs={[
            {
              key: "active",
              label: "Active orders",
              content: group === "active" && (
                <OrderFeed
                  key={`active:${revision}`}
                  group="active"
                  userId={userId}
                  open={(order) => {
                    setSelectedStatus(order.status);
                    setSelected(order.reference);
                  }}
                />
              ),
            },
            {
              key: "past",
              label: "Order history",
              content: group === "past" && (
                <OrderFeed
                  key={`past:${revision}`}
                  group="past"
                  userId={userId}
                  open={(order) => {
                    setSelectedStatus(order.status);
                    setSelected(order.reference);
                  }}
                />
              ),
            },
          ]}
        />
      </div>
    </section>
  );
}

function OrderFeed({
  group,
  userId,
  open,
}: {
  group: OrderGroup;
  userId: string;
  open: (order: OrderCard) => void;
}) {
  const [orders, setOrders] = useState<OrderCard[]>([]);
  const [page, setPage] = useState(1);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retry, setRetry] = useState(0);
  const seenHints = useRef(new Set<string>());
  useEffect(() => {
    if (group !== "active" || !orders.length) return;
    let alive = true;
    const stops: (() => void)[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    void import("../lib/client/firebase-tracking").then(
      ({ subscribeTracking }) => {
        if (!alive) return;
        for (const order of orders)
          if (order.trackingId)
            stops.push(
              subscribeTracking(
                userId,
                order.trackingId,
                ({ blob, connection }) => {
                  if (!alive) return;
                  if (connection === "signed-out") {
                    setOrders([]);
                    setError(new SessionError(401, "Please sign in again."));
                    return;
                  }
                  const hint = `${order.trackingId}:${blob?.status}:${blob?.statusUpdatedAt}`;
                  if (
                    blob?.status &&
                    blob.status !== order.status &&
                    !seenHints.current.has(hint)
                  ) {
                    seenHints.current.add(hint);
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                      if (alive) {
                        setOrders([]);
                        setPage(1);
                        setRetry((value) => value + 1);
                      }
                    }, 500);
                  }
                },
              ),
            );
      },
    );
    return () => {
      alive = false;
      clearTimeout(timer);
      stops.forEach((stop) => stop());
    };
  }, [orders, group, userId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    readAccountData<OrderPage>(
      "/api/orders",
      new URLSearchParams({ group, page: String(page) }),
    )
      .then((result) => {
        if (!active) return;
        setOrders((current) => [
          ...new Map(
            [...current, ...result.orders].map((order) => [
              order.reference,
              order,
            ]),
          ).values(),
        ]);
        setNextPage(result.nextPage);
      })
      .catch((error) => {
        if (active) {
          setError(error);
          if (error instanceof SessionError && error.status === 401)
            setOrders([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [group, page, retry]);
  return (
    <>
      {orders.length > 0 && (
        <ul className="order-list">
          {orders.map((order) => (
            <li key={order.reference}>
              <button
                className="order-row"
                data-order={order.reference}
                onClick={() => open(order)}
                aria-label={`View order ${order.reference} from ${order.store}`}
              >
                <Thumbnail src={order.image} />
                <span className="order-row-main">
                  <strong>{order.store}</strong>
                  <span>
                    {order.reference} · {orderDate(order.createdAt)}
                  </span>
                  <Status order={order} />
                </span>
                <span className="order-row-total">
                  {orderMoney(order.total)}
                </span>
                <span aria-hidden="true" className="order-chevron">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {loading && (
        <p role="status" className="order-loading">
          Loading your orders…
        </p>
      )}
      {error && (
        <OrderError
          error={error}
          retry={() => setRetry((value) => value + 1)}
        />
      )}
      {!loading &&
        !error &&
        orders.length === 0 &&
        (nextPage !== null ? (
          <p className="order-loading">
            No {group === "active" ? "active" : "past"} orders in these results.
            Load more to look further back.
          </p>
        ) : (
          <CustomerEmptyState
            icon="history"
            title={group === "active" ? "No active orders" : "No past orders"}
            message={
              group === "active"
                ? "Your active orders will appear here. Completed orders can be found in Order History."
                : "Your completed orders will appear here."
            }
          />
        ))}
      {!loading && !error && nextPage !== null && (
        <div className="order-more">
          <button
            className="secondary"
            onClick={() => {
              setLoading(true);
              setPage(nextPage);
            }}
          >
            Load more orders
          </button>
        </div>
      )}
    </>
  );
}

function OrderSummary({
  reference,
  userId,
  retry,
  onStatus,
}: {
  reference: string;
  userId: string;
  retry: () => void;
  onStatus: (status: string) => void;
}) {
  const { order, error, connection, mapboxToken, delivery } = useTrackedOrder(
    reference,
    userId,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (order) {
      onStatus(order.status);
      if (!focused.current) {
        heading.current?.focus();
        focused.current = true;
      }
    }
  }, [order?.status, onStatus]);
  if (error && !order) return <OrderError error={error} retry={retry} />;
  if (!order)
    return (
      <p role="status" className="order-loading">
        Loading your order…
      </p>
    );
  const isActive = orderGroup(order.status) === "active";
  const totals = orderTotals(order);
  const paid = ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(
    order.paymentStatus,
  );
  const paymentLabel = paid
    ? "Paid"
    : order.paymentStatus === "AUTHORIZED"
      ? "Authorised"
      : "Order amount";
  return (
    <article className="order-summary">
      <header className="order-summary-header">
        <div>
          <h3 ref={heading} tabIndex={-1}>
            {order.store}
          </h3>
          <p>{orderDate(order.createdAt)}</p>
        </div>
        <Status order={order} />
      </header>
      {isActive && delivery && (
        <OrderTracking
          order={order}
          delivery={delivery}
          connection={connection}
          mapboxToken={mapboxToken}
        />
      )}
      {error && (
        <p role="status" className="order-error">
          We couldn’t refresh your order. Showing the last known details.
        </p>
      )}
      <details className="order-receipt" open={!isActive}>
        <summary hidden={!isActive}>Order details and payment</summary>
        <div className="order-summary-grid">
          <div>
            <section className="order-summary-section">
              <h3>Order details</h3>
              <ul className="order-items">
                {order.items.map((item, index) => {
                  const unavailable =
                    item.unavailable && !hasReturn(order.returnStatus);
                  return (
                    <li
                      key={index}
                      className="order-item"
                      data-unavailable={unavailable || undefined}
                    >
                      <Thumbnail src={item.image} />
                      <div className="order-item-copy">
                        <h4>{item.name}</h4>
                        {unavailable && <p>Unavailable — refunded</p>}
                        {item.options.length > 0 && (
                          <p>
                            {item.options
                              .map(
                                (option) => `${option.name}: ${option.value}`,
                              )
                              .join(" · ")}
                          </p>
                        )}
                        <p>Qty: {item.quantity}</p>
                      </div>
                      <span>
                        {orderMoney(item.price)}
                        <small>each</small>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="order-summary-section">
              <h3>Delivery address</h3>
              <p>{order.address || "Address unavailable"}</p>
              {order.instructions && (
                <p className="order-instructions">{order.instructions}</p>
              )}
            </section>
          </div>
          <section className="order-summary-section order-payment">
            <h3>Summary</h3>
            <dl>
              <div>
                <dt>Subtotal</dt>
                <dd>{orderMoney(order.subtotal)}</dd>
              </div>
              <div>
                <dt>Delivery Fee</dt>
                <dd>{orderMoney(order.deliveryFee)}</dd>
              </div>
              {order.packagingFee > 0 && (
                <div>
                  <dt>Packaging Fee</dt>
                  <dd>{orderMoney(order.packagingFee)}</dd>
                </div>
              )}
              {order.discount > 0 && (
                <div>
                  <dt>Discount</dt>
                  <dd>−{orderMoney(order.discount)}</dd>
                </div>
              )}
              <div className="order-total">
                <dt>Total (incl. VAT)</dt>
                <dd>{orderMoney(totals.current)}</dd>
              </div>
              <div>
                <dt>
                  {paymentLabel}
                  {paid &&
                  order.paymentMethod &&
                  !["others", "unknown"].includes(
                    order.paymentMethod.toLowerCase(),
                  )
                    ? ` with ${order.paymentMethod}`
                    : ""}
                </dt>
                <dd>{orderMoney(order.total)}</dd>
              </div>
              {order.refunded > 0 && (
                <>
                  <div>
                    <dt>Refunded</dt>
                    <dd>−{orderMoney(order.refunded)}</dd>
                  </div>
                  <div className="order-total">
                    <dt>Net paid</dt>
                    <dd>{orderMoney(totals.netPaid)}</dd>
                  </div>
                </>
              )}
            </dl>
            {totals.deliveryKept && (
              <p>
                Includes delivery {orderMoney(order.deliveryFee)}, which is not
                refunded.
              </p>
            )}
            <p>Returns and refunds are handled by {order.store}.</p>
            {order.returnsPolicy && (
              <a
                className="text-link"
                href={order.returnsPolicy}
                target="_blank"
                rel="noopener noreferrer"
              >
                View returns policy
              </a>
            )}
          </section>
        </div>
      </details>
    </article>
  );
}
