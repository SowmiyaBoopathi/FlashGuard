
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { randomUUID } = require("crypto");
const rateLimit = require("express-rate-limit");

const healthRoutes = require("./routes/healthRoutes");
const productRoutes = require("./routes/productRoutes");
const errorHandler = require("./middleware/errorHandler");
const checkoutRoutes = require("./routes/checkoutRoutes");
const orderRoutes = require("./routes/orderRoutes");
const checkoutRequestRoutes = require("./routes/checkoutRequestRoutes");

const app = express();

app.disable("x-powered-by");

app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
});

app.use(helmet());

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173"
}));

app.use(express.json({ limit: "10kb" }));

console.log("Rate-limit configuration:", {
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: Number(process.env.RATE_LIMIT_MAX || 100)
});
app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: Number(process.env.RATE_LIMIT_MAX || 100),
  standardHeaders: true,
  legacyHeaders: false
}));

// Register API routes directly.
app.use("/api/health", healthRoutes);
app.use("/api/products", productRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/checkout-requests", checkoutRequestRoutes);
// Handle unknown routes.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "API endpoint not found.",
      requestId: req.requestId
    }
  });
});

app.use(errorHandler);

module.exports = app;
