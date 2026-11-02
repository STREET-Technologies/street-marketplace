import type { ProductDetail } from "./contracts.ts";
// Display-only threshold; stock and bag validation still use backend inventory.
const LOW_STOCK_THRESHOLD = 2;
export function stockStatus(inventory: number | null): {
  kind: "unknown" | "out" | "low" | "in";
  label: string;
} {
  if (inventory === null) return { kind: "unknown", label: "Availability unavailable" };
  if (inventory <= 0) return { kind: "out", label: "Out of Stock" };
  if (inventory <= LOW_STOCK_THRESHOLD)
    return { kind: "low", label: `Low Stock (${inventory} available)` };
  return { kind: "in", label: `In Stock (${inventory} available)` };
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
