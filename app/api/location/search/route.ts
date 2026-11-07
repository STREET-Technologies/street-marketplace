import { handleAddressSearch } from "../../../../lib/server/address-search";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return handleAddressSearch(request);
}
