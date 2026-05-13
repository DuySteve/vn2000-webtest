/**
 * Cloudflare Worker – VN2000 OCR via Google AI Studio API
 *
 * Env secrets cần cấu hình trên Cloudflare Dashboard:
 *   GEMINI_API_KEY  → API Key lấy từ https://aistudio.google.com/apikey
 *
 * Lý do dùng Worker làm proxy:
 *   - Cloudflare Worker chạy tại datacenter US/EU → tránh geo-block Việt Nam
 *   - API key được bảo mật trong env, không lộ ra frontend
 */

// gemini-1.5-flash: quota ổn định hơn trên Google AI Studio so với 2.0-flash
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

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
      const { imageBase64 } = await request.json();
      if (!imageBase64) throw new Error('Thiếu trường imageBase64 trong request body');

      // 2. Lấy API Key
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY chưa được cấu hình trên Cloudflare');

      // 3. Chuẩn bị payload
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

      const payload = {
        contents: [{
          parts: [
            {
              text: `Bạn là chuyên gia trắc địa Việt Nam. Hãy trích xuất TẤT CẢ các cặp tọa độ VN2000 (X, Y) từ bảng tọa độ trong hình ảnh này.

QUY TẮC:
- Tọa độ X (Northing) thường từ 800,000 đến 3,000,000
- Tọa độ Y (Easting) thường từ 100,000 đến 900,000
- Mỗi dòng bảng = 1 cặp tọa độ, đọc ĐỦ TẤT CẢ các dòng, không bỏ sót
- Số thập phân dùng dấu chấm (.)

CHỈ trả về JSON array thuần túy, không có markdown, không có giải thích:
[{"x": 2363228.12, "y": 520031.45}, {"x": 2363150.00, "y": 520055.78}]`
            },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: base64Data,
              },
            },
          ],
        }],
        generationConfig: {
          temperature:     0,
          maxOutputTokens: 2048,
        },
      };

      // 4. Gọi Google AI Studio API (Cloudflare Worker chạy tại US/EU → không bị geo-block)
      const aiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      if (!aiRes.ok) {
        const errBody = await aiRes.text();
        throw new Error(`Google AI HTTP ${aiRes.status}: ${errBody}`);
      }

      const data = await aiRes.json();

      if (data.error) {
        throw new Error(`Google AI error [${data.error.code}]: ${data.error.message}`);
      }

      // 5. Parse kết quả
      const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!aiText) throw new Error('AI không trả về kết quả. Kiểm tra lại ảnh chụp.');

      let coordinates = [];
      try {
        // Xóa markdown code block nếu AI vẫn trả về
        const jsonStr = aiText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        coordinates   = JSON.parse(jsonStr);
        if (!Array.isArray(coordinates)) throw new Error('Kết quả không phải array');
      } catch (e) {
        throw new Error(`Lỗi parse kết quả AI: "${aiText.substring(0, 300)}"`);
      }

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
