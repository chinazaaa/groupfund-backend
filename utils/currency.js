// Currency utilities for backend
const CURRENCIES = {
  NGN: { symbol: '₦', name: 'Nigerian Naira' },
  USD: { symbol: '$', name: 'US Dollar' },
  GBP: { symbol: '£', name: 'British Pound' },
  EUR: { symbol: '€', name: 'Euro' },
  KES: { symbol: 'KSh', name: 'Kenyan Shilling' },
  GHS: { symbol: '₵', name: 'Ghanaian Cedi' },
  ZAR: { symbol: 'R', name: 'South African Rand' },
  CAD: { symbol: 'C$', name: 'Canadian Dollar' },
  AUD: { symbol: 'A$', name: 'Australian Dollar' },
  JPY: { symbol: '¥', name: 'Japanese Yen' },
};

const getCurrencySymbol = (currencyCode) => {
  const currency = CURRENCIES[currencyCode];
  return currency ? currency.symbol : currencyCode;
};

const formatAmount = (amount, currencyCode = 'NGN') => {
  const symbol = getCurrencySymbol(currencyCode);
  const numAmount = parseFloat(amount) || 0;
  return `${symbol}${numAmount.toLocaleString('en-NG')}`;
};

module.exports = {
  getCurrencySymbol,
  formatAmount,
  CURRENCIES,
};
