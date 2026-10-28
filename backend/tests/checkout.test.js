
require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const app = require("../src/app");
const pool = require("../src/config/db");

let server;
let baseUrl;

let productA;
let productB;
let productC;
let productD;

const productIds = [];

async function createTestProduct(productName, stock = 1) {
  const [result] = await pool.execute(
    `INSERT INTO products
       (product_name, price, stock, sale_status)
     VALUES (?, ?, ?, ?)`,
    [productName, 100, stock, "ACTIVE"]
  );

  productIds.push(result.insertId);
  return result.insertId;
}

async function checkout(productId, idempotencyKey) {
  const response = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      productId,
      quantity: 1,
    }),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

async function getProductStock(productId) {
  const [rows] = await pool.execute(
    "SELECT stock FROM products WHERE id = ?",
    [productId]
  );

  assert.equal(rows.length, 1, `Product ${productId} should exist`);
  return Number(rows[0].stock);
}

test.before(async () => {
  const prefix = `FG_TEST_${randomUUID()}`;

  productA = await createTestProduct(`${prefix}_A`);
  productB = await createTestProduct(`${prefix}_B`);
  productC = await createTestProduct(`${prefix}_C`);
  productD = await createTestProduct(`${prefix}_D`);

  server = app.listen(0);

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});



test.after(async () => {
  try {
    if (productIds.length > 0) {
      const placeholders = productIds.map(() => "?").join(", ");

      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        await connection.execute(
          `UPDATE checkout_requests
           SET order_id = NULL
           WHERE product_id IN (${placeholders})`,
          productIds
        );

        await connection.execute(
          `DELETE FROM orders
           WHERE product_id IN (${placeholders})`,
          productIds
        );

        await connection.execute(
          `DELETE FROM checkout_requests
           WHERE product_id IN (${placeholders})`,
          productIds
        );

        await connection.execute(
          `DELETE FROM products
           WHERE id IN (${placeholders})`,
          productIds
        );

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  } finally {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    await pool.end();
  }
});

test("a valid checkout confirms an order and reduces stock", async () => {
  const key = `fg-${randomUUID()}`;
  const response = await checkout(productA, key);

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.status, "CONFIRMED");
  assert.ok(response.body.data.orderId);

  assert.equal(await getProductStock(productA), 0);

  const [orders] = await pool.execute(
    "SELECT id, product_id, order_status FROM orders WHERE idempotency_key = ?",
    [key]
  );

  assert.equal(orders.length, 1);
  assert.equal(Number(orders[0].product_id), Number(productA));
  assert.equal(orders[0].order_status, "CONFIRMED");
});

test("retrying the same idempotency key does not create another order", async () => {
  const key = `fg-${randomUUID()}`;

  const first = await checkout(productB, key);
  const second = await checkout(productB, key);

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(
    String(first.body.data.orderId),
    String(second.body.data.orderId)
  );

  assert.equal(await getProductStock(productB), 0);

  const [orders] = await pool.execute(
    "SELECT id FROM orders WHERE idempotency_key = ?",
    [key]
  );

  assert.equal(orders.length, 1);
});

test("reusing an idempotency key for another product returns a conflict", async () => {
  const key = `fg-${randomUUID()}`;

  const first = await checkout(productC, key);

  assert.equal(first.status, 201);
  assert.equal(first.body.success, true);
  assert.equal(first.body.data.status, "CONFIRMED");

  const conflict = await checkout(productB, key);

  assert.equal(conflict.status, 409);
  assert.equal(
    conflict.body.error.code,
    "IDEMPOTENCY_KEY_CONFLICT"
  );

  // The key must still belong to the original order.
  const [orders] = await pool.execute(
    `SELECT id, product_id, order_status
     FROM orders
     WHERE idempotency_key = ?`,
    [key]
  );

  assert.equal(orders.length, 1);
  assert.equal(Number(orders[0].product_id), Number(productC));
  assert.equal(
    String(orders[0].id),
    String(first.body.data.orderId)
  );
  assert.equal(orders[0].order_status, "CONFIRMED");

  // The original product was purchased; the conflicting product was not.
  assert.equal(await getProductStock(productC), 0);
  assert.equal(await getProductStock(productB), 0);

  // Check the idempotency record using the actual schema.
  const [requests] = await pool.execute(
    `SELECT idempotency_key, product_id, request_status, order_id
     FROM checkout_requests
     WHERE idempotency_key = ?`,
    [key]
  );

  assert.equal(requests.length, 1);
  assert.equal(Number(requests[0].product_id), Number(productC));
  assert.equal(requests[0].request_status, "CONFIRMED");
  assert.equal(
    String(requests[0].order_id),
    String(first.body.data.orderId)
  );
});

test("checkout fails when the product is sold out", async () => {
  const key = `fg-${randomUUID()}`;

  // productA was purchased by the first test.
  assert.equal(await getProductStock(productA), 0);

  const response = await checkout(productA, key);

  assert.equal(response.status, 409);
  assert.equal(await getProductStock(productA), 0);
});

test("checkout fails when the sale has not started", async () => {
  await pool.execute(
    "UPDATE products SET sale_status = ? WHERE id = ?",
    ["UPCOMING", productD]
  );

  const response = await checkout(productD, `fg-${randomUUID()}`);

  assert.equal(response.status, 409);
  assert.equal(await getProductStock(productD), 1);
});




test("concurrent retries with the same key create only one order", async () => {
  // Restore this test-only product before starting concurrent requests.
  await pool.execute(
    "UPDATE products SET stock = 1, sale_status = 'ACTIVE' WHERE id = ?",
    [productD]
  );

  const key = `fg-${randomUUID()}`;

  const responses = await Promise.all(
    Array.from({ length: 10 }, () => checkout(productD, key))
  );

  console.log(
    "Concurrent response summary:",
    responses.map((response) => ({
      status: response.status,
      code: response.body.error?.code,
    }))
  );

  const [orders] = await pool.execute(
    `SELECT id, product_id, order_status
     FROM orders
     WHERE idempotency_key = ?`,
    [key]
  );

  assert.equal(orders.length, 1);
  assert.equal(Number(orders[0].product_id), Number(productD));
  assert.equal(orders[0].order_status, "CONFIRMED");
  assert.equal(await getProductStock(productD), 0);
});




test("a failed database transaction rolls back the stock update", async () => {
  // This product belongs only to this test suite.
  await pool.execute(
    "UPDATE products SET stock = 1, sale_status = 'ACTIVE' WHERE id = ?",
    [productD]
  );

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [result] = await connection.execute(
      `UPDATE products
       SET stock = stock - 1
       WHERE id = ? AND stock > 0`,
      [productD]
    );

    assert.equal(result.affectedRows, 1);

    // Deliberately cause a SQL error to verify rollback.
    await assert.rejects(
      connection.execute(
        "SELECT * FROM table_that_does_not_exist"
      )
    );

    await connection.rollback();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  assert.equal(await getProductStock(productD), 1);
});
