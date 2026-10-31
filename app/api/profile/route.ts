import type { NextRequest } from "next/server";
import { handleProfile } from "../../../lib/server/profile-api";
import { streetApi } from "../../../lib/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: NextRequest) {
  return handleProfile(request, streetApi);
}
