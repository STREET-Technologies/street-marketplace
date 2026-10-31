import { NextRequest } from "next/server";
import { handleCatalogue } from "../../../../lib/server/web-api";
import { streetApi } from "../../../../lib/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  return handleCatalogue(request, streetApi);
}
