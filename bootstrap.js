const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function ensureDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
  try {
    const exists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='users'
      ) AS exists
    `);

    if (!exists.rows[0].exists) {
      console.log('[bootstrap] Creating database schema...');
      await pool.query(fs.readFileSync(path.join(__dirname, 'db.sql'), 'utf8'));
    }

    const cases = await pool.query('SELECT COUNT(*)::int AS count FROM cases');
    if (cases.rows[0].count === 0) {
      console.log('[bootstrap] Loading initial game data...');
      await pool.query(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8'));
    }

    console.log('[bootstrap] Database ready');
  } finally {
    await pool.end();
  }
}

ensureDatabase().catch((err) => {
  console.error('[bootstrap] Failed:', err);
  process.exit(1);
});
