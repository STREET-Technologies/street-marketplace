import type { NextRequest } from "next/server";
import { handleAddressChange } from "../../../../lib/server/profile-api";
import { streetApi } from "../../../../lib/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: NextRequest) {
  return handleAddressChange(request, streetApi);
}
