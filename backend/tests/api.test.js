
require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const app = require("../src/app");
const pool = require("../src/config/db");

let server;
let baseUrl;

test.before(async () => {
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
  } finally {
    await pool.end();
  }
});

// Health API

test("GET /api/health returns a healthy response", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.status, "healthy");
  assert.equal(body.data.database, "connected");
});

// Product API

test("GET /api/products/abc rejects an invalid product ID", async () => {
  const response = await fetch(`${baseUrl}/api/products/abc`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_PRODUCT_ID");
});

test("GET /api/products/99999 returns product not found", async () => {
  const response = await fetch(`${baseUrl}/api/products/99999`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, "PRODUCT_NOT_FOUND");
});

// Order API

test("GET /api/orders/abc rejects an invalid order ID", async () => {
  const response = await fetch(`${baseUrl}/api/orders/abc`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_ORDER_ID");
});

test("GET /api/orders/99999 returns order not found", async () => {
  const response = await fetch(`${baseUrl}/api/orders/99999`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, "ORDER_NOT_FOUND");
});

// Checkout request lookup

test("GET /api/checkout-requests/unknown-key returns not found", async () => {
  const response = await fetch(
    `${baseUrl}/api/checkout-requests/unknown-key`
  );
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, "CHECKOUT_REQUEST_NOT_FOUND");
});

// Checkout validation

test("POST /api/checkout rejects an invalid product ID", async () => {
  const response = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `fg-${randomUUID()}`
    },
    body: JSON.stringify({ productId: 0 })
  });

  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_PRODUCT_ID");
});

test("POST /api/checkout rejects a missing idempotency key", async () => {
  const response = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ productId: 3 })
  });

  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_IDEMPOTENCY_KEY");
});

test("POST /api/checkout rejects an idempotency key containing spaces", async () => {
  const response = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "invalid key with spaces"
    },
    body: JSON.stringify({ productId: 3 })
  });

  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_IDEMPOTENCY_KEY");
});

// Malformed request body

test("POST /api/checkout rejects malformed JSON", async () => {
  const response = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `fg-${randomUUID()}`
    },
    body: '{"productId":'
  });

  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.equal(body.error.code, "INVALID_JSON");
  assert.equal(
    body.error.message,
    "Request body contains invalid JSON."
  );
  assert.ok(body.error.requestId);
});
