const { authenticate } = require('./auth');

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
  // First authenticate the user
  authenticate(req, res, () => {
    // Check if user is admin
    if (!req.user || !req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
};

module.exports = { requireAdmin };

