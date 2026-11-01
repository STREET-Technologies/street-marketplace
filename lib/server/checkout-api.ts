import type { NextRequest } from "next/server.js";
import { cartIntentFrom } from "./cart-check.ts";
import { uuid } from "./customer-data.ts";
import { ApiError, record, type StreetApi } from "./street-api.ts";
import {
  errorResponse,
  fields,
  json,
  requireSameOrigin,
  sessionCookies,
  smallJson,
} from "./web-api.ts";
import {
  CheckoutConflict,
  CheckoutNotStarted,
  isCheckoutShop,
  safeCheckoutUrl,
  type CheckoutResult,
  type CheckoutStatus,
} from "../checkout.ts";
export const checkoutEnabled = () => process.env.CHECKOUT_ENABLED === "true";
export function checkoutProjection(
  value: unknown,
  userId: string,
): CheckoutResult {
  try {
    const data = record(value);
    const statuses: CheckoutStatus[] = [
      "preparing",
      "ready",
      "uncertain",
      "failed",
      "completed",
      "cancelled",
    ];
    if (
      !statuses.includes(data.status as CheckoutStatus) ||
      (data.orderId !== null &&
        (typeof data.orderId !== "string" ||
          !/^[a-zA-Z0-9-]{1,80}$/.test(data.orderId)))
    )
      throw new Error();
    const checkoutUrl =
      data.status === "ready" ? safeCheckoutUrl(data.checkoutUrl) : undefined;
    if (data.status === "ready" && !checkoutUrl) throw new Error();
    return {
      userId,
      id: uuid(data.id),
      status: data.status as CheckoutStatus,
      orderId: data.orderId as string | null,
      ...(checkoutUrl ? { checkoutUrl } : {}),
    };
  } catch {
    throw new ApiError(
      502,
      "Checkout status could not be confirmed. Your bag has been kept.",
    );
  }
}
export async function handleCheckout(request: NextRequest, api: StreetApi) {
  try {
    if (!checkoutEnabled())
      throw new ApiError(403, "Web checkout is not available yet.");
    const token = request.cookies.get(sessionCookies.access)?.value;
    if (!token) throw new ApiError(401, "Sign in again before checking out.");
    let expectedUserId: string,
      id: string | undefined,
      body: Record<string, unknown> | undefined;
    if (request.method === "POST") {
      requireSameOrigin(request);
      if (new URL(request.url).search)
        throw new ApiError(400, "Unexpected checkout filters.");
      body = await smallJson(request, 8192);
      fields(body, [
        "expectedUserId",
        "attemptKey",
        "vendorId",
        "outletId",
        "addressId",
        "lines",
      ]);
      expectedUserId = uuid(body.expectedUserId);
    } else if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      if (
        [...params.keys()].some(
          (k) =>
            !["id", "expectedUserId"].includes(k) ||
            params.getAll(k).length !== 1,
        )
      )
        throw new ApiError(400, "Unexpected checkout filters.");
      expectedUserId = uuid(params.get("expectedUserId"));
      id = uuid(params.get("id"));
    } else return json({ error: "Method not allowed." }, 405);
    const user = await api.me(token);
    if (user.id !== expectedUserId)
      throw new ApiError(409, "Your account changed. Reload your bag.");
    if (body) {
      const { expectedUserId: _owner, attemptKey, ...values } = body;
      const intent = cartIntentFrom(values);
      if (!isCheckoutShop(intent))
        throw new ApiError(
          403,
          "Web checkout is not available for this shop yet.",
        );
      return json(
        checkoutProjection(
          await api.checkoutStart(token, {
            ...intent,
            attemptKey: uuid(attemptKey),
          }),
          user.id,
        ),
      );
    }
    return json(
      checkoutProjection(await api.checkoutStatus(token, id!), user.id),
    );
  } catch (error) {
    if (error instanceof CheckoutNotStarted)
      return json({ error: error.message, code: "CHECKOUT_NOT_STARTED" }, 400);
    if (error instanceof CheckoutConflict)
      return json({ error: error.message, attemptId: error.attemptId }, 409);
    return errorResponse(error);
  }
}
