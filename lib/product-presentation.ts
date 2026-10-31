// Display-only threshold; stock and bag validation still use backend inventory.
const LOW_STOCK_THRESHOLD = 2;
export function stockLabel(inventory: number | null): string {
  if (inventory === null) return "Availability unavailable";
  if (inventory <= 0) return "Out of Stock";
  if (inventory <= LOW_STOCK_THRESHOLD) return `Low Stock (${inventory})`;
  return `In Stock (${inventory})`;
}
