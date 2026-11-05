const express = require('express');
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const adminUsersRoutes = require('./routes/adminUsers');
const cors = require('cors');
const pool = require('./config/db');
const multer = require('multer');
const path = require('path');
const authMiddleware = require('./middleware/authMiddleware');
const { requireAdmin } = authMiddleware;
const { sendEmail } = require('./config/email');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  },
});

const app = express();

// Allow requests from the React frontend
app.use(cors({
    origin: 'http://localhost:3000'
}));


// Allow the server to read JSON data
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Test route
app.get('/', (req, res) => {
    res.send('Incident Tracker API is running');
});



app.post('/api/incidents', authMiddleware, upload.single('photo'), async (req, res) => {
    try {
        const { title, description, location, severity } = req.body;

        // Validate severity
        const allowedSeverities = ['low', 'medium', 'high'];

        if (severity && !allowedSeverities.includes(severity)) {
            return res.status(400).json({
                message: 'Invalid severity. Use low, medium, or high.'
            });
        }

        // Validate required fields
        if (
            !title || !title.trim() ||
            !description || !description.trim()
        ) {
            return res.status(400).json({
                message: 'Title and description are required.'
            });
        }

        // Save the uploaded photo path, if provided
        const photoPath = req.file
            ? `/uploads/${req.file.filename}`
            : null;

        const result = await pool.query(
            `INSERT INTO incidents
                (title, description, location, severity, photo_path, reported_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
                title.trim(),
                description.trim(),
                location?.trim() || null,
                severity || 'medium',
                photoPath,
                req.user?.id || null
            ]
        );

        const reporterResult = await pool.query(
            'SELECT name, email FROM app_users WHERE id = $1',
            [req.user.id]
        );

        const reporter = reporterResult.rows[0];

        if (reporter?.email) {
            try {
                const emailResult = await sendEmail({
                    to: reporter.email,
                    subject: `Incident Report Received - #${result.rows[0].id}`,
                    html: `
                        <h2>Incident Report Received</h2>

                        <p>Dear ${reporter.name || 'Staff Member'},</p>

                        <p>Thank you for submitting your incident report.</p>

                        <p>Your report has been successfully received and is awaiting review by the relevant personnel.</p>

                        <h3>Incident Details</h3>

                        <p><strong>Reference:</strong> #${result.rows[0].id}</p>
                        <p><strong>Title:</strong> ${result.rows[0].title}</p>
                        <p><strong>Location:</strong> ${result.rows[0].location || 'Not specified'}</p>
                        <p><strong>Severity:</strong> ${result.rows[0].severity}</p>
                        <p><strong>Status:</strong> ${result.rows[0].status}</p>

                        <p>You will receive further updates as your incident progresses.</p>

                        <p>Regards,<br>Incident Management Team</p>
                    `
                });

                if (emailResult.error) {
                    console.error('Resend email error:', emailResult.error);
                } else {
                    console.log('Acknowledgement email accepted by Resend. Email ID:', emailResult.data?.id);
                }
            } catch (emailError) {
                console.error('Email notification failed:', emailError.message);
            }
        }

        res.status(201).json({
    message: 'Incident report saved successfully',
    emailSent: Boolean(reporter?.email),
    incident: result.rows[0]
});
    } catch (error) {
        console.error('Error saving incident:', error.message);

        res.status(500).json({
            message: 'Failed to save incident report'
        });
    }
});


 // Get all incidents, with optional filters and search
app.get('/api/incidents', authMiddleware, async (req, res) => {
    try {
       const {
    status,
    severity,
    search,
    page = '1',
    sort = 'newest',
    startDate,
    endDate,
    mine
} = req.query;

// Validate page number
const pageNumber = Number(page);

if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return res.status(400).json({
        message: 'Page must be a positive integer.'
    });
}

// Pagination settings
const limit = 10;
const offset = (pageNumber - 1) * limit;

// Validate sort option
const allowedSortOptions = ['newest', 'oldest'];

if (
    typeof sort !== 'string' ||
    !allowedSortOptions.includes(sort.toLowerCase())
) {
    return res.status(400).json({
        message: 'Invalid sort option. Use newest or oldest.'
    });
}

// Validate date filters
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

if (startDate && !datePattern.test(startDate)) {
    return res.status(400).json({
        message: 'Invalid startDate. Use YYYY-MM-DD format.'
    });
}

if (endDate && !datePattern.test(endDate)) {
    return res.status(400).json({
        message: 'Invalid endDate. Use YYYY-MM-DD format.'
    });
}

// Validate actual calendar dates
const isValidDate = (date) => {
    if (!date) return true;

    const parsedDate = new Date(`${date}T00:00:00Z`);

    return !Number.isNaN(parsedDate.getTime()) &&
        parsedDate.toISOString().startsWith(date);
};

if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return res.status(400).json({
        message: 'Invalid calendar date.'
    });
}

// Ensure start date is not after end date
if (startDate && endDate && startDate > endDate) {
    return res.status(400).json({
        message: 'startDate must be before or equal to endDate.'
    });
}

// Validate the "my reports" filter
        if (
            mine !== undefined &&
            !['true', 'false'].includes(String(mine).toLowerCase())
        ) {
            return res.status(400).json({
                message: 'Invalid mine filter. Use true or false.'
            });
        }

        // Validate search input
        if (search !== undefined) {
            if (typeof search !== 'string' || !search.trim()) {
                return res.status(400).json({
                    message: 'Search must not be empty.'
                });
            }

            if (search.trim().length > 100) {
                return res.status(400).json({
                    message: 'Search must not exceed 100 characters.'
                });
            }
        }


        // Validate status filter
        const allowedStatuses = ['open', 'in progress', 'resolved'];

        if (status && !allowedStatuses.includes(status.toLowerCase())) {
            return res.status(400).json({
                message: 'Invalid status. Use open, in progress, or resolved.'
            });
        }

        // Validate severity filter
        const allowedSeverities = ['low', 'medium', 'high'];

        if (severity && !allowedSeverities.includes(severity.toLowerCase())) {
            return res.status(400).json({
                message: 'Invalid severity. Use low, medium, or high.'
            });
        }


        const values = [];
        const filters = ['1=1'];

        if (status) {
            values.push(status.toLowerCase());
            filters.push(`status = $${values.length}`);
        }

// Filter incidents by date range

if (startDate) {
    values.push(startDate);
    filters.push(`incidents.created_at >= $${values.length}`);
}

if (endDate) {
    values.push(endDate);
    filters.push(`incidents.created_at < ($${values.length}::date + INTERVAL '1 day')`);
}


        if (severity) {
            values.push(severity.toLowerCase());
            filters.push(`severity = $${values.length}`);
        }

        if (String(mine).toLowerCase() === 'true') {
            values.push(req.user.id);
            filters.push(`reported_by = $${values.length}`);
        }

        if (search) {
            values.push(`%${search}%`);
            filters.push(`(title ILIKE $${values.length} OR description ILIKE $${values.length})`);
        }

        const filterClause = `WHERE ${filters.join(' AND ')}`;
        let query = `SELECT incidents.*,
                reporter.name AS reported_by_name,
                reporter.email AS reported_by_email,
                reporter.profile_image_url AS reported_by_profile_image_url
            FROM incidents
            LEFT JOIN app_users reporter
                ON reporter.id = incidents.reported_by
            ${filterClause}`;

const countQuery = `SELECT COUNT(*) FROM incidents ${filterClause}`;
const countResult = await pool.query(countQuery, values);
const total = Number(countResult.rows[0].count);
const totalPages = Math.ceil(total / limit);

 // Sort incidents by date
if (sort.toLowerCase() === 'oldest') {
    query += ' ORDER BY incidents.created_at ASC';
} else {
    query += ' ORDER BY incidents.created_at DESC';
}
        values.push(limit, offset);
        query += ` LIMIT $${values.length - 1} OFFSET $${values.length}`;

        const result = await pool.query(query, values);

        res.status(200).json({
    page: pageNumber,
    limit,
    total,
    totalPages,
    incidents: result.rows
});

    } catch (error) {
        console.error('Error fetching incidents:', error.message);
        res.status(500).json({
            message: 'Failed to fetch incident reports'
        });
    }
});


 // Get incident summary statistics for the staff dashboard
app.get('/api/incidents/stats', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'open')::int AS open,
                COUNT(*) FILTER (WHERE status = 'in progress')::int AS in_progress,
                COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
                COUNT(*) FILTER (WHERE reported_by = $1)::int AS my_reports
             FROM incidents`,
            [req.user.id]
        );

        const stats = result.rows[0];

        res.status(200).json({
            stats: {
                total: stats.total,
                open: stats.open,
                inProgress: stats.in_progress,
                resolved: stats.resolved,
                myReports: stats.my_reports
            }
        });
    } catch (error) {
        console.error('Error fetching incident statistics:', error.message);
        res.status(500).json({
            message: 'Failed to fetch incident statistics'
        });
    }
});


 // Get one incident by ID
app.get('/api/incidents/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const incidentId = Number(id);

if (!Number.isInteger(incidentId) || incidentId <= 0) {
    return res.status(400).json({
        message: 'Incident ID must be a positive whole number.'
    });
}

        const result = await pool.query(
            `SELECT incidents.*,
                    reporter.name AS reported_by_name,
                    reporter.email AS reported_by_email,
                    reporter.profile_image_url AS reported_by_profile_image_url,
                    assignee.name AS assigned_staff_name,
                    assignee.email AS assigned_staff_email
             FROM incidents
             LEFT JOIN app_users reporter
                ON reporter.id = incidents.reported_by
             LEFT JOIN app_users assignee
                ON assignee.id = incidents.assigned_to
             WHERE incidents.id = $1`,
            [incidentId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: 'Incident not found'
            });
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching incident:', error.message);

        res.status(500).json({
            message: 'Failed to fetch incident'
        });
    }
});


 // Edit an incident's details
app.patch('/api/incidents/:id', authMiddleware, requireAdmin, upload.single('photo'), async (req, res) => {
    try {
        const incidentId = Number(req.params.id);
        const { title, description, location, severity } = req.body;

        if (!Number.isInteger(incidentId) || incidentId <= 0) {
            return res.status(400).json({
                message: 'Incident ID must be a positive whole number.'
            });
        }

        if (
            typeof title !== 'string' || !title.trim() ||
            typeof description !== 'string' || !description.trim()
        ) {
            return res.status(400).json({
                message: 'Title and description are required.'
            });
        }

        const allowedSeverities = ['low', 'medium', 'high'];

        if (
            severity &&
            !allowedSeverities.includes(severity.toLowerCase())
        ) {
            return res.status(400).json({
                message: 'Invalid severity. Use low, medium, or high.'
            });
        }

       const photoPath = req.file
    ? `/uploads/${req.file.filename}`
    : null;

const result = await pool.query(
    `UPDATE incidents
     SET title = $1,
         description = $2,
         location = $3,
         severity = $4,
         photo_path = COALESCE($5, photo_path)
     WHERE id = $6
     RETURNING *`,
    [
        title.trim(),
        description.trim(),
        typeof location === 'string' && location.trim()
            ? location.trim()
            : null,
        severity ? severity.toLowerCase() : 'medium',
        photoPath,
        incidentId
    ]
);

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: 'Incident not found.'
            });
        }

        res.status(200).json({
            message: 'Incident updated successfully.',
            incident: result.rows[0]
        });
    } catch (error) {
        console.error('Error updating incident:', error.message);

        res.status(500).json({
            message: 'Failed to update incident.'
        });
    }
});


 

 // Update an incident's status
app.patch('/api/incidents/:id/status', authMiddleware, requireAdmin, async (req, res) => {
    try {
        console.log('Request body:', req.body);
        console.log('Uploaded file:', req.file);

        const incidentId = Number(req.params.id);

        if (!Number.isInteger(incidentId) || incidentId <= 0) {
            return res.status(400).json({
                message: 'Incident ID must be a positive whole number.'
            });
        }

        const { status } = req.body;
        const normalizedStatus = status?.trim().toLowerCase();

        const allowedStatuses = ['open', 'in progress', 'resolved'];

        if (!allowedStatuses.includes(normalizedStatus)) {
            return res.status(400).json({
                message: 'Invalid status. Use open, in progress, or resolved.'
            });
        }

        const result = await pool.query(
    `UPDATE incidents
     SET status = $1
     WHERE id = $2
     RETURNING *`,
    [normalizedStatus, incidentId]
);

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: 'Incident not found.'
            });
        }

        res.status(200).json({
            message: 'Incident status updated successfully.',
            incident: result.rows[0]
        });
    } catch (error) {
        console.error('Error updating incident status:', error.message);

        res.status(500).json({
            message: 'Failed to update incident status.'
        });
    }
});

// List the staff members an administrator can assign an incident to.
app.get('/api/admin/staff', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, email, profile_image_url
             FROM app_users
             WHERE role = 'staff'
             ORDER BY name ASC, email ASC`
        );

        res.status(200).json({ staff: result.rows });
    } catch (error) {
        console.error('Error fetching staff members:', error.message);

        res.status(500).json({
            message: 'Failed to fetch staff members.'
        });
    }
});

// Assign an incident to a responsible staff member (or clear the assignment).
app.patch(
    '/api/incidents/:id/assignment',
    authMiddleware,
    requireAdmin,
    async (req, res) => {
        try {
            const incidentId = Number(req.params.id);

            if (!Number.isInteger(incidentId) || incidentId <= 0) {
                return res.status(400).json({
                    message: 'Incident ID must be a positive whole number.'
                });
            }

            const rawAssignee =
                req.body?.assignedTo ?? req.body?.assigned_to ?? null;

            let assignedTo = null;

            if (rawAssignee !== null && rawAssignee !== '') {
                assignedTo = Number(rawAssignee);

                if (!Number.isInteger(assignedTo) || assignedTo <= 0) {
                    return res.status(400).json({
                        message: 'Choose a valid staff member.'
                    });
                }

                const assignee = await pool.query(
                    `SELECT id FROM app_users
                     WHERE id = $1 AND role = 'staff'`,
                    [assignedTo]
                );

                if (assignee.rows.length === 0) {
                    return res.status(400).json({
                        message: 'Choose a valid staff member.'
                    });
                }
            }

            const result = await pool.query(
                `UPDATE incidents
                 SET assigned_to = $1
                 WHERE id = $2
                 RETURNING *`,
                [assignedTo, incidentId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    message: 'Incident not found.'
                });
            }

            const incidentResult = await pool.query(
                `SELECT incidents.*,
                        reporter.name AS reported_by_name,
                        reporter.email AS reported_by_email,
                        reporter.profile_image_url AS reported_by_profile_image_url,
                        assignee.name AS assigned_staff_name,
                        assignee.email AS assigned_staff_email
                 FROM incidents
                 LEFT JOIN app_users reporter
                    ON reporter.id = incidents.reported_by
                 LEFT JOIN app_users assignee
                    ON assignee.id = incidents.assigned_to
                 WHERE incidents.id = $1`,
                [incidentId]
            );

            res.status(200).json({
                message: assignedTo
                    ? 'Incident assigned successfully.'
                    : 'Incident assignment cleared.',
                incident: incidentResult.rows[0] || result.rows[0]
            });
        } catch (error) {
            console.error('Error assigning incident:', error.message);

            res.status(500).json({
                message: 'Failed to assign incident.'
            });
        }
    }
);

// Ensure incidents can be linked to the staff member who reported them
const ensureIncidentOwnershipColumn = async () => {
    try {
        await pool.query(
            'ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reported_by INTEGER'
        );
    } catch (error) {
        console.error(
            'Could not prepare incident ownership column:',
            error.message
        );
    }
};

// Keep the profile columns available for existing databases. The SQL
// migration in backend/sql is the authoritative schema change; this runtime
// guard makes development environments resilient if it has not been run yet.
const ensureProfileSchema = async () => {
    try {
        await pool.query(
            'ALTER TABLE app_users ADD COLUMN IF NOT EXISTS profile_image_url TEXT'
        );
        await pool.query(
            `ALTER TABLE app_users
             ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL
             DEFAULT CURRENT_TIMESTAMP`
        );
        await pool.query(
            `UPDATE app_users
             SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP)
             WHERE updated_at IS NULL`
        );
        await pool.query(
            'ALTER TABLE app_users ALTER COLUMN updated_at SET NOT NULL'
        );

        try {
            await pool.query(
                `CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_key
                 ON app_users (LOWER(email))`
            );
        } catch (indexError) {
            console.error(
                'Could not create case-insensitive email index:',
                indexError.message
            );
        }
    } catch (error) {
        console.error('Could not prepare profile columns:', error.message);
    }
};

// Assignment support. The SQL migration in backend/sql is the authoritative
// schema change; this guard keeps development databases working if it has not
// been run yet.
const ensureIncidentAssignmentColumn = async () => {
    try {
        await pool.query(
            'ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_to INTEGER'
        );

        await pool.query(
            `DO $$
             BEGIN
                 IF NOT EXISTS (
                     SELECT 1 FROM pg_constraint
                     WHERE conname = 'incidents_assigned_to_fkey'
                 ) THEN
                     ALTER TABLE incidents
                     ADD CONSTRAINT incidents_assigned_to_fkey
                     FOREIGN KEY (assigned_to)
                     REFERENCES app_users(id)
                     ON DELETE SET NULL;
                 END IF;
             END $$;`
        );

        await pool.query(
            `CREATE INDEX IF NOT EXISTS incidents_assigned_to_idx
             ON incidents (assigned_to)`
        );
    } catch (error) {
        console.error(
            'Could not prepare incident assignment column:',
            error.message
        );
    }
};

// Start server after all routes have been registered
const startServer = async () => {
    try {
        await ensureIncidentOwnershipColumn();
        await ensureIncidentAssignmentColumn();
        await ensureProfileSchema();

        const port = process.env.PORT || 5000;

        const server = app.listen(port, () => {
            console.log(`Incident Tracker is running on port ${port}`);
        });

        server.on('error', (error) => {
            console.error('Server startup error:', error.message);
        });

    } catch (error) {
        console.error('Failed to start server:', error.message);
        process.exit(1);
    }
};

// Delete an incident by ID
app.delete('/api/incidents/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const incidentId = Number(req.params.id);

        if (!Number.isInteger(incidentId) || incidentId <= 0) {
            return res.status(400).json({
                message: 'Incident ID must be a positive whole number.'
            });
        }

        const result = await pool.query(
            'DELETE FROM incidents WHERE id = $1 RETURNING *',
            [incidentId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: 'Incident not found'
            });
        }

        res.status(200).json({
            message: 'Incident deleted successfully',
            incident: result.rows[0]
        });
    } catch (error) {
        console.error('Error deleting incident:', error.message);
        res.status(500).json({
            message: 'Failed to delete incident'
        });
    }
});

startServer();
