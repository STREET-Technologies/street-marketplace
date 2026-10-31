import {
  ApiError,
  UUID_PATTERN,
  record,
  requiredString as required,
  optionalString as text,
  imageUrl as image,
} from "./api-values.ts";
import type { ProductCard, ProductDetail, ProductPage } from "../contracts.ts";

export type CatalogueQuery = {
  kind: "products" | "product" | "search";
  page: number;
  vendorId?: string;
  productId?: string;
  locationGid?: string;
  query?: string;
  productType?: string;
  latitude?: number;
  longitude?: number;
};
const uuid = UUID_PATTERN;
export function catalogueQuery(params: URLSearchParams): CatalogueQuery {
  const allowed = [
    "kind",
    "page",
    "vendorId",
    "productId",
    "locationGid",
    "query",
    "productType",
    "latitude",
    "longitude",
  ];
  if (
    [...params.keys()].some(
      (key) => !allowed.includes(key) || params.getAll(key).length !== 1,
    )
  )
    throw new ApiError(400, "Unsupported catalogue filter.");
  const kind = params.get("kind");
  if (kind !== "products" && kind !== "product" && kind !== "search")
    throw new ApiError(400, "Choose a catalogue view.");
  const page = Number(params.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000)
    throw new ApiError(400, "Invalid catalogue page.");
  const result: CatalogueQuery = { kind, page };
  if (kind !== "search") {
    const vendorId = params.get("vendorId") ?? "";
    const locationGid = params.get("locationGid") ?? "";
    if (
      !uuid.test(vendorId) ||
      !/^gid:\/\/shopify\/Location\/\d+$/.test(locationGid)
    )
      throw new ApiError(
        400,
        "Choose a shop location before browsing products.",
      );
    result.vendorId = vendorId;
    result.locationGid = locationGid;
    if (kind === "product") {
      const productId = params.get("productId") ?? "";
      if (!uuid.test(productId)) throw new ApiError(400, "Invalid product.");
      result.productId = productId;
    }
  }
  if (params.has("productType")) {
    const productType = params.get("productType")!.trim();
    if (kind !== "products" || !productType || productType.length > 120)
      throw new ApiError(400, "Choose a valid shop category.");
    result.productType = productType;
  }
  const query = (params.get("query") ?? "").trim();
  if (query.length > 120 || (kind === "search" && !query))
    throw new ApiError(400, "Enter a search of up to 120 characters.");
  if (query) result.query = query;
  if (params.has("latitude") || params.has("longitude")) {
    const lat = params.get("latitude"),
      lon = params.get("longitude");
    if (
      !lat?.trim() ||
      !lon?.trim() ||
      !Number.isFinite(Number(lat)) ||
      !Number.isFinite(Number(lon)) ||
      Math.abs(Number(lat)) > 90 ||
      Math.abs(Number(lon)) > 180
    )
      throw new ApiError(400, "Choose a valid search location.");
    result.latitude = Number(lat);
    result.longitude = Number(lon);
  }
  return result;
}
function price(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "")
    return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}
function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null;
}
function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? record(value)
    : {};
}

// Explicit projection: upstream vendor objects contain private integration fields.
export function productPageFrom(
  value: unknown,
  query: CatalogueQuery,
): ProductPage {
  const data = record(value),
    meta = record(data.meta);
  if (!Array.isArray(data.data) || count(meta.total) === null)
    throw new ApiError(502, "STREET returned an unexpected catalogue.");
  const products: ProductCard[] = data.data.map((value) => {
    const p = record(value),
      outlet = object(p.outlet);
    const images = Array.isArray(p.images) ? p.images : [];
    const search = query.kind === "search";
    return {
      id: search ? text(p.productId) : required(p.id),
      title: required(p.title),
      price: price(p.price),
      image: image(
        search ? p.image : (object(images[0]).src ?? object(p.image).src),
      ),
      productType: text(p.productType),
      vendorId: search ? required(outlet.vendorId) : query.vendorId!,
      outletId: search ? text(outlet.outletId) : null,
      locationGid: search
        ? text(outlet.shopifyLocationGid)
        : query.locationGid!,
      shopName: search ? text(outlet.vendorName) : text(p.vendor),
      outletName: search ? text(outlet.outletName) : null,
    };
  });
  return {
    products,
    facets: Array.isArray(data.facets)
      ? data.facets.flatMap((value) => {
          const facet = object(value),
            productType = text(facet.productType)?.trim(),
            total = count(
              typeof facet.count === "string" && /^\d+$/.test(facet.count)
                ? Number(facet.count)
                : facet.count,
            );
          return productType && total !== null
            ? [{ productType, count: total }]
            : [];
        })
      : [],
    page: query.page,
    total: Number(meta.total),
    totalPages: Math.ceil(Number(meta.total) / 12),
    requiresLocation: data.requiresLocation === true,
    outOfDeliveryArea: data.outOfDeliveryArea === true,
  };
}
export function productDetailFrom(value: unknown): ProductDetail {
  const p = record(value);
  if (!Array.isArray(p.variants) || !Array.isArray(p.images))
    throw new ApiError(502, "STREET returned incomplete product details.");
  return {
    id: required(p.id),
    title: required(p.title),
    description: text(p.description)?.trim() || null,
    optionNames: Array.isArray(p.options)
      ? p.options.flatMap((value) => {
          const name = text(object(value).name)?.trim();
          return name ? [name] : [];
        })
      : [],
    images: p.images
      .map((v) => image(object(v).src))
      .filter((v): v is string => Boolean(v)),
    variants: p.variants.map((value) => {
      const v = record(value);
      return {
        id: required(v.id),
        title: required(v.title),
        price: price(v.price),
        inventory: count(v.inventoryQuantity),
      };
    }),
  };
}
export function cataloguePath(query: CatalogueQuery): string {
  const params = new URLSearchParams();
  if (query.kind === "search") {
    params.set("query", query.query!);
    if (query.latitude !== undefined && query.longitude !== undefined) {
      params.set("user_latitude", String(query.latitude));
      params.set("user_longitude", String(query.longitude));
    }
  } else params.set("locationGid", query.locationGid!);
  if (query.kind !== "product") {
    params.set("page", String(query.page));
    params.set("limit", "12");
  }
  if (query.kind === "products") {
    params.set("includeFacets", "true");
    if (query.productType) params.set("productType", query.productType);
  }
  if (query.kind === "products" && query.query)
    params.set("search", query.query);
  const path =
    query.kind === "search"
      ? "/search"
      : `/vendors/${encodeURIComponent(query.vendorId!)}/products${query.kind === "product" ? "/" + encodeURIComponent(query.productId!) : ""}`;
  return `${path}?${params}`;
}
