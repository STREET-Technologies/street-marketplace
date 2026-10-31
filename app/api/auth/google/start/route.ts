import type { NextRequest } from "next/server";
import { handleGoogleStart } from "../../../../../lib/server/google-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: NextRequest) {
  return handleGoogleStart(request);
}
