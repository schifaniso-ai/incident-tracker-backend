
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const {
  normalizeEmail,
  validateProfileFields,
} = require('../utils/profile');

const router = express.Router();

// SIGN UP
router.post('/signup', async (req, res) => {
  try {
    const { password } = req.body || {};
    const {
      name: normalizedName,
      email: normalizedEmail,
      errors,
      isValid,
    } = validateProfileFields(req.body);

    if (!isValid) {
      return res.status(400).json({
        message: 'Please provide your name and a valid email address.',
        errors,
      });
    }

    if (typeof password !== 'string' || !password) {
      return res.status(400).json({
        message: 'Password is required.',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters long.'
      });
    }

    const existingUser = await pool.query(
  `SELECT id, name, email, password_hash, created_at, updated_at,
          profile_image_url, role
   FROM app_users WHERE email = $1`,
     [normalizedEmail]
);

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        message: 'An account with this email already exists.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO app_users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, profile_image_url, created_at, updated_at`,
      [normalizedName, normalizedEmail, passwordHash]
    );

    res.status(201).json({
      message: 'Account created successfully.',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Sign-up error:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        message: 'An account with this email already exists.'
      });
    }

    res.status(500).json({
      message: 'Unable to create account.'
    });
  }
});

// LOG IN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password are required.'
      });
    }

    const normalizedEmail = normalizeEmail(email);

    const result = await pool.query(
      `SELECT id, name, email, password_hash, created_at, updated_at,
              profile_image_url, role
       FROM app_users WHERE email = $1`,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: 'Invalid email or password.'
      });
    }

    const user = result.rows[0];

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: 'Invalid email or password.'
      });
    }

   const token = jwt.sign(
  {
    id: user.id,
    email: user.email,
    role: user.role
  },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

    res.json({
      message: 'Login successful.',
      token,
     user: {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  profileImageUrl: user.profile_image_url || null,
  createdAt: user.created_at,
  updatedAt: user.updated_at || user.created_at,
  created_at: user.created_at
}
    });
  } catch (error) {
    console.error('Login error:', error);

    res.status(500).json({
      message: 'Unable to log in.'
    });
  }
});

module.exports = router;
