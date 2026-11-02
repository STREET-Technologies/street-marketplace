"use client";
import { useEffect, useRef, useState } from "react";
import type { OrderDetail } from "../orders";
import { orderGroup } from "../orders";
import {
  liveDelivery,
  needsOrderRefresh,
  type TrackingBlob,
  type TrackingConnection,
} from "../tracking";
import { readAccountData, SessionError } from "./session";
export function useTrackedOrder(reference: string, userId: string) {
  const [order, setOrder] = useState<OrderDetail | null>(null),
    [error, setError] = useState<Error | null>(null);
  const [connection, setConnection] =
    useState<TrackingConnection>("connecting");
  const [blob, setBlob] = useState<TrackingBlob | null>(null),
    [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const current = useRef<OrderDetail | null>(null);
  useEffect(() => {
    let alive = true,
      busy = false,
      stop: (() => void) | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    let mode: TrackingConnection = "connecting",
      failures = 0,
      pinAttempts = 0,
      lastHint = "",
      lastRefresh = 0;
    const schedule = () => {
      clearTimeout(timer);
      if (
        alive &&
        current.current &&
        orderGroup(current.current.status) === "active"
      )
        timer = setTimeout(
          () => {
            if (document.visibilityState === "visible" && mode !== "live")
              void load();
            else schedule();
          },
          Math.min(120000, 30000 * 2 ** failures),
        );
    };
    async function load() {
      if (!alive || busy) return;
      busy = true;
      lastRefresh = Date.now();
      try {
        const next = await readAccountData<OrderDetail>(
          "/api/orders",
          new URLSearchParams({ reference }),
        );
        if (!alive) return;
        current.current = next;
        setOrder(next);
        setError(null);
        failures = 0;
        if (orderGroup(next.status) === "past") {
          stop?.();
          stop = undefined;
          setBlob(null);
          setConnection("live");
        } else if (!stop && next.trackingId) {
          const { subscribeTracking } = await import("./firebase-tracking");
          if (!alive) return;
          stop = subscribeTracking(userId, next.trackingId, (update) => {
            if (!alive) return;
            mode = update.connection;
            setConnection(mode);
            setMapboxToken(update.mapboxToken);
            setBlob(update.blob);
            if (mode === "signed-out") {
              alive = false;
              current.current = null;
              setOrder(null);
              setError(new SessionError(401, "Please sign in again."));
              clearTimeout(timer);
              return;
            }
            const hint = JSON.stringify([
              update.blob?.status,
              update.blob?.statusUpdatedAt,
              update.blob?.topic,
            ]);
            const needsPin =
              !!current.current &&
              !current.current.tracking.pin &&
              !!(
                current.current.tracking.jobId ||
                update.blob?.courier ||
                update.blob?.topic?.startsWith("courier_") ||
                update.blob?.topic?.startsWith("package_")
              ) &&
              pinAttempts < 3;
            if (
              update.blob &&
              current.current &&
              hint !== lastHint &&
              (needsOrderRefresh(current.current, update.blob) || needsPin)
            ) {
              lastHint = hint;
              if (needsPin) pinAttempts++;
              clearTimeout(hintTimer);
              hintTimer = setTimeout(
                () => void load(),
                Math.max(250, 2000 - (Date.now() - lastRefresh)),
              );
            }
          });
        }
      } catch (cause) {
        if (alive) {
          const err =
            cause instanceof Error
              ? cause
              : new Error("Unable to update tracking.");
          setError(err);
          failures++;
          if (
            err instanceof SessionError &&
            [401, 403, 404].includes(err.status)
          ) {
            stop?.();
            stop = undefined;
            current.current = null;
            setOrder(null);
            alive = false;
          }
        }
      } finally {
        busy = false;
        schedule();
      }
    }
    const resume = () => {
      if (document.visibilityState === "visible") void load();
    };
    current.current = null;
    setOrder(null);
    setBlob(null);
    setError(null);
    void load();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(hintTimer);
      stop?.();
      current.current = null;
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [reference, userId]);
  return {
    order,
    error,
    connection,
    mapboxToken,
    delivery: order ? liveDelivery(order.tracking, blob) : null,
  };
}
