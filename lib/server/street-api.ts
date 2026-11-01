import { CheckoutConflict, CheckoutNotStarted } from "../checkout.ts";
import { UUID_PATTERN } from "./api-values.ts";
import { addressesFrom } from "./customer-data.ts";
import type { ProfileChanges, AddressFields } from "../profile.ts";
import type {
  FavouriteTarget,
  CustomerContext,
  DeliveryCheck,
} from "../contracts.ts";
import {
  ApiError,
  record,
  requiredString,
  optionalString,
  imageUrl,
} from "./api-values.ts";
export { ApiError, record } from "./api-values.ts";
import {
  cataloguePath,
  productPageFrom,
  productDetailFrom,
  type CatalogueQuery,
} from "./catalogue.ts";
import type {
  Customer,
  OutletCard,
  VendorPage,
  Favourites,
  SavedItem,
  SavedPage,
} from "../contracts.ts";
import { STAGING_API, stagingUrl } from "./config.ts";

export function customerFrom(value: unknown): Customer {
  const user = record(value);
  return {
    id: requiredString(user.id),
    firstName: optionalString(user.firstName),
    lastName: optionalString(user.lastName),
    email: optionalString(user.email),
    phone: optionalString(user.phone),
    ssoProvider: optionalString(user.ssoProvider),
  };
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}
export function tokensFrom(value: unknown): Tokens {
  const data = record(value);
  const accessToken = requiredString(data.accessToken);
  const refreshToken = requiredString(data.refreshToken);
  // Prevent malformed/oversized cookies. Tokens are validated by STREET, not decoded as auth here.
  if (
    [accessToken, refreshToken].some(
      (token) => token.length > 3800 || !/^[A-Za-z0-9._~-]+$/.test(token),
    )
  ) {
    throw new ApiError(502, "STREET returned an invalid session.");
  }
  return { accessToken, refreshToken };
}

export function vendorPageFrom(value: unknown): VendorPage {
  const data = record(value);
  const meta = record(data.meta);
  if (
    !Array.isArray(data.data) ||
    !Number.isInteger(meta.total) ||
    !Number.isInteger(meta.page) ||
    !Number.isInteger(meta.totalPages)
  ) {
    throw new ApiError(502, "STREET returned an unexpected catalogue.");
  }
  return {
    categories: [],
    outlets: data.data.map((value) => {
      const vendor = record(value);
      const image = optionalString(vendor.storeImage);
      return {
        vendorId: requiredString(vendor.id),
        outletId: optionalString(vendor.outletId),
        locationGid: optionalString(vendor.shopifyLocationGid),
        name: requiredString(vendor.storeName),
        outletName: optionalString(vendor.outletName),
        category: optionalString(vendor.vendorCategory),
        image: image?.startsWith("https://") ? image : null,
        logo: imageUrl(vendor.logo),
        postcode: optionalString(vendor.postcode),
        address: optionalString(vendor.address),
        distanceMiles:
          typeof vendor.distance === "number" &&
          Number.isFinite(vendor.distance) &&
          vendor.distance >= 0
            ? vendor.distance
            : null,
        isOnline: vendor.isOnline === true,
      };
    }),
    total: meta.total as number,
    page: meta.page as number,
    totalPages: meta.totalPages as number,
  };
}

type FavouriteRef = {
  vendorId: string;
  productShopifyId?: string;
  outletId?: string | null;
};
export function favouriteRefs(
  value: unknown,
  kind: "products" | "shops",
): FavouriteRef[] {
  if (!Array.isArray(value))
    throw new ApiError(502, "STREET returned an unexpected wishlist.");
  return value.map((item) => {
    const row = record(item);
    return kind === "products"
      ? {
          vendorId: requiredString(row.vendorId),
          productShopifyId: requiredString(row.productShopifyId),
        }
      : {
          vendorId: requiredString(row.vendorId),
          outletId: optionalString(row.outletId),
        };
  });
}

// Limit both page size and concurrent detail requests. Favourites remain visible
// when an individual catalogue entry has been removed or is temporarily offline.
async function savedPage(
  refs: FavouriteRef[],
  page: number,
  enrich: (ref: FavouriteRef) => Promise<SavedItem>,
): Promise<SavedPage> {
  const pageSize = 12;
  const selected = refs.slice((page - 1) * pageSize, page * pageSize);
  const items: SavedItem[] = [];
  for (let i = 0; i < selected.length; i += 4) {
    items.push(...(await Promise.all(selected.slice(i, i + 4).map(enrich))));
  }
  return {
    items,
    page,
    total: refs.length,
    totalPages: Math.ceil(refs.length / pageSize),
  };
}

// Only explicit operations are exposed. No arbitrary URL/path/body forwarding.
export function createStreetApi(fetcher: typeof fetch = fetch) {
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
  ): Promise<unknown> {
    const headers = new Headers({ Accept: "application/json" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let response: Response;
    try {
      response = await fetcher(stagingUrl(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Never leak upstream URLs, credentials or diagnostic bodies to the browser.
      throw new ApiError(
        503,
        "STREET is temporarily unavailable. Please try again.",
      );
    }
    if (!response.ok) {
      if (path === "/checkout-attempts" && [400,409].includes(response.status)) {
        const conflict = await response.json().catch(() => null);
        if (response.status === 400 && conflict?.code === "CHECKOUT_NOT_STARTED") throw new CheckoutNotStarted();
        if (response.status === 409 && typeof conflict?.attemptId === "string" && UUID_PATTERN.test(conflict.attemptId))
          throw new CheckoutConflict(conflict.attemptId);
        throw new ApiError(response.status, "This checkout could not be started. Resume your existing checkout or contact STREET.");
      }
      const messages: Record<number, string> = {
        400: "Please check your details and try again.",
        401: "Your session or verification code is no longer valid.",
        403: "This action is not available for this account.",
        404: "The requested item could not be found.",
        409: "These details are already used by another account. Please check your email or mobile number.",
        429: "Too many attempts. Please wait before trying again.",
      };
      throw new ApiError(
        messages[response.status] ? response.status : 502,
        messages[response.status] ?? "STREET could not complete this request.",
      );
    }
    try {
      return record(await response.json()).data;
    } catch {
      throw new ApiError(502, "STREET returned an unexpected response.");
    }
  }
  async function outletForAddress(
    vendorId: string,
    outletId: string,
    coordinates: { latitude: number; longitude: number },
  ): Promise<{ outlet: OutletCard | null; delivery: DeliveryCheck }> {
    // Backend owns radius and discovery gates. Vendor pages may contain zero outlet rows.
    for (let page = 1; page <= 20; page++) {
      const params = new URLSearchParams({
        page: String(page),
        limit: "100",
        user_latitude: String(coordinates.latitude),
        user_longitude: String(coordinates.longitude),
      });
      const result = vendorPageFrom(await request(`/vendors?${params}`));
      const outlet = result.outlets.find(
        (o) => o.vendorId === vendorId && o.outletId === outletId,
      );
      if (outlet) {
        const hours = record(
          await request(
            `/vendors/${encodeURIComponent(vendorId)}/online-status?${new URLSearchParams({ outletId })}`,
          ),
        );
        return {
          outlet,
          delivery: {
            status: "available",
            isOpen:
              typeof hours.isCurrentlyOpen === "boolean"
                ? hours.isCurrentlyOpen
                : null,
          },
        };
      }
      if (page >= result.totalPages)
        return {
          outlet: null,
          delivery: { status: "unavailable", isOpen: null },
        };
    }
    return { outlet: null, delivery: { status: "unknown", isOpen: null } };
  }
  return {
    checkoutStart: (token: string, body: import("../contracts.ts").CartIntent & { attemptKey: string }) => request("/checkout-attempts", "POST", body, token),
    checkoutStatus: (token: string, id: string) => request(`/checkout-attempts/${encodeURIComponent(id)}`, "GET", undefined, token),
    async requestOtp(phone: string) {
      await request("/auth/request-otp", "POST", { phone });
    },
    async googleLogin(idToken: string) {
      const data = record(
        await request("/auth/google/token", "POST", { idToken }),
      );
      return { tokens: tokensFrom(data), user: customerFrom(data.user) };
    },
    async verifyOtp(phone: string, code: string) {
      const data = record(
        await request("/auth/verify-otp", "POST", { phone, code }),
      );
      return { tokens: tokensFrom(data), user: customerFrom(data.user) };
    },
    async me(accessToken: string) {
      return customerFrom(
        await request("/auth/me", "GET", undefined, accessToken),
      );
    },
    async updateProfile(
      token: string,
      userId: string,
      changes: ProfileChanges,
    ) {
      return customerFrom(
        await request(
          `/users/${encodeURIComponent(userId)}`,
          "PATCH",
          changes,
          token,
        ),
      );
    },
    async validateAddress(
      token: string,
      address: Pick<AddressFields, "line1" | "city" | "postcode">,
    ) {
      const result = record(
        await request(
          "/user-addresses/validate",
          "POST",
          {
            address: address.line1,
            city: address.city,
            postcode: address.postcode,
          },
          token,
        ),
      );
      return optionalString(result.verdict) ?? "unknown";
    },
    async saveAddress(
      token: string,
      id: string | null,
      changes: Partial<AddressFields> & {
        isDefault?: boolean;
        country?: string;
        countryCode?: string;
      },
    ) {
      const result = await request(
        id ? `/user-addresses/${encodeURIComponent(id)}` : "/user-addresses",
        id ? "PATCH" : "POST",
        changes,
        token,
      );
      return addressesFrom([result])[0];
    },
    async deleteAddress(token: string, id: string) {
      await request(
        `/user-addresses/${encodeURIComponent(id)}`,
        "DELETE",
        undefined,
        token,
      );
    },
    async refresh(refreshToken: string) {
      return tokensFrom(
        await request("/auth/refresh", "POST", { refreshToken }),
      );
    },
    async logout(refreshToken: string) {
      await request("/auth/logout", "POST", { refreshToken });
    },
    async vendors(
      page: number,
      coordinates?: { latitude: number; longitude: number },
      category?: string,
    ): Promise<VendorPage> {
      // Upstream paginates vendors before expanding/filtering outlets. Gather every
      // page before category filtering and pagination so nearest-first is global.
      const params = new URLSearchParams({ limit: "100" });
      if (coordinates) {
        params.set("user_latitude", String(coordinates.latitude));
        params.set("user_longitude", String(coordinates.longitude));
      }
      const outlets = new Map<string, OutletCard>();
      for (let upstreamPage = 1; ; upstreamPage++) {
        params.set("page", String(upstreamPage));
        const result = vendorPageFrom(await request(`/vendors?${params}`));
        for (const outlet of result.outlets)
          outlets.set(outlet.vendorId + ":" + outlet.outletId, outlet);
        if (upstreamPage >= result.totalPages) break;
        // Fail explicitly rather than return a misleading partial nearby directory.
        if (upstreamPage >= 20)
          throw new ApiError(
            502,
            "The shop directory is too large to load. Please try again later.",
          );
      }
      const all = [...outlets.values()];
      const categories = [
        ...new Set(all.flatMap((o) => (o.category ? [o.category] : []))),
      ].sort((a, b) => a.localeCompare(b));
      const filtered = all.filter((o) => !category || o.category === category);
      if (coordinates)
        filtered.sort(
          (a, b) =>
            (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity) ||
            a.name.localeCompare(b.name) ||
            (a.outletId ?? "").localeCompare(b.outletId ?? ""),
        );
      const limit = 12;
      return {
        outlets: filtered.slice((page - 1) * limit, page * limit),
        categories,
        page,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / limit),
      };
    },
    async deliveryFee(token: string, userAddressId: string, vendorId: string) {
      const data = record(
        await request(
          "/orders/delivery-price",
          "POST",
          { userAddressId, vendorId },
          token,
        ),
      );
      const fee = data.priceTaxIncluded;
      if (
        typeof fee !== "number" ||
        !Number.isFinite(fee) ||
        fee < 0 ||
        !Number.isSafeInteger(Math.round(fee * 100))
      )
        throw new ApiError(502, "Delivery fee could not be confirmed.");
      return Math.round(fee * 100) / 100;
    },
    async addresses(token: string) {
      return addressesFrom(
        await request("/user-addresses", "GET", undefined, token),
      );
    },
    async customerContext(token: string): Promise<CustomerContext> {
      const [user, addresses, products, shops] = await Promise.all([
        request("/auth/me", "GET", undefined, token).then(customerFrom),
        request("/user-addresses", "GET", undefined, token).then(addressesFrom),
        request("/favorites/products", "GET", undefined, token).then((v) =>
          favouriteRefs(v, "products"),
        ),
        request("/favorites/vendors", "GET", undefined, token).then((v) =>
          favouriteRefs(v, "shops"),
        ),
      ]);
      return {
        userId: user.id,
        addresses,
        favourites: [
          ...products.map((p) => ({
            kind: "product" as const,
            vendorId: p.vendorId,
            productId: p.productShopifyId!,
          })),
          ...shops
            .filter((s) => s.outletId)
            .map((s) => ({
              kind: "shop" as const,
              vendorId: s.vendorId,
              outletId: s.outletId!,
            })),
        ],
      };
    },
    async setFavourite(token: string, target: FavouriteTarget, saved: boolean) {
      const path =
        target.kind === "product"
          ? "/favorites/products"
          : "/favorites/vendors";
      const body =
        target.kind === "product"
          ? { vendorId: target.vendorId, productShopifyId: target.productId }
          : { vendorId: target.vendorId, outletId: target.outletId };
      try {
        if (saved) await request(path, "POST", body, token);
        else
          await request(
            target.kind === "product"
              ? `${path}?${new URLSearchParams({ vendorId: target.vendorId, productShopifyId: target.productId })}`
              : `${path}/${encodeURIComponent(target.outletId)}`,
            "DELETE",
            undefined,
            token,
          );
      } catch (error) {
        // An already absent favourite has the requested state. Never hide add failures.
        if (saved || !(error instanceof ApiError && error.status === 404))
          throw error;
      }
    },
    outletForAddress,
    async deliveryCheck(
      vendorId: string,
      outletId: string,
      coordinates: { latitude: number; longitude: number },
    ): Promise<DeliveryCheck> {
      return (await outletForAddress(vendorId, outletId, coordinates)).delivery;
    },
    async catalogue(query: CatalogueQuery) {
      const data = await request(cataloguePath(query));
      return query.kind === "product"
        ? productDetailFrom(data)
        : productPageFrom(data, query);
    },
    async favourites(
      accessToken: string,
      productsPage = 1,
      shopsPage = 1,
    ): Promise<Favourites> {
      const [productRefs, shopRefs] = await Promise.all([
        request("/favorites/products", "GET", undefined, accessToken).then(
          (data) => favouriteRefs(data, "products"),
        ),
        request("/favorites/vendors", "GET", undefined, accessToken).then(
          (data) => favouriteRefs(data, "shops"),
        ),
      ]);
      // Request-local only: different customers never share tokens or favourite data.
      const vendors = new Map<string, Promise<unknown>>();
      const vendorDetails = (id: string) => {
        if (!vendors.has(id))
          vendors.set(
            id,
            request(
              `/vendors/${encodeURIComponent(id)}`,
              "GET",
              undefined,
              accessToken,
            ),
          );
        return vendors.get(id)!;
      };
      const enrich = async (ref: FavouriteRef): Promise<SavedItem> => {
        const product = ref.productShopifyId;
        const base: SavedItem = {
          key: JSON.stringify([ref.vendorId, product ?? ref.outletId ?? null]),
          vendorId: ref.vendorId,
          ...(product
            ? { productId: product }
            : { outletId: ref.outletId ?? null }),
          name: product ? "Saved product" : "Saved shop",
          shopName: null,
          image: null,
          status: "ready",
        };
        try {
          const detail = record(
            await (product
              ? request(
                  `/vendors/${encodeURIComponent(ref.vendorId)}/products/${encodeURIComponent(product)}`,
                  "GET",
                  undefined,
                  accessToken,
                )
              : vendorDetails(ref.vendorId)),
          );
          if (product) {
            const images = Array.isArray(detail.images) ? detail.images : [];
            const first =
              images[0] && typeof images[0] === "object"
                ? record(images[0])
                : {};
            const vendor =
              detail.vendor && typeof detail.vendor === "object"
                ? record(detail.vendor)
                : {};
            return {
              ...base,
              name: requiredString(detail.title),
              image: imageUrl(first.src),
              shopName: optionalString(vendor.storeName),
            };
          }
          // Vendor details describe the brand, not necessarily the saved branch.
          // Keep the original outlet ID; never substitute primary-outlet metadata.
          return {
            ...base,
            name: requiredString(detail.storeName),
            image: imageUrl(detail.storeImage),
          };
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) throw error;
          return {
            ...base,
            status:
              error instanceof ApiError && error.status === 404
                ? "unavailable"
                : "error",
          };
        }
      };
      const [products, shops] = await Promise.all([
        savedPage(productRefs, productsPage, enrich),
        savedPage(shopRefs, shopsPage, enrich),
      ]);
      return { products, shops };
    },
  };
}
export type StreetApi = ReturnType<typeof createStreetApi>;
export { STAGING_API };
