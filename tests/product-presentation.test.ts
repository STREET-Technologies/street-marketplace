import test from "node:test";
import assert from "node:assert/strict";
import {
  stockLabel,
  productOptionPrompt,
  productPriceSummary,
} from "../lib/product-presentation.ts";
test("stock labels distinguish unknown, unavailable, low and normal inventory at boundaries", () => {
  for (const [inventory, expected] of [
    [null, "Availability unavailable"],
    [0, "Out of Stock"],
    [1, "Low Stock (1)"],
    [2, "Low Stock (2)"],
    [3, "In Stock (3)"],
    [6, "In Stock (6)"],
  ] as const)
    assert.equal(stockLabel(inventory), expected);
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
