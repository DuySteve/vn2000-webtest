export const config = {
  runtime: 'nodejs', // Bắt buộc dùng Node.js thay vì Edge
  regions: ['iad1'], // BẮT BUỘC ÉP CHẠY Ở MỸ (Washington D.C) để vượt rào Groq chặn IP Việt Nam
};

function parseNum(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    let str = val.trim();
    if (str.includes('.') && str.includes(',')) {
      if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
        str = str.replace(/\./g, '').replace(',', '.');
      } else {
        str = str.replace(/,/g, '');
      }
    } else if (str.includes(',')) {
      if (str.indexOf(',') === str.lastIndexOf(',') && str.length - str.indexOf(',') <= 4) {
        str = str.replace(',', '.');
      } else {
        str = str.replace(/,/g, '');
      }
    }
    const num = parseFloat(str);
    return isNaN(num) ? null : num;
  }
  return null;
}

function sanitizeItem(item) {
  if (!item) return null;

  // Nếu item là Array: [2380968.497, 524713.053]
  if (Array.isArray(item)) {
    const num1 = parseNum(item[0]);
    const num2 = parseNum(item[1]);
    if (num1 !== null && num2 !== null) {
      if (num1 > num2) {
        return { x: num1, y: num2 };
      } else {
        return { x: num2, y: num1 };
      }
    }
    return null;
  }

  // Nếu item là Object
  if (typeof item === 'object') {
    let xVal = null;
    let yVal = null;

    for (let key in item) {
      const k = key.toLowerCase().trim();
      const val = parseNum(item[key]);
      if (val === null) continue;

      if (k === 'x' || k === 'x_m' || k === 'x (m)' || k === 'northing' || k === 'x_coord') {
        xVal = val;
      } else if (k === 'y' || k === 'y_m' || k === 'y (m)' || k === 'easting' || k === 'y_coord') {
        yVal = val;
      }
    }

    if (xVal === null || yVal === null) {
      const vals = Object.values(item).map(parseNum).filter(v => v !== null);
      for (let v of vals) {
        if (v >= 800000 && v <= 3000000 && xVal === null) {
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

  // 2. Thử các ứng viên JSON
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

    // Sửa các lỗi cú pháp JSON phổ biến
    let sanitizedStr = rawStr.replace(/(["']?[xyXY]["']?\s*:\s*\d+),(\d+)/gi, '$1.$2');
    sanitizedStr = sanitizedStr.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
    sanitizedStr = sanitizedStr.replace(/'/g, '"');
    sanitizedStr = sanitizedStr.replace(/,\s*([}\]])/g, '$1');

    try {
      const parsed = JSON.parse(sanitizedStr);
      const arr = extractArrayFromParsedJson(parsed);
      if (arr) {
        const result = arr.map(sanitizeItem).filter(Boolean);
        if (result.length > 0) return result;
      }
    } catch (e) {}
  }

  // 3. Fallback: Quét Regex theo dòng (đọc được cả bảng Markdown / Văn bản thuần)
  const lines = cleanText.split('\n');
  const extracted = [];

  for (let line of lines) {
    let norm = line.replace(/(\d+)\.(\d{3})/g, '$1$2').replace(/(\d+),(\d+)/g, '$1.$2');
    const matches = norm.match(/\d+(?:\.\d+)?/g);
    if (!matches || matches.length < 2) continue;

    const nums = matches.map(n => parseFloat(n)).filter(n => !isNaN(n));
    let foundX = null;
    let foundY = null;

    for (let n of nums) {
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

export default async function handler(req, res) {
  // CORS Preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      throw new Error('Thiếu trường imageBase64 trong request');
    }

    const rawKey = process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!rawKey) {
      throw new Error('Chưa cấu hình GROQ_API_KEY trên Vercel');
    }
    const apiKey = rawKey.trim();

    const selectedModel = req.body.model || "qwen/qwen3.6-27b";
    
    let apiUrl = process.env.AI_API_URL;
    if (!apiUrl) {
      if (apiKey.startsWith('sk-or-') || process.env.OPENROUTER_API_KEY) {
        apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
      } else {
        apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
      }
    }

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

    const aiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`Groq API HTTP ${aiRes.status}: ${errText}`);
    }

    const data = await aiRes.json();
    if (data.error) {
      throw new Error(`Groq API error: ${data.error.message}`);
    }

    const aiText = data.choices?.[0]?.message?.content;
    if (!aiText) throw new Error('AI không trả về kết quả.');

    const coordinates = parseCoordinatesFromAIText(aiText);

    if (coordinates.length === 0) {
      throw new Error('Không tìm thấy tọa độ nào trong ảnh.');
    }

    return res.status(200).json({ success: true, data: coordinates });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
