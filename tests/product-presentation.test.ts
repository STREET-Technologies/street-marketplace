import test from "node:test";
import assert from "node:assert/strict";
import { stockLabel } from "../lib/product-presentation.ts";
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
