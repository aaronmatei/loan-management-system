// Thin wrapper around express-validator so route files only have to
// declare WHAT to validate, not also wire up the "did validation fail?"
// boilerplate at the bottom of every handler.
//
// Usage:
//
//   import { validate, body } from "../utils/validate.js";
//
//   router.post(
//     "/",
//     authorize("admin"),
//     validate(
//       body("loan_id").isInt({ min: 1 }).toInt(),
//       body("amount_paid").isFloat({ gt: 0 }).toFloat(),
//       body("payment_method").isIn(["Cash", "M-Pesa", ...]),
//     ),
//     async (req, res) => { ... },
//   );
//
// On failure the wrapper returns 400 with the same { error, details }
// shape the rest of the API uses, so the frontend's existing error
// renderer works without a special case. On success req.body is
// coerced + trimmed in place and the handler runs.

import { body, param, query, validationResult } from "express-validator";

/**
 * Build a middleware array that runs every validation chain in order
 * and then short-circuits with a 400 if any failed. Pass the result
 * straight as a middleware to `router.post`/etc.
 */
export function validate(...chains) {
  return [
    ...chains,
    (req, res, next) => {
      const result = validationResult(req);
      if (result.isEmpty()) return next();
      // Compact, machine-readable shape — the frontend can show
      // per-field hints when it wants, or just surface .error.
      const details = result.array({ onlyFirstError: true }).map((e) => ({
        field: e.path,
        message: e.msg,
      }));
      return res.status(400).json({
        error: details.length === 1
          ? `${details[0].field}: ${details[0].message}`
          : "Invalid input",
        details,
      });
    },
  ];
}

// Re-export the most-used chain builders so callers don't need a
// second import line. `body` for req.body, `param` for URL params,
// `query` for ?query=string.
export { body, param, query };

export default { validate, body, param, query };
