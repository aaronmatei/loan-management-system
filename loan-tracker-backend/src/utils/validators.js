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
  // Minimum 12 chars, at least one uppercase, one number, one special char
  const passwordRegex =
    /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{12,}$/;
  return passwordRegex.test(password);
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
