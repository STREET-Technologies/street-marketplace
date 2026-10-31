import type { CartDraft, CartLine, CartIntent } from "./contracts.ts";
import { UUID_PATTERN } from "./server/api-values.ts";
// Request/storage bounds, not business stock or allocation limits.
export const CART_MAX_LINES = 12;
export const CART_MAX_QUANTITY = 99;
export const cartLineKey = (line: Pick<CartLine, "productId" | "variantId">) =>
  `${line.productId}:${line.variantId}`;
export const cartStorageKey = (userId: string) =>
  `street:staging:cart:v1:${userId}`;
export function cartIntent(cart: CartDraft, addressId: string): CartIntent {
  return {
    vendorId: cart.vendorId,
    outletId: cart.outletId,
    addressId,
    lines: cart.lines.map(({ productId, variantId, quantity }) => ({
      productId,
      variantId,
      quantity,
    })),
  };
}
export function addCartLine(
  cart: CartDraft | null,
  outlet: Omit<CartDraft, "lines">,
  line: CartLine,
  inventory: number,
  replace = false,
): { cart: CartDraft; conflict: boolean } {
  if (!Number.isSafeInteger(inventory) || inventory < 1)
    throw new Error("This variant is not currently available.");
  if (
    cart &&
    cart.lines.length &&
    (cart.vendorId !== outlet.vendorId || cart.outletId !== outlet.outletId) &&
    !replace
  )
    return { cart, conflict: true };
  const base = replace || !cart ? { ...outlet, lines: [] } : cart;
  const existing = base.lines.find((l) => cartLineKey(l) === cartLineKey(line));
  const quantity = (existing?.quantity ?? 0) + 1;
  if (quantity > inventory)
    throw new Error(
      "Your bag already contains the available quantity of this variant.",
    );
  if (quantity > CART_MAX_QUANTITY)
    throw new Error(
      "The maximum quantity for this staging bag has been reached.",
    );
  if (!existing && base.lines.length >= CART_MAX_LINES)
    throw new Error(
      `This staging bag supports up to ${CART_MAX_LINES} different variants.`,
    );
  return {
    cart: {
      ...base,
      lines: existing
        ? base.lines.map((l) =>
            cartLineKey(l) === cartLineKey(line) ? { ...line, quantity } : l,
          )
        : [...base.lines, { ...line, quantity }],
    },
    conflict: false,
  };
}
export function restoreCart(raw: string | null): CartDraft | null {
  if (!raw || raw.length > 30000) return null;
  try {
    const c = JSON.parse(raw);
    const label = (x: unknown) => typeof x === "string" && x.length <= 300;
    if (
      !UUID_PATTERN.test(c.vendorId) ||
      !UUID_PATTERN.test(c.outletId) ||
      !label(c.shopName) ||
      !label(c.branch) ||
      !Array.isArray(c.lines) ||
      c.lines.length > CART_MAX_LINES
    )
      return null;
    const seen = new Set<string>();
    for (const l of c.lines) {
      if (
        !UUID_PATTERN.test(l.productId) ||
        typeof l.variantId !== "string" ||
        !/^\d{1,30}$/.test(l.variantId) ||
        !Number.isSafeInteger(l.quantity) ||
        l.quantity < 1 ||
        l.quantity > CART_MAX_QUANTITY ||
        !label(l.title) ||
        !label(l.variantTitle) ||
        typeof l.unitPrice !== "number" ||
        !Number.isFinite(l.unitPrice) ||
        l.unitPrice < 0 ||
        (l.image !== null &&
          (typeof l.image !== "string" || !l.image.startsWith("https://")))
      )
        return null;
      if (seen.has(cartLineKey(l))) return null;
      seen.add(cartLineKey(l));
    }
    return {
      vendorId: c.vendorId,
      outletId: c.outletId,
      shopName: c.shopName,
      branch: c.branch,
      lines: c.lines.map((l: CartLine) => ({
        productId: l.productId,
        variantId: l.variantId,
        quantity: l.quantity,
        title: l.title,
        variantTitle: l.variantTitle,
        ...(Array.isArray(l.optionLabels) && l.optionLabels.length <= 10 && l.optionLabels.every((option) => option && label(option.name) && label(option.value))
          ? { optionLabels: l.optionLabels.map(({ name, value }) => ({ name, value })) }
          : {}),
        image: l.image,
        unitPrice: l.unitPrice,
      })),
    };
  } catch {
    return null;
  }
}
