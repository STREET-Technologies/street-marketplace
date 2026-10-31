import { variantOptionLabels } from "../product-options.ts";
import type {
  CartIntent,
  CartReview,
  ProductDetail,
  ProductPage,
} from "../contracts.ts";
import type { StreetApi } from "./street-api.ts";
import { ApiError, record } from "./api-values.ts";
import { uuid } from "./customer-data.ts";
import { CART_MAX_LINES, CART_MAX_QUANTITY, cartLineKey } from "../cart.ts";
export function cartIntentFrom(value: unknown): CartIntent {
  const body = record(value);
  if (
    Object.keys(body).some(
      (k) => !["vendorId", "outletId", "addressId", "lines"].includes(k),
    ) ||
    !Array.isArray(body.lines) ||
    !body.lines.length ||
    body.lines.length > CART_MAX_LINES
  )
    throw new ApiError(400, "Invalid bag.");
  const seen = new Set<string>();
  const lines = body.lines.map((value) => {
    const l = record(value);
    const productId = uuid(l.productId);
    if (
      Object.keys(l).some(
        (k) => !["productId", "variantId", "quantity"].includes(k),
      ) ||
      typeof l.variantId !== "string" ||
      !/^\d{1,30}$/.test(l.variantId) ||
      !Number.isSafeInteger(l.quantity) ||
      Number(l.quantity) < 1 ||
      Number(l.quantity) > CART_MAX_QUANTITY
    )
      throw new ApiError(400, "Invalid bag quantity or variant.");
    const line = {
      productId,
      variantId: l.variantId,
      quantity: Number(l.quantity),
    };
    if (seen.has(cartLineKey(line)))
      throw new ApiError(400, "Duplicate bag variant.");
    seen.add(cartLineKey(line));
    return line;
  });
  return {
    vendorId: uuid(body.vendorId),
    outletId: uuid(body.outletId),
    addressId: uuid(body.addressId),
    lines,
  };
}
export async function checkCart(
  intent: CartIntent,
  token: string,
  api: StreetApi,
): Promise<CartReview> {
  const [user, addresses] = await Promise.all([
    api.me(token),
    api.addresses(token),
  ]);
  const address = addresses.find((a) => a.id === intent.addressId);
  if (!address)
    throw new ApiError(
      404,
      "This address is no longer available. Choose another address.",
    );
  if (!address.coordinates)
    throw new ApiError(
      400,
      "Update this address in the app before using it for delivery.",
    );
  const { outlet, delivery } = await api.outletForAddress(
    intent.vendorId,
    intent.outletId,
    address.coordinates,
  );
  const base: CartReview = {
    userId: user.id,
    addressId: address.id,
    checkedAt: new Date().toISOString(),
    delivery,
    subtotal: null,
    deliveryFee: null,
    total: null,
    lines: intent.lines.map((l) => ({
      ...l,
      title: null,
      variantTitle: null,
      image: null,
      unitPrice: null,
      inventory: null,
      issue: "unknown",
    })),
  };
  if (!outlet?.locationGid || delivery.status !== "available") return base;
  try {
    base.deliveryFee = await api.deliveryFee(
      token,
      address.id,
      intent.vendorId,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    // Keep stock review useful, but never imply delivery is free after a failed quote.
  }
  // Detail alone does not enforce ownership/Street eligibility. Establish list membership first.
  const wanted = new Set(intent.lines.map((l) => l.productId)),
    found = new Set<string>();
  let complete = false;
  for (let page = 1; page <= 20; page++) {
    const products = (await api.catalogue({
      kind: "products",
      vendorId: intent.vendorId,
      locationGid: outlet.locationGid,
      page,
    })) as ProductPage;
    for (const product of products.products)
      if (product.id && wanted.has(product.id)) found.add(product.id);
    if (page >= products.totalPages) {
      complete = true;
      break;
    }
    if (found.size === wanted.size) break;
  }
  const details = new Map<string, ProductDetail | null>();
  const ids = [...found];
  for (let i = 0; i < ids.length; i += 4)
    await Promise.all(
      ids.slice(i, i + 4).map(async (productId) => {
        try {
          const detail = (await api.catalogue({
            kind: "product",
            vendorId: intent.vendorId,
            locationGid: outlet.locationGid!,
            productId,
            page: 1,
          })) as ProductDetail;
          if (detail.id !== productId)
            throw new ApiError(502, "STREET returned an unexpected product.");
          details.set(productId, detail);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404)
            details.set(productId, null);
          else throw error;
        }
      }),
    );
  base.lines = base.lines.map((line) => {
    if (!found.has(line.productId))
      return { ...line, issue: complete ? "unavailable" : "unknown" };
    const product = details.get(line.productId),
      variant = product?.variants.find((v) => v.id === line.variantId);
    if (!product || !variant) return { ...line, issue: "unavailable" };
    return {
      ...line,
      title: product.title,
      variantTitle: variant.title,
      optionLabels: variantOptionLabels(product, variant.id),
      image: product.images[0] ?? null,
      unitPrice: variant.price,
      inventory: variant.inventory,
      issue:
        variant.price === null || variant.inventory === null
          ? "unknown"
          : variant.inventory < line.quantity
            ? "stock"
            : null,
    };
  });
  if (base.lines.every((l) => l.issue === null)) {
    const cents = base.lines.reduce(
      (total, l) => total + Math.round(l.unitPrice! * 100) * l.quantity,
      0,
    );
    if (Number.isSafeInteger(cents)) {
      base.subtotal = cents / 100;
      if (base.deliveryFee !== null) {
        const totalCents = cents + Math.round(base.deliveryFee * 100);
        if (Number.isSafeInteger(totalCents)) base.total = totalCents / 100;
      }
    }
  }
  return base;
}
