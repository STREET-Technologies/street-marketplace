import { cartIntentFrom, checkCart } from "./cart-check.ts";
import { favouriteTarget, uuid } from "./customer-data.ts";
import { catalogueQuery } from "./catalogue.ts";
import { NextRequest, NextResponse } from "next/server.js";
import { ApiError, record, type StreetApi, type Tokens } from "./street-api.ts";

export const sessionCookies = {
  access: "street_staging_access",
  refresh: "street_staging_refresh",
};
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Robots-Tag": "noindex",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}

function setSession(response: NextResponse, tokens: Tokens | null) {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax" as const,
    path: "/",
  };
  response.cookies.set(sessionCookies.access, tokens?.accessToken ?? "", {
    ...options,
    maxAge: tokens ? 15 * 60 : 0,
  });
  response.cookies.set(sessionCookies.refresh, tokens?.refreshToken ?? "", {
    ...options,
    maxAge: tokens ? 7 * 24 * 60 * 60 : 0,
  });
  return response;
}

export function requireSameOrigin(request: Request) {
  // Never trust a caller-supplied forwarded host. Pin deployed origin when configured.
  const expected =
    process.env.MARKETPLACE_ORIGIN || new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (
    origin !== expected ||
    ["cross-site", "same-site"].includes(
      request.headers.get("sec-fetch-site") ?? "",
    )
  ) {
    throw new ApiError(
      403,
      "Please submit this request from the STREET website.",
    );
  }
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  ) {
    throw new ApiError(415, "This request must use JSON.");
  }
}

async function smallJson(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Please provide your details.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2048) {
      await reader.cancel();
      throw new ApiError(413, "The request is too large.");
    }
    chunks.push(value);
  }
  try {
    return record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    throw new ApiError(400, "Please provide valid details.");
  }
}

function fields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new ApiError(400, "Unexpected request fields.");
}
function phoneFrom(value: unknown) {
  // Input is explicitly international format; backend remains normalization authority.
  if (typeof value !== "string")
    throw new ApiError(400, "Enter your phone number with its country code.");
  const phone = value.replace(/[ ()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new ApiError(
      400,
      "Enter your phone number with its country code, such as +44.",
    );
  return phone;
}

export type AuthAction =
  "request-otp" | "verify-otp" | "session" | "refresh" | "logout";

export async function handleAuth(
  request: NextRequest,
  action: AuthAction,
  api: StreetApi,
): Promise<NextResponse> {
  try {
    if (action === "session") {
      if (request.method !== "GET")
        return json({ error: "Method not allowed." }, 405);
      const access = request.cookies.get(sessionCookies.access)?.value;
      if (!access) {
        // A normal guest is not an error and needs no refresh round trip.
        const hasRefresh = request.cookies.has(sessionCookies.refresh);
        return json({ user: null }, hasRefresh ? 401 : 200);
      }
      return json({ user: await api.me(access) });
    }
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    requireSameOrigin(request);
    const body = await smallJson(request);
    if (action === "request-otp") {
      fields(body, ["phone"]);
      await api.requestOtp(phoneFrom(body.phone));
      return json({ success: true });
    }
    if (action === "verify-otp") {
      fields(body, ["phone", "code"]);
      const phone = phoneFrom(body.phone);
      if (typeof body.code !== "string" || !/^\d{4,6}$/.test(body.code))
        throw new ApiError(400, "Enter the code from your text message.");
      // Account is always created/found by STREET. No user ID is accepted from the browser.
      const { tokens, user } = await api.verifyOtp(phone, body.code);
      return setSession(json({ user }), tokens);
    }
    fields(body, []);
    const refresh = request.cookies.get(sessionCookies.refresh)?.value;
    if (action === "refresh") {
      if (!refresh)
        return setSession(json({ error: "Please sign in again." }, 401), null);
      return setSession(json({ success: true }), await api.refresh(refresh));
    }
    // On upstream outage keep the cookies so the customer can retry revocation.
    // A rejected/expired refresh token is already unusable and can be cleared.
    if (refresh) {
      try {
        await api.logout(refresh);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
    }
    return setSession(json({ success: true }), null);
  } catch (error) {
    const response = errorResponse(error);
    if (
      action === "refresh" &&
      error instanceof ApiError &&
      error.status === 401
    )
      setSession(response, null);
    return response;
  }
}

export function errorResponse(error: unknown): NextResponse {
  return json(
    {
      error:
        error instanceof ApiError
          ? error.message
          : "This request could not be completed.",
    },
    error instanceof ApiError ? error.status : 500,
  );
}

export async function handleVendors(request: NextRequest, api: StreetApi) {
  try {
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some(
        (key) =>
          !["page", "addressId", "latitude", "longitude", "category"].includes(
            key,
          ) || params.getAll(key).length !== 1,
      )
    )
      throw new ApiError(400, "Unsupported catalogue filter.");
    const page = Number(params.get("page") ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000)
      throw new ApiError(400, "Invalid catalogue page.");
    const category = params.get("category")?.trim();
    if (params.has("category") && (!category || category.length > 120))
      throw new ApiError(400, "Choose a valid shop category.");
    let coordinates;
    if (params.has("latitude") || params.has("longitude")) {
      const latitude = params.get("latitude"),
        longitude = params.get("longitude");
      if (
        params.has("addressId") ||
        !latitude?.trim() ||
        !longitude?.trim() ||
        !Number.isFinite(Number(latitude)) ||
        !Number.isFinite(Number(longitude)) ||
        Math.abs(Number(latitude)) > 90 ||
        Math.abs(Number(longitude)) > 180
      )
        throw new ApiError(400, "Choose a valid shop location.");
      coordinates = {
        latitude: Number(latitude),
        longitude: Number(longitude),
      };
    } else coordinates = await addressCoordinates(request, api);
    return json(await api.vendors(page, coordinates, category));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleFavourites(request: NextRequest, api: StreetApi) {
  try {
    const token = request.cookies.get(sessionCookies.access)?.value;
    if (!token) return json({ error: "Sign in to see your saved items." }, 401);
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some(
        (key) => !["productsPage", "shopsPage"].includes(key),
      )
    ) {
      throw new ApiError(400, "Unsupported favourites filter.");
    }
    const pages = ["productsPage", "shopsPage"].map((key) =>
      Number(params.get(key) ?? 1),
    );
    if (
      pages.some(
        (page) => !Number.isSafeInteger(page) || page < 1 || page > 1000,
      )
    ) {
      throw new ApiError(400, "Invalid favourites page.");
    }
    return json(await api.favourites(token, pages[0], pages[1]));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleCatalogue(request: NextRequest, api: StreetApi) {
  try {
    const params = new URL(request.url).searchParams;
    const coordinates = await addressCoordinates(request, api);
    params.delete("addressId");
    if (coordinates) {
      params.set("latitude", String(coordinates.latitude));
      params.set("longitude", String(coordinates.longitude));
    }
    return json(await api.catalogue(catalogueQuery(params)));
  } catch (error) {
    return errorResponse(error);
  }
}

async function addressCoordinates(request: NextRequest, api: StreetApi) {
  const params = new URL(request.url).searchParams;
  const addressId = params.get("addressId");
  if (addressId === null) return undefined;
  if (params.getAll("addressId").length !== 1)
    throw new ApiError(400, "Choose one address.");
  uuid(addressId);
  const token = request.cookies.get(sessionCookies.access)?.value;
  if (!token) throw new ApiError(401, "Sign in to use your saved addresses.");
  const address = (await api.addresses(token)).find((a) => a.id === addressId);
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
  return address.coordinates;
}
export async function handleCustomerContext(
  request: NextRequest,
  api: StreetApi,
) {
  try {
    if (new URL(request.url).search)
      throw new ApiError(400, "Unexpected account filters.");
    const token = request.cookies.get(sessionCookies.access)?.value;
    if (!token) throw new ApiError(401, "Sign in to use your STREET account.");
    return json(await api.customerContext(token));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function handleFavouriteChange(
  request: NextRequest,
  api: StreetApi,
) {
  try {
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    requireSameOrigin(request);
    const token = request.cookies.get(sessionCookies.access)?.value;
    if (!token) throw new ApiError(401, "Sign in to save your favourites.");
    const body = await smallJson(request);
    fields(
      body,
      body.kind === "product"
        ? ["kind", "vendorId", "productId", "saved"]
        : ["kind", "vendorId", "outletId", "saved"],
    );
    if (typeof body.saved !== "boolean")
      throw new ApiError(400, "Choose whether to save this item.");
    await api.setFavourite(token, favouriteTarget(body), body.saved);
    return json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function handleDeliveryCheck(
  request: NextRequest,
  api: StreetApi,
) {
  try {
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some(
        (k) =>
          !["vendorId", "outletId", "addressId"].includes(k) ||
          params.getAll(k).length !== 1,
      )
    )
      throw new ApiError(400, "Unexpected delivery filters.");
    const vendorId = uuid(params.get("vendorId")),
      outletId = uuid(params.get("outletId"));
    const coordinates = await addressCoordinates(request, api);
    if (!coordinates) throw new ApiError(400, "Choose a saved address.");
    return json(await api.deliveryCheck(vendorId, outletId, coordinates));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleCartCheck(request: NextRequest, api: StreetApi) {
  try {
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    requireSameOrigin(request);
    const token = request.cookies.get(sessionCookies.access)?.value;
    if (!token) throw new ApiError(401, "Sign in to check your bag.");
    return json(
      await checkCart(cartIntentFrom(await smallJson(request)), token, api),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
