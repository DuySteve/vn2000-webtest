/**
 * Cloudflare Worker – VN2000 OCR
 *
 * Env secrets cần cấu hình trên Cloudflare Dashboard:
 *   GROQ_API_KEY hoặc OPENROUTER_API_KEY → API Key của provider (Groq/OpenRouter/...)
 */

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

export default {
  async fetch(request, env, ctx) {

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin':  '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Only POST is allowed', { status: 405 });
    }

    try {
      // 1. Đọc ảnh từ request
      const reqJson = await request.json().catch(() => ({}));
      const { imageBase64, model: clientModel } = reqJson;
      if (!imageBase64) throw new Error('Thiếu trường imageBase64 trong request body');

      // 2. Lấy API Key
      const rawKey = env.GROQ_API_KEY || env.OPENROUTER_API_KEY; 
      if (!rawKey) throw new Error('API_KEY chưa được cấu hình trên Cloudflare (GROQ_API_KEY hoặc OPENROUTER_API_KEY)');
      const apiKey = rawKey.trim();

      const selectedModel = clientModel || "qwen/qwen3.6-27b";
      let apiUrl = env.AI_API_URL;

      if (!apiUrl) {
        if (apiKey.startsWith('sk-or-') || env.OPENROUTER_API_KEY) {
          apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
        } else {
          apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
        }
      }

      // 3. Chuẩn bị payload cho OpenAI-compatible API
      const imageUrl = imageBase64.startsWith('data:image') 
        ? imageBase64 
        : `data:image/png;base64,${imageBase64}`;

      const payload = {
        model: selectedModel, 
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Bạn là chuyên gia trắc địa Việt Nam. Hãy trích xuất TẤT CẢ các cặp tọa độ VN2000 (X, Y) từ bảng tọa độ trong hình ảnh này.

QUY TẮC:
- Tọa độ X (Northing) thường từ 500,000 đến 3,000,000
- Tọa độ Y (Easting) thường từ 100,000 đến 900,000
- Dữ liệu dạng X(m), Y(m) hoặc X, Y. Giữ nguyên dấu chấm thập phân (.) nếu có trong ảnh
- Mỗi dòng bảng = 1 cặp tọa độ, đọc ĐỦ TẤT CẢ các dòng, không bỏ sót
- CHỈ trả về duy nhất 1 JSON array thuần túy, không dùng markdown, không có giải thích hay suy nghĩ:
[{"x": 2363228.565, "y": 520031.694}]`
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ],
        temperature: 0,
        max_tokens: 2048
      };

      // reasoning_effort: 'none' = bỏ block <think>, giảm ~70% tokens/request, tránh vượt TPM
      if (REASONING_MODELS.some(m => selectedModel.toLowerCase().includes(m.toLowerCase()))) {
        payload.reasoning_effort = 'none';
      }

      const headers = { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };

      if (apiUrl.includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'https://vn2000-webtest.vercel.app';
        headers['X-Title'] = 'VN2000 So Do OCR';
      }

      // 4. Gọi API
      const aiRes = await fetch(apiUrl, {
        method:  'POST',
        headers: headers,
        body:    JSON.stringify(payload),
      });

      if (!aiRes.ok) {
        const errBody = await aiRes.text();
        throw new Error(`API HTTP ${aiRes.status}: ${errBody}`);
      }

      const data = await aiRes.json();

      if (data.error) {
        throw new Error(`API error: ${data.error.message}`);
      }

      // 5. Parse kết quả
      const aiText = data.choices?.[0]?.message?.content;
      if (!aiText) throw new Error('AI không trả về kết quả. Kiểm tra lại ảnh chụp.');

      const coordinates = parseCoordinatesFromAIText(aiText);

      if (coordinates.length === 0) {
        throw new Error('Không tìm thấy tọa độ nào. Hãy chụp rõ nét vùng bảng tọa độ.');
      }

      // 6. Trả kết quả
      return new Response(JSON.stringify({ success: true, data: coordinates }), {
        headers: {
          'Content-Type':                'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });

    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        {
          status: 500,
          headers: {
            'Content-Type':                'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
  },
};