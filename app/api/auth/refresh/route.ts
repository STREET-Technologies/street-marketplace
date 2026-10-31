import { NextRequest } from "next/server";
import { handleAuth } from "../../../../lib/server/web-api";
import { streetApi } from "../../../../lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: NextRequest) {
  return handleAuth(request, "refresh", streetApi);
}
