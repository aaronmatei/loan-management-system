import jwt from "jsonwebtoken";
import logger from "../config/logger.js";

export function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  const typeBearer = req.headers.authorization?.split(" ")[0];

  //check token
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  // Token must be Bearer
  if (typeBearer !== "Bearer") {
    return res.status(401).json({ error: "Token must be 'Bearer '" });
  }

  //Verify token
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    logger.error("Token verification failed:", error);
    return res.status(403).json({ error: "Invalid token" });
  }
}

export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}
