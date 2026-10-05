// Canonical account-kind vocabulary, shared by the account form and the PDF
// report builder so the two can never drift apart.
export const KIND_LABELS = {
  checking: 'Checking',
  savings: 'Savings',
  money_market: 'Money Market',
  cd: 'Certificate of Deposit (CD)',
  cash: 'Cash',
  brokerage: 'Brokerage',
  '529': '529 Plan',
  '401k': '401(k)',
  roth_ira: 'Roth IRA',
  traditional_ira: 'Traditional IRA',
  hsa: 'HSA',
  pension: 'Pension',
  house: 'House / Home',
  land: 'Land',
  vehicle: 'Vehicle',
  jewelry: 'Jewelry',
  collectible: 'Collectible',
  receivable: 'Money owed to me',
  mortgage: 'Mortgage',
  car_loan: 'Car Loan',
  student_loan: 'Student Loan',
  credit_card: 'Credit Card',
  personal_loan: 'Personal Loan',
  other: 'Other',
};

export const KIND_GROUPS = [
  { label: 'Cash', kinds: ['checking', 'savings', 'money_market', 'cd', 'cash'] },
  { label: 'Investment', kinds: ['brokerage', '529'] },
  { label: 'Retirement', kinds: ['401k', 'roth_ira', 'traditional_ira', 'hsa', 'pension'] },
  { label: 'Real Estate', kinds: ['house', 'land'] },
  { label: 'Personal Property', kinds: ['vehicle', 'jewelry', 'collectible', 'receivable'] },
  { label: 'Liabilities', kinds: ['mortgage', 'car_loan', 'student_loan', 'credit_card', 'personal_loan'] },
];

export function kindLabel(kind) {
  return KIND_LABELS[kind] || '';
}