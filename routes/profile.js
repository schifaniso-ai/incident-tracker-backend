const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const multer = require('multer');
const path = require('path');
const pool = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware');
const {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  PROFILE_COLUMNS,
  deleteStoredImage,
  mapProfile,
  validateProfileFields,
  validateProfileImage,
} = require('../utils/profile');

const router = express.Router();
const UPLOAD_DIRECTORY = path.join(__dirname, '..', 'uploads');

const profileUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: 1,
  },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
      return callback(
        new Error('Profile pictures must be JPG, PNG or WEBP images.')
      );
    }

    return callback(null, true);
  },
});

/**
 * Wrap multer so its errors become the same JSON error shape as the rest of
 * the API. The file never touches disk until its signature has been checked.
 */
function uploadProfilePicture(req, res, next) {
  profileUpload.single('picture')(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: 'Profile pictures must be 5 MB or smaller.',
      });
    }

    return res.status(400).json({
      message: error.message || 'Could not upload the profile picture.',
    });
  });
}

// Every profile endpoint requires a valid JWT. The user id always comes from
// the token, never from the request body or query string.
router.use(authMiddleware);

// GET /api/profile - return the authenticated user's profile.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${PROFILE_COLUMNS} FROM app_users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Profile not found.',
      });
    }

    return res.status(200).json({ profile: mapProfile(result.rows[0]) });
  } catch (error) {
    console.error('Error fetching profile:', error.message);

    return res.status(500).json({
      message: 'Unable to load the profile.',
    });
  }
});

/**
 * Shared create/update handler.
 *
 * app_users is the application's user/profile table. Sign-up already creates
 * the row, so POST acts as the idempotent "create profile details" operation
 * for clients that need to initialise a profile, while PUT updates it.
 */
function saveProfile({ successStatus, successMessage }) {
  return async (req, res) => {
    const { name, email, errors, isValid } = validateProfileFields(req.body);

    if (!isValid) {
      return res.status(400).json({
        message: 'Please correct the highlighted fields.',
        errors,
      });
    }

    try {
      const duplicate = await pool.query(
        `SELECT id FROM app_users
         WHERE LOWER(email) = LOWER($1) AND id <> $2`,
        [email, req.user.id]
      );

      if (duplicate.rows.length > 0) {
        return res.status(409).json({
          message: 'That email address is already in use by another account.',
        });
      }

      const result = await pool.query(
        `UPDATE app_users
         SET name = $1,
             email = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING ${PROFILE_COLUMNS}`,
        [name, email, req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: 'Profile not found.',
        });
      }

      return res.status(successStatus).json({
        message: successMessage,
        profile: mapProfile(result.rows[0]),
      });
    } catch (error) {
      console.error('Error saving profile:', error.message);

      if (error.code === '23505') {
        return res.status(409).json({
          message: 'That email address is already in use by another account.',
        });
      }

      return res.status(500).json({
        message: 'Unable to save the profile.',
      });
    }
  };
}

// POST /api/profile - create/initialise the authenticated user's profile.
router.post(
  '/',
  saveProfile({
    successStatus: 201,
    successMessage: 'Profile created successfully.',
  })
);

// PUT /api/profile - update the authenticated user's name and email.
router.put(
  '/',
  saveProfile({
    successStatus: 200,
    successMessage: 'Profile updated successfully.',
  })
);

// POST /api/profile/picture - upload or replace a profile picture.
router.post('/picture', uploadProfilePicture, async (req, res) => {
  const validation = validateProfileImage(req.file);

  if (validation.error) {
    return res.status(400).json({ message: validation.error });
  }

  const fileName = `profile-${req.user.id}-${Date.now()}-${crypto.randomUUID()}.${
    validation.extension
  }`;
  const filePath = path.join(UPLOAD_DIRECTORY, fileName);
  const imageUrl = `/uploads/${fileName}`;

  try {
    const currentProfile = await pool.query(
      `SELECT ${PROFILE_COLUMNS} FROM app_users WHERE id = $1`,
      [req.user.id]
    );

    if (currentProfile.rows.length === 0) {
      return res.status(404).json({ message: 'Profile not found.' });
    }

    await fs.mkdir(UPLOAD_DIRECTORY, { recursive: true });
    await fs.writeFile(filePath, req.file.buffer, { flag: 'wx' });

    const result = await pool.query(
      `UPDATE app_users
       SET profile_image_url = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING ${PROFILE_COLUMNS}`,
      [imageUrl, req.user.id]
    );

    if (result.rows.length === 0) {
      await deleteStoredImage(imageUrl, UPLOAD_DIRECTORY);
      return res.status(404).json({ message: 'Profile not found.' });
    }

    // The replacement has been saved successfully, so the old file is no
    // longer needed. Failure to remove it is logged but does not undo the save.
    await deleteStoredImage(
      currentProfile.rows[0].profile_image_url,
      UPLOAD_DIRECTORY
    );

    return res.status(200).json({
      message: 'Profile picture updated successfully.',
      profile: mapProfile(result.rows[0]),
    });
  } catch (error) {
    await deleteStoredImage(imageUrl, UPLOAD_DIRECTORY);
    console.error('Error saving profile picture:', error.message);

    return res.status(500).json({
      message: 'Unable to save the profile picture.',
    });
  }
});

// DELETE /api/profile/picture - remove the current picture and its file.
router.delete('/picture', async (req, res) => {
  try {
    const currentProfile = await pool.query(
      `SELECT ${PROFILE_COLUMNS} FROM app_users WHERE id = $1`,
      [req.user.id]
    );

    if (currentProfile.rows.length === 0) {
      return res.status(404).json({ message: 'Profile not found.' });
    }

    const result = await pool.query(
      `UPDATE app_users
       SET profile_image_url = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING ${PROFILE_COLUMNS}`,
      [req.user.id]
    );

    await deleteStoredImage(
      currentProfile.rows[0].profile_image_url,
      UPLOAD_DIRECTORY
    );

    return res.status(200).json({
      message: 'Profile picture removed successfully.',
      profile: mapProfile(result.rows[0]),
    });
  } catch (error) {
    console.error('Error removing profile picture:', error.message);

    return res.status(500).json({
      message: 'Unable to remove the profile picture.',
    });
  }
});

module.exports = router;
