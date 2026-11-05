
const pool = require('./config/db');

pool.query('SELECT NOW()', (err, result) => {
  if (err) {
    console.error('Database connection failed:', err.message);
  } else {
    console.log('Database connected successfully!');
    console.log('Database time:', result.rows[0].now);
  }

  pool.end();
});
