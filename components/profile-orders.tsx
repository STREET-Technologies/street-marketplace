"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CustomerEmptyState, CustomerLoading } from "./customer-page";
import CustomerTabs from "./customer-tabs";
import NavigationIcon from "./navigation-icon";
import OrderTracking from "./order-tracking";
import { useTrackedOrder } from "../lib/client/use-tracked-order";
import { orderGroup } from "../lib/orders";
import { readAccountData, SessionError } from "../lib/client/session";
import {
  hasReturn,
  type OrderCounts,
  returnStatusLabel,
  paymentMethodLabel,
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

export default function ProfileOrders({
  userId,
  resetRequest = 0,
}: {
  userId: string;
  resetRequest?: number;
}) {
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [group, setGroup] = useState<OrderGroup>("active");
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const [counts, setCounts] = useState<OrderCounts | null>(null);
  const [countRevision, setCountRevision] = useState(0);
  const updateCounts = useCallback(
    () => setCountRevision((value) => value + 1),
    [],
  );
  const [countFailed, setCountFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setCounts(null);
    setCountFailed(false);
    readAccountData<OrderCounts>(
      "/api/orders",
      new URLSearchParams({ counts: "true" }),
    )
      .then((value) => {
        if (alive) setCounts(value);
      })
      .catch(() => {
        if (alive) setCountFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [userId, revision, selectedStatus, countRevision]);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    setSelected(null);
    setSelectedStatus(null);
  }, [resetRequest]);
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
      {!selected && (
        <p className="order-count" role="status">
          {counts
            ? `${counts[group]} ${group === "active" ? (counts[group] === 1 ? "active order" : "active orders") : group === "returns" ? (counts[group] === 1 ? "order with returns" : "orders with returns") : counts[group] === 1 ? "order" : "orders"}`
            : countFailed
              ? "Order count unavailable"
              : <>
                  <span className="sr-only">Counting orders…</span>
                  <span className="skeleton-block skeleton-line skeleton-line--short" aria-hidden="true" />
                </>}
        </p>
      )}
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
            { key: "active", label: "Active orders" },
            { key: "past", label: "Order history" },
            { key: "returns", label: "Returns" },
          ].map((view) => ({
            ...view,
            content: group === view.key && (
              <OrderFeed
                key={`${view.key}:${revision}`}
                group={group}
                userId={userId}
                onUpdated={updateCounts}
                open={(order) => {
                  setSelectedStatus(order.status);
                  setSelected(order.reference);
                }}
              />
            ),
          }))}
        />
      </div>
    </section>
  );
}

function OrderFeed({
  group,
  userId,
  onUpdated,
  open,
}: {
  group: OrderGroup;
  userId: string;
  onUpdated: () => void;
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
                        onUpdated();
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
  }, [orders, group, userId, onUpdated]);
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
        <CustomerLoading label="Loading your orders…" rows={orders.length ? 1 : 3} />
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
            No{" "}
            {group === "returns"
              ? "returns"
              : `${group === "active" ? "active" : "past"} orders`}{" "}
            in these results. Load more to look further back.
          </p>
        ) : (
          <CustomerEmptyState
            icon={group === "returns" ? "returns" : "history"}
            title={
              group === "returns"
                ? "No returns"
                : group === "active"
                  ? "No active orders"
                  : "No past orders"
            }
            message={
              group === "returns"
                ? "You haven't returned any items yet. Returns processed by the retailer will appear here."
                : group === "active"
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
      <CustomerLoading label="Loading your order…" />
    );
  const isActive = orderGroup(order.status) === "active";
  const totals = orderTotals(order);
  const paid = ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(
    order.paymentStatus,
  );
  const paymentMethod = paymentMethodLabel(order.paymentMethod);
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
            Order #{order.reference}
          </h3>
          <p className="order-summary-meta">
            <span>{order.store}</span>
            <Status order={order} />
            <span>{orderDate(order.createdAt)}</span>
          </p>
        </div>
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
        <div className="order-delivery-details">
          <section>
            <h3>
              {["DELIVERED", "COMPLETED"].includes(order.status)
                ? "Delivered to"
                : "Delivery address"}
            </h3>
            <p>{order.address || "Address unavailable"}</p>
          </section>
          <section>
            <h3>Delivery note</h3>
            <p className="order-instructions">
              {order.instructions || "No delivery instructions"}
            </p>
          </section>
        </div>
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
                  {paid && paymentMethod ? ` with ${paymentMethod}` : ""}
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
        {!!order.returns?.length && (
          <section className="order-returns" aria-label="Returns">
            <h3>Return details</h3>
            {order.returns.map((returned, index) => (
              <div className="order-return" key={index}>
                <strong>{returnStatusLabel(returned.status)}</strong>
                {returned.createdAt && (
                  <p>Opened {orderDate(returned.createdAt)}</p>
                )}
                {returned.quantity > 0 && (
                  <p>
                    {returned.quantity}{" "}
                    {returned.quantity === 1 ? "item" : "items"} in this return
                  </p>
                )}
                {returned.reasons.length > 0 && (
                  <p>Reason: {returned.reasons.join(", ")}</p>
                )}
                {returned.refunded > 0 && (
                  <p>
                    Refunded: <strong>{orderMoney(returned.refunded)}</strong>
                  </p>
                )}
                {returned.note && (
                  <p className="order-instructions">{returned.note}</p>
                )}
              </div>
            ))}
          </section>
        )}
      </details>
    </article>
  );
}
