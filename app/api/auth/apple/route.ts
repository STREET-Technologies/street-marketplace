import type { NextRequest } from "next/server";
import { handleAppleFinish } from "../../../../lib/server/apple-auth";
import { streetApi } from "../../../../lib/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: NextRequest) {
  return handleAppleFinish(request, streetApi, "login");
}
