import type { ProductDetail } from "./contracts.ts";
// Display-only threshold; stock and bag validation still use backend inventory.
const LOW_STOCK_THRESHOLD = 2;
export function stockLabel(inventory: number | null): string {
  if (inventory === null) return "Availability unavailable";
  if (inventory <= 0) return "Out of Stock";
  if (inventory <= LOW_STOCK_THRESHOLD) return `Low Stock (${inventory})`;
  return `In Stock (${inventory})`;
}

export function productOptionPrompt(names: string[] = []): string {
  const options = [...new Set(names.map((name) => name.trim().toLowerCase()))];
  if (options.length === 1 && options[0] === "size") return "Choose a size";
  if (options.length === 1 && ["color", "colour"].includes(options[0]))
    return "Choose a colour";
  return "Choose an option";
}

export function productPriceSummary(variants: ProductDetail["variants"]): {
  price: number | null;
  from: boolean;
} {
  const prices = variants.flatMap((v) => (v.price === null ? [] : [v.price]));
  return {
    price: prices.length ? Math.min(...prices) : null,
    from: new Set(prices).size > 1,
  };
}
