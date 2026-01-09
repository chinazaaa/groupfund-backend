const express = require('express');
const pool = require('../config/database');
const path = require('path');

const router = express.Router();

// Deep link handler for group sharing
// Route: /g/:inviteCode or /group/:inviteCode
router.get('/g/:inviteCode', async (req, res) => {
  try {
    const { inviteCode } = req.params;

    // Verify the invite code exists (case-insensitive search)
    const groupResult = await pool.query(
      `SELECT g.id, g.name, g.invite_code, g.status, g.accepting_requests
       FROM groups g
       WHERE LOWER(g.invite_code) = LOWER($1)`,
      [inviteCode]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Group Not Found</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px 20px; }
            h1 { color: #e74c3c; }
          </style>
        </head>
        <body>
          <h1>Group Not Found</h1>
          <p>The group you're looking for doesn't exist or the invite code is invalid.</p>
        </body>
        </html>
      `);
    }

    const group = groupResult.rows[0];

    // Check if group is closed
    if (group.status === 'closed') {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Group Closed</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px 20px; }
            h1 { color: #e74c3c; }
          </style>
        </head>
        <body>
          <h1>Group Closed</h1>
          <p>This group is closed and no longer accepting new members.</p>
        </body>
        </html>
      `);
    }

    // Get user agent to detect device
    const userAgent = req.headers['user-agent'] || '';
    const isIOS = /iPad|iPhone|iPod/.test(userAgent);
    const isAndroid = /Android/.test(userAgent);
    const isMobile = isIOS || isAndroid;

    // App store URLs (these should be configured in environment variables)
    const iosAppStoreUrl = process.env.IOS_APP_STORE_URL || 'https://apps.apple.com/app/groupfund/idYOUR_APP_ID';
    const androidPlayStoreUrl = process.env.ANDROID_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.groupfund.app';
    
    // Deep link scheme (should match your Expo app configuration)
    // Format: groupfund://join/CODE
    // The app should handle this route and:
    // - If user is NOT logged in → navigate to login screen, then after login navigate to join screen with code
    // - If user IS logged in → navigate directly to join screen with code prefilled
    const deepLinkScheme = process.env.DEEP_LINK_SCHEME || 'groupfund';
    const deepLinkUrl = `${deepLinkScheme}://join/${inviteCode}`;

    // Universal link (if configured)
    const universalLink = process.env.UNIVERSAL_LINK_URL || `https://groupfund.app/g/${inviteCode}`;

    // Send HTML page with smart redirect
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Join ${group.name} - GroupFund</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta property="og:title" content="Join ${group.name} - GroupFund">
        <meta property="og:description" content="Join this group on GroupFund">
        <meta property="og:type" content="website">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
          }
          .logo {
            font-size: 48px;
            margin-bottom: 20px;
          }
          h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 28px;
          }
          .group-name {
            color: #667eea;
            font-weight: 600;
            font-size: 24px;
            margin-bottom: 30px;
          }
          .code {
            background: #f5f5f5;
            padding: 15px 30px;
            border-radius: 10px;
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 5px;
            color: #667eea;
            margin: 20px 0;
            font-family: 'Courier New', monospace;
          }
          .message {
            color: #666;
            margin: 20px 0;
            line-height: 1.6;
          }
          .button {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 15px 40px;
            border-radius: 10px;
            text-decoration: none;
            font-weight: 600;
            margin: 10px;
            transition: transform 0.2s, box-shadow 0.2s;
          }
          .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
          }
          .button:active {
            transform: translateY(0);
          }
          .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .fallback {
            margin-top: 30px;
            padding-top: 30px;
            border-top: 1px solid #eee;
          }
          .fallback-text {
            color: #999;
            font-size: 14px;
            margin-bottom: 15px;
          }
        </style>
        <script>
          (function() {
            const inviteCode = '${inviteCode}';
            const deepLinkUrl = '${deepLinkUrl}';
            const isIOS = ${isIOS};
            const isAndroid = ${isAndroid};
            const isMobile = ${isMobile};
            const iosAppStoreUrl = '${iosAppStoreUrl}';
            const androidPlayStoreUrl = '${androidPlayStoreUrl}';
            const universalLink = '${universalLink}';

            // Try to open the app immediately
            function openApp() {
              if (isMobile) {
                // Try deep link
                window.location.href = deepLinkUrl;
                
                // If app is not installed, redirect to store after a delay
                setTimeout(function() {
                  if (isIOS) {
                    window.location.href = iosAppStoreUrl;
                  } else if (isAndroid) {
                    window.location.href = androidPlayStoreUrl;
                  }
                }, 2500);
              } else {
                // Desktop: show instructions
                document.getElementById('desktop-message').style.display = 'block';
                document.getElementById('spinner').style.display = 'none';
              }
            }

            // Try universal link first (iOS 9+)
            if (isIOS) {
              // Try universal link
              window.location.href = universalLink;
              setTimeout(openApp, 1000);
            } else {
              openApp();
            }

            // Fallback: manual button click
            document.getElementById('open-app-btn').addEventListener('click', function() {
              if (isMobile) {
                window.location.href = deepLinkUrl;
                setTimeout(function() {
                  if (isIOS) {
                    window.location.href = iosAppStoreUrl;
                  } else if (isAndroid) {
                    window.location.href = androidPlayStoreUrl;
                  }
                }, 500);
              }
            });
          })();
        </script>
      </head>
      <body>
        <div class="container">
          <div class="logo">🎉</div>
          <h1>Join Group</h1>
          <div class="group-name">${group.name}</div>
          <div class="code">${inviteCode}</div>
          <div id="spinner" class="spinner"></div>
          <p class="message" id="mobile-message" style="display: ${isMobile ? 'block' : 'none'}">
            Opening GroupFund app...
          </p>
          <p class="message" id="desktop-message" style="display: none">
            Scan this code with your mobile device or enter the code manually in the app.
          </p>
          <div class="fallback">
            <p class="fallback-text">Don't have the app?</p>
            <a href="${isIOS ? iosAppStoreUrl : isAndroid ? androidPlayStoreUrl : '#'}" class="button" id="download-btn">
              Download GroupFund
            </a>
            <br>
            <a href="${deepLinkUrl}" class="button" id="open-app-btn" style="background: #764ba2;">
              Open in App
            </a>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Deep link error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px 20px; }
          h1 { color: #e74c3c; }
        </style>
      </head>
      <body>
        <h1>Something went wrong</h1>
        <p>Please try again later.</p>
      </body>
      </html>
    `);
  }
});

// Alternative route: /group/:inviteCode (same handler)
router.get('/group/:inviteCode', async (req, res) => {
  // Redirect to /g/:inviteCode
  res.redirect(`/g/${req.params.inviteCode}`);
});

module.exports = router;

