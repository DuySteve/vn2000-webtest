import { put, list, getDownloadUrl } from '@vercel/blob';

const CONFIG_PATH = 'vn2000-model-config.json';

export const config = {
  runtime: 'nodejs',
  regions: ['iad1'],
};

export const MODEL_DEFAULTS = {
  cerebras:   process.env.MODEL_CEREBRAS   || 'gemma-4-31b',
  groq:       process.env.MODEL_GROQ       || 'qwen/qwen3.8-27b',
  gemini:     process.env.MODEL_GEMINI     || 'gemini-2.0-flash-lite',
  openrouter: process.env.MODEL_OPENROUTER || 'google/gemma-4-31b-it:free',
  order:      ['cerebras', 'groq', 'gemini', 'openrouter'],
  enabled:    { cerebras: true, groq: true, gemini: true, openrouter: true },
};

const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;

// ── Blob helpers (dùng @vercel/blob package — hỗ trợ private store) ──
async function blobRead() {
  if (!blobEnabled()) return null;
  try {
    const { blobs } = await list({ prefix: CONFIG_PATH });
    if (!blobs.length) return null;
    // getDownloadUrl tạo signed URL cho private blob
    const downloadUrl = await getDownloadUrl(blobs[0].url);
    const r = await fetch(downloadUrl, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function blobWrite(data) {
  if (!blobEnabled()) return { ok: false, error: 'BLOB_READ_WRITE_TOKEN chưa set' };
  try {
    await put(CONFIG_PATH, JSON.stringify(data), {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
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
        gemini:     stored?.gemini     || MODEL_DEFAULTS.gemini,
        openrouter: stored?.openrouter || MODEL_DEFAULTS.openrouter,
      },
      order:   stored?.order   || MODEL_DEFAULTS.order,
      enabled: stored?.enabled ?? MODEL_DEFAULTS.enabled,
      defaults: MODEL_DEFAULTS,
    });
  }

  // ── POST: lưu config ──
  if (req.method === 'POST') {
    const { password, models, order, enabled } = req.body || {};
    if (!checkPassword(password || '')) return res.status(401).json({ error: 'Sai mật khẩu admin' });
    if (!models || typeof models !== 'object') return res.status(400).json({ error: 'Thiếu trường models' });
    if (!blobEnabled()) {
      return res.status(503).json({ error: 'Chưa cấu hình BLOB_READ_WRITE_TOKEN.' });
    }

    const result = await blobWrite({
      cerebras:   models.cerebras   || MODEL_DEFAULTS.cerebras,
      groq:       models.groq       || MODEL_DEFAULTS.groq,
      gemini:     models.gemini     || MODEL_DEFAULTS.gemini,
      openrouter: models.openrouter || MODEL_DEFAULTS.openrouter,
      order:      Array.isArray(order) ? order : MODEL_DEFAULTS.order,
      enabled:    (enabled && typeof enabled === 'object') ? enabled : MODEL_DEFAULTS.enabled,
    });

    if (result.ok) return res.status(200).json({ success: true, message: 'Đã lưu cấu hình thành công!' });
    return res.status(500).json({ error: `Lỗi Vercel Blob: ${result.error}` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
