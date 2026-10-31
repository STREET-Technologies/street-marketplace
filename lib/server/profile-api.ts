import type { NextRequest } from "next/server.js";
import {
  profilePermissions,
  type AddressFields,
  type ProfileChanges,
} from "../profile.ts";
import { ApiError, type StreetApi } from "./street-api.ts";
import { uuid } from "./customer-data.ts";
import {
  errorResponse,
  fields,
  json,
  phoneFrom,
  requireSameOrigin,
  sessionCookies,
  smallJson,
} from "./web-api.ts";

function accountToken(request: NextRequest) {
  if (request.method !== "POST") throw new ApiError(405, "Method not allowed.");
  requireSameOrigin(request);
  const token = request.cookies.get(sessionCookies.access)?.value;
  if (!token) throw new ApiError(401, "Sign in to manage your STREET account.");
  return token;
}

function textField(
  value: unknown,
  label: string,
  max: number,
  required = false,
) {
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    throw new ApiError(400, `Please check ${label}.`);
  return value.trim();
}

export async function handleProfile(request: NextRequest, api: StreetApi) {
  try {
    const token = accountToken(request);
    const body = await smallJson(request);
    fields(body, ["firstName", "lastName", "email", "phone"]);
    const user = await api.me(token);
    const permissions = profilePermissions(user);
    const changes: ProfileChanges = {};
    for (const key of ["firstName", "lastName", "email", "phone"] as const) {
      if (!(key in body)) continue;
      const value = textField(
        body[key],
        key === "email"
          ? "your email address"
          : key === "phone"
            ? "your mobile number"
            : "your name",
        key === "email" ? 254 : 100,
      );
      if (value === (user[key] ?? "")) continue;
      if (key === "phone" && !permissions.phone)
        throw new ApiError(
          403,
          "Your mobile number is used to sign in and cannot be changed here.",
        );
      if (key === "email" && !permissions.email)
        throw new ApiError(403, "Your email address is managed by Google.");
      if (key === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        throw new ApiError(400, "Enter a valid email address.");
      changes[key] = key === "phone" ? phoneFrom(value) : value;
    }
    // Identity and restrictions always come from /auth/me, never the request body.
    return json({
      user: Object.keys(changes).length
        ? await api.updateProfile(token, user.id, changes)
        : user,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

const addressFields: (keyof AddressFields)[] = [
  "label",
  "line1",
  "line2",
  "city",
  "state",
  "postcode",
  "deliveryInstructions",
];

export async function handleAddressChange(
  request: NextRequest,
  api: StreetApi,
) {
  try {
    const token = accountToken(request);
    const body = await smallJson(request);
    if (!["save", "default", "delete"].includes(String(body.action)))
      throw new ApiError(400, "Choose a valid address action.");
    fields(
      body,
      body.action === "save"
        ? ["action", "id", ...addressFields]
        : ["action", "id"],
    );
    const id =
      body.id === undefined && body.action === "save" ? null : uuid(body.id);
    // Check ownership before the backend's default-reset side effect.
    const existing = id
      ? (await api.addresses(token)).find((a) => a.id === id)
      : null;
    if (id && !existing)
      throw new ApiError(
        404,
        "This address is no longer available. Refresh your addresses.",
      );
    if (body.action === "delete") {
      await api.deleteAddress(token, id!);
      return json({ success: true });
    }
    if (body.action === "default") {
      await api.saveAddress(token, id, { isDefault: true });
      return json({ success: true });
    }
    const address = Object.fromEntries(
      addressFields.map((key) => [
        key,
        textField(
          body[key],
          key === "postcode"
            ? "your postcode"
            : key === "line1"
              ? "your street address"
              : key,
          key === "deliveryInstructions"
            ? 500
            : key === "postcode"
              ? 12
              : key === "line1" || key === "line2"
                ? 200
                : 100,
          !["line2", "deliveryInstructions"].includes(key),
        ),
      ]),
    ) as unknown as AddressFields;
    address.postcode = address.postcode.toUpperCase();
    if (
      existing &&
      existing.countryCode !== "GB" &&
      existing.countryCode !== undefined
    )
      throw new ApiError(400, "Please manage this address in the STREET app.");
    const changes: Partial<AddressFields> = {};
    for (const key of addressFields)
      if (!existing || address[key] !== (existing[key] ?? ""))
        changes[key] = address[key];
    const locationChanged =
      !existing ||
      ["line1", "line2", "city", "postcode"].some((key) => key in changes);
    if (locationChanged) {
      let verdict = "unknown";
      try {
        verdict = await api.validateAddress(token, address);
      } catch (error) {
        // Match mobile's fail-open validation for service outages; auth still fails closed.
        if (error instanceof ApiError && [401, 403].includes(error.status))
          throw error;
      }
      if (verdict === "invalid_postcode")
        throw new ApiError(
          400,
          "This postcode doesn’t look right. Please check it.",
        );
      if (verdict === "postcode_mismatch")
        throw new ApiError(
          400,
          "This postcode doesn’t match the street address. Please check it.",
        );
    }
    // Only changed fields are sent. Label/instruction edits preserve a confirmed app pin.
    // Text location edits omit coordinates so the backend resolves a fresh location.
    if (!existing || Object.keys(changes).length)
      await api.saveAddress(
        token,
        id,
        existing
          ? changes
          : { ...address, country: "United Kingdom", countryCode: "GB" },
      );
    return json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
