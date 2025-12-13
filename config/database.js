const { Pool } = require('pg');
require('dotenv').config();

// Support DATABASE_URL (common on Render, Heroku, etc.) or individual connection parameters
let poolConfig;

if (process.env.DATABASE_URL) {
  // Use connection string (common on cloud platforms like Render)
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };
} else {
  // Use individual connection parameters
  poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'groupfund',
    user: process.env.DB_USER || process.env.USER || 'postgres', // Use system user as fallback
    password: process.env.DB_PASSWORD || undefined, // Often not needed for local connections
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };
}

const pool = new Pool(poolConfig);

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;
