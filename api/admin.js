import { put, list } from '@vercel/blob';

export const config = {
  runtime: 'nodejs',
  regions: ['iad1'],
};

const CONFIG_BLOB = 'vn2000-model-config.json';

export const MODEL_DEFAULTS = {
  cerebras:   process.env.MODEL_CEREBRAS   || 'gemma-4-31b',
  groq:       process.env.MODEL_GROQ       || 'qwen/qwen3.8-27b',
  openrouter: process.env.MODEL_OPENROUTER || 'google/gemma-4-31b-it:free',
};

const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;

// ── Blob helpers ─────────────────────────────────────────────
async function blobRead() {
  if (!blobEnabled()) return null;
  try {
    const { blobs } = await list({ prefix: CONFIG_BLOB });
    if (!blobs.length) return null;
    const res = await fetch(blobs[0].url, { cache: 'no-store' });
    return await res.json();
  } catch { return null; }
}

async function blobWrite(data) {
  if (!blobEnabled()) return false;
  try {
    await put(CONFIG_BLOB, JSON.stringify(data), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
    });
    return true;
  } catch { return false; }
}

// ── Password check ────────────────────────────────────────────
function checkPassword(input) {
  const secret = process.env.ADMIN_PASSWORD || '';
  return secret !== '' && input.trim() === secret.trim();
}

// ── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ['https://vn2000-webtest.vercel.app', 'http://localhost:3000', 'http://127.0.0.1:3000'];
  const isAllowed = allowed.some(o => origin.startsWith(o));
  res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin : allowed[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: đọc config ──
  if (req.method === 'GET') {
    const pwd = req.query.password || '';
    if (!checkPassword(pwd)) return res.status(401).json({ error: 'Sai mật khẩu admin' });

    const stored = await blobRead();
    return res.status(200).json({
      success: true,
      blobEnabled: blobEnabled(),
      models: {
        cerebras:   stored?.cerebras   || MODEL_DEFAULTS.cerebras,
        groq:       stored?.groq       || MODEL_DEFAULTS.groq,
        openrouter: stored?.openrouter || MODEL_DEFAULTS.openrouter,
      },
      defaults: MODEL_DEFAULTS,
    });
  }

  // ── POST: lưu config ──
  if (req.method === 'POST') {
    const { password, models } = req.body || {};
    if (!checkPassword(password || '')) return res.status(401).json({ error: 'Sai mật khẩu admin' });
    if (!models || typeof models !== 'object') return res.status(400).json({ error: 'Thiếu trường models' });
    if (!blobEnabled()) {
      return res.status(503).json({ error: 'Chưa cấu hình BLOB_READ_WRITE_TOKEN trong Vercel → Settings → Environment Variables.' });
    }

    const ok = await blobWrite({
      cerebras:   models.cerebras   || MODEL_DEFAULTS.cerebras,
      groq:       models.groq       || MODEL_DEFAULTS.groq,
      openrouter: models.openrouter || MODEL_DEFAULTS.openrouter,
    });

    if (ok) return res.status(200).json({ success: true, message: 'Đã lưu cấu hình model thành công!' });
    return res.status(500).json({ error: 'Lỗi ghi vào Vercel Blob' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
