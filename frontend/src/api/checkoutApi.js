
const API_BASE_URL = "http://localhost:5000/api";

export async function checkoutProduct(productId, idempotencyKey) {
  const response = await fetch(`${API_BASE_URL}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({ productId })
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || "Checkout request failed"
    );

    error.code = result.error?.code;
    error.status = response.status;

    throw error;
  }

  return result.data;
}
