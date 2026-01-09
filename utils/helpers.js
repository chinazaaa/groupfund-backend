const crypto = require('crypto');

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate invite code
const generateInviteCode = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// Generate account number
const generateAccountNumber = () => {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
};

// Hash password (using bcrypt in auth routes, but keeping for reference)
// Password hashing is done in routes using bcryptjs

/**
 * Check if user has admin or co-admin permissions in a group
 * @param {string} userId - User ID to check
 * @param {string} groupId - Group ID
 * @param {Object} pool - Database pool
 * @returns {Promise<Object>} { isAdmin: boolean, isCoAdmin: boolean, isAdminOrCoAdmin: boolean, role: string }
 */
async function checkGroupAdminPermissions(userId, groupId, pool) {
  const result = await pool.query(
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
    [groupId, userId, 'active']
  );

  if (result.rows.length === 0) {
    return { isAdmin: false, isCoAdmin: false, isAdminOrCoAdmin: false, role: null };
  }

  const role = result.rows[0].role;
  const isAdmin = role === 'admin';
  const isCoAdmin = role === 'co-admin';
  const isAdminOrCoAdmin = isAdmin || isCoAdmin;

  return { isAdmin, isCoAdmin, isAdminOrCoAdmin, role };
}

module.exports = {
  generateOTP,
  generateInviteCode,
  generateAccountNumber,
  checkGroupAdminPermissions,
};
