/**
 * Quick test of Gemini and Mistral vision APIs
 * Tests on a sample historical page image
 */

const EXTRACTION_PROMPT = `Analyze this historical book page scan and identify all illustrations, diagrams, woodcuts, or decorative elements.

Return ONLY a JSON array:
[
  {
    "description": "brief description",
    "type": "woodcut|diagram|chart|illustration|symbol",
    "bbox": { "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.4 }
  }
]

If no illustrations, return: []`;

// Sample image - test with a reliable public image
const TEST_IMAGE = 'https://picsum.photos/800/1000';

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.log('❌ Gemini: GEMINI_API_KEY not set');
    return;
  }

  console.log('🔄 Testing Gemini...');
  const start = Date.now();

  try {
    // Fetch image
    const imageResponse = await fetch(TEST_IMAGE);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: EXTRACTION_PROMPT },
              { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
        })
      }
    );

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const latency = Date.now() - start;

    console.log(`✅ Gemini (${latency}ms):`);
    if (text) {
      console.log(text.slice(0, 500));
    } else {
      console.log('(empty response)');
      console.log('Raw:', JSON.stringify(data).slice(0, 300));
    }
  } catch (e) {
    console.log('❌ Gemini error:', e);
  }
}

async function testMistral() {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.log('❌ Mistral: MISTRAL_API_KEY not set');
    return;
  }

  console.log('\n🔄 Testing Mistral (Pixtral)...');
  const start = Date.now();

  try {
    // Fetch and encode image as base64 (Mistral can't fetch some URLs directly)
    const imageResponse = await fetch(TEST_IMAGE);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'pixtral-12b-2409',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }],
        temperature: 0.1,
        max_tokens: 1024
      })
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || JSON.stringify(data);
    const latency = Date.now() - start;

    console.log(`✅ Mistral (${latency}ms):`);
    console.log(text.slice(0, 500));
  } catch (e) {
    console.log('❌ Mistral error:', e);
  }
}

async function main() {
  console.log('Testing Vision APIs on sample historical page\n');
  console.log(`Image: ${TEST_IMAGE.slice(0, 80)}...\n`);

  await testGemini();
  await testMistral();
}

main();
