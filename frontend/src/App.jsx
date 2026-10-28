
import { useEffect, useRef, useState } from "react";
import { getProduct } from "./api/productApi";
import { checkoutProduct } from "./api/checkoutApi";
import { getCheckoutRequest } from "./api/checkoutRequestApi";
import { getOrder } from "./api/orderApi";
import "./App.css";

const PRODUCT_ID = Number(import.meta.env.VITE_PRODUCT_ID || 1);

function App() {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkingOut, setCheckingOut] = useState(false);
  const [message, setMessage] = useState(null);

  const [orderIdInput, setOrderIdInput] = useState("");
  const [order, setOrder] = useState(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState("");

  const pendingCheckoutRef = useRef(null);

  async function loadProduct() {
    try {
      const data = await getProduct(PRODUCT_ID);
      setProduct(data);
      setError("");
      return data;
    } catch (err) {
      setError(err.message || "Unable to load product.");
      throw err;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function fetchProduct() {
      try {
        const data = await getProduct(PRODUCT_ID);
        if (!cancelled) {
          setProduct(data);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Unable to load product.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchProduct();

    return () => {
      cancelled = true;
    };
  }, []);

  async function recoverCheckout(pending) {
    const request = await getCheckoutRequest(pending.key);

    if (Number(request.product_id) !== Number(pending.productId)) {
      throw new Error("Checkout recovery returned a different product.");
    }

    if (request.order_id != null) {
      const recoveredOrder = await getOrder(request.order_id);
      const recoveredOrderId =
        recoveredOrder.id ?? recoveredOrder.order_id;

      pendingCheckoutRef.current = null;
      setOrder(recoveredOrder);
      setOrderIdInput(String(recoveredOrderId));

      setMessage({
        type: "success",
        text: `Order confirmed! Order ID: ${recoveredOrderId}`,
      });

      await loadProduct();
      return true;
    }

    if (request.request_status === "PROCESSING") {
      setMessage({
        type: "error",
        text: "Your checkout is still processing. Check again before retrying.",
      });
      return false;
    }

    setMessage({
      type: "error",
      text: `Checkout status: ${request.request_status}. Check the order status before trying again.`,
    });

    return false;
  }

  async function handleCheckout() {
    if (
      checkingOut ||
      !product ||
      product.stock <= 0 ||
      product.sale_status !== "ACTIVE"
    ) {
      return;
    }

    setCheckingOut(true);
    setMessage(null);

    let pending = pendingCheckoutRef.current;

    if (!pending || pending.productId !== product.id) {
      pending = {
        productId: product.id,
        key: crypto.randomUUID(),
      };

      pendingCheckoutRef.current = pending;
    }

    try {
      if (pending.uncertain) {
        try {
          const recovered = await recoverCheckout(pending);
          if (recovered) return;
        } catch (lookupError) {
          if (lookupError.status !== 404) {
            setMessage({
              type: "error",
              text: "We couldn't confirm the previous checkout. Check again before purchasing.",
            });
            return;
          }
        }
      }

      try {
        const result = await checkoutProduct(product.id, pending.key);
        const newOrderId = result.orderId ?? result.order_id;

        pendingCheckoutRef.current = null;

        setMessage({
          type: "success",
          text: `Order confirmed! Order ID: ${newOrderId}`,
        });

        setOrderIdInput(String(newOrderId));
        setOrder({
          id: newOrderId,
          status: "CONFIRMED",
          product_name: product.product_name,
        });

        try {
          await loadProduct();
        } catch {
          setMessage({
            type: "success",
            text: `Order ${newOrderId} was confirmed, but stock could not be refreshed. Reload the page to check it.`,
          });
        }
      } catch (checkoutError) {
        const definitiveCodes = new Set([
          "SOLD_OUT",
          "SALE_UNAVAILABLE",
          "INVALID_PRODUCT_ID",
          "INVALID_IDEMPOTENCY_KEY",
          "IDEMPOTENCY_KEY_CONFLICT",
        ]);

        if (definitiveCodes.has(checkoutError.code)) {
          pendingCheckoutRef.current = null;
        } else {
          pending.uncertain = true;
        }

        setMessage({
          type: "error",
          text:
            checkoutError.message ||
            "Checkout result is uncertain. Retry to check the original request.",
        });

        try {
          await loadProduct();
        } catch {
          // Preserve the checkout error if stock refresh also fails.
        }
      }
    } finally {
      setCheckingOut(false);
    }
  }

  async function handleOrderLookup(event) {
    event.preventDefault();

    const id = orderIdInput.trim();

    if (!/^[1-9]\d*$/.test(id)) {
      setOrder(null);
      setOrderError("Enter a valid positive order ID.");
      return;
    }

    setOrderLoading(true);
    setOrderError("");
    setOrder(null);

    try {
      const data = await getOrder(id);
      setOrder(data);
    } catch (err) {
      setOrderError(err.message || "Unable to retrieve order.");
    } finally {
      setOrderLoading(false);
    }
  }

  if (loading) {
    return <p>Loading product...</p>;
  }

  if (error && !product) {
    return (
      <main className="container">
        <h1>FlashGuard</h1>
        <p role="alert">Error: {error}</p>
        <button className="buy-button" onClick={() => loadProduct().catch(() => {})}>
          Retry loading product
        </button>
      </main>
    );
  }

  if (!product) {
    return <p role="alert">Product information is unavailable.</p>;
  }

  return (
    <main className="container">
      <h1>FlashGuard</h1>
      <p className="subtitle">High-Concurrency Flash Sale Checkout</p>

      <section className="product-card">
        <h2>{product.product_name}</h2>

        <p className="price">
          ₹{Number(product.price).toLocaleString("en-IN")}
        </p>

        <p>
          Available stock: <strong>{product.stock}</strong>
        </p>
        <p>
          Sale status: <strong>{product.sale_status}</strong>
        </p>

        <button
          className="buy-button"
          onClick={handleCheckout}
          disabled={
            checkingOut ||
            product.stock <= 0 ||
            product.sale_status !== "ACTIVE"
          }
        >
          {checkingOut
            ? "Processing..."
            : product.stock <= 0
              ? "Sold Out"
              : product.sale_status !== "ACTIVE"
                ? "Sale Unavailable"
                : "Buy Now"}
        </button>

        {message && (
          <p
            className={`message ${message.type}`}
            role={message.type === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {message.text}
          </p>
        )}
      </section>

      <section className="product-card order-section">
        <h2>Track Your Order</h2>

        <form onSubmit={handleOrderLookup}>
          <label htmlFor="orderId">Order ID</label>
          <input
            id="orderId"
            className="order-input"
            type="text"
            inputMode="numeric"
            value={orderIdInput}
            onChange={(event) => setOrderIdInput(event.target.value)}
            placeholder="e.g. 9"
          />

          <button
            className="buy-button"
            type="submit"
            disabled={orderLoading}
          >
            {orderLoading ? "Checking..." : "Check Order"}
          </button>
        </form>

        {orderError && (
          <p className="message error" role="alert">
            {orderError}
          </p>
        )}

        {order && (
          <div className="order-details">
            <h3>Order Details</h3>
            <p>
              Order ID: <strong>{order.id ?? order.order_id}</strong>
            </p>
            <p>
              Product:{" "}
              <strong>
                {order.product_name ?? "Product details unavailable"}
              </strong>
            </p>
            <p>
              Status:{" "}
              <strong>
                {order.status ?? order.order_status ?? "CONFIRMED"}
              </strong>
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
