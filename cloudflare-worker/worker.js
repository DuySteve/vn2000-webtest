/**
 * Cloudflare Worker – VN2000 OCR
 *
 * Env secrets cần cấu hình trên Cloudflare Dashboard:
 *   GROQ_API_KEY hoặc OPENROUTER_API_KEY → API Key của provider (Groq/OpenRouter/...)
 */

function parseCoordinatesFromAIText(aiText) {
  if (!aiText) return [];

  // 1. Loại bỏ các khối suy nghĩ <think>...</think> của model reasoning (Qwen 3.6 / DeepSeek)
  let cleanText = aiText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .trim();

  // 2. Thử parse JSON
  let jsonCandidates = [];
  
  const matchArray = cleanText.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (matchArray) jsonCandidates.push(matchArray[0]);

  const matchCode = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (matchCode) jsonCandidates.push(matchCode[1].trim());

  jsonCandidates.push(cleanText);

  for (let rawStr of jsonCandidates) {
    if (!rawStr) continue;

    // Direct JSON parse
    try {
      const parsed = JSON.parse(rawStr);
      if (Array.isArray(parsed)) {
        const result = sanitizeCoordinates(parsed);
        if (result.length > 0) return result;
      }
    } catch (e) {}

    // Sửa các lỗi cú pháp JSON thường gặp từ LLM:
    // a) Sửa số thập phân dùng dấu phẩy dạng "x": 2380968,497 -> "x": 2380968.497
    let sanitizedStr = rawStr.replace(/(["']?[xyXY]["']?\s*:\s*\d+),(\d+)/gi, '$1.$2');
    // b) Sửa unquoted keys: { x: ... } -> { "x": ... }
    sanitizedStr = sanitizedStr.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
    // c) Sửa nháy đơn thành nháy kép
    sanitizedStr = sanitizedStr.replace(/'/g, '"');
    // d) Xóa phẩy thừa ở cuối object/array
    sanitizedStr = sanitizedStr.replace(/,\s*([}\]])/g, '$1');

    try {
      const parsed = JSON.parse(sanitizedStr);
      if (Array.isArray(parsed)) {
        const result = sanitizeCoordinates(parsed);
        if (result.length > 0) return result;
      }
    } catch (e) {}
  }

  // 3. Fallback: Quét từng dòng bằng Regex (Dành cho trường hợp AI trả về bảng Markdown hoặc Text thuần)
  const lines = cleanText.split('\n');
  const extracted = [];

  for (let line of lines) {
    const normalizedLine = line.replace(/(\d+),(\d+)/g, '$1.$2');
    const nums = normalizedLine.match(/\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 2) continue;

    const parsedNums = nums.map(n => parseFloat(n));
    let foundX = null;
    let foundY = null;

    for (let n of parsedNums) {
      if (n >= 800000 && n <= 3000000 && foundX === null) {
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

function sanitizeCoordinates(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    if (!item || typeof item !== 'object') return null;
    let xRaw = item.x !== undefined ? item.x : (item.X !== undefined ? item.X : item.northing);
    let yRaw = item.y !== undefined ? item.y : (item.Y !== undefined ? item.Y : item.easting);

    if (typeof xRaw === 'string') xRaw = parseFloat(xRaw.replace(',', '.'));
    if (typeof yRaw === 'string') yRaw = parseFloat(yRaw.replace(',', '.'));

    const x = Number(xRaw);
    const y = Number(yRaw);

    if (!isNaN(x) && !isNaN(y) && x > 0 && y > 0) {
      return { x, y };
    }
    return null;
  }).filter(Boolean);
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
- Tọa độ X (Northing) thường từ 800,000 đến 3,000,000
- Tọa độ Y (Easting) thường từ 100,000 đến 900,000
- BẮT BUỘC dùng dấu chấm (.) cho số thập phân (Ví dụ: 2380968.497, KHÔNG dùng 2380968,497)
- Mỗi dòng bảng = 1 cặp tọa độ, đọc ĐỦ TẤT CẢ các dòng, không bỏ sót
- CHỈ trả về duy nhất 1 JSON array thuần túy, không dùng markdown, không có giải thích hay suy nghĩ:
[{"x": 2380968.497, "y": 524713.053}]`
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