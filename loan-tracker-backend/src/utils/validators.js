export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validatePhone(phone) {
  // Kenyan phone format: 254712345678 or 0712345678
  const phoneRegex = /^(254|\+254|0)[0-9]{9}$/;
  return phoneRegex.test(phone.replace(/\s+/g, ""));
}

export function validatePassword(password) {
  // Minimum 12 chars, at least one uppercase, one number, and one special
  // character. "Special" = any non-alphanumeric, so #, -, _, ., etc. all count.
  // The old whitelist regex wrongly rejected anything outside @$!%*?& — e.g. a
  // perfectly valid password containing '#'.
  if (typeof password !== "string" || password.length < 12) return false;
  return (
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export function validateAmount(amount) {
  return !isNaN(amount) && amount > 0;
}

export function validateLoanDuration(months) {
  return Number.isInteger(months) && months > 0 && months <= 360;
}

export function validateInterestRate(rate) {
  return !isNaN(rate) && rate >= 0 && rate <= 100;
}
