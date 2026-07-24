/**
 * Cloudflare Worker – VN2000 OCR
 *
 * Env secrets cần cấu hình trên Cloudflare Dashboard:
 *   GROQ_API_KEY hoặc OPENROUTER_API_KEY → API Key của provider (Groq/OpenRouter/...)
 */

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