
require("dotenv").config();

const pool = require("../src/config/db");

const TEST_PRODUCT_IDS = process.env.TEST_PRODUCT_IDS
  ? process.env.TEST_PRODUCT_IDS.split(",").map((value) => Number(value.trim()))
  : [];

if (
  TEST_PRODUCT_IDS.length === 0 ||
  TEST_PRODUCT_IDS.some(
    (id) => !Number.isSafeInteger(id) || id <= 0
  ) ||
  new Set(TEST_PRODUCT_IDS).size !== TEST_PRODUCT_IDS.length
) {
  throw new Error(
    "Set TEST_PRODUCT_IDS to unique, positive product IDs. No cleanup performed."
  );
}
const REQUIRED_PREFIX = "FG_K6_TEST_";

async function main() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const placeholders = TEST_PRODUCT_IDS.map(() => "?").join(", ");

    const [products] = await connection.execute(
      `SELECT id, product_name
       FROM products
       WHERE id IN (${placeholders})
       FOR UPDATE`,
      TEST_PRODUCT_IDS
    );

    // Validate every product before deleting any records.
    if (products.length !== TEST_PRODUCT_IDS.length) {
      throw new Error("Expected all three temporary products. No cleanup performed.");
    }

    for (const product of products) {
      if (!product.product_name.startsWith(REQUIRED_PREFIX)) {
        throw new Error(
          `Safety check failed for product ${product.id}. No cleanup performed.`
        );
      }
    }

    for (const product of products) {
      const id = product.id;

      // Clear the circular order reference before deleting orders.
      await connection.execute(
        `UPDATE checkout_requests
         SET order_id = NULL
         WHERE product_id = ?`,
        [id]
      );

      await connection.execute(
        "DELETE FROM orders WHERE product_id = ?",
        [id]
      );

      await connection.execute(
        "DELETE FROM checkout_requests WHERE product_id = ?",
        [id]
      );

      await connection.execute(
        "DELETE FROM products WHERE id = ?",
        [id]
      );

      console.log(`Cleaned temporary product ${id}`);
    }

    await connection.commit();
    console.log("Cleanup committed successfully.");
  } catch (error) {
    await connection.rollback();
    console.error("Cleanup aborted and rolled back:", error.message);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
