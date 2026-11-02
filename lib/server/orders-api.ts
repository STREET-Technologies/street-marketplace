import type { NextRequest } from "next/server";
import { ApiError, type StreetApi } from "./street-api.ts";
import { errorResponse, json, sessionCookies } from "./web-api.ts";
import { orderReference } from "./orders.ts";
export async function handleOrders(request: NextRequest, api: StreetApi) {
  try {
    const token = request.cookies.get(sessionCookies.access)?.value;
    if (!token) throw new ApiError(401, "Please sign in to view your orders.");
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some(
        (key) =>
          !["page", "group", "reference"].includes(key) ||
          params.getAll(key).length !== 1,
      )
    )
      throw new ApiError(400, "Unsupported order filter.");
    if (params.has("reference")) {
      if (params.size !== 1) throw new ApiError(400, "Choose one order.");
      return json(
        await api.orderDetail(token, orderReference(params.get("reference"))),
      );
    }
    const page = Number(params.get("page") ?? "1"),
      group = params.get("group") ?? "active";
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100000 ||
      !["active", "past"].includes(group)
    )
      throw new ApiError(400, "Choose a valid order page.");
    return json(await api.orders(token, group as "active" | "past", page));
  } catch (error) {
    return errorResponse(error);
  }
}
