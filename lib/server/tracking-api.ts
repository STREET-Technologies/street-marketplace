import type { NextRequest } from "next/server";
import { ApiError, record, type StreetApi } from "./street-api.ts";
import {
  errorResponse,
  fields,
  json,
  requireSameOrigin,
  sessionCookies,
  smallJson,
} from "./web-api.ts";
export async function handleTrackingSession(
  request: NextRequest,
  api: StreetApi,
) {
  try {
    requireSameOrigin(request);
    const access = request.cookies.get(sessionCookies.access)?.value;
    if (!access) throw new ApiError(401, "Please sign in to track your order.");
    fields(await smallJson(request), []);
    const user = await api.me(access);
    const result = record(await api.firebaseToken(access));
    if (
      typeof result.token !== "string" ||
      !result.token ||
      result.token.length > 12000
    )
      throw new ApiError(502, "Live tracking could not connect.");
    // User approved reuse of the app's existing public Mapbox token. Never
    // expose a secret-scoped token if this server configuration changes.
    const mapToken = process.env.MAPBOX_ACCESS_TOKEN?.trim();
    return json({
      userId: user.id,
      token: result.token,
      mapboxToken: mapToken?.startsWith("pk.") ? mapToken : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
