
const pool = require("../config/db");

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 50;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableError(error) {
  return [
    "ER_LOCK_DEADLOCK",
    "ER_LOCK_WAIT_TIMEOUT"
  ].includes(error.code);
}

function createError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function getCheckoutResult(idempotencyKey, productId) {
  const [rows] = await pool.execute(
    `SELECT product_id, request_status, order_id
     FROM checkout_requests
     WHERE idempotency_key = ?`,
    [idempotencyKey]
  );

  if (rows.length === 0) {
    return null;
  }

  const existing = rows[0];

  if (Number(existing.product_id) !== Number(productId)) {
    throw createError(
      "This idempotency key was already used for another product.",
      409,
      "IDEMPOTENCY_KEY_CONFLICT"
    );
  }

  switch (existing.request_status) {
    case "CONFIRMED":
      return {
        httpStatus: 201,
        body: {
          success: true,
          data: {
            status: "CONFIRMED",
            orderId: existing.order_id
          }
        }
      };

    case "SOLD_OUT":
      return {
        httpStatus: 409,
        body: {
          success: false,
          error: {
            code: "SOLD_OUT",
            message: "The product is sold out."
          }
        }
      };

    case "UNAVAILABLE":
      return {
        httpStatus: 409,
        body: {
          success: false,
          error: {
            code: "SALE_UNAVAILABLE",
            message: "The sale is not currently available."
          }
        }
      };

    default:
      throw createError(
        "The previous checkout result could not be confirmed.",
        503,
        "CHECKOUT_RECONCILIATION_FAILED"
      );
  }
}

async function executeCheckout(productId, idempotencyKey) {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const [products] = await connection.execute(
      `SELECT id, stock, sale_status
       FROM products
       WHERE id = ?
       FOR UPDATE`,
      [productId]
    );

    if (products.length === 0) {
      throw createError(
        "Product not found.",
        404,
        "PRODUCT_NOT_FOUND"
      );
    }

    const product = products[0];

    await connection.execute(
      `INSERT INTO checkout_requests
        (idempotency_key, product_id, request_status)
       VALUES (?, ?, 'PROCESSING')`,
      [idempotencyKey, productId]
    );

    if (product.sale_status !== "ACTIVE") {
      await connection.execute(
        `UPDATE checkout_requests
         SET request_status = 'UNAVAILABLE'
         WHERE idempotency_key = ?`,
        [idempotencyKey]
      );

      await connection.commit();
      transactionStarted = false;

      return {
        httpStatus: 409,
        body: {
          success: false,
          error: {
            code: "SALE_UNAVAILABLE",
            message: "The sale is not currently available."
          }
        }
      };
    }

    if (Number(product.stock) <= 0) {
      await connection.execute(
        `UPDATE checkout_requests
         SET request_status = 'SOLD_OUT'
         WHERE idempotency_key = ?`,
        [idempotencyKey]
      );

      await connection.commit();
      transactionStarted = false;

      return {
        httpStatus: 409,
        body: {
          success: false,
          error: {
            code: "SOLD_OUT",
            message: "The product is sold out."
          }
        }
      };
    }

    const [updateResult] = await connection.execute(
      `UPDATE products
       SET stock = stock - 1
       WHERE id = ?
         AND stock > 0
         AND sale_status = 'ACTIVE'`,
      [productId]
    );

    if (updateResult.affectedRows !== 1) {
      throw createError(
        "Inventory update could not be completed.",
        503,
        "INVENTORY_UPDATE_FAILED"
      );
    }

    const [orderResult] = await connection.execute(
      `INSERT INTO orders
        (product_id, quantity, order_status, idempotency_key)
       VALUES (?, 1, 'CONFIRMED', ?)`,
      [productId, idempotencyKey]
    );

    const orderId = orderResult.insertId;

    const [requestResult] = await connection.execute(
      `UPDATE checkout_requests
       SET request_status = 'CONFIRMED',
           order_id = ?
       WHERE idempotency_key = ?
         AND request_status = 'PROCESSING'`,
      [orderId, idempotencyKey]
    );

    if (requestResult.affectedRows !== 1) {
      throw createError(
        "Checkout request could not be finalized.",
        503,
        "CHECKOUT_FINALIZATION_FAILED"
      );
    }

    await connection.commit();
    transactionStarted = false;

    return {
      httpStatus: 201,
      body: {
        success: true,
        data: {
          status: "CONFIRMED",
          orderId
        }
      }
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Transaction rollback failed:", {
          code: rollbackError.code,
          message: rollbackError.message
        });
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function checkout(productId, idempotencyKey) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await executeCheckout(productId, idempotencyKey);
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        const existing = await getCheckoutResult(
          idempotencyKey,
          productId
        );

        if (existing) {
          return existing;
        }

        throw createError(
          "Checkout could not be reconciled.",
          503,
          "CHECKOUT_RECONCILIATION_FAILED"
        );
      }

      if (error.code === "ER_NO_REFERENCED_ROW_2") {
        throw createError(
          "Product not found.",
          404,
          "PRODUCT_NOT_FOUND"
        );
      }

      if (
        !isRetryableError(error) ||
        attempt === MAX_RETRIES
      ) {
        throw error;
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  throw createError(
    "Checkout could not be completed.",
    503,
    "CHECKOUT_FAILED"
  );
}

module.exports = { checkout };
