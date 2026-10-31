import {
  ApiError,
  UUID_PATTERN,
  record,
  requiredString,
  optionalString,
} from "./api-values.ts";
import type { SavedAddress, FavouriteTarget } from "../contracts.ts";
export function addressesFrom(value: unknown): SavedAddress[] {
  if (!Array.isArray(value))
    throw new ApiError(502, "STREET returned unexpected addresses.");
  return value.map((value) => {
    const a = record(value);
    const lat =
      !["number", "string"].includes(typeof a.latitude) ||
      String(a.latitude).trim() === ""
        ? NaN
        : Number(a.latitude);
    const lon =
      !["number", "string"].includes(typeof a.longitude) ||
      String(a.longitude).trim() === ""
        ? NaN
        : Number(a.longitude);
    return {
      id: requiredString(a.id),
      label: requiredString(a.label),
      line1: requiredString(a.line1),
      line2: optionalString(a.line2),
      city: requiredString(a.city),
      postcode: requiredString(a.postcode),
      isDefault: a.isDefault === true,
      coordinates:
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180 &&
        !(lat === 0 && lon === 0)
          ? { latitude: lat, longitude: lon }
          : null,
    };
  });
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value))
    throw new ApiError(400, "Invalid item identifier.");
  return value;
}
export function favouriteTarget(
  body: Record<string, unknown>,
): FavouriteTarget {
  const vendorId = uuid(body.vendorId);
  if (body.kind === "product")
    return { kind: "product", vendorId, productId: uuid(body.productId) };
  if (body.kind === "shop")
    return { kind: "shop", vendorId, outletId: uuid(body.outletId) };
  throw new ApiError(400, "Choose a product or shop location.");
}
