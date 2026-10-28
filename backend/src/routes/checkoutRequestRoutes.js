
const express = require("express");
const pool = require("../config/db");

const router = express.Router();

router.get("/:key", async (req, res, next) => {
  const idempotencyKey = req.params.key;

  if (
    !idempotencyKey ||
    idempotencyKey.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(idempotencyKey)
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "A valid idempotency key is required."
      },
      requestId: req.requestId
    });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT
          idempotency_key,
          product_id,
          request_status,
          order_id,
          created_at,
          updated_at
       FROM checkout_requests
       WHERE idempotency_key = ?`,
      [idempotencyKey]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: "CHECKOUT_REQUEST_NOT_FOUND",
          message: "Checkout request not found."
        },
        requestId: req.requestId
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
      requestId: req.requestId
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
