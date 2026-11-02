import test from "node:test";
import assert from "node:assert/strict";
import {
  stockStatus,
  productOptionPrompt,
  productPriceSummary,
} from "../lib/product-presentation.ts";
test("stock labels distinguish unknown, unavailable, low and normal inventory at boundaries", () => {
  for (const [inventory, kind, label] of [
    [null, "unknown", "Availability unavailable"],
    [-1, "out", "Out of Stock"],
    [0, "out", "Out of Stock"],
    [1, "low", "Low Stock (1 available)"],
    [2, "low", "Low Stock (2 available)"],
    [3, "in", "In Stock (3 available)"],
    [6, "in", "In Stock (6 available)"],
  ] as const)
    assert.deepEqual(stockStatus(inventory), {kind, label});
});

test("option prompts use metadata without guessing sizes from variant titles", () => {
  assert.equal(productOptionPrompt(["Size"]), "Choose a size");
  assert.equal(productOptionPrompt([" Color "]), "Choose a colour");
  assert.equal(productOptionPrompt(["Colour"]), "Choose a colour");
  assert.equal(productOptionPrompt(["Size", "Color"]), "Choose an option");
  assert.equal(productOptionPrompt(["Title"]), "Choose an option");
  assert.equal(productOptionPrompt(), "Choose an option");
});
test("price summaries reserve From for differing known prices", () => {
  const variants = (prices: (number | null)[]) =>
    prices.map((price, i) => ({
      id: String(i),
      title: "Option",
      price,
      inventory: 1,
    }));
  assert.deepEqual(productPriceSummary(variants([159, 159])), {
    price: 159,
    from: false,
  });
  assert.deepEqual(productPriceSummary(variants([159, 179])), {
    price: 159,
    from: true,
  });
  assert.deepEqual(productPriceSummary(variants([0, 0])), {
    price: 0,
    from: false,
  });
  assert.deepEqual(productPriceSummary(variants([null, 159])), {
    price: 159,
    from: false,
  });
  assert.deepEqual(productPriceSummary(variants([null])), {
    price: null,
    from: false,
  });
  assert.deepEqual(productPriceSummary([]), { price: null, from: false });
});
