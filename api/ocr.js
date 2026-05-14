export const config = {
  runtime: 'nodejs', // Bắt buộc dùng Node.js thay vì Edge
  regions: ['iad1'], // BẮT BUỘC ÉP CHẠY Ở MỸ (Washington D.C) để vượt rào Groq chặn IP Việt Nam
};

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

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

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('Chưa cấu hình GROQ_API_KEY trên Vercel');
    }

    const imageUrl = imageBase64.startsWith('data:image') 
      ? imageBase64 
      : `data:image/png;base64,${imageBase64}`;

    const payload = {
      model: req.body.model || "llama-3.2-90b-vision-preview",
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

    const aiRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
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

    const jsonStr = aiText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const coordinates = JSON.parse(jsonStr);

    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      throw new Error('Không tìm thấy tọa độ nào trong ảnh.');
    }

    return res.status(200).json({ success: true, data: coordinates });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
