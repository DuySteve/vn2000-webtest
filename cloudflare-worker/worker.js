/**
 * Cloudflare Worker – VN2000 OCR via Google Cloud Vertex AI
 *
 * Env secrets cần cấu hình trên Cloudflare Dashboard:
 *   VERTEX_SERVICE_ACCOUNT_JSON  → Toàn bộ nội dung file JSON Service Account
 *
 * Project: vn2000-ocr  |  Project ID: vn2000-ocr  |  Number: 874713237560
 */

const GCP_PROJECT_ID = 'vn2000-ocr';
const GCP_LOCATION   = 'us-central1';       // Dùng US để tránh geo-block ở Việt Nam
const GEMINI_MODEL   = 'gemini-1.5-flash-002';  // Thử 1.5 flash vì 2.0 có thể chưa available trong project mới

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Chuyển PEM private key sang ArrayBuffer (cần cho Web Crypto) */
function pemToBinary(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Encode sang base64url (không padding) */
function base64url(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Ký JWT bằng Service Account → đổi lấy OAuth2 Access Token
 * Cloudflare Workers hỗ trợ Web Crypto API nên không cần thư viện ngoài
 */
async function getAccessToken(serviceAccountJson) {
  const sa  = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim  = {
    iss:   sa.client_email,
    sub:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  };

  const signingInput = `${base64url(header)}.${base64url(claim)}`;

  // Import private key từ Service Account JSON
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToBinary(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Ký
  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  // Tạo JWT hoàn chỉnh
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const jwt = `${signingInput}.${signature}`;

  // Đổi JWT lấy Access Token từ Google
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Lỗi lấy Access Token: ${err}`);
  }

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Không nhận được access_token từ Google');
  return tokenData.access_token;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

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

      // 2. Kiểm tra secret
      const serviceAccountJson = env.VERTEX_SERVICE_ACCOUNT_JSON;
      if (!serviceAccountJson) {
        throw new Error('VERTEX_SERVICE_ACCOUNT_JSON chưa được cấu hình trên Cloudflare');
      }

      // 3. Lấy OAuth2 Access Token
      const accessToken = await getAccessToken(serviceAccountJson);

      // 4. Chuẩn bị payload gửi Vertex AI
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

      const vertexUrl = `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/${GEMINI_MODEL}:generateContent`;

      const payload = {
        contents: [{
          role: 'user',
          parts: [
            {
              text: `Bạn là chuyên gia trắc địa Việt Nam. Hãy trích xuất TẤT CẢ các cặp tọa độ VN2000 (X, Y) từ bảng tọa độ trong hình ảnh này.

QUY TẮC:
- Tọa độ X (Northing) thường từ 800,000 đến 3,000,000
- Tọa độ Y (Easting) thường từ 100,000 đến 900,000
- Mỗi dòng bảng = 1 cặp tọa độ, đọc ĐỦ TẤT CẢ các dòng, không bỏ sót
- Số thập phân dùng dấu chấm (.)

CHỈ trả về JSON array, không thêm bất kỳ văn bản nào khác:
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
          temperature:    0,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        },
      };

      // 5. Gọi Vertex AI (qua US server, tránh geo-block Việt Nam)
      const aiRes = await fetch(vertexUrl, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      // Log HTTP status để debug
      if (!aiRes.ok) {
        const errBody = await aiRes.text();
        throw new Error(`Vertex AI HTTP ${aiRes.status}: ${errBody}`);
      }

      const data = await aiRes.json();

      if (data.error) {
        throw new Error(`Vertex AI error [${data.error.code}]: ${data.error.message}`);
      }

      // 6. Parse kết quả
      const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!aiText) throw new Error('AI không trả về kết quả. Kiểm tra lại ảnh chụp.');

      let coordinates = [];
      try {
        const jsonStr = aiText.replace(/```json|```/g, '').trim();
        coordinates   = JSON.parse(jsonStr);
        if (!Array.isArray(coordinates)) throw new Error('Không phải array');
      } catch (e) {
        throw new Error(`Lỗi parse JSON từ AI: ${aiText.substring(0, 200)}`);
      }

      if (coordinates.length === 0) {
        throw new Error('AI không tìm thấy tọa độ nào trong ảnh. Hãy chụp rõ nét vùng bảng tọa độ.');
      }

      // 7. Trả kết quả về frontend
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
