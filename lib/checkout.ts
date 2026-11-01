import type { CartDraft, CartIntent } from "./contracts.ts";
import { cartIntent, restoreCart } from "./cart.ts";
import { UUID_PATTERN } from "./server/api-values.ts";
export const CHECKOUT_VENDOR = "e13ad453-943c-4861-891a-feae35a805d4";
export const CHECKOUT_OUTLET = "0eb52280-293f-480e-ad39-ffa76970c1e1";
export function isCheckoutShop(
  cart: Pick<CartDraft, "vendorId" | "outletId"> | null,
) {
  return (
    cart?.vendorId === CHECKOUT_VENDOR && cart.outletId === CHECKOUT_OUTLET
  );
}

export function checkoutVisibility(
  cart: CartDraft | null,
  hasSavedAttempt: boolean,
) {
  if (hasSavedAttempt) return "resume";
  if (!cart?.lines.length) return "hidden";
  return isCheckoutShop(cart) ? "start" : "pilot-only";
}

export type CheckoutStatus =
  | "preparing"
  | "ready"
  | "uncertain"
  | "failed"
  | "completed"
  | "cancelled";
export type CheckoutResult = {
  userId: string;
  id: string;
  status: CheckoutStatus;
  orderId: string | null;
  checkoutUrl?: string;
};
export type SavedCheckout = {
  owner: string;
  attemptKey: string;
  id?: string;
  completionHandled?: boolean;
  recovered?: boolean;
  notStarted?: boolean;
  intent: CartIntent;
  snapshot: CartDraft;
};
export function checkoutAddressIssue(
  saved: SavedCheckout,
  selectedAddressId?: string,
): string | null {
  if (!selectedAddressId)
    return "Select the delivery address used for this checkout before resuming.";
  if (selectedAddressId !== saved.intent.addressId)
    return "This checkout uses a different delivery address. Select its original address to resume; changing the bag’s address does not update an existing Shopify checkout.";
  return null;
}

export const checkoutStorageKey = (owner: string) =>
  `street:staging:checkout:v1:${owner}`;
export function intentFingerprint(intent: CartIntent) {
  return JSON.stringify({
    vendorId: intent.vendorId,
    outletId: intent.outletId,
    addressId: intent.addressId,
    lines: [...intent.lines].sort((a, b) =>
      `${a.productId}:${a.variantId}`.localeCompare(
        `${b.productId}:${b.variantId}`,
      ),
    ),
  });
}
export function sameSubmittedBag(cart: CartDraft | null, saved: SavedCheckout) {
  return (
    !!cart &&
    JSON.stringify(restoreCart(JSON.stringify(cart))) ===
      JSON.stringify(restoreCart(JSON.stringify(saved.snapshot)))
  );
}
export function restoreCheckout(
  raw: string | null,
  owner: string,
): SavedCheckout | null {
  if (raw === null) return null;
  try {
    if (raw.length > 40000) throw new Error();
    const data = JSON.parse(raw);
    const snapshot = restoreCart(JSON.stringify(data.snapshot));
    if (
      data.owner !== owner ||
      !UUID_PATTERN.test(data.attemptKey) ||
      (data.id !== undefined && !UUID_PATTERN.test(data.id)) ||
      !snapshot?.lines.length ||
      !UUID_PATTERN.test(data.intent.addressId) ||
      intentFingerprint(cartIntent(snapshot, data.intent.addressId)) !==
        intentFingerprint(data.intent)
    )
      throw new Error();
    return {
      owner,
      attemptKey: data.attemptKey,
      ...(data.id ? { id: data.id } : {}),
      completionHandled: data.completionHandled === true,
      recovered: data.recovered === true,
      notStarted: data.notStarted === true,
      intent: cartIntent(snapshot, data.intent.addressId),
      snapshot,
    };
  } catch {
    throw new Error(
      "Your saved checkout could not be read. Contact STREET before starting another checkout.",
    );
  }
}
export function safeCheckoutUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 4096)
    throw new Error("Invalid checkout link");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "gymshark-10024.myshopify.com" ||
    url.port ||
    url.username ||
    url.password ||
    !(
      url.pathname.startsWith("/checkouts/") ||
      url.pathname.startsWith("/cart/c/")
    )
  )
    throw new Error("Invalid checkout link");
  return url.href;
}

export class CheckoutConflict extends Error {
  readonly attemptId: string;
  constructor(attemptId: string) {
    super("Resume your existing checkout before starting another.");
    this.attemptId = attemptId;
  }
}

export class CheckoutNotStarted extends Error {
  constructor() {
    super(
      "Checkout was not started. Review your bag, address and contact details before trying again.",
    );
  }
}
