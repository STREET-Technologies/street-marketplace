import { createAsyncCache } from "../async-cache.ts";
import { readAccountData } from "./session.ts";
import { canPrefetch } from "./prefetch.ts";

export const catalogueCache = createAsyncCache<unknown>();
export const catalogueInvalidated = "street:catalogue-invalidated";
let catalogueOwner: string | null | undefined;
export function setCatalogueOwner(owner: string | null) {
  // The initial load has only public browsing data. Later identity changes must
  // discard any address-scoped results, including changes detected on focus.
  if (catalogueOwner !== undefined && catalogueOwner !== owner)
    invalidateCatalogue();
  catalogueOwner = owner;
}
export function invalidateCatalogue() {
  catalogueCache.clear();
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(catalogueInvalidated));
}
if (typeof window !== "undefined") {
  window.addEventListener("street:session-changed", invalidateCatalogue);
  window.addEventListener("street:addresses-changed", invalidateCatalogue);
}
export function productUrl(params: Record<string, string>) {
  return `/api/catalogue/browse?${new URLSearchParams({
    kind: "product",
    vendorId: params.vendorId || "",
    productId: params.productId || "",
    locationGid: params.locationGid || "",
  })}`;
}
export function readCatalogue<T>(url: string, force = false): Promise<T> {
  const parsed = new URL(url, "https://marketplace.invalid");
  // Product snapshots have a deliberately short lifetime. The bag and checkout
  // continue to validate against the backend independently of this browsing cache.
  const age = parsed.searchParams.get("kind") === "product" ? 10_000 : 30_000;
  return catalogueCache.read(
    url,
    async () => {
      if (parsed.searchParams.has("addressId"))
        return readAccountData(
          parsed.pathname as "/api/catalogue/vendors" | "/api/catalogue/browse",
          parsed.searchParams,
        );
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json().catch(() => {
        throw new Error(
          "STREET could not load this collection. Please try again.",
        );
      });
      if (!response.ok)
        throw new Error(data.error || "STREET could not load this collection.");
      return data;
    },
    force ? 0 : age,
  ) as Promise<T>;
}
export function prefetchProduct(params: Record<string, string>) {
  if (!canPrefetch()) return;
  void readCatalogue(productUrl(params)).catch(() => {
    /* Opening the product provides retry UI. */
  });
}
