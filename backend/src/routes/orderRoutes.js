
const express = require("express");
const pool = require("../config/db");

const router = express.Router();

router.get("/:id", async (req, res, next) => {
  const orderId = req.params.id;

  // Validate the order ID before querying the database.
  if (!/^[1-9]\d*$/.test(orderId)) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_ORDER_ID",
        message: "Order ID must be a positive integer."
      },
      requestId: req.requestId
    });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT
          o.id,
          o.product_id,
          p.product_name,
          o.quantity,
          o.order_status,
          o.idempotency_key,
          o.created_at
       FROM orders o
       INNER JOIN products p ON p.id = o.product_id
       WHERE o.id = ?`,
      [orderId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: "ORDER_NOT_FOUND",
          message: "Order not found."
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
