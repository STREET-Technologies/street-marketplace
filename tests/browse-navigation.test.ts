import test from "node:test";
import assert from "node:assert/strict";
import { resultsScrollTarget } from "../lib/browse-navigation.ts";

test("filtered results clear the sticky header without moving an already visible result set", () => {
  assert.equal(resultsScrollTarget(-102, 166, 900, 450), 158);
  assert.equal(resultsScrollTarget(150, 166, 900, 450), 410);
  assert.equal(resultsScrollTarget(190, 166, 900, 158), null);
  assert.equal(resultsScrollTarget(400, 166, 900, 0), null);
  assert.equal(resultsScrollTarget(950, 166, 900, 0), 760);
  assert.equal(resultsScrollTarget(100, 166, 900, 0), 0);
});
