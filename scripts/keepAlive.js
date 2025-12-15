/**
 * Keep-Alive Script for Render
 * 
 * This script pings the health endpoint to prevent Render from sleeping.
 * Can be used with Render Cron Jobs or external cron services.
 * 
 * Usage:
 *   node scripts/keepAlive.js
 * 
 * Or set as a Render Cron Job:
 *   Schedule: Every 14 minutes (e.g., 0,14,28,42,56 * * * *)
 *   Command: node scripts/keepAlive.js
 */

require('dotenv').config();

const https = require('https');
const http = require('http');

// Get the service URL from environment variable or use default
const SERVICE_URL = process.env.RENDER_SERVICE_URL || process.env.SERVICE_URL;

if (!SERVICE_URL) {
  console.error('❌ Error: RENDER_SERVICE_URL or SERVICE_URL environment variable is not set');
  console.error('Please set it to your Render service URL (e.g., https://your-app.onrender.com)');
  process.exit(1);
}

// Ensure URL has protocol
const url = SERVICE_URL.startsWith('http') ? SERVICE_URL : `https://${SERVICE_URL}`;
const healthEndpoint = `${url}/health`;

console.log(`🔄 Pinging ${healthEndpoint}...`);

// Use https for Render URLs (they use SSL)
const client = url.startsWith('https') ? https : http;

const startTime = Date.now();

const request = client.get(healthEndpoint, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    const duration = Date.now() - startTime;
    
    if (res.statusCode === 200) {
      console.log(`✅ Success! Server responded in ${duration}ms`);
      console.log(`📊 Response: ${data}`);
      process.exit(0);
    } else {
      console.error(`❌ Error: Server returned status ${res.statusCode}`);
      console.error(`📊 Response: ${data}`);
      process.exit(1);
    }
  });
});

request.on('error', (error) => {
  const duration = Date.now() - startTime;
  console.error(`❌ Error pinging server after ${duration}ms:`, error.message);
  process.exit(1);
});

// Set timeout to 30 seconds
request.setTimeout(30000, () => {
  request.destroy();
  console.error('❌ Error: Request timeout after 30 seconds');
  process.exit(1);
});

