// Vercel Blob REST API — không cần package
const BLOB_BASE = 'https://blob.vercel-storage.com';
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

const getToken = () => process.env.BLOB_READ_WRITE_TOKEN || '';
const blobEnabled = () => !!getToken();

// Shared headers — x-api-version:7 bắt buộc để API tự nhận store type (public/private)
const blobHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'x-api-version': '7',
});

async function blobRead() {
  const token = getToken();
  if (!token) return null;
  try {
    const r = await fetch(
      `${BLOB_BASE}?prefix=${encodeURIComponent(CONFIG_PATH)}&limit=1`,
      { headers: blobHeaders(token) }
    );
    if (!r.ok) return null;
    const { blobs } = await r.json();
    if (!blobs?.length) return null;
    // Thử fetch trực tiếp, nếu private thì gửi kèm auth
    const data = await fetch(blobs[0].url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    return data.ok ? await data.json() : null;
  } catch { return null; }
}

async function blobWrite(data) {
  const token = getToken();
  if (!token) return { ok: false, error: 'BLOB_READ_WRITE_TOKEN chưa set' };
  try {
    const res = await fetch(
      `${BLOB_BASE}/${CONFIG_PATH}?addRandomSuffix=false`,
      {
        method: 'PUT',
        headers: {
          ...blobHeaders(token),
          'x-content-type': 'application/json',
          // Không set x-access → tự động dùng access mode của store (public hoặc private)
        },
        body: JSON.stringify(data),
      }
    );
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function checkPassword(input) {
  const secret = process.env.ADMIN_PASSWORD || '';
  return secret !== '' && input.trim() === secret.trim();
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ['https://vn2000-webtest.vercel.app', 'http://localhost:3000'];
  res.setHeader('Access-Control-Allow-Origin', allowed.some(o => origin.startsWith(o)) ? origin : allowed[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    if (!checkPassword(req.query.password || ''))
      return res.status(401).json({ error: 'Sai mật khẩu admin' });
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

  if (req.method === 'POST') {
    const { password, models, order, enabled } = req.body || {};
    if (!checkPassword(password || ''))
      return res.status(401).json({ error: 'Sai mật khẩu admin' });
    if (!models || typeof models !== 'object')
      return res.status(400).json({ error: 'Thiếu trường models' });
    if (!blobEnabled())
      return res.status(503).json({ error: 'Chưa cấu hình BLOB_READ_WRITE_TOKEN' });

    const result = await blobWrite({
      cerebras:   models.cerebras   || MODEL_DEFAULTS.cerebras,
      groq:       models.groq       || MODEL_DEFAULTS.groq,
      gemini:     models.gemini     || MODEL_DEFAULTS.gemini,
      openrouter: models.openrouter || MODEL_DEFAULTS.openrouter,
      order:      Array.isArray(order) ? order : MODEL_DEFAULTS.order,
      enabled:    (enabled && typeof enabled === 'object') ? enabled : MODEL_DEFAULTS.enabled,
    });

    if (result.ok) return res.status(200).json({ success: true, message: 'Đã lưu thành công!' });
    return res.status(500).json({ error: `Lỗi Blob: ${result.error}` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
