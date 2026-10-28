
require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const { checkout } = require("../src/services/checkoutService");
const pool = require("../src/config/db");

test("checkout rolls back when order creation fails", async () => {
  const suffix = randomUUID();
  const productName = `FG_ROLLBACK_${suffix}`;
  const idempotencyKey = `fg-rollback-${suffix}`;

  let productId;
  const originalGetConnection = pool.getConnection;
  let injectedFailure = false;

  try {
    // Create a dedicated product for this test.
    const [insertResult] = await pool.execute(
      `INSERT INTO products
        (product_name, price, stock, sale_status)
       VALUES (?, ?, 1, 'ACTIVE')`,
      [productName, 100]
    );

    productId = insertResult.insertId;

    // Inject a failure when the service attempts to create an order.
    pool.getConnection = async function (...args) {
      const connection = await originalGetConnection.apply(this, args);
      const originalExecute = connection.execute;

      connection.execute = async function (sql, params) {
        if (
          !injectedFailure &&
          typeof sql === "string" &&
          sql.includes("INSERT INTO orders")
        ) {
          injectedFailure = true;

          const error = new Error("Injected order creation failure");
          error.code = "ER_TEST_INJECTED_FAILURE";
          throw error;
        }

        return originalExecute.call(this, sql, params);
      };

      return connection;
    };

    await assert.rejects(
      checkout(productId, idempotencyKey),
      (error) => {
        assert.equal(error.code, "ER_TEST_INJECTED_FAILURE");
        return true;
      }
    );

    assert.equal(injectedFailure, true);

    // Verify stock was restored by the transaction rollback.
    const [products] = await pool.execute(
      "SELECT stock FROM products WHERE id = ?",
      [productId]
    );

    assert.equal(products.length, 1);
    assert.equal(Number(products[0].stock), 1);

    // Verify no order was created.
    const [orders] = await pool.execute(
      "SELECT id FROM orders WHERE idempotency_key = ?",
      [idempotencyKey]
    );

    assert.equal(orders.length, 0);

    // Verify the checkout request was rolled back too.
    const [requests] = await pool.execute(
      "SELECT id FROM checkout_requests WHERE idempotency_key = ?",
      [idempotencyKey]
    );

    assert.equal(requests.length, 0);
  } finally {
    // Restore the shared pool method before cleanup.
    pool.getConnection = originalGetConnection;

    if (productId !== undefined) {
      // Respect the circular foreign-key relationship.
      await pool.execute(
        `UPDATE checkout_requests
         SET order_id = NULL
         WHERE product_id = ?`,
        [productId]
      );

      await pool.execute(
        `DELETE FROM orders
         WHERE product_id = ?`,
        [productId]
      );

      await pool.execute(
        `DELETE FROM checkout_requests
         WHERE product_id = ?`,
        [productId]
      );

      await pool.execute(
        "DELETE FROM products WHERE id = ?",
        [productId]
      );
    }
  }
});

// Close the pool so Node's test process can exit.
test.after(async () => {
  await pool.end();
});
