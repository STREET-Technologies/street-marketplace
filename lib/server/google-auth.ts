import { randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
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

const challengeLifetimeSeconds = 600;
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  { timeoutDuration: 5000 },
);
export function googleChallengeCookie() {
  return process.env.NODE_ENV === "development"
    ? "street_google_challenge"
    : "__Host-street_google_challenge";
}
export function googleClientId() {
  const value = process.env.GOOGLE_CLIENT_ID?.trim();
  return value && /^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(value)
    ? value
    : null;
}
function challengeCookie(response: NextResponse, value: string) {
  response.cookies.set(googleChallengeCookie(), value, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "strict",
    path: "/",
    maxAge: value ? challengeLifetimeSeconds : 0,
  });
  return response;
}
function requireGuest(request: NextRequest) {
  if (
    request.cookies.has(sessionCookies.access) ||
    request.cookies.has(sessionCookies.refresh)
  )
    throw new ApiError(409, "Sign out before choosing a different account.");
}
function validChallenge(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9_-]{43}\.\d{13}$/.test(value)) return false;
  const age = Date.now() - Number(value.split(".")[1]);
  return age >= 0 && age < challengeLifetimeSeconds * 1000;
}

// The cookie binds this transaction to the initiating browser. The signed ID
// token must repeat its unpredictable nonce; claims are never trusted by decoding alone.
export async function verifyGoogleCredential(
  idToken: string,
  clientId: string,
  nonce: string,
  keys: JWTVerifyGetKey = googleKeys,
) {
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      algorithms: ["RS256"],
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
      requiredClaims: ["exp", "iat", "sub", "nonce", "email", "email_verified"],
      maxTokenAge: "10m",
    });
    // No alternate mobile audience or azp substitution at this web boundary.
    if (
      payload.aud !== clientId ||
      (payload.azp !== undefined && payload.azp !== clientId) ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.email !== "string" ||
      !payload.email ||
      payload.email_verified !== true ||
      typeof payload.nonce !== "string" ||
      payload.nonce.length !== nonce.length ||
      !timingSafeEqual(Buffer.from(payload.nonce), Buffer.from(nonce))
    )
      throw new Error("Invalid Google claims");
  } catch {
    throw new ApiError(
      401,
      "Google sign-in could not be verified. Please try again.",
    );
  }
}

export async function handleGoogleStart(
  request: NextRequest,
  clientId = googleClientId(),
) {
  try {
    if (request.method !== "POST")
      throw new ApiError(405, "Method not allowed.");
    requireSameOrigin(request);
    fields(await smallJson(request), []);
    if (!clientId) return json({ enabled: false });
    requireGuest(request);
    const nonce = `${randomBytes(32).toString("base64url")}.${Date.now()}`;
    return challengeCookie(json({ enabled: true, clientId, nonce }), nonce);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGoogleLogin(
  request: NextRequest,
  api: StreetApi,
  verify = verifyGoogleCredential,
  clientId = googleClientId(),
) {
  let sameOrigin = false;
  try {
    if (request.method !== "POST")
      throw new ApiError(405, "Method not allowed.");
    requireSameOrigin(request);
    sameOrigin = true;
    if (!clientId)
      throw new ApiError(
        503,
        "Google sign-in is unavailable. You can sign in by phone.",
      );
    requireGuest(request);
    const body = await smallJson(request, 8192);
    fields(body, ["idToken"]);
    if (
      typeof body.idToken !== "string" ||
      body.idToken.length > 8000 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(body.idToken)
    )
      throw new ApiError(400, "Please try Google sign-in again.");
    const nonce = request.cookies.get(googleChallengeCookie())?.value;
    if (!validChallenge(nonce))
      throw new ApiError(401, "Google sign-in has expired. Please try again.");
    await verify(body.idToken, clientId, nonce!);
    const { tokens, user } = await api.googleLogin(body.idToken);
    return challengeCookie(setSession(json({ user }), tokens), "");
  } catch (error) {
    const response = errorResponse(error);
    return sameOrigin ? challengeCookie(response, "") : response;
  }
}
