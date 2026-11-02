import type { NextRequest } from "next/server";
import { handleOrders } from "../../../lib/server/orders-api";
import { streetApi } from "../../../lib/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  return handleOrders(request, streetApi);
}
