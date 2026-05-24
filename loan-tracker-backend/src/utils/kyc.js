import { isCloudinaryConfigured } from "../config/cloudinary.js";

// A customer's KYC is complete once all three identity images are on file:
// a profile/DP photo plus both sides of the national ID.
export const isKycComplete = (c = {}) =>
  !!(c.profile_photo_url && c.id_front_url && c.id_back_url);

// The portal forces the upload gate ONLY when image storage is actually
// configured — otherwise customers would be locked out before Cloudinary is
// provisioned. So "needs KYC" = storage is live AND documents are missing.
export const needsKyc = (c = {}) =>
  isCloudinaryConfigured() && !isKycComplete(c);
