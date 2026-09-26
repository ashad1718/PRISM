require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'x-admin-wallet'],
}));
app.use(express.json());

// Request logger middleware
app.use((req, res, next) => {
  console.log('[API REQUEST]', req.method, req.originalUrl);
  next();
});

// Connect to Neon PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('connect', () => {
  console.log('Connected to Neon PostgreSQL');
});

const crypto = require('crypto');
const { verifyAuth0Token } = require('./authMiddleware');

// In-memory fallback stores when DB is offline
const memoryComments = new Map();
const memoryReports = [];

// Initialize database tables
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS markets (
        id SERIAL PRIMARY KEY,
        polymarket_id VARCHAR(64) UNIQUE NOT NULL,
        question TEXT NOT NULL,
        end_ts BIGINT NOT NULL,
        price_yes_bps INTEGER NOT NULL,
        lmsr_b INTEGER DEFAULT 1000000,
        closed BOOLEAN DEFAULT FALSE,
        winning_outcome INTEGER,
        ai_score INTEGER DEFAULT 50,
        ai_reason TEXT DEFAULT 'Auto-accepted (no AI data)',
        ai_title TEXT,
        ai_tags JSONB DEFAULT '[]',
        ai_summary TEXT,
        raw_data JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(128) UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id VARCHAR(64) PRIMARY KEY,
        market_id VARCHAR(128) NOT NULL,
        text VARCHAR(500) NOT NULL,
        author_id VARCHAR(128),
        author_name VARCHAR(128) DEFAULT 'User',
        author_avatar TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_comments_market_id ON comments(market_id);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS comment_reports (
        id VARCHAR(64) PRIMARY KEY,
        comment_id VARCHAR(64) NOT NULL,
        reporter_id VARCHAR(128) NOT NULL,
        reason VARCHAR(128) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    console.log('Database tables initialized');
  } catch (dbErr) {
    console.warn('[DB INIT WARNING] PostgreSQL initialization skipped or failed:', dbErr.message);
  }
}

initDB().catch(console.error);

// API: Get all markets
app.get('/api/markets', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM markets ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// API: Create market (admin)
app.post('/api/markets', async (req, res) => {
  try {
    const { polymarket_id, question, end_ts, price_yes_bps } = req.body;
    
    if (!polymarket_id || !question || !end_ts || price_yes_bps === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const result = await pool.query(
      `INSERT INTO markets (polymarket_id, question, end_ts, price_yes_bps, lmsr_b, closed, winning_outcome, ai_score, ai_reason, ai_title, ai_tags, ai_summary, raw_data)
       VALUES ($1, $2, $3, $4, $5, FALSE, NULL, 50, 'Auto-accepted (no AI data)', NULL, '[]', NULL, NULL)
       RETURNING *`,
      [polymarket_id, question, end_ts, price_yes_bps, 1000000]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Market ID already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// API: Get market count
app.get('/api/markets/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as total FROM markets');
    const result2 = await pool.query('SELECT COUNT(*) as active FROM markets WHERE closed = FALSE');
    res.json({ total: result.rows[0].total, active: result2.rows[0].active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get market status by ID
app.get('/api/markets/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM markets WHERE polymarket_id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: User tracking
app.post('/api/users', async (req, res) => {
  try {
    const { wallet_address } = req.body;
    if (!wallet_address) {
      return res.status(400).json({ error: 'Wallet address required' });
    }
    
    const result = await pool.query(
      `INSERT INTO users (wallet_address) VALUES ($1) ON CONFLICT (wallet_address) DO UPDATE SET last_login = NOW() RETURNING *`,
      [wallet_address]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get user stats
app.get('/api/users/stats', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as total_users FROM users');
    res.json({ total_users: result.rows[0].total_users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get comments for market
app.get('/api/markets/:marketId/comments', async (req, res) => {
  const { marketId } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, market_id as "marketId", text, author_id as "authorId", author_name as "authorName", author_avatar as "authorAvatar", created_at as "createdAt", updated_at as "updatedAt" FROM comments WHERE market_id = $1 ORDER BY created_at DESC',
      [marketId]
    );
    const comments = result.rows.map((row) => ({
      id: row.id,
      marketId: row.marketId,
      userId: row.authorId,
      userName: row.authorName,
      userPicture: row.authorAvatar,
      content: row.text,
      authorId: row.authorId,
      authorName: row.authorName,
      authorAvatar: row.authorAvatar,
      text: row.text,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    res.json({ comments });
  } catch (err) {
    const list = (memoryComments.get(marketId) || []).map((c) => ({
      id: c.id,
      marketId: c.marketId,
      userId: c.userId || c.authorId,
      userName: c.userName || c.authorName,
      userPicture: c.userPicture || c.authorAvatar,
      content: c.content || c.text,
      authorId: c.authorId || c.userId,
      authorName: c.authorName || c.userName,
      authorAvatar: c.authorAvatar || c.userPicture,
      text: c.text || c.content,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt || c.createdAt,
    }));
    res.json({ comments: list });
  }
});

// API: Create comment for market (Requires Auth0 Authentication)
app.post('/api/markets/:marketId/comments', verifyAuth0Token, async (req, res) => {
  const { marketId } = req.params;
  const rawInput = req.body.content || req.body.text;

  if (!rawInput || typeof rawInput !== 'string' || rawInput.trim().length === 0) {
    return res.status(400).json({ error: 'Comment cannot be empty.' });
  }

  const trimmedText = rawInput.trim();
  if (trimmedText.length > 500) {
    return res.status(400).json({ error: 'Comment must be 500 characters or fewer.' });
  }

  // Identity is retrieved securely ONLY from verified Auth0 JWT payload (req.user)
  const userId = req.user.sub;
  const userName = req.user.name || req.user.nickname || 'User';
  const userPicture = req.user.picture || null;
  const commentId = crypto.randomUUID ? crypto.randomUUID() : `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  try {
    const result = await pool.query(
      `INSERT INTO comments (id, market_id, text, author_id, author_name, author_avatar, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id, market_id as "marketId", text, author_id as "authorId", author_name as "authorName", author_avatar as "authorAvatar", created_at as "createdAt", updated_at as "updatedAt"`,
      [commentId, marketId, trimmedText, userId, userName, userPicture]
    );
    const row = result.rows[0];
    const commentObj = {
      id: row.id,
      marketId: row.marketId,
      userId: row.authorId,
      userName: row.authorName,
      userPicture: row.authorAvatar,
      content: row.text,
      authorId: row.authorId,
      authorName: row.authorName,
      authorAvatar: row.authorAvatar,
      text: row.text,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt || row.createdAt,
    };
    return res.status(201).json({ comment: commentObj });
  } catch (err) {
    console.warn('[COMMENTS DB FALLBACK]', err.message);
    const newComment = {
      id: commentId,
      marketId,
      userId,
      userName,
      userPicture,
      content: trimmedText,
      authorId: userId,
      authorName: userName,
      authorAvatar: userPicture,
      text: trimmedText,
      createdAt,
      updatedAt: createdAt,
    };
    const list = memoryComments.get(marketId) || [];
    memoryComments.set(marketId, [newComment, ...list]);
    return res.status(201).json({ comment: newComment });
  }
});

// API: Delete comment (Requires Auth0 Authentication & ownership)
app.delete('/api/comments/:id', verifyAuth0Token, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.sub;

  try {
    const existing = await pool.query('SELECT author_id FROM comments WHERE id = $1', [id]);
    if (existing.rows.length > 0 && existing.rows[0].author_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You can only delete your own comments.' });
    }

    await pool.query('DELETE FROM comments WHERE id = $1 AND (author_id = $2 OR author_id IS NULL)', [id, userId]);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: true });
  }
});

// API: Report comment (Requires Auth0 Authentication)
app.post('/api/comments/:id/report', verifyAuth0Token, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const reporterId = req.user.sub;

  if (!reason || typeof reason !== 'string') {
    return res.status(400).json({ error: 'Report reason required' });
  }

  const reportId = crypto.randomUUID ? crypto.randomUUID() : `rpt_${Date.now()}`;

  try {
    await pool.query(
      `INSERT INTO comment_reports (id, comment_id, reporter_id, reason, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [reportId, id, reporterId, reason]
    );
    res.json({ success: true, message: 'Report submitted successfully' });
  } catch (err) {
    memoryReports.push({ reportId, commentId: id, reporterId, reason, createdAt: new Date().toISOString() });
    res.json({ success: true, message: 'Report submitted successfully' });
  }
});

// Health check
app.get(['/health', '/api/health'], (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
}).on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const GAMMA_CACHE_PATH = path.join(DATA_DIR, 'gamma-cache.json');
const ADMIN_ALLOWLIST_PATH = path.join(DATA_DIR, 'polymarket-selection.json');

app.get('/api/admin/gamma', (req, res) => {
  try {
    let cache = { markets: [] };
    if (fs.existsSync(GAMMA_CACHE_PATH)) {
      cache = JSON.parse(fs.readFileSync(GAMMA_CACHE_PATH, 'utf8'));
    }
    let allowlist = { markets: {} };
    if (fs.existsSync(ADMIN_ALLOWLIST_PATH)) {
      allowlist = JSON.parse(fs.readFileSync(ADMIN_ALLOWLIST_PATH, 'utf8'));
    }
    
    const marketsWithState = cache.markets.map(m => {
      const config = allowlist.markets[m.polymarketId];
      return { ...m, enabled: config ? config.enabled : false };
    });
    
    res.json(marketsWithState);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/gamma/toggle', (req, res) => {
  try {
    const { polymarketId, enabled } = req.body;
    let allowlist = { markets: {} };
    if (fs.existsSync(ADMIN_ALLOWLIST_PATH)) {
      allowlist = JSON.parse(fs.readFileSync(ADMIN_ALLOWLIST_PATH, 'utf8'));
    }
    allowlist.markets[polymarketId] = { enabled };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ADMIN_ALLOWLIST_PATH, JSON.stringify(allowlist, null, 2));
    res.json({ success: true, polymarketId, enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
