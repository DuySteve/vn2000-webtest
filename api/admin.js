export const config = {
  runtime: 'nodejs',
  regions: ['iad1'],
};

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export const MODEL_DEFAULTS = {
  cerebras:    process.env.MODEL_CEREBRAS   || 'gemma-4-31b',
  groq:        process.env.MODEL_GROQ       || 'qwen/qwen3.8-27b',
  openrouter:  process.env.MODEL_OPENROUTER || 'google/gemma-4-31b-it:free',
};

// ── KV helpers ──────────────────────────────────────────────
async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const d = await r.json();
    return d.result || null;
  } catch { return null; }
}

async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
      method: 'GET', // Upstash REST: SET via GET with path
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    return r.ok;
  } catch { return false; }
}

// ── Constant-time password check ────────────────────────────
function checkPassword(input) {
  const secret = process.env.ADMIN_PASSWORD || '';
  if (!secret || input.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= input.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

// ── Handler ─────────────────────────────────────────────────
export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigins = [
    'https://vn2000-webtest.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  const isAllowed = allowedOrigins.some(o => origin.startsWith(o));
  res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin : allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: đọc config hiện tại ──
  if (req.method === 'GET') {
    const pwd = req.query.password || '';
    if (!checkPassword(pwd)) {
      return res.status(401).json({ error: 'Sai mật khẩu admin' });
    }

    const [cerebras, groq, openrouter] = await Promise.all([
      kvGet('model:cerebras'),
      kvGet('model:groq'),
      kvGet('model:openrouter'),
    ]);

    return res.status(200).json({
      success: true,
      kvEnabled: !!(KV_URL && KV_TOKEN),
      models: {
        cerebras:   cerebras   || MODEL_DEFAULTS.cerebras,
        groq:       groq       || MODEL_DEFAULTS.groq,
        openrouter: openrouter || MODEL_DEFAULTS.openrouter,
      },
      defaults: MODEL_DEFAULTS,
    });
  }

  // ── POST: lưu config mới ──
  if (req.method === 'POST') {
    const { password, models } = req.body || {};
    if (!checkPassword(password || '')) {
      return res.status(401).json({ error: 'Sai mật khẩu admin' });
    }
    if (!models || typeof models !== 'object') {
      return res.status(400).json({ error: 'Thiếu trường models' });
    }
    if (!KV_URL || !KV_TOKEN) {
      return res.status(503).json({
        error: 'Chưa cấu hình Vercel KV. Hãy tạo KV store trong Vercel Dashboard → Storage.',
      });
    }

    const ok = await Promise.all([
      kvSet('model:cerebras',   models.cerebras   || MODEL_DEFAULTS.cerebras),
      kvSet('model:groq',       models.groq       || MODEL_DEFAULTS.groq),
      kvSet('model:openrouter', models.openrouter || MODEL_DEFAULTS.openrouter),
    ]);

    if (ok.every(Boolean)) {
      return res.status(200).json({ success: true, message: 'Đã lưu cấu hình model thành công!' });
    }
    return res.status(500).json({ error: 'Lỗi khi ghi vào Vercel KV' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
