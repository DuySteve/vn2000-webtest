export const config = {
  runtime: 'edge', // Chạy trên Edge Server (US) để vượt geo-block
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent';

export default async function handler(req) {
  // 1. CORS Preflight - Cho phép GitHub Pages gọi tới Vercel
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { imageBase64 } = await req.json();
    if (!imageBase64) {
      throw new Error('Thiếu trường imageBase64 trong request');
    }

    // Lấy API Key từ Environment Variables của Vercel
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Chưa cấu hình GEMINI_API_KEY trên Vercel');
    }

    // Cắt bỏ phần header data:image/png;base64,
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
[{"x": 2363228.12, "y": 520031.45}]`
          },
          {
            inline_data: {
              mime_type: 'image/png',
              data: base64Data,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
      },
    };

    // Gọi API của Google từ IP Vercel (Mỹ)
    const aiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`Google AI HTTP ${aiRes.status}: ${errText}`);
    }

    const data = await aiRes.json();
    if (data.error) {
      throw new Error(`Google AI error: ${data.error.message}`);
    }

    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiText) throw new Error('AI không trả về kết quả.');

    // Làm sạch JSON
    const jsonStr = aiText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const coordinates = JSON.parse(jsonStr);

    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      throw new Error('Không tìm thấy tọa độ nào trong ảnh.');
    }

    return new Response(JSON.stringify({ success: true, data: coordinates }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // Bắt buộc để bypass CORS
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
