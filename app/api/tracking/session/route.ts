import type { NextRequest } from "next/server";
import { handleTrackingSession } from "../../../../lib/server/tracking-api";
import { streetApi } from "../../../../lib/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: NextRequest) {
  return handleTrackingSession(request, streetApi);
}
