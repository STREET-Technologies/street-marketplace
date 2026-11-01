"use client";
import { useEffect, useRef, useState } from "react";
import { cartIntent } from "../lib/cart";
import type { CartDraft } from "../lib/contracts";
import {
  CheckoutConflict,
  CheckoutNotStarted,
  checkoutVisibility,
  checkoutAddressIssue,
  checkoutStorageKey,
  restoreCheckout,
  safeCheckoutUrl,
  type CheckoutResult,
  type SavedCheckout,
} from "../lib/checkout";
import { requestCheckout } from "../lib/client/checkout";
export default function Checkout({
  owner,
  cart,
  addressId,
  eligible,
  enabled,
  complete,
}: {
  owner: string;
  cart: CartDraft | null;
  addressId?: string;
  eligible: boolean;
  enabled: boolean;
  complete: (saved: SavedCheckout) => void;
}) {
  const [saved, setSaved] = useState<SavedCheckout | null>(null);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const latest = useRef({ owner, complete, addressId });
  latest.current = { owner, complete, addressId };
  const running = useRef(false);
  const terminalResult = useRef(false);
  useEffect(() => {
    setSaved(null);
    setResult(null);
    setError("");
    setLoaded(false);
    terminalResult.current = false;
    if (!owner || !enabled) return;
    const load = () => {
      try {
        setSaved(
          restoreCheckout(
            localStorage.getItem(checkoutStorageKey(owner)),
            owner,
          ),
        );
        setLoaded(true);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    load();
    const onStorage = (e: StorageEvent) => {
      if (e.key === checkoutStorageKey(owner) || e.key === null) {
        setResult(null);
        load();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [owner, enabled]);
  async function accept(data: CheckoutResult, attempt: SavedCheckout) {
    if (latest.current.owner !== owner) return;
    const current = restoreCheckout(
      localStorage.getItem(checkoutStorageKey(owner)),
      owner,
    );
    if (current?.attemptKey !== attempt.attemptKey) return;
    const handled = current.completionHandled;
    const updated = {
      ...current,
      id: data.id,
      completionHandled: handled || data.status === "completed",
    };
    terminalResult.current = ["completed", "failed", "cancelled"].includes(
      data.status,
    );
    localStorage.setItem(checkoutStorageKey(owner), JSON.stringify(updated));
    setSaved(updated);
    setResult(data);
    setError("");
    if (data.status === "completed" && !handled)
      latest.current.complete(updated);
  }
  async function check(attempt: SavedCheckout) {
    if (!attempt.id || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const current = restoreCheckout(
        localStorage.getItem(checkoutStorageKey(owner)),
        owner,
      );
      if (current?.attemptKey !== attempt.attemptKey) return;
      await accept(await requestCheckout(owner, current), current);
    } catch (e) {
      if (latest.current.owner === owner) setError((e as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!saved?.id || saved.owner !== owner) return;
    void check(saved);
    const onReturn = () => {
      if (!terminalResult.current && document.visibilityState === "visible")
        void check(saved);
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    // Poll reads only. Never create or redirect on mount/return.
    const timer = setInterval(onReturn, 15000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
    // Re-read only when the durable identity/account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.id, owner]);
  async function startOrResume() {
    if (running.current || !loaded) return;
    if (!navigator.locks) {
      setError(
        "This browser cannot safely start checkout. Use a browser that supports Web Locks.",
      );
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await navigator.locks.request(checkoutStorageKey(owner), async () => {
        if (latest.current.owner !== owner) return;
        let attempt = restoreCheckout(
          localStorage.getItem(checkoutStorageKey(owner)),
          owner,
        );
        if (!attempt) {
          if (!cart || !addressId || !eligible)
            throw new Error(
              "Check your bag and delivery address before checking out.",
            );
          attempt = {
            owner,
            attemptKey: crypto.randomUUID(),
            intent: cartIntent(cart, addressId),
            snapshot: cart,
          };
          // Persist BEFORE the first network mutation; failure here must prevent initiation.
          localStorage.setItem(
            checkoutStorageKey(owner),
            JSON.stringify(attempt),
          );
        }
        const addressIssue = checkoutAddressIssue(
          attempt,
          latest.current.addressId,
        );
        if (addressIssue) {
          setError(addressIssue);
          return;
        }
        setSaved(attempt);
        let data: CheckoutResult;
        try {
          data = await requestCheckout(owner, attempt, !attempt.id);
        } catch (error) {
          if (error instanceof CheckoutNotStarted && !attempt.id) {
            attempt = { ...attempt, notStarted: true };
            localStorage.setItem(
              checkoutStorageKey(owner),
              JSON.stringify(attempt),
            );
            setSaved(attempt);
            setError(error.message);
            return;
          }
          if (!(error instanceof CheckoutConflict)) throw error;
          attempt = {
            ...attempt,
            id: error.attemptId,
            recovered: true,
            completionHandled: true,
          };
          localStorage.setItem(
            checkoutStorageKey(owner),
            JSON.stringify(attempt),
          );
          setSaved(attempt);
          data = await requestCheckout(owner, attempt);
        }
        await accept(data, attempt);
        if (
          latest.current.owner === owner &&
          data.status === "ready" &&
          !checkoutAddressIssue(attempt, latest.current.addressId) &&
          data.checkoutUrl
        )
          window.location.assign(safeCheckoutUrl(data.checkoutUrl)!);
      });
    } catch (e) {
      if (latest.current.owner === owner)
        setError(
          `${(e as Error).message} Your bag is kept. Resume this checkout to check the existing attempt.`,
        );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  function finish() {
    if (
      !saved ||
      (!saved.notStarted &&
        !["completed", "failed", "cancelled"].includes(result?.status ?? ""))
    )
      return;
    void navigator.locks?.request(checkoutStorageKey(owner), () => {
      const current = restoreCheckout(
        localStorage.getItem(checkoutStorageKey(owner)),
        owner,
      );
      if (current?.attemptKey !== saved.attemptKey) return;
      localStorage.removeItem(checkoutStorageKey(owner));
      setSaved(null);
      setResult(null);
      setError("");
      terminalResult.current = false;
    });
  }
  const active = saved?.owner === owner ? saved : null;
  const visibility = checkoutVisibility(cart, !!active);
  const addressIssue = active ? checkoutAddressIssue(active, addressId) : null;
  // An empty bag only needs controls when a previously submitted checkout exists.
  // Keep storage errors visible so an unreadable attempt is not silently hidden.
  if (visibility === "hidden" && !error) return null;
  if (!enabled)
    return (
      <button className="primary wide" disabled>
        Checkout coming later
      </button>
    );
  const status = result?.userId === owner ? result.status : undefined;
  const terminal =
    active?.notStarted ||
    (status && ["completed", "failed", "cancelled"].includes(status));
  return (
    <div className="checkout-actions">
      {active?.notStarted && (
        <p role="status">
          Checkout was not started. Review your bag, address and contact details
          before trying again.
        </p>
      )}
      {status === "completed" && (
        <p role="status">
          Your order was placed. View its latest status in the STREET app.
        </p>
      )}
      {status === "ready" && !addressIssue && (
        <p role="status">
          Your checkout is ready. Select Resume checkout to open Shopify and
          complete your order.
        </p>
      )}
      {status === "uncertain" && (
        <p role="status">
          Shopify checkout could not be opened yet. Your bag and pending
          checkout are saved. Select Resume checkout to try opening it again;
          this won’t create another order.
        </p>
      )}
      {status === "preparing" && (
        <p role="status">
          Preparing your checkout. Check its status in a moment.
        </p>
      )}
      {(status === "failed" || status === "cancelled") && (
        <p role="status">
          This checkout{" "}
          {status === "failed" ? "could not be prepared" : "was cancelled"}.
          Your bag has been kept.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {terminal ? (
        <button className="secondary wide" onClick={finish}>
          Done
        </button>
      ) : (
        <>
          <button
            className="primary wide"
            disabled={
              !loaded ||
              busy ||
              !!addressIssue ||
              (!active && (!eligible || visibility !== "start"))
            }
            onClick={startOrResume}
          >
            {busy
              ? "Checking checkout…"
              : active
                ? "Resume checkout"
                : "Checkout"}
          </button>
          {addressIssue && <p role="status">{addressIssue}</p>}
          {active?.id && (
            <button
              className="text-link cart-recheck"
              disabled={busy}
              onClick={() => check(active)}
            >
              Check order status
            </button>
          )}
          {active && (
            <p>
              Resuming uses the items and delivery address submitted with this
              checkout. Your current bag is kept until the order is confirmed.
            </p>
          )}
          {!active && visibility === "pilot-only" && (
            <p role="status">
              Test checkout is currently available only for Gymshark · Regent
              Street. Your bag is saved, but checkout isn’t enabled for this
              shop yet.
            </p>
          )}
          {!active && visibility === "start" && (
            <p>Final shipping and discounts are confirmed at checkout.</p>
          )}
        </>
      )}
    </div>
  );
}
