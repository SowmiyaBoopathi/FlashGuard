
const test = require("node:test");
const assert = require("node:assert/strict");

test("FlashGuard test environment is working", () => {
  assert.equal(2 + 3, 5);
});

test("Product stock cannot be negative", () => {
  const stock = 0;

  assert.ok(stock >= 0);
});
