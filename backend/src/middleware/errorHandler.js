
module.exports = (err, req, res, next) => {
  // If the response has already started, let Express handle the error.
  if (res.headersSent) {
    return next(err);
  }

  // Malformed JSON sent by the client.
  if (
    err instanceof SyntaxError &&
    err.status === 400 &&
    Object.prototype.hasOwnProperty.call(err, "body")
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_JSON",
        message: "Request body contains invalid JSON.",
        requestId: req.requestId
      }
    });
  }

  // Handle oversized JSON request bodies.
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body exceeds the allowed size.",
        requestId: req.requestId
      }
    });
  }

  // Handle other application errors.
  const status = Number.isInteger(err.statusCode)
    ? err.statusCode
    : Number.isInteger(err.status)
      ? err.status
      : 500;

  const statusCode = status >= 400 && status < 600 ? status : 500;

  const code = err.code || "INTERNAL_SERVER_ERROR";
  const message =
    statusCode >= 500
      ? "An unexpected error occurred."
      : err.message || "Request could not be processed.";

  console.error("FLASHGUARD ERROR:", {
    requestId: req.requestId,
    statusCode,
    code,
    message: statusCode >= 500 ? err.message : undefined
  });

  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      requestId: req.requestId
    }
  });
};
