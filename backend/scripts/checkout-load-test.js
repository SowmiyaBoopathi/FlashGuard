
import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const PRODUCT_ID = Number(__ENV.PRODUCT_ID);
const REQUEST_COUNT = Number(__ENV.REQUEST_COUNT || 50);
const TEST_RUN_ID = __ENV.TEST_RUN_ID;


if (!Number.isSafeInteger(PRODUCT_ID) || PRODUCT_ID <= 0) {
  throw new Error("Set PRODUCT_ID to a valid positive integer.");
}

if (!TEST_RUN_ID || !/^[a-zA-Z0-9_-]+$/.test(TEST_RUN_ID)) {
  throw new Error("Set TEST_RUN_ID to a valid identifier.");
}

if (!Number.isSafeInteger(REQUEST_COUNT) ||
    REQUEST_COUNT < 1 ||
    REQUEST_COUNT > 100) {
  throw new Error("REQUEST_COUNT must be between 1 and 100.");
}

http.setResponseCallback(http.expectedStatuses(200, 201, 409));

export const options = {
  scenarios: {
    concurrent_checkout: {
      executor: "shared-iterations",
      vus: REQUEST_COUNT,
      iterations: REQUEST_COUNT,
      maxDuration: "60s",
    },
  },
  thresholds: {
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
  },
};


export default function () {
  const key = `fgk6_${TEST_RUN_ID}_${__VU}_${__ITER}`;

  const response = http.post(
    `${BASE_URL}/api/checkout`,
    JSON.stringify({ productId: PRODUCT_ID }),
    {
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      tags: { endpoint: "checkout" },
    }
  );

  let body = null;

  try {
    body = response.json();
  } catch (_) {
    // JSON validation below will fail.
  }

  check(response, {
    "status is 201 or 409": (r) =>
      r.status === 201 || r.status === 409,

    "response is valid JSON": () =>
      body !== null && typeof body === "object",

    "201 means confirmed order": (r) =>
      r.status !== 201 ||
      (body?.success === true &&
       body?.data?.status === "CONFIRMED" &&
       Number.isSafeInteger(body?.data?.orderId)),

    "409 means sold out": (r) =>
      r.status !== 409 ||
      (body?.success === false &&
       body?.error?.code === "SOLD_OUT"),
  });
}
