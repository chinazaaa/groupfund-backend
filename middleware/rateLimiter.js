const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for authentication endpoints (login, signup, password reset)
 * Stricter limits to prevent brute force attacks
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60);
    return {
      error: 'Too many authentication attempts. Please wait a few minutes before trying again.',
      message: `You've exceeded the limit of 10 authentication attempts. Please try again in ${retryAfter} minute(s).`,
      retryAfter: retryAfter,
      limit: 10,
      window: '15 minutes',
    };
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting for successful requests (only count failures)
  skipSuccessfulRequests: false,
  // Use IP address as the key
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
});

/**
 * Rate limiter for OTP endpoints (verify-otp, resend-otp)
 * Very strict to prevent OTP abuse
 */
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 OTP requests per windowMs
  message: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60);
    return {
      error: 'Too many OTP requests. Please wait before requesting a new code.',
      message: `You've exceeded the limit of 5 OTP requests. Please try again in ${retryAfter} minute(s).`,
      retryAfter: retryAfter,
      limit: 5,
      window: '15 minutes',
    };
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for general API endpoints
 * Generous limits to allow normal mobile app usage
 * Mobile apps might make multiple requests when loading screens (groups, birthdays, etc.)
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs (generous for mobile apps)
  message: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60);
    return {
      error: 'Too many requests. Please slow down and try again in a few minutes.',
      message: `You've exceeded the API rate limit. Please try again in ${retryAfter} minute(s).`,
      retryAfter: retryAfter,
      limit: 200,
      window: '15 minutes',
    };
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip successful requests to only count errors/abuse
  skipSuccessfulRequests: true,
});

/**
 * Rate limiter for contribution/payment endpoints
 * Moderate limits to prevent abuse while allowing normal usage
 */
const contributionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 contribution requests per windowMs
  message: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60);
    return {
      error: 'Too many contribution requests. Please wait before making another transaction.',
      message: `You've exceeded the limit of 50 contribution requests. Please try again in ${retryAfter} minute(s).`,
      retryAfter: retryAfter,
      limit: 50,
      window: '15 minutes',
    };
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for admin endpoints
 * Stricter limits for admin operations
 */
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 admin requests per windowMs
  message: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60);
    return {
      error: 'Too many admin requests. Please slow down your requests.',
      message: `You've exceeded the admin API rate limit. Please try again in ${retryAfter} minute(s).`,
      retryAfter: retryAfter,
      limit: 100,
      window: '15 minutes',
    };
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for contact/waitlist endpoints
 * Moderate limits to prevent spam
 */
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each IP to 5 submissions per hour
  message: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60);
    const hours = Math.floor(retryAfter / 60);
    const minutes = retryAfter % 60;
    const timeText = hours > 0 ? `${hours} hour(s) and ${minutes} minute(s)` : `${minutes} minute(s)`;
    
    return {
      error: 'Too many submissions. Please wait before submitting again.',
      message: `You've exceeded the limit of 5 submissions per hour. Please try again in ${timeText}.`,
      retryAfter: retryAfter,
      limit: 5,
      window: '1 hour',
    };
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  authLimiter,
  otpLimiter,
  apiLimiter,
  contributionLimiter,
  adminLimiter,
  contactLimiter,
};

