import type { NextRequest } from "next/server";
import { handleAppleStart } from "../../../../../lib/server/apple-auth";
import { streetApi } from "../../../../../lib/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: NextRequest) {
  return handleAppleStart(request, streetApi);
}
