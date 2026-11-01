import { NextRequest } from "next/server";
import { handleCheckout } from "../../../../lib/server/checkout-api";
import { streetApi } from "../../../../lib/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: NextRequest) {
  return handleCheckout(request, streetApi);
}
export function GET(request: NextRequest) {
  return handleCheckout(request, streetApi);
}
