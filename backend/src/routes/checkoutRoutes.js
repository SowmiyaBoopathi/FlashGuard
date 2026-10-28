
const express = require("express");
const { randomUUID } = require("crypto");
const { checkout } = require("../services/checkoutService");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const productId = req.body?.productId;
    const idempotencyKey = req.get("Idempotency-Key");

    if (
      !Number.isSafeInteger(productId) ||
      productId <= 0
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_PRODUCT_ID",
          message: "productId must be a positive integer."
        },
        requestId: req.requestId
      });
    }

    if (
      typeof idempotencyKey !== "string" ||
      idempotencyKey.length < 1 ||
      idempotencyKey.length > 128 ||
      !/^[a-zA-Z0-9_-]+$/.test(idempotencyKey)
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_IDEMPOTENCY_KEY",
          message: "Provide a valid Idempotency-Key header."
        },
        requestId: req.requestId
      });
    }

    const result = await checkout(productId, idempotencyKey);

    return res.status(result.httpStatus).json({
      ...result.body,
      requestId: req.requestId || randomUUID()
    });
    } catch (error) {
    next(error);
  }
});

module.exports = router;
