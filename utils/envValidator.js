/**
 * Environment Variable Validation
 * Validates required and recommended environment variables on startup
 */

const requiredVars = {
  // Critical - app won't work without these
  JWT_SECRET: {
    description: 'JWT secret key for token signing',
    example: 'your_super_secret_jwt_key_change_this_in_production',
    validate: (value) => {
      if (!value || value.length < 10) {
        return 'JWT_SECRET must be at least 10 characters long for security';
      }
      if (value.includes('change_this') || value.includes('your_')) {
        return 'JWT_SECRET appears to be a placeholder. Please set a secure random value.';
      }
      return null;
    },
  },
};

// Database: Either DATABASE_URL OR individual DB vars (with defaults)
const databaseVars = {
  DATABASE_URL: {
    description: 'Full database connection string (alternative to individual DB vars)',
    example: 'postgresql://user:password@host:port/database_name',
    required: false, // Not required if using individual vars
  },
  // Individual DB vars have defaults, so they're optional
  // But we should validate that either DATABASE_URL or DB connection is possible
};

const recommendedVars = {
  RESEND_API_KEY: {
    description: 'Resend API key for sending emails (OTP, notifications)',
    example: 're_xxxxxxxxxxxxx',
    warning: 'Email functionality will not work without this',
  },
  EMAIL_FROM: {
    description: 'Email sender address',
    example: 'GroupFund <onboarding@resend.dev>',
    default: 'GroupFund <onboarding@resend.dev>',
  },
  NODE_ENV: {
    description: 'Environment mode (development, production, test)',
    example: 'production',
    default: 'development',
  },
  PORT: {
    description: 'Server port',
    example: '3000',
    default: '3000',
  },
};

const optionalVars = {
  FRONTEND_URL: {
    description: 'Frontend URL for CORS configuration',
    example: 'https://groupfund.app',
  },
  JWT_EXPIRES_IN: {
    description: 'JWT token expiration time',
    example: '10000d',
    default: '10000d',
  },
  OTP_EXPIRY_MINUTES: {
    description: 'OTP expiration time in minutes',
    example: '10',
    default: '10',
  },
  EXPO_ACCESS_TOKEN: {
    description: 'Expo access token for push notifications (optional)',
    example: 'your_expo_access_token',
  },
  MIGRATION_SECRET_TOKEN: {
    description: 'Secret token for API-based migrations (optional)',
    example: 'generate with: openssl rand -base64 32',
  },
};

/**
 * Validate environment variables
 * @returns {Object} { isValid: boolean, errors: string[], warnings: string[] }
 */
function validateEnv() {
  const errors = [];
  const warnings = [];

  // Validate required variables
  for (const [varName, config] of Object.entries(requiredVars)) {
    const value = process.env[varName];
    
    if (!value) {
      errors.push(
        `❌ Missing required environment variable: ${varName}\n` +
        `   Description: ${config.description}\n` +
        `   Example: ${config.example}`
      );
    } else if (config.validate) {
      const validationError = config.validate(value);
      if (validationError) {
        errors.push(
          `❌ Invalid ${varName}: ${validationError}\n` +
          `   Current value: ${value.substring(0, 20)}...`
        );
      }
    }
  }

  // Validate database configuration
  const hasDatabaseUrl = !!process.env.DATABASE_URL;
  const hasDbConfig = !!(process.env.DB_HOST || process.env.DB_NAME);
  
  if (!hasDatabaseUrl && !hasDbConfig) {
    warnings.push(
      `⚠️  Database configuration: Neither DATABASE_URL nor DB_HOST/DB_NAME found.\n` +
      `   Using defaults: localhost:5432/groupfund\n` +
      `   This may work for local development but will fail in production.`
    );
  }

  // Check recommended variables
  for (const [varName, config] of Object.entries(recommendedVars)) {
    const value = process.env[varName];
    
    if (!value) {
      if (config.default) {
        // Has default, so just info
        continue;
      } else {
        warnings.push(
          `⚠️  Missing recommended variable: ${varName}\n` +
          `   ${config.warning || `Description: ${config.description}`}\n` +
          `   Example: ${config.example}`
        );
      }
    }
  }

  // Check for common mistakes
  if (process.env.JWT_SECRET) {
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret === 'your_super_secret_jwt_key_change_this_in_production') {
      errors.push(
        `❌ JWT_SECRET is set to the default placeholder value.\n` +
        `   This is insecure! Please generate a secure random secret.\n` +
        `   You can generate one with: openssl rand -base64 32`
      );
    }
  }

  if (process.env.RESEND_API_KEY) {
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey.includes('your_') || apiKey.includes('example')) {
      warnings.push(
        `⚠️  RESEND_API_KEY appears to be a placeholder.\n` +
        `   Email functionality will not work with a placeholder key.`
      );
    }
  }

  // Check NODE_ENV
  if (process.env.NODE_ENV && !['development', 'production', 'test'].includes(process.env.NODE_ENV)) {
    warnings.push(
      `⚠️  NODE_ENV is set to "${process.env.NODE_ENV}" which is not a standard value.\n` +
      `   Expected: development, production, or test`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Print validation results
 */
function printValidationResults() {
  const { isValid, errors, warnings } = validateEnv();

  console.log('\n' + '='.repeat(60));
  console.log('🔍 Environment Variable Validation');
  console.log('='.repeat(60) + '\n');

  if (errors.length > 0) {
    console.log('❌ ERRORS (must be fixed):\n');
    errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error}\n`);
    });
  }

  if (warnings.length > 0) {
    console.log('⚠️  WARNINGS (recommended to fix):\n');
    warnings.forEach((warning, index) => {
      console.log(`${index + 1}. ${warning}\n`);
    });
  }

  if (isValid && warnings.length === 0) {
    console.log('✅ All environment variables are properly configured!\n');
  } else if (isValid) {
    console.log('✅ Required environment variables are set (but see warnings above).\n');
  } else {
    console.log('❌ Please fix the errors above before starting the server.\n');
  }

  console.log('='.repeat(60) + '\n');

  return isValid;
}

/**
 * Validate and exit if invalid (for strict mode)
 */
function validateAndExit() {
  const { isValid } = validateEnv();
  
  if (!isValid) {
    printValidationResults();
    console.error('❌ Server startup aborted due to environment variable errors.');
    process.exit(1);
  }
  
  return true;
}

module.exports = {
  validateEnv,
  printValidationResults,
  validateAndExit,
};

