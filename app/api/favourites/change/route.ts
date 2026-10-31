import { NextRequest } from "next/server";
import { handleFavouriteChange } from "../../../../lib/server/web-api";
import { streetApi } from "../../../../lib/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: NextRequest) {
  return handleFavouriteChange(request, streetApi);
}
