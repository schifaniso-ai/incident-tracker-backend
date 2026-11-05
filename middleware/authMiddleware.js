
const jwt = require('jsonwebtoken');

function normalizeRole(role) {
  return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Authentication required. Please log in.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      ...decoded,
      role: normalizeRole(decoded.role)
    };

    next();
  } catch (error) {
    return res.status(401).json({
      message: 'Invalid or expired token. Please log in again.'
    });
  }
}

/**
 * Allow the request through only when the authenticated user's role is one of
 * the supplied roles. Authentication must run before this middleware so that
 * req.user is always populated.
 */
function requireRole(...allowedRoles) {
  const roles = allowedRoles
    .flat()
    .map(normalizeRole)
    .filter(Boolean);

  return function roleGuard(req, res, next) {
    const userRole = normalizeRole(req.user?.role);

    if (!roles.includes(userRole)) {
      return res.status(403).json({
        message: 'You do not have permission to perform this action.'
      });
    }

    return next();
  };
}

const requireAdmin = requireRole('admin');

module.exports = authMiddleware;
module.exports.requireRole = requireRole;
module.exports.requireAdmin = requireAdmin;
