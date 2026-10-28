
const API_BASE_URL = "http://localhost:5000/api";

export async function getProduct(productId) {
  const response = await fetch(
    `${API_BASE_URL}/products/${productId}`
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error?.message || "Failed to fetch product"
    );
  }

  return result.data;
}
