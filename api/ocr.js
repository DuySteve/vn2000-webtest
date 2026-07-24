export const config = {
  runtime: 'nodejs', // Bắt buộc dùng Node.js thay vì Edge
  regions: ['iad1'], // BẮT BUỘC ÉP CHẠY Ở MỸ (Washington D.C) để vượt rào Groq chặn IP Việt Nam
};

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
- Mỗi dòng bảng = 1 cặp tọa độ, đọc ĐỦ TẤT CẢ các dòng, không bỏ sót
- Số thập phân dùng dấu chấm (.)

CHỈ trả về JSON array thuần túy, không có markdown, không có giải thích:
[{"x": 2363228.12, "y": 520031.45}]`
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

    // 1. Loại bỏ các khối suy nghĩ <think>...</think> của model reasoning (Qwen 3.6 / DeepSeek)
    let cleanText = aiText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/gi, '').trim();

    // 2. Tìm đoạn JSON array [...] trong response text
    let jsonStr = '';
    const jsonMatch = cleanText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    } else {
      jsonStr = cleanText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    }

    // 3. Parse JSON và chuẩn hóa tọa độ
    let rawCoords = [];
    try {
      rawCoords = JSON.parse(jsonStr);
    } catch (e) {
      // Thử sửa lỗi dấu phẩy ở số thập phân
      const fixedJson = jsonStr.replace(/(\d+),(\d+)/g, '$1.$2');
      rawCoords = JSON.parse(fixedJson);
    }

    if (!Array.isArray(rawCoords)) {
      throw new Error('Kết quả không phải dạng danh sách tọa độ hợp lệ.');
    }

    const coordinates = rawCoords.map(item => {
      let x = typeof item.x === 'string' ? parseFloat(item.x.replace(',', '.')) : parseFloat(item.x);
      let y = typeof item.y === 'string' ? parseFloat(item.y.replace(',', '.')) : parseFloat(item.y);
      return { x, y };
    }).filter(p => !isNaN(p.x) && !isNaN(p.y));

    if (coordinates.length === 0) {
      throw new Error('Không tìm thấy tọa độ nào trong ảnh.');
    }

    return res.status(200).json({ success: true, data: coordinates });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
