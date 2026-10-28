
require("dotenv").config();

const { randomUUID } = require("node:crypto");
const pool = require("../src/config/db");

async function main() {
  const productName = `FG_K6_TEST_${randomUUID()}`;

  try {
    const [result] = await pool.execute(
      `INSERT INTO products
        (product_name, price, stock, sale_status)
       VALUES (?, ?, ?, 'ACTIVE')`,
      [productName, 100, 20]
    );

    console.log("Temporary checkout test product created.");
    console.log(`Product ID: ${result.insertId}`);
    console.log(`Product name: ${productName}`);
    console.log("Initial stock: 20");
    console.log("Save this product ID for the next step.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Failed to create test product:", error.message);
  process.exitCode = 1;
});
