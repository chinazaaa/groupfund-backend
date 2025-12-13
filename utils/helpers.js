const crypto = require('crypto');

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate invite code
const generateInviteCode = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// Generate account number
const generateAccountNumber = () => {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
};

// Hash password (using bcrypt in auth routes, but keeping for reference)
// Password hashing is done in routes using bcryptjs

module.exports = {
  generateOTP,
  generateInviteCode,
  generateAccountNumber,
};
