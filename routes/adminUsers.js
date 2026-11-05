const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware');

const { requireAdmin } = authMiddleware;
const router = express.Router();

// GET /api/admin/users
// Returns every registered application account without authentication secrets.
router.get('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, profile_image_url, created_at
       FROM app_users
       ORDER BY name ASC, email ASC`
    );

    res.status(200).json({ users: result.rows });
  } catch (error) {
    console.error('Error fetching application accounts:', error.message);

    res.status(500).json({
      message: 'Failed to fetch application accounts.',
    });
  }
});

// GET /api/admin/users/:id/reports
// Returns incidents created by one account.
router.get('/:id/reports', authMiddleware, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({
      message: 'User ID must be a positive whole number.',
    });
  }

  try {
    const userResult = await pool.query(
      'SELECT id FROM app_users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        message: 'Application account not found.',
      });
    }

    const result = await pool.query(
      `SELECT id, title, location, severity, status, created_at
       FROM incidents
       WHERE reported_by = $1
       ORDER BY created_at DESC NULLS LAST, id DESC`,
      [userId]
    );

    res.status(200).json({ reports: result.rows });
  } catch (error) {
    console.error('Error fetching user reports:', error.message);

    res.status(500).json({
      message: 'Failed to fetch incidents reported by this user.',
    });
  }
});

// GET /api/admin/users/:id/assigned-incidents
// Returns incidents currently assigned to one account.
router.get(
  '/:id/assigned-incidents',
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        message: 'User ID must be a positive whole number.',
      });
    }

    try {
      const userResult = await pool.query(
        'SELECT id FROM app_users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          message: 'Application account not found.',
        });
      }

      const result = await pool.query(
        `SELECT id, title, location, severity, status, created_at
         FROM incidents
         WHERE assigned_to = $1
         ORDER BY created_at DESC NULLS LAST, id DESC`,
        [userId]
      );

      res.status(200).json({ assignedIncidents: result.rows });
    } catch (error) {
      console.error('Error fetching assigned incidents:', error.message);

      res.status(500).json({
        message: 'Failed to fetch incidents assigned to this user.',
      });
    }
  }
);

// GET /api/admin/users/:id
// Returns one account's safe profile fields plus incident activity counts.
router.get('/:id', authMiddleware, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({
      message: 'User ID must be a positive whole number.',
    });
  }

  try {
    const result = await pool.query(
      `SELECT
         app_users.id,
         app_users.name,
         app_users.email,
         app_users.role,
         app_users.profile_image_url,
         app_users.created_at,
         (
           SELECT COUNT(*)::int
           FROM incidents
           WHERE incidents.reported_by = app_users.id
         ) AS reports_count,
         (
           SELECT COUNT(*)::int
           FROM incidents
           WHERE incidents.assigned_to = app_users.id
         ) AS assigned_incidents_count
       FROM app_users
       WHERE app_users.id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Application account not found.',
      });
    }

    res.status(200).json({ user: result.rows[0] });
  } catch (error) {
    console.error('Error fetching application account:', error.message);

    res.status(500).json({
      message: 'Failed to fetch the application account.',
    });
  }
});

module.exports = router;
