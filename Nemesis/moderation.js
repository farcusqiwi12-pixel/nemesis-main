module.exports = function (app, pool, auth, requireAdmin, log, io) {
  const REPORT_THRESHOLD = 5;
  const KICK_DURATION_MIN = 30;

  app.get('/api/admin/reports', auth, requireAdmin, async (req, res) => {
    const { status = 'open' } = req.query;
    const r = await pool.query(
      `SELECT r.*, u1.nickname as reporter_nickname, u2.nickname as reported_nickname
       FROM reports r
       JOIN users u1 ON u1.id = r.reporter_id
       JOIN users u2 ON u2.id = r.reported_id
       WHERE r.status = $1
       ORDER BY r.created_at DESC`,
      [status]
    );
    res.json(r.rows);
  });

  app.post('/api/admin/reports/:id/review', auth, requireAdmin, async (req, res) => {
    const { action } = req.body;
    const status = action === 'dismiss' ? 'dismissed' : 'reviewed';
    const r = await pool.query(
      'UPDATE reports SET status=$1 WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
    await log(req.user.id, 'report_reviewed', { report_id: req.params.id, action });
    res.json(r.rows[0]);
  });

  app.post('/api/admin/users/:id/kick', auth, requireAdmin, async (req, res) => {
    const userId = req.params.id;
    const minutes = Number(req.body.minutes) || KICK_DURATION_MIN;
    const until = new Date(Date.now() + minutes * 60 * 1000);
    await pool.query('UPDATE users SET kicked_until=$1 WHERE id=$2', [until, userId]);
    await log(req.user.id, 'admin_kick', { target_id: userId, minutes });
    io.to(userId).emit('kicked', { until });
    res.json({ ok: true, until });
  });

  app.post('/api/admin/users/:id/unkick', auth, requireAdmin, async (req, res) => {
    const userId = req.params.id;
    await pool.query('UPDATE users SET kicked_until=NULL, reports_count=0 WHERE id=$1', [userId]);
    await log(req.user.id, 'admin_unkick', { target_id: userId });
    res.json({ ok: true });
  });

  async function checkAutoKick(pool, userId) {
    const r = await pool.query('SELECT reports_count FROM users WHERE id=$1', [userId]);
    if (!r.rows.length) return false;
    if (r.rows[0].reports_count > REPORT_THRESHOLD) {
      const until = new Date(Date.now() + KICK_DURATION_MIN * 60 * 1000);
      await pool.query('UPDATE users SET kicked_until=$1, reports_count=0 WHERE id=$2', [until, userId]);
      await log(userId, 'auto_kicked', { reports_count: r.rows[0].reports_count, duration_min: KICK_DURATION_MIN });
      io.to(userId).emit('kicked', { until });
      return true;
    }
    return false;
  }

  return { checkAutoKick };
};
