import type { CheckoutResult, SavedCheckout } from "../checkout.ts";
import {
  CheckoutConflict,
  CheckoutNotStarted,
  safeCheckoutUrl,
} from "../checkout.ts";
// A checkout mutation is never automatically retried, including after auth refresh.
export async function requestCheckout(
  owner: string,
  saved: SavedCheckout,
  start = false,
): Promise<CheckoutResult> {
  const response = await fetch(
    start
      ? "/api/checkout/attempts"
      : `/api/checkout/attempts?${new URLSearchParams({ id: saved.id!, expectedUserId: owner })}`,
    {
      method: start ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: start ? { "Content-Type": "application/json" } : undefined,
      body: start
        ? JSON.stringify({
            ...saved.intent,
            attemptKey: saved.attemptKey,
            expectedUserId: owner,
          })
        : undefined,
      signal: AbortSignal.timeout(25000),
    },
  );
  const data = await response.json();
  if (response.status === 400 && data.code === "CHECKOUT_NOT_STARTED")
    throw new CheckoutNotStarted();
  if (
    response.status === 409 &&
    typeof data.attemptId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      data.attemptId,
    )
  )
    throw new CheckoutConflict(data.attemptId);
  if (!response.ok)
    throw new Error(
      data.error ||
        "Checkout could not be confirmed. Check its status before trying again.",
    );
  if (data.userId !== owner || (saved.id && data.id !== saved.id))
    throw new Error("Your account or checkout changed. Reload your bag.");
  if (data.checkoutUrl) safeCheckoutUrl(data.checkoutUrl);
  return data;
}
