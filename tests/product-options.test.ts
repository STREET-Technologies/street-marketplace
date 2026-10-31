import test from "node:test";
import assert from "node:assert/strict";
import type { ProductDetail } from "../lib/contracts.ts";
import {
  buildOptionModel,
  chooseOption,
  defaultOptions,
  matchingOptions,
  optionLabels,
  selectedOptionVariant,
} from "../lib/product-options.ts";
const product = (
  options: NonNullable<ProductDetail["options"]>,
  titles: string[],
): ProductDetail => ({
  id: "product",
  title: "Test",
  description: null,
  images: [],
  options,
  variants: titles.map((title, i) => ({
    id: String(i + 1),
    title,
    price: 100 + i,
    inventory: i === 1 ? 0 : 3,
  })),
});
const apex = product(
  [
    { name: "Size", values: ["UK6 / EU40 / US7", "UK6.5 / EU40.5 / US8.5"] },
    { name: "Colour", values: ["Flat White"] },
  ],
  ["UK6 / EU40 / US7 / Flat White", "UK6.5 / EU40.5 / US8.5 / Flat White"],
);
test("compound size values resolve to original variant identity without splitting size equivalents", () => {
  const model = buildOptionModel(apex)!;
  assert.ok(model);
  const defaults = defaultOptions(model);
  assert.deepEqual(defaults, { Colour: "Flat White" });
  assert.equal(selectedOptionVariant(model, defaults), undefined);
  const chosen = chooseOption(
    model,
    defaults,
    "Size",
    apex.options![0].values[1],
  );
  assert.equal(selectedOptionVariant(model, chosen), apex.variants[1]);
  assert.equal(
    selectedOptionVariant(model, chosen)?.title,
    "UK6.5 / EU40.5 / US8.5 / Flat White",
  );
  assert.deepEqual(optionLabels(model.options[0]), {
    name: "Size (UK)",
    values: [
      { value: "UK6 / EU40 / US7", label: "6" },
      { value: "UK6.5 / EU40.5 / US8.5", label: "6.5" },
    ],
  });
});
test("independent selections distinguish same-size colours and retain price/stock", () => {
  const p = product(
    [
      { name: "Size", values: ["S", "M"] },
      { name: "Color", values: ["Red", "Blue"] },
    ],
    ["S / Red", "S / Blue", "M / Red"],
  );
  const m = buildOptionModel(p)!;
  assert.deepEqual(defaultOptions(m), {});
  let v = chooseOption(m, {}, "Color", "Red");
  assert.equal(selectedOptionVariant(m, v), undefined);
  v = chooseOption(m, v, "Size", "S");
  assert.equal(selectedOptionVariant(m, v)?.id, "1");
  v = chooseOption(m, v, "Color", "Blue");
  assert.equal(selectedOptionVariant(m, v)?.id, "2");
  assert.equal(selectedOptionVariant(m, v)?.inventory, 0);
  assert.equal(selectedOptionVariant(m, v)?.price, 101);
  // Blue/M doesn't exist: changing colour must clear the stale size.
  assert.deepEqual(
    chooseOption(m, { Size: "M", Color: "Red" }, "Color", "Blue"),
    { Color: "Blue" },
  );
  assert.equal(matchingOptions(m, { Size: "S" }).length, 2);
});
test("single-value options resolve automatically only to a unique real variant", () => {
  const m = buildOptionModel(
    product(
      [
        { name: "Size", values: ["One Size"] },
        { name: "Colour", values: ["Black"] },
      ],
      ["One Size / Black"],
    ),
  )!;
  assert.equal(selectedOptionVariant(m, defaultOptions(m))?.id, "1");
});
test("incomplete metadata and mismatched or duplicate variants use original choices", () => {
  assert.equal(buildOptionModel(product([], ["M"])), null);
  assert.equal(
    buildOptionModel(product([{ name: "Size", values: [] }], ["M"])),
    null,
  );
  assert.equal(
    buildOptionModel(product([{ name: "Size", values: ["M"] }], ["Large"])),
    null,
  );
  assert.equal(
    buildOptionModel(product([{ name: "Size", values: ["M"] }], ["M", "M"])),
    null,
  );
  assert.equal(
    buildOptionModel(
      product(
        [
          { name: "Size", values: ["M"] },
          { name: "Size", values: ["Red"] },
        ],
        ["M / Red"],
      ),
    ),
    null,
  );
});
test("ambiguous slash-containing options never pick the first apparent match", () => {
  assert.equal(
    buildOptionModel(
      product(
        [
          { name: "A", values: ["X", "X / Y"] },
          { name: "B", values: ["Y / Z", "Z"] },
        ],
        ["X / Y / Z"],
      ),
    ),
    null,
  );
});
test("UK display needs explicit consistent unique equivalents; never converts retailer sizes", () => {
  for (const values of [
    ["6", "7"],
    ["EU40", "EU41"],
    ["UK6 / EU40 / US7", "7"],
    ["UK6 / EU40 / US7", "UK6 / EU41 / US8"],
    ["UK6 / Unknown"],
  ]) {
    const result = optionLabels({ name: "Size", values });
    assert.equal(result.name, "Size");
    assert.deepEqual(
      result.values.map((v) => v.label),
      values,
    );
  }
  assert.equal(
    optionLabels({ name: "Color", values: ["Blue"] }).name,
    "Colour",
  );
  assert.equal(optionLabels({ name: "Fit", values: ["Regular"] }).name, "Fit");
});
