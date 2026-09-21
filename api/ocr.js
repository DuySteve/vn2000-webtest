import { list } from '@vercel/blob';

export const config = {
  runtime: 'nodejs',
  regions: ['iad1'],
};

// reasoning_effort: 'none' = bỏ block <think>, giảm ~70% token, tránh vượt TPM Groq
const REASONING_MODELS = ['qwen/qwen3', 'qwen3', 'deepseek-r1', 'deepseek/deepseek-r1'];

const BLOB_BASE = 'https://blob.vercel-storage.com';
const BLOB_CONFIG = 'vn2000-model-config.json';

// ── Model defaults (override bằng Vercel Blob REST API hoặc env var) ──
const MODEL_DEFAULTS = {
  cerebras: process.env.MODEL_CEREBRAS || 'gemma-4-31b',
  groq: process.env.MODEL_GROQ || 'qwen/qwen3.8-27b',
  gemini: process.env.MODEL_GEMINI || 'gemini-2.0-flash-lite',
  openrouter: process.env.MODEL_OPENROUTER || 'google/gemma-4-31b-it:free',
  order: ['cerebras', 'groq', 'gemini', 'openrouter'],
  enabled: { cerebras: true, groq: true, gemini: true, openrouter: true },
};

// In-memory TTL cache (60s) — tránh gọi Blob API mỗi request
let _configCache = null;
let _cacheTs = 0;
const CACHE_TTL = 5_000; // 5s — đủ ngắn để config mới có hiệu lực ngay sau khi lưu admin

async function getModelConfig() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { ...MODEL_DEFAULTS };
  const now = Date.now();
  if (_configCache && now - _cacheTs < CACHE_TTL) return _configCache;
  try {
    const listRes = await fetch(
      `${BLOB_BASE}?prefix=${encodeURIComponent(BLOB_CONFIG)}&limit=10`,
      { headers: { Authorization: `Bearer ${token}`, 'x-api-version': '7' } }
    );
    if (!listRes.ok) return { ...MODEL_DEFAULTS };
    const { blobs } = await listRes.json();
    if (!blobs?.length) return { ...MODEL_DEFAULTS };
    const newest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
    const r = await fetch(`${newest.url}?t=${Date.now()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!r.ok) return { ...MODEL_DEFAULTS };
    const stored = await r.json();
    _configCache = {
      cerebras: stored.cerebras || MODEL_DEFAULTS.cerebras,
      groq: stored.groq || MODEL_DEFAULTS.groq,
      gemini: stored.gemini || MODEL_DEFAULTS.gemini,
      openrouter: stored.openrouter || MODEL_DEFAULTS.openrouter,
      order: Array.isArray(stored.order) ? stored.order : MODEL_DEFAULTS.order,
      enabled: stored.enabled ?? MODEL_DEFAULTS.enabled,
    };
    _cacheTs = now;
    return _configCache;
  } catch {
    return { ...MODEL_DEFAULTS };
  }
}

function parseVN2000Number(val) {
  if (typeof val === 'number') return val;
  if (!val || typeof val !== 'string') return null;

  let str = val.trim();

  if ((str.match(/\./g) || []).length > 1) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if ((str.match(/,/g) || []).length > 1) {
    str = str.replace(/,/g, '');
  } else if (str.includes(',')) {
    str = str.replace(',', '.');
  }

  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

function sanitizeItem(item) {
  if (!item) return null;

  // Nếu item là Array: [2363228.565, 520031.694] hoặc ["2363228.565", "520031.694"]
  if (Array.isArray(item)) {
    const nums = item.map(parseVN2000Number).filter(v => v !== null);
    let xVal = null;
    let yVal = null;
    for (let n of nums) {
      if (n >= 500000 && n <= 3500000 && xVal === null) {
        xVal = n;
      } else if (n >= 100000 && n <= 900000 && yVal === null) {
        yVal = n;
      }
    }
    if (xVal !== null && yVal !== null) {
      return { x: xVal, y: yVal };
    }
    return null;
  }

  // Nếu item là Object
  if (typeof item === 'object') {
    let xVal = null;
    let yVal = null;

    for (let key in item) {
      const k = key.toLowerCase().trim();
      const val = parseVN2000Number(item[key]);
      if (val === null) continue;

      if (k === 'x' || k === 'x_m' || k === 'x (m)' || k === 'northing' || k === 'x_coord' || k === 'x(m)') {
        xVal = val;
      } else if (k === 'y' || k === 'y_m' || k === 'y (m)' || k === 'easting' || k === 'y_coord' || k === 'y(m)') {
        yVal = val;
      }
    }

    if (xVal === null || yVal === null) {
      const vals = Object.values(item).map(parseVN2000Number).filter(v => v !== null);
      for (let v of vals) {
        if (v >= 500000 && v <= 3500000 && xVal === null) {
          xVal = v;
        } else if (v >= 100000 && v <= 900000 && yVal === null) {
          yVal = v;
        }
      }
    }

    if (xVal !== null && yVal !== null && xVal > 0 && yVal > 0) {
      return { x: xVal, y: yVal };
    }
  }

  return null;
}

function extractArrayFromParsedJson(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    for (let key in parsed) {
      if (Array.isArray(parsed[key])) {
        return parsed[key];
      }
    }
  }
  return null;
}

function parseCoordinatesFromAIText(aiText) {
  if (!aiText) return [];

  // 1. Loại bỏ các khối suy nghĩ <think>...</think> của model reasoning
  let cleanText = aiText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .trim();

  // 2. Thử parse các khối JSON
  let jsonCandidates = [];

  const matchArray = cleanText.match(/\[\s*[\s\S]*\s*\]/);
  if (matchArray) jsonCandidates.push(matchArray[0]);

  const matchObject = cleanText.match(/\{\s*[\s\S]*\s*\}/);
  if (matchObject) jsonCandidates.push(matchObject[0]);

  const matchCode = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (matchCode) jsonCandidates.push(matchCode[1].trim());

  jsonCandidates.push(cleanText);

  for (let rawStr of jsonCandidates) {
    if (!rawStr) continue;

    try {
      const parsed = JSON.parse(rawStr);
      const arr = extractArrayFromParsedJson(parsed);
      if (arr) {
        const result = arr.map(sanitizeItem).filter(Boolean);
        if (result.length > 0) return result;
      }
    } catch (e) { }

    // Sửa các lỗi cú pháp JSON thông thường
    let sanitizedStr = rawStr
      .replace(/([{,]\s*)([a-zA-Z0-9_\s\(\)]+)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,\s*([}\]])/g, '$1');

    try {
      const parsed = JSON.parse(sanitizedStr);
      const arr = extractArrayFromParsedJson(parsed);
      if (arr) {
        const result = arr.map(sanitizeItem).filter(Boolean);
        if (result.length > 0) return result;
      }
    } catch (e) { }
  }

  // 3. Fallback: Quét Regex theo dòng (đọc trực tiếp mọi định dạng Bảng / Text)
  const lines = cleanText.split('\n');
  const extracted = [];

  for (let line of lines) {
    let norm = line.replace(/(\d+),(\d+)/g, '$1.$2');
    const matches = norm.match(/\d+(?:\.\d+)?/g);
    if (!matches || matches.length < 2) continue;

    const nums = matches.map(n => parseFloat(n)).filter(n => !isNaN(n));
    let foundX = null;
    let foundY = null;

    for (let n of nums) {
      if (n >= 500000 && n <= 3500000 && foundX === null) {
        foundX = n;
      } else if (n >= 100000 && n <= 900000 && foundY === null) {
        foundY = n;
      }
    }

    if (foundX !== null && foundY !== null) {
      extracted.push({ x: foundX, y: foundY });
    }
  }

  return extracted;
}

const ALLOWED_ORIGIN = 'https://vn2000-webtest.vercel.app';
const RATE_LIMIT_MAP = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS_PER_IP = 40;

export default async function handler(req, res) {
  // CORS Preflight with strict origin checking
  const origin = req.headers.origin;
  const isLocalhost = origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'));
  const allowed = (origin === ALLOWED_ORIGIN || isLocalhost) ? origin : ALLOWED_ORIGIN;

  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Security: Check Origin
  if (origin && origin !== ALLOWED_ORIGIN && !isLocalhost) {
    return res.status(403).json({ error: 'Forbidden: Origin not allowed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Security: Rate Limiting
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (ip !== 'unknown') {
    const now = Date.now();
    const userRecord = RATE_LIMIT_MAP.get(ip);
    if (userRecord && (now - userRecord.startTime < RATE_LIMIT_WINDOW_MS)) {
      if (userRecord.count >= MAX_REQUESTS_PER_IP) {
        return res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 1 phút.' });
      }
      userRecord.count++;
    } else {
      RATE_LIMIT_MAP.set(ip, { startTime: now, count: 1 });
    }
  }

  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      throw new Error('Thiếu trường imageBase64 trong request');
    }

    // Security: Payload Size Limit (max ~500KB since our frontend compressed image is ~20KB)
    if (imageBase64.length > 500 * 1024) {
      return res.status(413).json({ error: 'Payload quá lớn. Kích thước ảnh tối đa cho phép là ~500KB.' });
    }

    // Xây dựng danh sách providers theo thứ tự ưu tiên từ admin config
    const modelConfig = await getModelConfig();
    const ALL_PROVIDERS = {
      cerebras: process.env.CEREBRAS_API_KEY ? {
        name: 'Cerebras', type: 'openai',
        apiKey: process.env.CEREBRAS_API_KEY.trim(),
        apiUrl: 'https://api.cerebras.ai/v1/chat/completions',
        model: modelConfig.cerebras,
      } : null,
      groq: process.env.GROQ_API_KEY ? {
        name: 'Groq', type: 'openai',
        apiKey: process.env.GROQ_API_KEY.trim(),
        apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
        model: modelConfig.groq,
      } : null,
      gemini: process.env.GEMINI_API_KEY ? {
        name: 'Gemini', type: 'gemini',
        apiKey: process.env.GEMINI_API_KEY.trim(),
        model: modelConfig.gemini,
      } : null,
      openrouter: process.env.OPENROUTER_API_KEY ? {
        name: 'OpenRouter', type: 'openai',
        apiKey: process.env.OPENROUTER_API_KEY.trim(),
        apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
        model: modelConfig.openrouter,
      } : null,
    };

    // Sắp xếp theo thứ tự trong config, bỏ qua provider bị tắt
    const enabled = modelConfig.enabled || MODEL_DEFAULTS.enabled;
    const providers = modelConfig.order
      .filter(k => enabled[k] !== false)   // bỏ qua provider bị tắt
      .map(k => ALL_PROVIDERS[k])
      .filter(Boolean);

    if (providers.length === 0) {
      throw new Error('Chưa cấu hình API Key nào');
    }

    const imageUrl = imageBase64.startsWith('data:image')
      ? imageBase64
      : `data:image/png;base64,${imageBase64}`;

    let lastError = null;

    for (const provider of providers) {
      try {
        let aiText = null;

        if (provider.type === 'gemini') {
          // ── Gemini API (format khác OpenAI) ──
          const base64Data = imageBase64.startsWith('data:')
            ? imageBase64.split(',')[1]
            : imageBase64;
          const mimeType = imageBase64.startsWith('data:')
            ? imageBase64.split(';')[0].split(':')[1]
            : 'image/png';

          const geminiPayload = {
            contents: [{
              parts: [
                { text: 'Output X Y per line. No text.' },
                { inline_data: { mime_type: mimeType, data: base64Data } },
              ]
            }],
            generationConfig: { temperature: 0, maxOutputTokens: 384 },
          };

          const gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.apiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiPayload) }
          );

          if (gRes.status === 429) { lastError = 'Gemini rate limited'; continue; }
          if (!gRes.ok) { lastError = `Gemini HTTP ${gRes.status}: ${await gRes.text()}`; continue; }

          const gData = await gRes.json();
          aiText = gData.candidates?.[0]?.content?.parts?.[0]?.text || null;
          if (!aiText) { lastError = 'Gemini: trả về kết quả rỗng'; continue; }

        } else {
          // ── OpenAI-compatible (Cerebras / Groq / OpenRouter) ──
          const payload = {
            model: provider.model,
            messages: [
              { role: 'system', content: 'Output X Y per line. No text.' },
              { role: 'user', content: [{ type: 'image_url', image_url: { url: imageUrl, detail: 'low' } }] },
            ],
            temperature: 0,
            max_tokens: 384,
          };

          if (REASONING_MODELS.some(m => provider.model.toLowerCase().includes(m.toLowerCase()))) {
            payload.reasoning_effort = 'none';
          }

          const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` };
          if (provider.name === 'OpenRouter') {
            headers['HTTP-Referer'] = 'https://vn2000-webtest.vercel.app';
            headers['X-Title'] = 'VN2000 So Do OCR';
          }

          const aiRes = await fetch(provider.apiUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
          if (aiRes.status === 429 || aiRes.status === 413) { lastError = `${provider.name} rate limited (${aiRes.status})`; continue; }
          if (!aiRes.ok) { lastError = `${provider.name} HTTP ${aiRes.status}: ${await aiRes.text()}`; continue; }

          const data = await aiRes.json();
          if (data.error) { lastError = `${provider.name}: ${data.error.message}`; continue; }
          aiText = data.choices?.[0]?.message?.content;
          if (!aiText) { lastError = `${provider.name}: AI trả về kết quả rỗng`; continue; }
        }

        const coordinates = parseCoordinatesFromAIText(aiText);
        if (coordinates.length === 0) { lastError = `${provider.name}: Không tìm thấy tọa độ`; continue; }
        return res.status(200).json({ success: true, data: coordinates, provider: provider.name });

      } catch (e) {
        lastError = `${provider.name}: ${e.message}`;
        continue;
      }
    }

    throw new Error(lastError || 'Tất cả providers đều thất bại');
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
