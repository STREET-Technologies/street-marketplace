import { handleLocationPostcode } from "../../../../lib/server/web-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return handleLocationPostcode(request);
}
