
require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const { checkout } = require("../src/services/checkoutService");
const pool = require("../src/config/db");

test("checkout retries a deadlock and creates exactly one order", async () => {
  const suffix = randomUUID();
  const productName = `FG_RETRY_${suffix}`;
  const idempotencyKey = `fg-retry-${suffix}`;

  let productId;
  let deadlockInjected = false;
  let attemptsAtLockedQuery = 0;

  const originalGetConnection = pool.getConnection;

  try {
    const [insertResult] = await pool.execute(
      `INSERT INTO products
        (product_name, price, stock, sale_status)
       VALUES (?, ?, 1, 'ACTIVE')`,
      [productName, 100]
    );

    productId = insertResult.insertId;

    pool.getConnection = async function (...args) {
      const connection = await originalGetConnection.apply(this, args);
      const originalExecute = connection.execute;

      connection.execute = async function (sql, params) {
        if (typeof sql === "string" && sql.includes("FOR UPDATE")) {
          attemptsAtLockedQuery++;

          if (!deadlockInjected) {
            deadlockInjected = true;

            const error = new Error("Simulated transient deadlock");
            error.code = "ER_LOCK_DEADLOCK";
            throw error;
          }
        }

        return originalExecute.call(this, sql, params);
      };

      return connection;
    };

    const result = await checkout(productId, idempotencyKey);

    assert.equal(deadlockInjected, true);
    assert.equal(attemptsAtLockedQuery, 2);
    assert.equal(result.httpStatus, 201);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.status, "CONFIRMED");

    const [products] = await pool.execute(
      "SELECT stock FROM products WHERE id = ?",
      [productId]
    );
    assert.equal(Number(products[0].stock), 0);

    const [orders] = await pool.execute(
      "SELECT id FROM orders WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    assert.equal(orders.length, 1);

    const [requests] = await pool.execute(
      `SELECT request_status, order_id
       FROM checkout_requests
       WHERE idempotency_key = ?`,
      [idempotencyKey]
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].request_status, "CONFIRMED");
    assert.ok(requests[0].order_id);
  } finally {
    pool.getConnection = originalGetConnection;

    if (productId !== undefined) {
      await pool.execute(
        `UPDATE checkout_requests SET order_id = NULL
         WHERE product_id = ?`,
        [productId]
      );
      await pool.execute(
        "DELETE FROM orders WHERE product_id = ?",
        [productId]
      );
      await pool.execute(
        "DELETE FROM checkout_requests WHERE product_id = ?",
        [productId]
      );
      await pool.execute(
        "DELETE FROM products WHERE id = ?",
        [productId]
      );
    }
  }
});

test("checkout stops after three consecutive deadlocks", async () => {
  const suffix = randomUUID();
  const productName = `FG_RETRY_LIMIT_${suffix}`;
  const idempotencyKey = `fg-retry-limit-${suffix}`;

  let productId;
  let deadlockCount = 0;
  const originalGetConnection = pool.getConnection;

  try {
    const [insertResult] = await pool.execute(
      `INSERT INTO products
        (product_name, price, stock, sale_status)
       VALUES (?, ?, 1, 'ACTIVE')`,
      [productName, 100]
    );

    productId = insertResult.insertId;

    pool.getConnection = async function (...args) {
      const connection = await originalGetConnection.apply(this, args);
      const originalExecute = connection.execute;

      connection.execute = async function (sql, params) {
        if (typeof sql === "string" && sql.includes("FOR UPDATE")) {
          deadlockCount++;

          const error = new Error("Simulated persistent deadlock");
          error.code = "ER_LOCK_DEADLOCK";
          throw error;
        }

        return originalExecute.call(this, sql, params);
      };

      return connection;
    };

    await assert.rejects(
      checkout(productId, idempotencyKey),
      (error) => {
        assert.equal(error.code, "ER_LOCK_DEADLOCK");
        return true;
      }
    );

    assert.equal(deadlockCount, 3);

    const [products] = await pool.execute(
      "SELECT stock FROM products WHERE id = ?",
      [productId]
    );
    assert.equal(Number(products[0].stock), 1);

    const [orders] = await pool.execute(
      "SELECT id FROM orders WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    assert.equal(orders.length, 0);

    const [requests] = await pool.execute(
      "SELECT id FROM checkout_requests WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    assert.equal(requests.length, 0);
  } finally {
    pool.getConnection = originalGetConnection;

    if (productId !== undefined) {
      await pool.execute(
        `UPDATE checkout_requests SET order_id = NULL
         WHERE product_id = ?`,
        [productId]
      );
      await pool.execute(
        "DELETE FROM orders WHERE product_id = ?",
        [productId]
      );
      await pool.execute(
        "DELETE FROM checkout_requests WHERE product_id = ?",
        [productId]
      );
      await pool.execute(
        "DELETE FROM products WHERE id = ?",
        [productId]
      );
    }
  }
});

test.after(async () => {
  await pool.end();
});
