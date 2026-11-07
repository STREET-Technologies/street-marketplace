import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server.js";
import { ApiError, type StreetApi } from "./street-api.ts";
import {
  errorResponse,
  fields,
  json,
  requireSameOrigin,
  sessionCookies,
  setSession,
  smallJson,
} from "./web-api.ts";

export type AppleIntent = "login" | "link";
export function appleEnabled() {
  return process.env.APPLE_WEB_SIGN_IN_ENABLED === "true";
}
export function appleChallengeCookie() {
  return process.env.NODE_ENV === "development"
    ? "street_apple_challenge"
    : "__Host-street_apple_challenge";
}
function setChallenge(response: NextResponse, value: string, maxAge = 0) {
  response.cookies.set(appleChallengeCookie(), value, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "strict",
    path: "/",
    maxAge,
  });
  return response;
}
function sessionFor(request: NextRequest, intent: AppleIntent) {
  const token = request.cookies.get(sessionCookies.access)?.value;
  if (
    intent === "login" &&
    (token || request.cookies.has(sessionCookies.refresh))
  )
    throw new ApiError(409, "Sign out before choosing a different account.");
  if (intent === "link" && !token)
    throw new ApiError(401, "Sign in again before connecting Apple.");
  return intent === "link" ? token : undefined;
}
function sessionHash(token?: string) {
  return token ? createHash("sha256").update(token).digest("hex") : "";
}
function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function handleAppleStart(
  request: NextRequest,
  api: StreetApi,
  enabled = appleEnabled(),
) {
  try {
    if (request.method !== "POST")
      throw new ApiError(405, "Method not allowed.");
    requireSameOrigin(request);
    const body = await smallJson(request);
    fields(body, ["intent"]);
    if (body.intent !== "login" && body.intent !== "link")
      throw new ApiError(400, "Choose a valid Apple sign-in action.");
    if (!enabled) return json({ enabled: false });
    const token = sessionFor(request, body.intent);
    const challenge = await api.appleChallenge(body.intent, token);
    // Popup responses are delivered to this origin. Never accept a backend or
    // caller configuration that would send credentials to an unrelated website.
    const redirect = new URL(challenge.redirectUri);
    if (
      redirect.protocol !== "https:" ||
      redirect.origin !== new URL(request.url).origin ||
      redirect.pathname !== "/api/auth/apple/callback" ||
      redirect.search ||
      redirect.hash
    )
      throw new ApiError(
        503,
        "Apple sign-in is not configured for this website.",
      );
    const state = randomBytes(32).toString("base64url");
    const transaction = {
      state,
      challengeId: challenge.challengeId,
      intent: body.intent,
      expiresAt: Date.now() + challenge.expiresIn * 1000,
      session: sessionHash(token),
    };
    return setChallenge(
      json({ enabled: true, ...challenge, state }),
      Buffer.from(JSON.stringify(transaction)).toString("base64url"),
      challenge.expiresIn,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function handleAppleFinish(
  request: NextRequest,
  api: StreetApi,
  intent: AppleIntent,
  enabled = appleEnabled(),
) {
  let sameOrigin = false;
  try {
    if (request.method !== "POST")
      throw new ApiError(405, "Method not allowed.");
    requireSameOrigin(request);
    sameOrigin = true;
    if (!enabled)
      throw new ApiError(
        503,
        "Apple sign-in is unavailable. Please use another sign-in method.",
      );
    const token = sessionFor(request, intent);
    const body = await smallJson(request, 12288);
    fields(body, [
      "state",
      "authorizationCode",
      "identityToken",
      ...(intent === "login" ? ["givenName", "familyName"] : []),
    ]);
    const profile: { givenName?: string; familyName?: string } = {};
    for (const key of ["givenName", "familyName"] as const) {
      if (!(key in body)) continue;
      if (typeof body[key] !== "string" || body[key].length > 100)
        throw new ApiError(400, "Please check your name and try again.");
      const name = body[key].trim();
      if (name) profile[key] = name;
    }
    if (
      typeof body.state !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.state) ||
      typeof body.authorizationCode !== "string" ||
      !body.authorizationCode ||
      body.authorizationCode.length > 2048 ||
      typeof body.identityToken !== "string" ||
      body.identityToken.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
        body.identityToken,
      )
    )
      throw new ApiError(400, "Please try Apple sign-in again.");
    let transaction;
    try {
      transaction = JSON.parse(
        Buffer.from(
          request.cookies.get(appleChallengeCookie())?.value ?? "",
          "base64url",
        ).toString(),
      );
    } catch {
      throw new ApiError(401, "Apple sign-in has expired. Please try again.");
    }
    if (
      !transaction ||
      typeof transaction.state !== "string" ||
      !equal(transaction.state, body.state) ||
      typeof transaction.challengeId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(transaction.challengeId) ||
      transaction.intent !== intent ||
      typeof transaction.expiresAt !== "number" ||
      transaction.expiresAt <= Date.now() ||
      transaction.expiresAt > Date.now() + 300000 ||
      transaction.session !== sessionHash(token)
    )
      throw new ApiError(
        401,
        "Apple sign-in has expired or the account changed. Please try again.",
      );
    const proof = {
      challengeId: transaction.challengeId,
      authorizationCode: body.authorizationCode,
      identityToken: body.identityToken,
    };
    if (intent === "link") {
      await api.appleLink(proof, token!);
      return setChallenge(json({ linked: true }), "");
    }
    // The backend verifies Apple signature/code/nonce and atomically consumes the
    // challenge. Cookie clearing alone is not used as replay protection.
    const { tokens, user } = await api.appleLogin({ ...proof, ...profile });
    return setChallenge(setSession(json({ user }), tokens), "");
  } catch (error) {
    const response = errorResponse(error);
    return sameOrigin ? setChallenge(response, "") : response;
  }
}
