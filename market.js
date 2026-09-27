module.exports = function (app, pool, auth, log) {
  app.get('/api/market/listings', auth, async (req, res) => {
    const { search, sort, type, rarity } = req.query;
    let query = `
      SELECT ml.*, i.type, i.level, i.rarity, t.name, t.icon_url, u.nickname as seller_nickname
      FROM market_listings ml
      JOIN items i ON i.id = ml.item_id
      JOIN item_templates t ON t.id = i.template_id
      JOIN users u ON u.id = ml.seller_id
      WHERE ml.status = 'active'
    `;
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      query += ` AND t.name ILIKE $${params.length}`;
    }
    if (type) {
      params.push(type);
      query += ` AND i.type = $${params.length}`;
    }
    if (rarity) {
      params.push(rarity);
      query += ` AND i.rarity = $${params.length}`;
    }
    if (sort === 'price_asc') query += ' ORDER BY ml.price ASC';
    else if (sort === 'price_desc') query += ' ORDER BY ml.price DESC';
    else query += ' ORDER BY ml.created_at DESC';

    const r = await pool.query(query, params);
    res.json(r.rows);
  });

  app.post('/api/market/listings', auth, async (req, res) => {
    const userId = req.user.id;
    const { item_id, price } = req.body;
    if (!price || price <= 0) return res.status(400).json({ error: 'bad_price' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const itemR = await client.query(
        'SELECT * FROM items WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [item_id, userId]
      );
      if (!itemR.rows.length) throw { code: 'not_owner' };

      const equippedR = await client.query(
        `SELECT * FROM equipped WHERE user_id=$1 AND (helmet=$2 OR chest=$2 OR legs=$2 OR weapon=$2 OR backpack=$2)`,
        [userId, item_id]
      );
      if (equippedR.rows.length) throw { code: 'item_equipped' };

      const activeR = await client.query(
        `SELECT id FROM market_listings WHERE item_id=$1 AND status='active' FOR UPDATE`,
        [item_id]
      );
      if (activeR.rows.length) throw { code: 'already_listed' };

      const userR = await client.query('SELECT is_premium FROM users WHERE id=$1', [userId]);
      const commission = userR.rows[0].is_premium ? 2.5 : 5.0;

      const listR = await client.query(
        `INSERT INTO market_listings (item_id, seller_id, price, commission_pct)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [item_id, userId, price, commission]
      );
      await client.query('COMMIT');
      await log(userId, 'market_list', { item_id, price });
      res.json(listR.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: e.code || 'server_error' });
    } finally {
      client.release();
    }
  });

  app.post('/api/market/listings/:id/buy', auth, async (req, res) => {
    const buyerId = req.user.id;
    const listingId = req.params.id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const listR = await client.query(
        `SELECT * FROM market_listings WHERE id=$1 AND status='active' FOR UPDATE`,
        [listingId]
      );
      if (!listR.rows.length) throw { code: 'not_found' };
      const listing = listR.rows[0];
      if (listing.seller_id === buyerId) throw { code: 'cant_buy_own' };

      const ownerR = await client.query('SELECT owner_id FROM items WHERE id=$1 FOR UPDATE', [listing.item_id]);
      if (!ownerR.rows.length || ownerR.rows[0].owner_id !== listing.seller_id) throw { code: 'listing_invalid' };

      const buyerR = await client.query('SELECT balance FROM users WHERE id=$1 FOR UPDATE', [buyerId]);
      if (buyerR.rows[0].balance < listing.price) throw { code: 'not_enough_balance' };

      const commissionAmount = Math.floor(listing.price * (listing.commission_pct / 100));
      const sellerReceives = listing.price - commissionAmount;

      await client.query('UPDATE users SET balance=balance-$1 WHERE id=$2', [listing.price, buyerId]);
      await client.query('UPDATE users SET balance=balance+$1 WHERE id=$2', [sellerReceives, listing.seller_id]);
      await client.query('UPDATE items SET owner_id=$1 WHERE id=$2', [buyerId, listing.item_id]);
      await client.query(
        `UPDATE market_listings SET status='sold', buyer_id=$1, sold_at=now() WHERE id=$2`,
        [buyerId, listingId]
      );
      await client.query('COMMIT');

      await log(buyerId, 'market_buy', { listing_id: listingId, item_id: listing.item_id, price: listing.price, seller_id: listing.seller_id });
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: e.code || 'server_error' });
    } finally {
      client.release();
    }
  });

  app.post('/api/market/listings/:id/cancel', auth, async (req, res) => {
    const userId = req.user.id;
    const r = await pool.query(
      `UPDATE market_listings SET status='cancelled' WHERE id=$1 AND seller_id=$2 AND status='active' RETURNING *`,
      [req.params.id, userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
    await log(userId, 'market_cancel', { listing_id: req.params.id });
    res.json({ ok: true });
  });

  app.get('/api/market/history', auth, async (req, res) => {
    const r = await pool.query(
      `SELECT ml.*, t.name FROM market_listings ml
       JOIN items i ON i.id = ml.item_id
       JOIN item_templates t ON t.id = i.template_id
       WHERE ml.status='sold' AND (ml.seller_id=$1 OR ml.buyer_id=$1)
       ORDER BY ml.sold_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(r.rows);
  });
};
