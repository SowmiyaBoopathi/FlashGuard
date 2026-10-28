
const express = require("express");
const pool = require("../config/db");

const router = express.Router();

router.get("/:id", async (req, res, next) => {
  const productId = req.params.id;

  // Validate the product ID before querying MySQL.
  if (!/^[1-9]\d*$/.test(productId)) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_PRODUCT_ID",
        message: "Product ID must be a positive integer."
      },
      requestId: req.requestId
    });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, product_name, price, stock, sale_status
       FROM products
       WHERE id = ?`,
      [productId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: "PRODUCT_NOT_FOUND",
          message: "Product not found."
        },
        requestId: req.requestId
      });
    }

    const product = rows[0];

    return res.status(200).json({
      success: true,
      data: {
        id: product.id,
        product_name: product.product_name,
        price: Number(product.price),
        stock: product.stock,
        sale_status: product.sale_status
      },
      requestId: req.requestId
    });
  } catch (error) {
    return next(error);
  }
});


module.exports = router;
