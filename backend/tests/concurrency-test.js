
const { randomUUID } = require("crypto");

const API_URL = "http://localhost:5000/api/checkout";
const PRODUCT_ID = 2;
const REQUEST_COUNT = 20;
const BOUNDARY_STOCK = 1;
const BOUNDARY_REQUEST_COUNT = 10;
const INITIAL_STOCK = 5;

async function sendCheckout(index) {
  const idempotencyKey = `concurrency-${randomUUID()}`;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({
        productId: PRODUCT_ID
      })
    });

    const body = await response.json();

    return {
      request: index,
      httpStatus: response.status,
      status: body.data?.status || body.error?.code || "UNKNOWN",
      orderId: body.data?.orderId || null
    };
  } catch (error) {
    return {
      request: index,
      httpStatus: 0,
      status: "NETWORK_ERROR",
      orderId: null,
      message: error.message
    };
  }
}

async function main() {
  console.log(`Sending ${REQUEST_COUNT} concurrent checkout requests...`);
  console.log(`Product ID: ${PRODUCT_ID}`);
  console.log(`Expected initial stock: ${INITIAL_STOCK}`);

  const results = await Promise.all(
    Array.from(
      { length: REQUEST_COUNT },
      (_, index) => sendCheckout(index + 1)
    )
  );

  const confirmed = results.filter(
    result => result.status === "CONFIRMED"
  );

  const soldOut = results.filter(
    result => result.status === "SOLD_OUT"
  );

  const unexpected = results.filter(
    result => !["CONFIRMED", "SOLD_OUT"].includes(result.status)
  );

  const uniqueOrderIds = new Set(
    confirmed.map(result => result.orderId)
  );

  console.table(results);

  console.log("\nSummary");
  console.log("Total requests:", results.length);
  console.log("Confirmed orders:", confirmed.length);
  console.log("Sold-out responses:", soldOut.length);
  console.log("Unexpected responses:", unexpected.length);
  console.log("Unique order IDs:", uniqueOrderIds.size);

  if (results.length !== REQUEST_COUNT) {
    console.error("FAIL: Incorrect number of results.");
    process.exitCode = 1;
  } else if (unexpected.length > 0) {
    console.error("FAIL: Unexpected responses detected.");
    process.exitCode = 1;
  } else if (confirmed.length > INITIAL_STOCK) {
    console.error("FAIL: More orders than available stock.");
    process.exitCode = 1;
  } else if (uniqueOrderIds.size !== confirmed.length) {
    console.error("FAIL: Duplicate order IDs detected.");
    process.exitCode = 1;
  } else if (
    confirmed.length === INITIAL_STOCK &&
    soldOut.length === REQUEST_COUNT - INITIAL_STOCK
  ) {
    console.log(
      "PASS: Exactly 5 orders confirmed and 15 requests sold out."
    );
  } else {
    console.error(
      "FAIL: Results differ from the expected stock scenario."
    );
    console.error(
      "Check the product's actual stock before interpreting this result."
    );
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error("Concurrency test failed:", error);
  process.exitCode = 1;
});
