const jwt = require('jsonwebtoken');
const User = require('../models/User');

// A verified JWT alone used to be trusted for its whole life (JWT_EXPIRES_IN,
// default 7d) with no live check against the account it names — suspending a
// user, changing their role/college, or changing their password (e.g. to
// lock out a stolen device) did nothing to a token already issued, since
// req.user was built entirely from the token's own (stale) payload. Every
// place that revokes access now bumps User.tokenVersion (see adminController
// updateUser/bulkUpdateStatus, authController resetPassword, and the
// password-change endpoints in alumniController/routes/auth.js) — comparing
// it here on every request is what actually makes that revocation take
// effect immediately instead of "whenever this token happens to expire."
// Reading role/college/status live from the DB (instead of the token) also
// means a role/college change or suspension applies on the user's very next
// request, not just after they log in again.
const protect = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authenticated.' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id, 'role college status tokenVersion').lean();
    if (!user) return res.status(401).json({ message: 'Invalid or expired token.' });
    if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({ message: 'Your session has expired. Please log in again.' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ message: 'Your account has been suspended. Please contact the administrator.' });
    }
    req.user = { id: decoded.id, role: user.role, college: user.college || '' };
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

// Usage: protect, authorize('admin')  or  protect, authorize('admin', 'coordinator')
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
  }
  next();
};

module.exports = { protect, authorize };
