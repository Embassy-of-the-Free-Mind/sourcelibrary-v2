/**
 * Experiment: Compare Gemini vs Mistral for Image Bounding Box Extraction
 *
 * Tests both models on pages with detected illustrations to see which
 * better identifies and locates images within page scans.
 *
 * Run: npx ts-node scripts/experiment-image-extraction.ts [--limit=5]
 *
 * Environment variables:
 * - MONGODB_URI: MongoDB connection string
 * - GOOGLE_API_KEY: Gemini API key (already configured)
 * - MISTRAL_API_KEY: Mistral API key
 */

import { MongoClient } from 'mongodb';

// Types
interface BoundingBox {
  x: number;      // Left edge (0-1 normalized)
  y: number;      // Top edge (0-1 normalized)
  width: number;  // Width (0-1 normalized)
  height: number; // Height (0-1 normalized)
}

interface DetectedImage {
  description: string;
  type?: string;
  bbox?: BoundingBox;
  confidence?: number;
}

interface ExtractionResult {
  model: string;
  images: DetectedImage[];
  rawResponse: string;
  latencyMs: number;
  error?: string;
}

// Prompt for image extraction
const EXTRACTION_PROMPT = `Analyze this historical book page scan and identify all illustrations, diagrams, woodcuts, charts, or decorative elements.

For each image/illustration found, provide:
1. A brief description of what it depicts
2. The type (woodcut, diagram, chart, illustration, symbol, decorative, table)
3. The bounding box coordinates as normalized values (0-1 scale where 0,0 is top-left)

**IMPORTANT:** Return ONLY a JSON array, no other text. Format:
[
  {
    "description": "Alchemist working at a furnace with dragon symbol",
    "type": "woodcut",
    "bbox": { "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.4 },
    "confidence": 0.95
  }
]

If there are no illustrations on this page (just text), return an empty array: []

Be precise with bounding boxes - they should tightly enclose each illustration.`;

// Gemini extraction
async function extractWithGemini(imageUrl: string): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return { model: 'gemini', images: [], rawResponse: '', latencyMs: 0, error: 'GEMINI_API_KEY not set' };
  }

  const start = Date.now();

  try {
    // Fetch image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageResponse.headers.get('content-type')?.split(';')[0] || 'image/jpeg';

    // Call Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: EXTRACTION_PROMPT },
              { inline_data: { mime_type: mimeType, data: base64Image } }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const rawResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const latencyMs = Date.now() - start;

    // Parse JSON from response
    const images = parseJsonResponse(rawResponse);

    return { model: 'gemini-2.0-flash', images, rawResponse, latencyMs };
  } catch (error) {
    return {
      model: 'gemini-2.0-flash',
      images: [],
      rawResponse: '',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Mistral extraction (using Pixtral vision model)
async function extractWithMistral(imageUrl: string): Promise<ExtractionResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return { model: 'mistral', images: [], rawResponse: '', latencyMs: 0, error: 'MISTRAL_API_KEY not set' };
  }

  const start = Date.now();

  try {
    // Mistral's Pixtral can accept image URLs directly
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'pixtral-12b-2409',  // Mistral's vision model
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }],
        temperature: 0.1,
        max_tokens: 2048
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Mistral API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const rawResponse = data.choices?.[0]?.message?.content || '';
    const latencyMs = Date.now() - start;

    // Parse JSON from response
    const images = parseJsonResponse(rawResponse);

    return { model: 'pixtral-12b', images, rawResponse, latencyMs };
  } catch (error) {
    return {
      model: 'pixtral-12b',
      images: [],
      rawResponse: '',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Parse JSON array from model response
function parseJsonResponse(text: string): DetectedImage[] {
  try {
    // Try to find JSON array in the response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('No JSON array found in response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.map(item => ({
      description: item.description || '',
      type: item.type || 'unknown',
      bbox: item.bbox ? {
        x: parseFloat(item.bbox.x) || 0,
        y: parseFloat(item.bbox.y) || 0,
        width: parseFloat(item.bbox.width) || 0,
        height: parseFloat(item.bbox.height) || 0,
      } : undefined,
      confidence: item.confidence
    }));
  } catch (e) {
    console.warn('Failed to parse JSON:', e);
    return [];
  }
}

// Compare results
function compareResults(gemini: ExtractionResult, mistral: ExtractionResult): void {
  console.log('\n  Comparison:');
  console.log(`    Gemini found ${gemini.images.length} images in ${gemini.latencyMs}ms`);
  console.log(`    Mistral found ${mistral.images.length} images in ${mistral.latencyMs}ms`);

  if (gemini.error) console.log(`    Gemini error: ${gemini.error}`);
  if (mistral.error) console.log(`    Mistral error: ${mistral.error}`);

  // Compare descriptions
  if (gemini.images.length > 0 || mistral.images.length > 0) {
    console.log('\n  Gemini detections:');
    gemini.images.forEach((img, i) => {
      const bbox = img.bbox ? `[${img.bbox.x.toFixed(2)}, ${img.bbox.y.toFixed(2)}, ${img.bbox.width.toFixed(2)}, ${img.bbox.height.toFixed(2)}]` : 'no bbox';
      console.log(`    ${i + 1}. [${img.type}] ${img.description.slice(0, 50)}... ${bbox}`);
    });

    console.log('\n  Mistral detections:');
    mistral.images.forEach((img, i) => {
      const bbox = img.bbox ? `[${img.bbox.x.toFixed(2)}, ${img.bbox.y.toFixed(2)}, ${img.bbox.width.toFixed(2)}, ${img.bbox.height.toFixed(2)}]` : 'no bbox';
      console.log(`    ${i + 1}. [${img.type}] ${img.description.slice(0, 50)}... ${bbox}`);
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 5;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('IMAGE EXTRACTION EXPERIMENT: Gemini vs Mistral');
  console.log('='.repeat(80));

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();

    // Find pages with detected images (from OCR tags)
    console.log(`\nFinding ${limit} pages with illustrations...`);
    const pages = await db.collection('pages').aggregate([
      {
        $match: {
          $and: [
            {
              $or: [
                { 'detected_images.0': { $exists: true } },
                { 'ocr.data': { $regex: '\\[\\[image:', $options: 'i' } }
              ]
            },
            {
              $or: [
                { cropped_photo: { $exists: true, $ne: '' } },
                { photo_original: { $exists: true, $ne: '' } },
                { photo: { $exists: true, $ne: '' } }
              ]
            }
          ]
        }
      },
      { $sample: { size: limit } },
      {
        $lookup: {
          from: 'books',
          localField: 'book_id',
          foreignField: 'id',
          as: 'book'
        }
      },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } }
    ]).toArray();

    console.log(`Found ${pages.length} pages to test\n`);

    const results: Array<{
      pageId: string;
      bookTitle: string;
      pageNumber: number;
      imageUrl: string;
      existingDescription?: string;
      gemini: ExtractionResult;
      mistral: ExtractionResult;
    }> = [];

    for (const page of pages) {
      const imageUrl = page.cropped_photo || page.photo_original || page.photo;
      if (!imageUrl) {
        console.log(`Skipping page ${page.page_number} - no image URL`);
        continue;
      }

      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Page ${page.page_number} from "${page.book?.title || 'Unknown'}"`);
      console.log(`Image: ${imageUrl.slice(0, 80)}...`);

      // Get existing description from OCR if available
      const ocrText = page.ocr?.data || '';
      const existingMatch = ocrText.match(/\[\[image:\s*([^\]]+)\]\]/i);
      const existingDescription = existingMatch ? existingMatch[1] : undefined;
      if (existingDescription) {
        console.log(`OCR detected: "${existingDescription.slice(0, 60)}..."`);
      }

      // Run both models
      console.log('\n  Running Gemini...');
      const geminiResult = await extractWithGemini(imageUrl);

      console.log('  Running Mistral...');
      const mistralResult = await extractWithMistral(imageUrl);

      // Compare
      compareResults(geminiResult, mistralResult);

      results.push({
        pageId: page.id,
        bookTitle: page.book?.title || 'Unknown',
        pageNumber: page.page_number,
        imageUrl,
        existingDescription,
        gemini: geminiResult,
        mistral: mistralResult
      });
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));

    const geminiTotal = results.reduce((sum, r) => sum + r.gemini.images.length, 0);
    const mistralTotal = results.reduce((sum, r) => sum + r.mistral.images.length, 0);
    const geminiAvgLatency = results.reduce((sum, r) => sum + r.gemini.latencyMs, 0) / results.length;
    const mistralAvgLatency = results.reduce((sum, r) => sum + r.mistral.latencyMs, 0) / results.length;
    const geminiErrors = results.filter(r => r.gemini.error).length;
    const mistralErrors = results.filter(r => r.mistral.error).length;
    const geminiWithBbox = results.reduce((sum, r) => sum + r.gemini.images.filter(i => i.bbox).length, 0);
    const mistralWithBbox = results.reduce((sum, r) => sum + r.mistral.images.filter(i => i.bbox).length, 0);

    console.log(`
Pages tested: ${results.length}

Model          | Images Found | With BBox | Avg Latency | Errors
---------------|--------------|-----------|-------------|-------
Gemini 2.0     | ${geminiTotal.toString().padEnd(12)} | ${geminiWithBbox.toString().padEnd(9)} | ${geminiAvgLatency.toFixed(0).padEnd(11)}ms | ${geminiErrors}
Pixtral 12B    | ${mistralTotal.toString().padEnd(12)} | ${mistralWithBbox.toString().padEnd(9)} | ${mistralAvgLatency.toFixed(0).padEnd(11)}ms | ${mistralErrors}
`);

    // Save results to file
    const outputPath = `./experiment-results-${Date.now()}.json`;
    const fs = await import('fs');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\nFull results saved to: ${outputPath}`);

  } finally {
    await client.close();
  }
}

main().catch(console.error);
