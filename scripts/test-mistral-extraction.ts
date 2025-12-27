/**
 * Test Mistral (Pixtral) image extraction on historical book pages
 *
 * Run: npx ts-node --esm scripts/test-mistral-extraction.ts
 */

const EXTRACTION_PROMPT = `Analyze this historical book page scan and identify all illustrations, diagrams, woodcuts, charts, or decorative elements.

For each image/illustration found, provide:
1. A brief description of what it depicts
2. The type (woodcut, diagram, chart, illustration, symbol, decorative, table)
3. The bounding box coordinates as normalized values (0-1 scale where 0,0 is top-left)

Return ONLY a JSON array:
[
  {
    "description": "Alchemist working at a furnace with dragon symbol",
    "type": "woodcut",
    "bbox": { "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.4 },
    "confidence": 0.95
  }
]

If there are no illustrations (just text), return: []`;

// Test images - mix of historical book pages with illustrations
const TEST_IMAGES = [
  {
    name: 'Random image 1 (control)',
    url: 'https://picsum.photos/seed/alchemy1/800/1000'
  },
  {
    name: 'Random image 2 (control)',
    url: 'https://picsum.photos/seed/alchemy2/800/1000'
  },
  {
    name: 'Random image 3 (control)',
    url: 'https://picsum.photos/seed/book1/800/1000'
  }
];

interface DetectedImage {
  description: string;
  type?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
}

async function extractWithMistral(imageUrl: string, imageName: string): Promise<void> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.log('❌ MISTRAL_API_KEY not set');
    return;
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Testing: ${imageName}`);
  console.log(`URL: ${imageUrl.slice(0, 60)}...`);

  const start = Date.now();

  try {
    // Fetch and encode image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.log(`❌ Failed to fetch image: ${imageResponse.status}`);
      return;
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    console.log(`   Image size: ${(imageBuffer.byteLength / 1024).toFixed(1)} KB`);

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
        max_tokens: 2048
      })
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const latency = Date.now() - start;

    console.log(`   Latency: ${latency}ms`);

    // Parse JSON from response
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const images: DetectedImage[] = JSON.parse(jsonMatch[0]);
        console.log(`   Found: ${images.length} illustration(s)`);

        images.forEach((img, i) => {
          const bbox = img.bbox
            ? `[x:${img.bbox.x.toFixed(2)}, y:${img.bbox.y.toFixed(2)}, w:${img.bbox.width.toFixed(2)}, h:${img.bbox.height.toFixed(2)}]`
            : 'no bbox';
          console.log(`   ${i + 1}. [${img.type || 'unknown'}] ${img.description.slice(0, 50)}...`);
          console.log(`      bbox: ${bbox}`);
        });
      } else {
        console.log('   No JSON array in response');
        console.log('   Raw:', text.slice(0, 200));
      }
    } catch (e) {
      console.log('   Parse error:', e);
      console.log('   Raw:', text.slice(0, 300));
    }

  } catch (error) {
    console.log(`❌ Error: ${error}`);
  }
}

async function main() {
  console.log('═'.repeat(60));
  console.log('MISTRAL (PIXTRAL) IMAGE EXTRACTION TEST');
  console.log('═'.repeat(60));

  for (const image of TEST_IMAGES) {
    await extractWithMistral(image.url, image.name);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('DONE');
  console.log('═'.repeat(60));
}

main().catch(console.error);
