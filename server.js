require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const Redis = require('ioredis');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'nemesis' });
  } catch {
    res.status(503).json({ ok: false, service: 'nemesis' });
  }
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
});
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  retryStrategy: (times) => Math.min(times * 250, 3000),
});
redis.on('error', (err) => console.warn('Redis unavailable:', err.message));
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'no_token' });
  try {
    const token = h.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const r = await pool.query('SELECT is_admin FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows.length || !r.rows[0].is_admin) return res.status(403).json({ error: 'forbidden' });
    next();
  } catch {
    res.status(500).json({ error: 'server_error' });
  }
}

const memoryRate = new Map();
const memoryOnline = new Set();

async function rateLimit(userId, action, limit, windowSec) {
  const key = `rl:${action}:${userId}`;
  try {
    if (redis.status === 'wait') await redis.connect();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    return count <= limit;
  } catch {
    const now = Date.now();
    const entry = memoryRate.get(key);
    if (!entry || now >= entry.reset) {
      memoryRate.set(key, { count: 1, reset: now + windowSec * 1000 });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }
}

async function onlineAdd(id) {
  try {
    if (redis.status === 'wait') await redis.connect();
    await redis.sadd('online_users', id);
    return await redis.scard('online_users');
  } catch {
    memoryOnline.add(String(id));
    return memoryOnline.size;
  }
}
async function onlineRemove(id) {
  try {
    if (redis.status === 'ready') {
      await redis.srem('online_users', id);
      return await redis.scard('online_users');
    }
  } catch {}
  memoryOnline.delete(String(id));
  return memoryOnline.size;
}

async function log(userId, action, payload) {
  await pool.query(
    'INSERT INTO logs (user_id, action, payload) VALUES ($1,$2,$3)',
    [userId, action, JSON.stringify(payload)]
  );
}

app.post('/api/register', async (req, res) => {
  const { nickname, password } = req.body;
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname || ''))
    return res.status(400).json({ error: 'bad_nickname' });
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'bad_password' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const r = await pool.query(
      'INSERT INTO users (nickname, password_hash, balance) VALUES ($1,$2,2500) RETURNING id, nickname, balance',
      [nickname, hash]
    );
    await pool.query('INSERT INTO equipped (user_id) VALUES ($1)', [r.rows[0].id]);
    const token = jwt.sign({ id: r.rows[0].id, nickname }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'nickname_taken' });
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { nickname, password } = req.body;
  const r = await pool.query('SELECT * FROM users WHERE nickname=$1', [nickname]);
  if (!r.rows.length) return res.status(401).json({ error: 'invalid_credentials' });
  const u = r.rows[0];
  if (u.kicked_until && new Date(u.kicked_until) > new Date())
    return res.status(403).json({ error: 'kicked', until: u.kicked_until });
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  const token = jwt.sign({ id: u.id, nickname: u.nickname }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: u.id, nickname: u.nickname, balance: u.balance, is_premium: u.is_premium } });
});

app.get('/api/cases', auth, async (req, res) => {
  const r = await pool.query('SELECT id, name, price, icon_url FROM cases WHERE is_active=TRUE');
  res.json(r.rows);
});

app.post('/api/cases/:id/open', auth, async (req, res) => {
  const userId = req.user.id;
  const caseId = req.params.id;
  const ok = await rateLimit(userId, 'open_case', 20, 60);
  if (!ok) return res.status(429).json({ error: 'rate_limited' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userR = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const user = userR.rows[0];
    const caseR = await client.query('SELECT * FROM cases WHERE id=$1 AND is_active=TRUE', [caseId]);
    if (!caseR.rows.length) throw { code: 'no_case' };
    const c = caseR.rows[0];
    if (user.balance < c.price) throw { code: 'not_enough_balance' };

    const itemsR = await client.query(
      `SELECT ci.item_template_id, ci.drop_weight FROM case_items ci WHERE ci.case_id=$1`,
      [caseId]
    );
    if (!itemsR.rows.length) throw { code: 'empty_case' };
    const total = itemsR.rows.reduce((s, i) => s + Number(i.drop_weight), 0);
    let roll = crypto.randomInt(0, 1000000) / 1000000 * total;
    let picked = itemsR.rows[itemsR.rows.length - 1];
    for (const it of itemsR.rows) {
      if (roll < Number(it.drop_weight)) { picked = it; break; }
      roll -= Number(it.drop_weight);
    }

    const tmplR = await client.query('SELECT * FROM item_templates WHERE id=$1', [picked.item_template_id]);
    const tmpl = tmplR.rows[0];

    const dupR = await client.query(
      'SELECT id FROM items WHERE owner_id=$1 AND template_id=$2 LIMIT 1',
      [userId, tmpl.id]
    );
    const wasDuplicate = dupR.rows.length > 0;

    const newItemR = await client.query(
      `INSERT INTO items (template_id, owner_id, type, level, rarity)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [tmpl.id, userId, tmpl.type, tmpl.level, tmpl.rarity]
    );
    const newItem = newItemR.rows[0];

    await client.query(
      'UPDATE users SET balance=balance-$1, total_spent=total_spent+$1, cases_opened=cases_opened+1 WHERE id=$2',
      [c.price, userId]
    );
    if (app.locals.nemesisProgression) {
      await app.locals.nemesisProgression.awardXp(client,userId,25,'case',newItem.id);
      await app.locals.nemesisProgression.bumpContract(client,userId,'OPEN_3_CASES');
      await app.locals.nemesisProgression.unlock(client,userId,'FIRST_CASE');
      if (tmpl.rarity==='legendary') await app.locals.nemesisProgression.unlock(client,userId,'FIRST_LEGENDARY');
      if (tmpl.rarity==='nemesis') await app.locals.nemesisProgression.unlock(client,userId,'NEMESIS_DROP');
    }
    await client.query(
      'INSERT INTO case_openings (user_id, case_id, item_id, was_duplicate) VALUES ($1,$2,$3,$4)',
      [userId, caseId, newItem.id, wasDuplicate]
    );
    await client.query('INSERT INTO logs(user_id,action,payload) VALUES($1,$2,$3)', [userId,'open_case',JSON.stringify({case_id:caseId,item_id:newItem.id,was_duplicate:wasDuplicate})]);
    await client.query('COMMIT');
    const suggestedBase = { common: 50, uncommon: 150, rare: 350, epic: 900, legendary: 2500 };
    const suggested_price = Math.floor(Math.max(
      suggestedBase[tmpl.rarity] || 50,
      Number(tmpl.level || 1) * (suggestedBase[tmpl.rarity] || 50) / 2
    ));
    res.json({
      item: { ...newItem, name: tmpl.name, icon_url: tmpl.icon_url, suggested_price },
      was_duplicate: wasDuplicate,
      balance: Number(user.balance) - Number(c.price)
    });
  } catch (e) {
    await client.query('ROLLBACK');
    const code = e.code || 'server_error';
    res.status(code === 'server_error' ? 500 : 400).json({ error: code });
  } finally {
    client.release();
  }
});

app.get('/api/inventory', auth, async (req, res) => {
  const r = await pool.query(
    `SELECT i.*, t.name, t.icon_url, t.model_url, t.base_stats, t.category, t.equip_slot, t.market_value AS template_market_value, t.weight,
       CASE i.rarity
         WHEN 'common' THEN GREATEST(50, i.level * 45)
         WHEN 'uncommon' THEN GREATEST(150, i.level * 90)
         WHEN 'rare' THEN GREATEST(350, i.level * 180)
         WHEN 'epic' THEN GREATEST(900, i.level * 420)
         WHEN 'legendary' THEN GREATEST(2500, i.level * 1100)
         WHEN 'nemesis' THEN GREATEST(50000, i.level * 7000)
       END AS suggested_price
     FROM items i
     JOIN item_templates t ON t.id=i.template_id
     WHERE i.owner_id=$1 AND i.status='owned' ORDER BY i.created_at DESC`,
    [req.user.id]
  );
  res.json(r.rows);
});

app.post('/api/inventory/:itemId/equip', auth, async (req, res) => {
  const userId = req.user.id;
  const { slot } = req.body;
  const validSlots = ['helmet', 'chest', 'legs', 'weapon', 'backpack'];
  if (!validSlots.includes(slot)) return res.status(400).json({ error: 'bad_slot' });
  const itemR = await pool.query("SELECT i.*,t.equip_slot FROM items i JOIN item_templates t ON t.id=i.template_id WHERE i.id=$1 AND i.owner_id=$2 AND i.status='owned'", [req.params.itemId, userId]);
  if (!itemR.rows.length) return res.status(404).json({ error: 'not_found' });
  if (itemR.rows[0].equip_slot !== slot) return res.status(400).json({ error: 'wrong_slot' });
  await pool.query(`UPDATE equipped SET ${slot}=$1, updated_at=now() WHERE user_id=$2`, [req.params.itemId, userId]);
  await log(userId, 'equip', { item_id: req.params.itemId, slot });
  res.json({ ok: true });
});

app.post('/api/inventory/:itemId/unequip', auth, async (req, res) => {
  const userId = req.user.id;
  const { slot } = req.body;
  const validSlots = ['helmet', 'chest', 'legs', 'weapon', 'backpack'];
  if (!validSlots.includes(slot)) return res.status(400).json({ error: 'bad_slot' });
  await pool.query(`UPDATE equipped SET ${slot}=NULL, updated_at=now() WHERE user_id=$1`, [userId]);
  await log(userId, 'unequip', { item_id: req.params.itemId, slot });
  res.json({ ok: true });
});


app.post('/api/inventory/:itemId/sell', auth, async (req, res) => {
  const userId = req.user.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemR = await client.query(
      `SELECT i.*, t.name
       FROM items i JOIN item_templates t ON t.id=i.template_id
       WHERE i.id=$1 AND i.owner_id=$2 AND i.status='owned' FOR UPDATE`,
      [req.params.itemId, userId]
    );
    if (!itemR.rows.length) throw { code: 'not_found' };

    const equippedR = await client.query(
      `SELECT 1 FROM equipped
       WHERE user_id=$1 AND (helmet=$2 OR chest=$2 OR legs=$2 OR weapon=$2 OR backpack=$2)`,
      [userId, req.params.itemId]
    );
    if (equippedR.rows.length) throw { code: 'item_equipped' };

    const listedR = await client.query(
      `SELECT 1 FROM market_listings WHERE item_id=$1 AND status='active'`,
      [req.params.itemId]
    );
    if (listedR.rows.length) throw { code: 'already_listed' };

    const item = itemR.rows[0];
    const prices = { common: 50, uncommon: 150, rare: 350, epic: 900, legendary: 2500 };
    const amount = Math.max(prices[item.rarity] || 50, Number(item.level || 1) * (prices[item.rarity] || 50) / 2);
    const rounded = Math.floor(amount);

    await client.query("UPDATE items SET status='sold' WHERE id=$1 AND owner_id=$2", [req.params.itemId, userId]);
    await client.query('UPDATE users SET balance=balance+$1 WHERE id=$2', [rounded, userId]);
    await client.query('COMMIT');

    await log(userId, 'instant_sell', { item_id: req.params.itemId, amount: rounded });
    res.json({ ok: true, amount: rounded, item_name: item.name });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.code || 'server_error' });
  } finally {
    client.release();
  }
});

app.get('/api/daily-reward/status', auth, async (req, res) => {
  const r = await pool.query(
    `SELECT EXISTS(
       SELECT 1 FROM daily_rewards
       WHERE user_id=$1 AND claimed_at::date=now()::date
     ) AS claimed`,
    [req.user.id]
  );
  res.json({ claimed: Boolean(r.rows[0]?.claimed) });
});

app.post('/api/daily-reward', auth, async (req, res) => {
  const userId = req.user.id;
  const todayR = await pool.query(
    `SELECT id FROM daily_rewards WHERE user_id=$1 AND claimed_at::date=now()::date`,
    [userId]
  );
  if (todayR.rows.length) return res.status(409).json({ error: 'already_claimed' });
  const amount = 100;
  await pool.query('UPDATE users SET balance=balance+$1 WHERE id=$2', [amount, userId]);
  await pool.query('INSERT INTO daily_rewards (user_id, amount) VALUES ($1,$2)', [userId, amount]);
  await log(userId, 'daily_reward', { amount });
  res.json({ amount });
});

app.post('/api/reports', auth, async (req, res) => {
  const { reported_id, reason } = req.body;
  if (reported_id === req.user.id) return res.status(400).json({ error: 'self_report' });
  await pool.query(
    'INSERT INTO reports (reporter_id, reported_id, reason) VALUES ($1,$2,$3)',
    [req.user.id, reported_id, reason]
  );
  await pool.query('UPDATE users SET reports_count=reports_count+1 WHERE id=$1', [reported_id]);
  await log(req.user.id, 'report', { reported_id, reason });
  await checkAutoKick(pool, reported_id);
  res.json({ ok: true });
});

app.get('/api/me', auth, async (req, res) => {
  const r = await pool.query(
    'SELECT id, nickname, balance, is_premium, is_admin, cases_opened, reports_count, level, role_tag, bio, profile_theme FROM users WHERE id=$1',
    [req.user.id]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
  res.json(r.rows[0]);
});

app.get('/api/users/search', auth, async (req, res) => {
  const nickname = String(req.query.nickname || '').trim();
  if (nickname.length < 2) return res.json([]);
  const r = await pool.query(
    `SELECT id, nickname, is_premium
     FROM users
     WHERE id <> $1 AND nickname ILIKE $2
     ORDER BY nickname ASC
     LIMIT 8`,
    [req.user.id, `%${nickname}%`]
  );
  res.json(r.rows);
});

app.get('/api/equipped', auth, async (req, res) => {
  const r = await pool.query(
    `SELECT e.*, 
      h.template_id as helmet_tid, c.template_id as chest_tid, l.template_id as legs_tid,
      w.template_id as weapon_tid, b.template_id as backpack_tid
     FROM equipped e
     LEFT JOIN items h ON h.id = e.helmet
     LEFT JOIN items c ON c.id = e.chest
     LEFT JOIN items l ON l.id = e.legs
     LEFT JOIN items w ON w.id = e.weapon
     LEFT JOIN items b ON b.id = e.backpack
     WHERE e.user_id=$1`,
    [req.user.id]
  );
  res.json(r.rows[0] || {});
});

app.get('/api/online-count', auth, async (req, res) => {
  let count = 0;
  try {
    if (redis.status === 'wait') await redis.connect();
    count = await redis.scard('online_users');
  } catch {
    count = memoryOnline.size;
  }
  res.json({ online: Number(count) });
});

const { checkAutoKick } = require('./moderation')(app, pool, auth, requireAdmin, log, io);
require('./logs')(app, pool, auth, requireAdmin);
require('./market')(app, pool, auth, log);
require('./trade')(app, io, pool, auth, log);
require('./progression')(app, pool, auth, log);
require('./blackrun')(app, pool, auth, log);

io.use((socket, next) => {
  try {
    socket.user = jwt.verify(socket.handshake.auth.token, JWT_SECRET);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', async (socket) => {
  socket.join(socket.user.id);
  const online = await onlineAdd(socket.user.id);
  io.emit('online_count', { online });

  socket.on('disconnect', async () => {
    const count = await onlineRemove(socket.user.id);
    io.emit('online_count', { online: count });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NEMESIS server on ${PORT}`));
