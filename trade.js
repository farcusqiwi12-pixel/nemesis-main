module.exports = function (app, io, pool, auth, log) {
  const pendingTimers = new Map();

  app.get('/api/trade/:id', auth, async (req, res) => {
    const tradeR = await pool.query(
      `SELECT t.*,
              ui.nickname AS initiator_nickname,
              ur.nickname AS recipient_nickname
       FROM trades t
       JOIN users ui ON ui.id=t.initiator_id
       JOIN users ur ON ur.id=t.recipient_id
       WHERE t.id=$1 AND (t.initiator_id=$2 OR t.recipient_id=$2)`,
      [req.params.id, req.user.id]
    );
    if (!tradeR.rows.length) return res.status(404).json({ error: 'not_found' });
    const trade = tradeR.rows[0];
    const itemsR = await pool.query(
      `SELECT ti.*, i.owner_id, i.type, i.level, i.rarity, t.name, t.base_stats
       FROM trade_items ti
       JOIN items i ON i.id=ti.item_id
       JOIN item_templates t ON t.id=i.template_id
       WHERE ti.trade_id=$1
       ORDER BY ti.from_user_id, ti.id`,
      [req.params.id]
    );
    res.json({ trade, items: itemsR.rows });
  });

  app.post('/api/trade/create', auth, async (req, res) => {
    const { recipient_id } = req.body;
    if (recipient_id === req.user.id) return res.status(400).json({ error: 'self_trade' });
    const r = await pool.query(
      `INSERT INTO trades (initiator_id, recipient_id) VALUES ($1,$2) RETURNING *`,
      [req.user.id, recipient_id]
    );
    io.to(recipient_id).emit('trade_invite', { trade: r.rows[0] });
    res.json(r.rows[0]);
  });

  app.post('/api/trade/:id/offer', auth, async (req, res) => {
    const userId = req.user.id;
    const tradeId = req.params.id;
    const { item_ids = [], currency = 0 } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tradeR = await client.query('SELECT * FROM trades WHERE id=$1 AND status=$2 FOR UPDATE', [tradeId, 'pending']);
      if (!tradeR.rows.length) throw { code: 'not_found' };
      const trade = tradeR.rows[0];
      if (trade.initiator_id !== userId && trade.recipient_id !== userId) throw { code: 'not_participant' };
      if (!Array.isArray(item_ids) || item_ids.length > 20) throw { code: 'bad_offer' };
      const normalizedCurrency = Number(currency);
      if (!Number.isSafeInteger(normalizedCurrency) || normalizedCurrency < 0) throw { code: 'bad_currency' };

      const balanceR = await client.query('SELECT balance FROM users WHERE id=$1 FOR UPDATE', [userId]);
      if (!balanceR.rows.length || balanceR.rows[0].balance < normalizedCurrency) throw { code: 'not_enough_balance' };

      for (const itemId of item_ids) {
        const ownR = await client.query("SELECT id FROM items WHERE id=$1 AND owner_id=$2 AND status='owned'", [itemId, userId]);
        if (!ownR.rows.length) throw { code: 'not_owner', item_id: itemId };
      }

      await client.query('DELETE FROM trade_items WHERE trade_id=$1 AND from_user_id=$2', [tradeId, userId]);
      for (const itemId of item_ids) {
        await client.query(
          'INSERT INTO trade_items (trade_id, item_id, from_user_id) VALUES ($1,$2,$3)',
          [tradeId, itemId, userId]
        );
      }

      const field = trade.initiator_id === userId ? 'initiator_currency' : 'recipient_currency';
      await client.query(
        `UPDATE trades SET ${field}=$1,
         initiator_confirmed=FALSE, recipient_confirmed=FALSE
         WHERE id=$2`,
        [normalizedCurrency, tradeId]
      );

      await client.query('COMMIT');

      const otherId = trade.initiator_id === userId ? trade.recipient_id : trade.initiator_id;
      io.to(otherId).emit('trade_updated', { trade_id: tradeId });
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: e.code || 'server_error' });
    } finally {
      client.release();
    }
  });

  app.post('/api/trade/:id/confirm', auth, async (req, res) => {
    const userId = req.user.id;
    const tradeId = req.params.id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tradeR = await client.query('SELECT * FROM trades WHERE id=$1 AND status=$2 FOR UPDATE', [tradeId, 'pending']);
      if (!tradeR.rows.length) throw { code: 'not_found' };
      const trade = tradeR.rows[0];
      if (trade.initiator_id !== userId && trade.recipient_id !== userId) throw { code: 'not_participant' };

      const field = trade.initiator_id === userId ? 'initiator_confirmed' : 'recipient_confirmed';
      if (trade[field]) throw { code: 'already_confirmed' };
      await client.query(`UPDATE trades SET ${field}=TRUE WHERE id=$1`, [tradeId]);

      const check = await client.query('SELECT * FROM trades WHERE id=$1', [tradeId]);
      const t = check.rows[0];

      await client.query('COMMIT');

      const otherId = trade.initiator_id === userId ? trade.recipient_id : trade.initiator_id;
      io.to(otherId).emit('trade_updated', { trade_id: tradeId });

      if (t.initiator_confirmed && t.recipient_confirmed) {
        io.to(trade.initiator_id).emit('trade_countdown', { trade_id: tradeId, seconds: 5 });
        io.to(trade.recipient_id).emit('trade_countdown', { trade_id: tradeId, seconds: 5 });

        const timer = setTimeout(() => executeTrade(tradeId), 5000);
        pendingTimers.set(tradeId, timer);
      }

      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: e.code || 'server_error' });
    } finally {
      client.release();
    }
  });

  app.post('/api/trade/:id/cancel', auth, async (req, res) => {
    const userId = req.user.id;
    const tradeId = req.params.id;
    if (pendingTimers.has(tradeId)) {
      clearTimeout(pendingTimers.get(tradeId));
      pendingTimers.delete(tradeId);
    }
    const r = await pool.query(
      `UPDATE trades SET status='cancelled' WHERE id=$1 AND (initiator_id=$2 OR recipient_id=$2) AND status='pending' RETURNING *`,
      [tradeId, userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
    const t = r.rows[0];
    const otherId = t.initiator_id === userId ? t.recipient_id : t.initiator_id;
    io.to(otherId).emit('trade_cancelled', { trade_id: tradeId });
    res.json({ ok: true });
  });

  async function executeTrade(tradeId) {
    pendingTimers.delete(tradeId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tradeR = await client.query('SELECT * FROM trades WHERE id=$1 AND status=$2 FOR UPDATE', [tradeId, 'pending']);
      if (!tradeR.rows.length) { await client.query('ROLLBACK'); return; }
      const trade = tradeR.rows[0];
      if (!trade.initiator_confirmed || !trade.recipient_confirmed) { await client.query('ROLLBACK'); return; }

      const firstUser = trade.initiator_id < trade.recipient_id ? trade.initiator_id : trade.recipient_id;
      const secondUser = trade.initiator_id < trade.recipient_id ? trade.recipient_id : trade.initiator_id;
      const usersR = await client.query(
        'SELECT id, balance FROM users WHERE id IN ($1,$2) ORDER BY id FOR UPDATE',
        [firstUser, secondUser]
      );
      const balances = new Map(usersR.rows.map((u) => [u.id, Number(u.balance)]));
      if ((balances.get(trade.initiator_id) || 0) < Number(trade.initiator_currency) ||
          (balances.get(trade.recipient_id) || 0) < Number(trade.recipient_currency)) {
        throw { code: 'not_enough_balance' };
      }

      const itemsR = await client.query('SELECT * FROM trade_items WHERE trade_id=$1 FOR UPDATE', [tradeId]);
      const seen = new Set();
      for (const ti of itemsR.rows) {
        if (seen.has(ti.item_id)) throw { code: 'duplicate_item' };
        seen.add(ti.item_id);
        const newOwner = ti.from_user_id === trade.initiator_id ? trade.recipient_id : trade.initiator_id;
        const moved = await client.query(
          'UPDATE items SET owner_id=$1 WHERE id=$2 AND owner_id=$3 RETURNING id',
          [newOwner, ti.item_id, ti.from_user_id]
        );
        if (!moved.rows.length) throw { code: 'item_no_longer_owned' };
      }

      if (trade.initiator_currency > 0) {
        await client.query('UPDATE users SET balance=balance-$1 WHERE id=$2', [trade.initiator_currency, trade.initiator_id]);
        await client.query('UPDATE users SET balance=balance+$1 WHERE id=$2', [trade.initiator_currency, trade.recipient_id]);
      }
      if (trade.recipient_currency > 0) {
        await client.query('UPDATE users SET balance=balance-$1 WHERE id=$2', [trade.recipient_currency, trade.recipient_id]);
        await client.query('UPDATE users SET balance=balance+$1 WHERE id=$2', [trade.recipient_currency, trade.initiator_id]);
      }

      await client.query(`UPDATE trades SET status='completed', completed_at=now() WHERE id=$1`, [tradeId]);
      await client.query('COMMIT');

      await log(trade.initiator_id, 'trade_completed', { trade_id: tradeId, with: trade.recipient_id, currency_sent: trade.initiator_currency });
      await log(trade.recipient_id, 'trade_completed', { trade_id: tradeId, with: trade.initiator_id, currency_sent: trade.recipient_currency });

      io.to(trade.initiator_id).emit('trade_completed', { trade_id: tradeId });
      io.to(trade.recipient_id).emit('trade_completed', { trade_id: tradeId });
    } catch (e) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
};
