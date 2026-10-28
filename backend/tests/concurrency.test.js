
require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const app = require("../src/app");
const pool = require("../src/config/db");

const INITIAL_STOCK = 5;
const REQUEST_COUNT = 20;
const BOUNDARY_STOCK = 1;
const BOUNDARY_REQUEST_COUNT = 10;

let server;
let baseUrl;
let productId;
let boundaryProductId;

const testPrefix = `FG_CONCURRENCY_${randomUUID()}`;

async function createTestProduct(stock, suffix) {
  const [result] = await pool.execute(
    `INSERT INTO products
      (product_name, price, stock, sale_status)
     VALUES (?, ?, ?, 'ACTIVE')`,
    [`${testPrefix}_${suffix}`, 100, stock]
  );

  return result.insertId;
}

async function sendCheckout(targetProductId, key) {
  const response = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key
    },
    body: JSON.stringify({ productId: targetProductId })
  });

  return {
    status: response.status,
    body: await response.json()
  };
}

async function cleanupTestProduct(targetProductId) {
  if (targetProductId === undefined) return;

  const [requests] = await pool.execute(
    `SELECT idempotency_key
     FROM checkout_requests
     WHERE product_id = ?`,
    [targetProductId]
  );

  for (const request of requests) {
    await pool.execute(
      `UPDATE checkout_requests
       SET order_id = NULL
       WHERE idempotency_key = ?`,
      [request.idempotency_key]
    );

    await pool.execute(
      `DELETE FROM orders
       WHERE idempotency_key = ?`,
      [request.idempotency_key]
    );

    await pool.execute(
      `DELETE FROM checkout_requests
       WHERE idempotency_key = ?`,
      [request.idempotency_key]
    );
  }

  await pool.execute(
    "DELETE FROM products WHERE id = ?",
    [targetProductId]
  );
}

test.before(async () => {
  productId = await createTestProduct(INITIAL_STOCK, "FIVE_UNIT");

  server = app.listen(0);

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });

        server.closeAllConnections();
      });
    }

    for (const id of [productId, boundaryProductId]) {
      if (id !== undefined) {
        await cleanupTestProduct(id);
      }
    }
  } finally {
    await pool.end();
  }
});

test("20 concurrent checkouts cannot oversell 5 units", async () => {
  const keys = Array.from(
    { length: REQUEST_COUNT },
    () => `fg-five-${randomUUID()}`
  );

  const results = await Promise.all(
    keys.map((key) => sendCheckout(productId, key))
  );

  const confirmed = results.filter(
    (result) =>
      result.status === 201 &&
      result.body.success === true &&
      result.body.data.status === "CONFIRMED"
  );

  const soldOut = results.filter(
    (result) =>
      result.status === 409 &&
      result.body.success === false &&
      result.body.error.code === "SOLD_OUT"
  );

  assert.equal(results.length, REQUEST_COUNT);
  assert.equal(confirmed.length, INITIAL_STOCK);
  assert.equal(soldOut.length, REQUEST_COUNT - INITIAL_STOCK);

  const [products] = await pool.execute(
    "SELECT stock FROM products WHERE id = ?",
    [productId]
  );

  assert.equal(products.length, 1);
  assert.equal(Number(products[0].stock), 0);
  assert.ok(Number(products[0].stock) >= 0);

  const [orders] = await pool.execute(
    `SELECT id, idempotency_key
     FROM orders
     WHERE product_id = ?`,
    [productId]
  );

  assert.equal(orders.length, INITIAL_STOCK);
  assert.equal(
    new Set(orders.map((order) => order.idempotency_key)).size,
    INITIAL_STOCK
  );

  const [requests] = await pool.execute(
    `SELECT request_status
     FROM checkout_requests
     WHERE product_id = ?`,
    [productId]
  );

  assert.equal(requests.length, REQUEST_COUNT);
  assert.equal(
    requests.filter((request) => request.request_status === "CONFIRMED").length,
    INITIAL_STOCK
  );
  assert.equal(
    requests.filter((request) => request.request_status === "SOLD_OUT").length,
    REQUEST_COUNT - INITIAL_STOCK
  );
});

test("10 concurrent checkouts cannot oversell 1 unit", async () => {
  boundaryProductId = await createTestProduct(
    BOUNDARY_STOCK,
    "BOUNDARY"
  );

  const keys = Array.from(
    { length: BOUNDARY_REQUEST_COUNT },
    () => `fg-boundary-${randomUUID()}`
  );

  const results = await Promise.all(
    keys.map((key) => sendCheckout(boundaryProductId, key))
  );

  const confirmed = results.filter(
    (result) =>
      result.status === 201 &&
      result.body.success === true &&
      result.body.data.status === "CONFIRMED"
  );

  const soldOut = results.filter(
    (result) =>
      result.status === 409 &&
      result.body.success === false &&
      result.body.error.code === "SOLD_OUT"
  );

  assert.equal(results.length, BOUNDARY_REQUEST_COUNT);
  assert.equal(confirmed.length, BOUNDARY_STOCK);
  assert.equal(
    soldOut.length,
    BOUNDARY_REQUEST_COUNT - BOUNDARY_STOCK
  );

  const [products] = await pool.execute(
    "SELECT stock FROM products WHERE id = ?",
    [boundaryProductId]
  );

  assert.equal(products.length, 1);
  assert.equal(Number(products[0].stock), 0);
  assert.ok(Number(products[0].stock) >= 0);

  const [orders] = await pool.execute(
    `SELECT idempotency_key
     FROM orders
     WHERE product_id = ?`,
    [boundaryProductId]
  );

  assert.equal(orders.length, 1);
  assert.equal(
    new Set(orders.map((order) => order.idempotency_key)).size,
    1
  );

  const [requests] = await pool.execute(
    `SELECT request_status
     FROM checkout_requests
     WHERE product_id = ?`,
    [boundaryProductId]
  );

  assert.equal(requests.length, BOUNDARY_REQUEST_COUNT);
  assert.equal(
    requests.filter((request) => request.request_status === "CONFIRMED").length,
    1
  );
  assert.equal(
    requests.filter((request) => request.request_status === "SOLD_OUT").length,
    BOUNDARY_REQUEST_COUNT - 1
  );
});
