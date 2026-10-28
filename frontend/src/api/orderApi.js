
const API_BASE_URL = "http://localhost:5000/api";

export async function getOrder(orderId) {
  const response = await fetch(
    `${API_BASE_URL}/orders/${encodeURIComponent(orderId)}`
  );

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || "Unable to retrieve order"
    );

    error.code = result.error?.code;
    error.status = response.status;

    throw error;
  }

  return result.data;
}
