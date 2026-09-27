const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

async function ensureDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
  });

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
      console.log('[bootstrap] Loading initial game data...');
      await pool.query(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8'));
    }

    // Safe, repeatable upgrades. This runs on every deploy and never deletes player data.
    const upgradePath = path.join(__dirname, 'upgrade.sql');
    if (fs.existsSync(upgradePath)) {
      console.log('[bootstrap] Applying game updates...');
      await pool.query(fs.readFileSync(upgradePath, 'utf8'));
    }

    // Keep the original seed behaviour for completely empty databases.
    const cases = await pool.query('SELECT COUNT(*)::int AS count FROM cases');
    if (cases.rows[0].count === 0) {
      console.log('[bootstrap] Loading initial game data...');
      await pool.query(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8'));
    }

    // Optional developer account. Password lives only in Render environment variables.
    const developerPassword = process.env.DEVELOPER_PASSWORD;
    if (developerPassword && developerPassword.length >= 8) {
      const hash = await bcrypt.hash(developerPassword, 12);
      const r = await pool.query(`
        INSERT INTO users
          (nickname, password_hash, balance, is_premium, is_admin, cases_opened,
           total_value, level, role_tag, bio, profile_theme)
        VALUES
          ('NEMESIS_DEV', $1, 99999999, TRUE, TRUE, 999,
           99999999, 100, 'Разработчик',
           'Создатель NEMESIS. Доступ к административным инструментам.',
           'developer')
        ON CONFLICT (nickname) DO UPDATE SET
          password_hash=EXCLUDED.password_hash,
          balance=99999999,
          is_premium=TRUE,
          is_admin=TRUE,
          cases_opened=999,
          total_value=99999999,
          level=100,
          role_tag='Разработчик',
          bio='Создатель NEMESIS. Доступ к административным инструментам.',
          profile_theme='developer'
        RETURNING id
      `, [hash]);
      await pool.query(
        'INSERT INTO equipped (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
        [r.rows[0].id]
      );
      console.log('[bootstrap] Developer account ready: NEMESIS_DEV');
    } else {
      console.log('[bootstrap] DEVELOPER_PASSWORD not set; developer account was not created/updated.');
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
