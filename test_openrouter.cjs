const https = require('https');
const apiKey = process.argv[2];

if (!apiKey) {
  console.error("Cách dùng: node test_openrouter.js <OPENROUTER_API_KEY>");
  process.exit(1);
}

const dummyBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const imageUrl = `data:image/png;base64,${dummyBase64}`;

const payload = JSON.stringify({
  model: 'nvidia/nemotron-nano-12b-v2-vl:free',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }
  ]
});

const options = {
  hostname: 'openrouter.ai',
  path: '/api/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://vn2000-webtest.vercel.app',
    'X-Title': 'VN2000 So Do OCR',
    'Content-Length': Buffer.byteLength(payload)
  }
};

console.log('Đang gửi request tới OpenRouter...');
const req = https.request(options, (res) => {
  let rawData = '';
  res.on('data', (chunk) => { rawData += chunk; });
  res.on('end', () => {
    console.log(`STATUS: ${res.statusCode}`);
    try {
      const parsed = JSON.parse(rawData);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log(rawData);
    }
  });
});
req.write(payload);
req.end();