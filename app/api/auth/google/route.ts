import type { NextRequest } from "next/server";
import { handleGoogleLogin } from "../../../../lib/server/google-auth";
import { streetApi } from "../../../../lib/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: NextRequest) {
  return handleGoogleLogin(request, streetApi);
}
