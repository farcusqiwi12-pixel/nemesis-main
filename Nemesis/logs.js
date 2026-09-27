module.exports = function (app, pool, auth, requireAdmin) {
  app.get('/api/admin/logs', auth, requireAdmin, async (req, res) => {
    const { user_id, action, from, to, limit = 100 } = req.query;
    let query = 'SELECT * FROM logs WHERE 1=1';
    const params = [];

    if (user_id) {
      params.push(user_id);
      query += ` AND user_id = $${params.length}`;
    }
    if (action) {
      params.push(action);
      query += ` AND action = $${params.length}`;
    }
    if (from) {
      params.push(from);
      query += ` AND created_at >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      query += ` AND created_at <= $${params.length}`;
    }
    params.push(Math.min(Number(limit) || 100, 500));
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const r = await pool.query(query, params);
    res.json(r.rows);
  });

  app.get('/api/admin/logs/dispute/:userIdA/:userIdB', auth, requireAdmin, async (req, res) => {
    const { userIdA, userIdB } = req.params;
    const r = await pool.query(
      `SELECT * FROM logs
       WHERE (payload->>'with' = $1 OR payload->>'with' = $2 OR user_id = $1 OR user_id = $2)
       ORDER BY created_at ASC`,
      [userIdA, userIdB]
    );
    res.json(r.rows);
  });

  app.get('/api/admin/logs/user/:userId/timeline', auth, requireAdmin, async (req, res) => {
    const r = await pool.query(
      'SELECT * FROM logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200',
      [req.params.userId]
    );
    res.json(r.rows);
  });

  app.get('/api/admin/logs/case-opening/:openingId', auth, requireAdmin, async (req, res) => {
    const openR = await pool.query('SELECT * FROM case_openings WHERE id=$1', [req.params.openingId]);
    if (!openR.rows.length) return res.status(404).json({ error: 'not_found' });
    const o = openR.rows[0];
    const logR = await pool.query(
      `SELECT * FROM logs WHERE user_id=$1 AND action='open_case' AND payload->>'item_id'=$2`,
      [o.user_id, o.item_id]
    );
    res.json({ opening: o, logs: logR.rows });
  });
};
