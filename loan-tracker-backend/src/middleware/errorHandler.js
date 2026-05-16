import logger from "../config/logger.js";

export function errorHandler(err, req, res, next) {
  logger.error("Error:", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  if (err.name === "ValidationError") {
    return res.status(400).json({ error: err.message });
  }

  if (err.name === "UnauthorizedError") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
}
