const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// Validate environment variables on startup
const { validateEnv } = require('./utils/envValidator');
const envCheck = validateEnv();

// Print validation results
if (envCheck.errors.length > 0 || envCheck.warnings.length > 0) {
  const { printValidationResults } = require('./utils/envValidator');
  printValidationResults();
  
  // In production, exit if there are critical errors
  if (process.env.NODE_ENV === 'production' && !envCheck.isValid) {
    console.error('❌ Server startup aborted due to environment variable errors.');
    process.exit(1);
  }
}

const app = express();

// Middleware
// CORS configuration - allow multiple origins for development and production
const allowedOrigins = [
  'https://groupfund.app',
  'https://www.groupfund.app',
  'https://app.groupfund.app',
  'http://localhost:5173',
  'http://localhost:8081',
  'http://localhost:3000',
];

// Add FRONTEND_URL from environment if it exists and isn't already in the list
if (process.env.FRONTEND_URL && !allowedOrigins.includes(process.env.FRONTEND_URL)) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // In development, allow all origins
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    // In production, check against allowed origins
    if (allowedOrigins.indexOf(origin) !== -1) {
      // Return the origin explicitly to ensure proper CORS headers
      callback(null, origin);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

// Security headers with Helmet
// Configure Helmet for API usage (less restrictive for API endpoints)
// Note: We serve HTML for deep links, so we need to allow some HTML features
app.use(helmet({
  // Allow inline scripts for deep link redirect logic
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  // Allow cross-origin requests for API
  crossOriginEmbedderPolicy: false,
  // Keep other security headers enabled
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  // Disable X-Download-Options for API
  noSniff: true,
  // Keep XSS protection
  xssFilter: true,
  // Frameguard - allow embedding if needed (adjust based on requirements)
  frameguard: { action: 'deny' },
  // Hide powered-by header
  hidePoweredBy: true,
}));

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'GroupFund API is running' });
});

// Universal Links - iOS (Apple App Site Association)
// Must be served at exactly /.well-known/apple-app-site-association (no extension)
// Must return Content-Type: application/json
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  const appleTeamId = process.env.APPLE_TEAM_ID || 'TEAM_ID';
  const bundleId = 'com.groupfund.app';
  
  res.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${appleTeamId}.${bundleId}`,
          paths: ['/g/*', '/group/*']
        }
      ]
    }
  });
});

// Universal Links - Android (Digital Asset Links)
// Must be served at exactly /.well-known/assetlinks.json
// Must return Content-Type: application/json
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  const packageName = 'com.groupfund.app';
  
  // Support multiple fingerprints (comma-separated in env, or fallback to default)
  const androidFingerprints = process.env.ANDROID_SHA256_FINGERPRINTS
    ? process.env.ANDROID_SHA256_FINGERPRINTS.split(',').map(f => f.trim())
    : [
        'AC:EF:5F:7C:3F:FA:EA:2E:2D:C4:AF:78:CB:6F:E8:40:5D:72:D9:17:34:25:7B:CA:07:49:9E:03:17:92:F0:8A',
        'A3:A5:5E:D0:9F:14:66:E2:16:93:70:1F:7B:1D:7A:74:9C:BC:1B:A4:62:77:E8:BF:01:8D:CB:EB:83:D1:1E:6F'
      ];
  
  res.json([
    {
      relation: [
        'delegate_permission/common.handle_all_urls',
        'delegate_permission/common.get_login_creds'
      ],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: androidFingerprints
      }
    }
  ]);
});

// Deep link routes (public, no auth required)
app.use('/', require('./routes/deeplink'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/members', require('./routes/members'));
app.use('/api/birthdays', require('./routes/birthdays'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/general', require('./routes/general'));
app.use('/api/contributions', require('./routes/contributions'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/waitlist', require('./routes/waitlist'));
app.use('/api/wishlist', require('./routes/wishlist'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/migrations', require('./routes/migrations'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/chat', require('./routes/chat'));


// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
