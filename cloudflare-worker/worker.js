export default {
  async fetch(request, env, ctx) {
    // 1. Xử lý CORS để cho phép web tĩnh gọi đến API này
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Only POST is allowed', { status: 405 });
    }

    try {
      const { imageBase64 } = await request.json();
      
      // Lấy GEMINI_API_KEY từ biến môi trường của Cloudflare
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is not configured on Cloudflare');

      // Dùng bản Gemini 2.0 Flash (Bản mới nhất)
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      
      // Cắt bỏ phần header data:image/jpeg;base64,
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

      // Gửi yêu cầu với Prompt chuyên dụng để ép AI trả về JSON tọa độ
      const payload = {
        contents: [{
          parts: [
            { text: "Bạn là chuyên gia trắc địa. Hãy trích xuất tất cả các tọa độ VN2000 (X, Y) từ hình ảnh bảng tọa độ này. Trả về DUY NHẤT một mảng JSON (không bọc trong markdown ```json). Tọa độ X thường từ 800000 đến 3000000, Tọa độ Y thường từ 100000 đến 900000. Ví dụ: [{\"x\": 2363228.12, \"y\": 520031.45}, {\"x\": 2363228.12, \"y\": 520052.00}]" },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }]
      };

      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }

      // Đọc kết quả từ Gemini
      const aiText = data.candidates[0].content.parts[0].text;
      
      // Parse JSON
      let coordinates = [];
      try {
        const jsonStr = aiText.replace(/```json|```/g, '').trim();
        coordinates = JSON.parse(jsonStr);
      } catch (e) {
        throw new Error('AI parse lỗi: ' + aiText);
      }

      // Trả về cho Frontend
      return new Response(JSON.stringify({ success: true, data: coordinates }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};
