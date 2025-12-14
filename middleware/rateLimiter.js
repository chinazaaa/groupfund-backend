const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for authentication endpoints (login, signup, password reset)
 * Stricter limits to prevent brute force attacks
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: (req, res) => {
    let retryAfter = 15; // Default to 15 minutes
    if (req.rateLimit && req.rateLimit.resetTime) {
      retryAfter = Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60));
    }
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
    let retryAfter = 15; // Default to 15 minutes
    if (req.rateLimit && req.rateLimit.resetTime) {
      retryAfter = Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60));
    }
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
 * Uses user ID if authenticated, otherwise falls back to IP
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each user/IP to 200 requests per windowMs (generous for mobile apps)
  message: (req, res) => {
    let retryAfter = 15; // Default to 15 minutes
    if (req.rateLimit && req.rateLimit.resetTime) {
      retryAfter = Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60));
    }
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
  // Use user ID if authenticated, otherwise use IP
  keyGenerator: (req) => {
    // If user is authenticated, use their user ID (prevents shared IP issues)
    if (req.user && req.user.id) {
      return `user:${req.user.id}`;
    }
    // Otherwise, use IP address
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
});

/**
 * Rate limiter for contribution/payment endpoints
 * Moderate limits to prevent abuse while allowing normal usage
 * Uses user ID if authenticated, otherwise falls back to IP
 */
const contributionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each user/IP to 50 contribution requests per windowMs
  message: (req, res) => {
    let retryAfter = 15; // Default to 15 minutes
    if (req.rateLimit && req.rateLimit.resetTime) {
      retryAfter = Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60));
    }
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
  // Use user ID if authenticated, otherwise use IP
  keyGenerator: (req) => {
    // If user is authenticated, use their user ID (prevents shared IP issues)
    if (req.user && req.user.id) {
      return `user:${req.user.id}`;
    }
    // Otherwise, use IP address
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
});

/**
 * Rate limiter for admin endpoints
 * Stricter limits for admin operations
 * Uses user ID (admin endpoints are always authenticated)
 */
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each admin user to 100 admin requests per windowMs
  message: (req, res) => {
    let retryAfter = 15; // Default to 15 minutes
    if (req.rateLimit && req.rateLimit.resetTime) {
      retryAfter = Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60));
    }
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
  // Use user ID (admin endpoints are always authenticated)
  keyGenerator: (req) => {
    if (req.user && req.user.id) {
      return `admin:${req.user.id}`;
    }
    // Fallback to IP (shouldn't happen for admin routes, but safety first)
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
});

/**
 * Rate limiter for waitlist endpoint
 * Very generous limits to allow many signups from same location (events, offices, etc.)
 * Uses email as key to prevent individual spam while allowing many different people from same IP
 */
const waitlistLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // Very generous limit per email/IP combination
  message: (req, res) => {
    let retryAfter = 60; // Default to 60 minutes (1 hour)
    if (req.rateLimit && req.rateLimit.resetTime) {
      retryAfter = Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60));
    }
    const hours = Math.floor(retryAfter / 60);
    const minutes = retryAfter % 60;
    const timeText = hours > 0 ? `${hours} hour(s) and ${minutes} minute(s)` : `${minutes} minute(s)`;
    
    return {
      error: 'Too many waitlist submissions. Please wait before submitting again.',
      message: `You've exceeded the waitlist submission limit. Please try again in ${timeText}.`,
      retryAfter: retryAfter,
      limit: 1000,
      window: '1 hour',
    };
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use email + IP combination to allow many different people from same location
  // but prevent individual spam
  keyGenerator: (req) => {
    const email = req.body?.email || req.query?.email || 'unknown';
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return `waitlist:${email}:${ip}`;
  },
});

/**
 * Rate limiter for contact form endpoint
 * Moderate limits to prevent spam while allowing legitimate inquiries
 * Uses email as key to prevent individual spam while allowing many different people from same IP
 */
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // Limit per email/IP combination (more restrictive than waitlist)
  message: (req, res) => {
    let retryAfter = 60; // Default to 60 minutes (1 hour)
    if (req.rateLimit && req.rateLimit.resetTime) {
      retryAfter = Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000 / 60));
    }
    const hours = Math.floor(retryAfter / 60);
    const minutes = retryAfter % 60;
    const timeText = hours > 0 ? `${hours} hour(s) and ${minutes} minute(s)` : `${minutes} minute(s)`;
    
    return {
      error: 'Too many contact form submissions. Please wait before submitting again.',
      message: `You've exceeded the contact form submission limit. Please try again in ${timeText}.`,
      retryAfter: retryAfter,
      limit: 100,
      window: '1 hour',
    };
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use email + IP combination to allow many different people from same location
  // but prevent individual spam
  keyGenerator: (req) => {
    const email = req.body?.email || req.query?.email || 'unknown';
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return `contact:${email}:${ip}`;
  },
});

module.exports = {
  authLimiter,
  otpLimiter,
  apiLimiter,
  contributionLimiter,
  adminLimiter,
  contactLimiter,
  waitlistLimiter,
};

