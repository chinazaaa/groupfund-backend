const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');

/**
 * Generate a TOTP secret for authenticator app
 * @returns {Object} { secret, otpauth_url }
 */
function generateTOTPSecret(email) {
  const secret = speakeasy.generateSecret({
    name: `GroupFund (${email})`,
    issuer: 'GroupFund',
    length: 32,
  });

  return {
    secret: secret.base32, // The secret key (base32 encoded)
    otpauth_url: secret.otpauth_url, // URL for QR code generation
  };
}

/**
 * Verify a TOTP token
 * @param {string} token - The 6-digit code from authenticator app
 * @param {string} secret - The TOTP secret (base32)
 * @returns {boolean} True if token is valid
 */
function verifyTOTPToken(token, secret) {
  return speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: token,
    window: 2, // Allow 2 time steps (60 seconds) of tolerance for clock skew
  });
}

/**
 * Generate QR code data URL for authenticator setup
 * @param {string} otpauth_url - The otpauth URL
 * @returns {Promise<string>} Data URL of QR code image
 */
async function generateQRCode(otpauth_url) {
  try {
    const qrCodeDataURL = await QRCode.toDataURL(otpauth_url);
    return qrCodeDataURL;
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw new Error('Failed to generate QR code');
  }
}

/**
 * Generate backup codes for account recovery
 * @param {number} count - Number of backup codes to generate (default: 8)
 * @returns {string[]} Array of backup codes
 */
function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // Generate 8-digit code with dashes for readability (e.g., "1234-5678")
    const code = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 8);
    const formattedCode = `${code.slice(0, 4)}-${code.slice(4, 8)}`;
    codes.push(formattedCode);
  }
  return codes;
}

/**
 * Hash a backup code for storage
 * @param {string} code - The backup code
 * @returns {string} Hashed code
 */
function hashBackupCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Verify a backup code against hashed codes
 * @param {string} code - The backup code to verify
 * @param {string[]} hashedCodes - Array of hashed backup codes
 * @returns {boolean} True if code matches
 */
function verifyBackupCode(code, hashedCodes) {
  if (!hashedCodes || !Array.isArray(hashedCodes)) {
    return false;
  }
  const hashedCode = hashBackupCode(code);
  return hashedCodes.includes(hashedCode);
}

/**
 * Format secret key for display (adds spaces for readability)
 * @param {string} secret - The base32 secret
 * @returns {string} Formatted secret (e.g., "JBSW Y3DP EHPK 3PXP")
 */
function formatSecretForDisplay(secret) {
  // Add space every 4 characters for readability
  return secret.match(/.{1,4}/g)?.join(' ') || secret;
}

module.exports = {
  generateTOTPSecret,
  verifyTOTPToken,
  generateQRCode,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
  formatSecretForDisplay,
};
