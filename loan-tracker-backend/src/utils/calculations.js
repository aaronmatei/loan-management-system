/**
 * Calculate total amount due (principal + interest)
 * @param principal - Loan amount
 * @param monthlyRate - Monthly interest rate (percentage)
 * @param months - Loan duration in months
 * @returns Total amount due
 */
export function calculateTotalAmount(principal, monthlyRate, months) {
  const rate = monthlyRate / 100;
  const interest = principal * rate * months;
  return principal + interest;
}

/**
 * Calculate monthly payment
 * @param totalAmount - Total amount due (principal + interest)
 * @param months - Number of months
 * @returns Monthly payment amount
 */
export function calculateMonthlyPayment(totalAmount, months) {
  return totalAmount / months;
}

/**
 * Calculate total interest
 * @param principal - Loan amount
 * @param monthlyRate - Monthly interest rate (percentage)
 * @param months - Loan duration in months
 * @returns Total interest amount
 */
export function calculateTotalInterest(principal, monthlyRate, months) {
  const rate = monthlyRate / 100;
  return principal * rate * months;
}

/**
 * Calculate remaining balance
 * @param totalAmount - Total amount due
 * @param amountPaid - Amount paid so far
 * @returns Remaining balance
 */
export function calculateRemainingBalance(totalAmount, amountPaid) {
  return Math.max(0, totalAmount - amountPaid);
}

/**
 * Calculate days overdue
 * @param dueDate - Date payment was due
 * @param currentDate - Current date (optional)
 * @returns Number of days overdue (0 if not overdue)
 */
export function calculateDaysOverdue(dueDate, currentDate = new Date()) {
  const due = new Date(dueDate);
  const now = new Date(currentDate);

  if (now <= due) return 0;

  const diffTime = now - due;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Generate payment schedule
 * @param loanId - Loan ID
 * @param totalAmount - Total amount due
 * @param months - Number of payments
 * @param startDate - First payment date
 * @returns Array of payment schedule objects
 */
export function generatePaymentSchedule(
  loanId,
  totalAmount,
  months,
  startDate,
) {
  const monthlyPayment = calculateMonthlyPayment(totalAmount, months);
  const schedule = [];

  for (let i = 1; i <= months; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);

    schedule.push({
      loan_id: loanId,
      payment_number: i,
      due_date: dueDate,
      amount_due: parseFloat(monthlyPayment.toFixed(2)),
      status: "pending",
      amount_paid: 0,
    });
  }

  return schedule;
}

/**
 * Calculate collection rate
 * @param totalLoansAmount - Total loans amount
 * @param collectedAmount - Amount collected
 * @returns Collection rate percentage
 */
export function calculateCollectionRate(totalLoansAmount, collectedAmount) {
  if (totalLoansAmount === 0) return 0;
  return parseFloat(((collectedAmount / totalLoansAmount) * 100).toFixed(2));
}

/**
 * Calculate default rate
 * @param totalLoans - Total number of loans
 * @param defaultedLoans - Number of defaulted loans
 * @returns Default rate percentage
 */
export function calculateDefaultRate(totalLoans, defaultedLoans) {
  if (totalLoans === 0) return 0;
  return parseFloat(((defaultedLoans / totalLoans) * 100).toFixed(2));
}
