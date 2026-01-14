const express = require('express');
const router = express.Router();

/**
 * GET /api/app/version-check
 * 
 * Checks if the app version meets the minimum required version.
 * 
 * Request Headers:
 * - X-App-Version: Current app version (e.g., "1.0.1")
 * 
 * Response:
 * {
 *   "minimumVersion": "1.0.2",
 *   "message": "This app version is outdated. Please update to version 1.0.2 or later to continue using the app.",
 *   "forceUpdate": true
 * }
 */
router.get('/version-check', (req, res) => {
  try {
    const currentVersion = req.headers['x-app-version'] || '1.0.0';
    
    // Get minimum required version from environment variable
    // Default to '1.0.0' if not set (allows all versions)
    const minimumVersion = process.env.MINIMUM_APP_VERSION || '1.0.0';
    
    // Generate a default message if not provided
    const defaultMessage = `This app version (${currentVersion}) is outdated. Please update to version ${minimumVersion} or later to continue using the app.`;
    const customMessage = process.env.APP_UPDATE_MESSAGE || defaultMessage;
    
    // Check if force update is enabled (default to true for security)
    const forceUpdate = process.env.FORCE_APP_UPDATE !== 'false';
    
    res.json({
      minimumVersion: minimumVersion,
      message: customMessage,
      forceUpdate: forceUpdate
    });
  } catch (error) {
    console.error('Version check error:', error);
    // Don't block users if version check fails
    res.status(500).json({
      error: 'Version check failed',
      minimumVersion: '1.0.0',
      message: 'Unable to check app version. Please try again later.',
      forceUpdate: false
    });
  }
});

module.exports = router;
