import { v2 as cloudinary } from "cloudinary";

// Cloudinary stores customer KYC images (DP photo + ID front/back). It is
// configured from either CLOUDINARY_URL or the discrete
// CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET trio.
// When none are set the feature stays dormant — isCloudinaryConfigured()
// returns false and the portal works normally without the KYC gate, so the
// product is not bricked before image storage is provisioned.
const {
  CLOUDINARY_URL,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
} = process.env;

let configured = false;
if (CLOUDINARY_URL) {
  // The SDK auto-parses CLOUDINARY_URL from the environment.
  cloudinary.config({ secure: true });
  configured = true;
} else if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

export const isCloudinaryConfigured = () => configured;

// Upload an in-memory buffer; resolves to the upload result (incl. secure_url).
// resourceType defaults to "image" (KYC photos); pass "auto" for documents so
// PDFs and other non-image files store as raw and remain downloadable.
export const uploadBuffer = (buffer, { folder, publicId, resourceType = "image" } = {}) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        overwrite: true,
        resource_type: resourceType,
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });

export default cloudinary;
