// Shared helpers for welfare documents — used by both the staff admin router
// (routes/welfareDocuments.js) and the member portal (routes/portal/member.js).
// Files are held in memory by multer and streamed to Cloudinary; only the URL
// is persisted. Reuses the same storage the KYC uploads use.
import multer from "multer";
import { uploadBuffer, isCloudinaryConfigured } from "../config/cloudinary.js";

export const CATEGORIES = ["minutes", "statement", "constitution", "report", "other"];
export const VISIBILITIES = ["members", "officers"];
export const OFFICER_ROLES = ["chair", "treasurer", "secretary"];

// Documents are broader than images: PDFs, Office docs, plain text/CSV, plus
// images (a photographed minute book). 15 MB ceiling.
const ALLOWED = /^(image\/|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument|application\/vnd\.ms-excel|text\/plain|text\/csv)/;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (ALLOWED.test(file.mimetype) ? cb(null, true) : cb(new Error("Unsupported file type (PDF, Office, image, text or CSV only)"))),
});

// Run multer for a single `file` field, turning size/type errors into clean 400s.
export const runDocUpload = (req, res, next) =>
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File must be 15 MB or smaller" : err.message });
    next();
  });

// Stream an uploaded buffer to Cloudinary as raw/auto so non-images stay
// downloadable; returns the secure URL.
export async function storeDocFile(file, welfareId) {
  const result = await uploadBuffer(file.buffer, { folder: `lenderfest/welfare-docs/${welfareId}`, resourceType: "auto" });
  return result.secure_url;
}

export const isOfficer = (role) => OFFICER_ROLES.includes((role || "").toLowerCase());
export const cleanCategory = (c) => (CATEGORIES.includes((c || "").toLowerCase()) ? c.toLowerCase() : "other");

export { isCloudinaryConfigured };
