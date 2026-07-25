export const config = {
  runtime: 'nodejs', // Bắt buộc dùng Node.js thay vì Edge
  regions: ['iad1'], // BẮT BUỘC ÉP CHẠY Ở MỸ (Washington D.C) để vượt rào Groq chặn IP Việt Nam
};

// reasoning_effort: 'none' = bỏ block <think>, giảm ~70% token, tránh vượt TPM Groq
const REASONING_MODELS = ['qwen/qwen3', 'qwen3', 'deepseek-r1', 'deepseek/deepseek-r1'];

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
    } catch (e) {}

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
    } catch (e) {}
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
const MAX_REQUESTS_PER_IP = 10;

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

    // Xây dựng danh sách providers theo thứ tự ưu tiên
    const providers = [];
    if (process.env.CEREBRAS_API_KEY) {
      providers.push({
        name: 'Cerebras', apiKey: process.env.CEREBRAS_API_KEY.trim(),
        apiUrl: 'https://api.cerebras.ai/v1/chat/completions', model: 'gemma-4-31b'
      });
    }
    if (process.env.GROQ_API_KEY) {
      providers.push({
        name: 'Groq', apiKey: process.env.GROQ_API_KEY.trim(),
        apiUrl: 'https://api.groq.com/openai/v1/chat/completions', model: 'qwen/qwen3.6-27b'
      });
    }
    if (process.env.OPENROUTER_API_KEY) {
      providers.push({
        name: 'OpenRouter', apiKey: process.env.OPENROUTER_API_KEY.trim(),
        apiUrl: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.2-11b-vision-instruct:free'
      });
    }
    if (providers.length === 0) {
      throw new Error('Chưa cấu hình API Key nào (CEREBRAS_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY)');
    }

    const imageUrl = imageBase64.startsWith('data:image') 
      ? imageBase64 
      : `data:image/png;base64,${imageBase64}`;

    let lastError = null;

    // Thử từng provider, fallback khi bị rate limit
    for (const provider of providers) {
      try {
        const payload = {
          model: provider.model,
          messages: [
            { role: "system", content: "Output X Y per line. No text." },
            { role: "user", content: [{ type: "image_url", image_url: { url: imageUrl, detail: "low" } }] }
          ],
          temperature: 0,
          max_tokens: 384
        };

        // reasoning_effort cho Groq reasoning models
        if (REASONING_MODELS.some(m => provider.model.toLowerCase().includes(m.toLowerCase()))) {
          payload.reasoning_effort = 'none';
        }

        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}` };
        if (provider.name === 'OpenRouter') {
          headers['HTTP-Referer'] = 'https://vn2000-webtest.vercel.app';
          headers['X-Title'] = 'VN2000 So Do OCR';
        }

        const aiRes = await fetch(provider.apiUrl, { method: 'POST', headers, body: JSON.stringify(payload) });

        // Rate limit → thử provider tiếp theo
        if (aiRes.status === 429 || aiRes.status === 413) {
          lastError = `${provider.name} rate limited (${aiRes.status})`;
          continue;
        }

        if (!aiRes.ok) {
          const errText = await aiRes.text();
          lastError = `${provider.name} HTTP ${aiRes.status}: ${errText}`;
          continue;
        }

        const data = await aiRes.json();
        if (data.error) { lastError = `${provider.name}: ${data.error.message}`; continue; }

        const aiText = data.choices?.[0]?.message?.content;
        if (!aiText) { 
          lastError = `${provider.name}: AI trả về kết quả rỗng (Data: ${JSON.stringify(data)})`; 
          continue; 
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
