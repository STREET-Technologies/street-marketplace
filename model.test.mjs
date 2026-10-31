import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addToBag, bagTotal, bagCount, filterProducts } from './model.mjs';
test('bag combines identical sizes, keeps variants separate, and totals in pennies', () => {
  let { bag } = addToBag([], 'knit', 'M');
  bag = addToBag(bag, 'knit', 'M').bag;
  bag = addToBag(bag, 'knit', 'L').bag;
  assert.equal(bag.length, 2); assert.equal(bagCount(bag), 3); assert.equal(bagTotal(bag), 20400);
});
test('switching shops requires an explicit replacement and preserves the old bag', () => {
  const { bag } = addToBag([], 'knit', 'M');
  assert.equal(addToBag(bag, 'chair', 'One size').conflict, true);
  assert.equal(bagCount(bag), 1);
  const replaced = addToBag(bag, 'chair', 'One size', true).bag;
  assert.equal(replaced.length, 1); assert.equal(replaced[0].shop, 'objects');
});
test('unavailable variants cannot be added', () => assert.throws(() => addToBag([], 'knit', 'XXL')));
test('search, category, shop and saved filters intersect; price sorting is numeric', () => {
  assert.equal(filterProducts({ query: 'KNIT', category: 'Clothing', shop: 'wardrobe', saved: new Set(['knit']) }).length, 1);
  assert.equal(filterProducts({ query: 'knit', category: 'Home' }).length, 0);
  assert.equal(filterProducts({ saved: new Set() }).length, 0);
  assert.equal(filterProducts({ sort: 'low' })[0].id, 'jewellery');
});
