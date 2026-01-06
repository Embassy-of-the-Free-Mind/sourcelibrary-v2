/**
 * Split Detection Visual Review
 *
 * Generates an HTML page showing images with split lines overlaid.
 * Open the generated HTML in a browser to review.
 *
 * Usage:
 *   npx tsx scripts/split-review.ts --random=10
 *   npx tsx scripts/split-review.ts --book-id=XXX --sample=5
 *   open split-review.html
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import * as fs from 'fs';

const DB_NAME = process.env.MONGODB_DB || 'bookstore';
const MODEL = 'gemini-2.5-pro'; // Pro for better spatial precision
const MARGIN_PERCENT = 2;

const EVAL_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    is_two_page_spread: { type: SchemaType.BOOLEAN },
    confidence: { type: SchemaType.STRING, enum: ['high', 'medium', 'low'] },
    gutter_shadow_left_edge: {
      type: SchemaType.NUMBER,
      description: 'Left edge of the dark gutter shadow, as % from image left (0-100)'
    },
    gutter_shadow_right_edge: {
      type: SchemaType.NUMBER,
      description: 'Right edge of the dark gutter shadow, as % from image left (0-100)'
    },
    left_text_ends_percent: {
      type: SchemaType.NUMBER,
      description: 'Where leftmost text character stops, before the gutter'
    },
    right_text_starts_percent: {
      type: SchemaType.NUMBER,
      description: 'Where rightmost text character begins, after the gutter'
    },
    split_position_percent: {
      type: SchemaType.NUMBER,
      description: 'Best position to cut - center of gutter shadow'
    },
    gutter_type: { type: SchemaType.STRING },
    concerns: { type: SchemaType.STRING }
  },
  required: ['is_two_page_spread', 'confidence', 'gutter_shadow_left_edge', 'gutter_shadow_right_edge', 'split_position_percent']
};

const EVAL_PROMPT = `Analyze this scanned book to find the GUTTER (the dark vertical shadow where pages meet at the binding).

YOUR TASK: Locate the gutter shadow precisely.

Look for:
1. A dark vertical band/shadow running top to bottom near the center
2. This shadow is where the book curves into the binding
3. The LEFT edge of this shadow is where the left page starts to curve away
4. The RIGHT edge is where the right page starts to curve away

MEASURE in percentages from the LEFT edge of the image:
- gutter_shadow_left_edge: where the dark shadow BEGINS (left side)
- gutter_shadow_right_edge: where the dark shadow ENDS (right side)
- split_position_percent: the CENTER of the shadow (best cut point)

Also measure text boundaries:
- left_text_ends_percent: rightmost ink/text on left page
- right_text_starts_percent: leftmost ink/text on right page

The cut should be in the CENTER of the gutter shadow, which is the safest zone.

IMPORTANT: Old book gutters are typically 5-15% wide. If you're seeing a very narrow gutter (< 3%), look again - the shadow is usually visible.

If SINGLE PAGE (no gutter): is_two_page_spread=false, all values=0.`;

async function getClient() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  return client;
}

function getDb(client: MongoClient) {
  return client.db(DB_NAME);
}

interface ReviewItem {
  pageId: string;
  bookTitle: string;
  pageNumber: number;
  imageUrl: string;
  imageDataUrl: string; // Base64 data URL for embedding
  isSpread: boolean;
  gutterLeft: number;   // Left edge of gutter shadow
  gutterRight: number;  // Right edge of gutter shadow
  leftTextEnds: number;  // Where left page text ends
  rightTextStarts: number; // Where right page text starts
  splitPercent: number;
  confidence: string;
  gutterType: string;
  concerns: string;
  error?: string;
}

async function analyzePage(genAI: GoogleGenerativeAI, page: any, bookTitle: string): Promise<ReviewItem> {
  const imageUrl = page.photo_original || page.photo;

  const result: ReviewItem = {
    pageId: page.id,
    bookTitle,
    pageNumber: page.page_number,
    imageUrl,
    imageDataUrl: '',
    isSpread: false,
    gutterLeft: 0,
    gutterRight: 0,
    leftTextEnds: 0,
    rightTextStarts: 0,
    splitPercent: 0,
    confidence: 'unknown',
    gutterType: 'unknown',
    concerns: ''
  };

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      result.error = `Failed to fetch: ${response.status}`;
      return result;
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    let mimeType = response.headers.get('content-type') || 'image/jpeg';
    if (mimeType.includes('octet-stream')) mimeType = 'image/jpeg';

    // Store as data URL for embedding in HTML
    result.imageDataUrl = `data:${mimeType};base64,${base64}`;

    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: EVAL_SCHEMA,
      }
    });

    const geminiResult = await model.generateContent([
      EVAL_PROMPT,
      { inlineData: { mimeType, data: base64 } }
    ]);

    const analysis = JSON.parse(geminiResult.response.text());

    result.isSpread = analysis.is_two_page_spread;
    result.gutterLeft = analysis.gutter_shadow_left_edge || 0;
    result.gutterRight = analysis.gutter_shadow_right_edge || 0;
    result.leftTextEnds = analysis.left_text_ends_percent || 0;
    result.rightTextStarts = analysis.right_text_starts_percent || 0;
    result.splitPercent = analysis.split_position_percent || 0;
    result.confidence = analysis.confidence;
    result.gutterType = analysis.gutter_type || 'unknown';
    result.concerns = analysis.concerns || '';

  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
  }

  return result;
}

function generateHTML(items: ReviewItem[]): string {
  const cards = items.map((item, i) => {
    const gutterWidth = item.gutterRight - item.gutterLeft;
    const statusClass = item.error ? 'error' : (item.isSpread ? 'spread' : 'single');
    const statusText = item.error ? 'ERROR' : (item.isSpread ? 'SPREAD' : 'SINGLE PAGE');

    return `
    <div class="card ${statusClass}">
      <div class="header">
        <span class="num">#${i + 1}</span>
        <span class="status">${statusText}</span>
        <span class="confidence">${item.confidence}</span>
      </div>
      <div class="title">${item.bookTitle}</div>
      <div class="meta">Page ${item.pageNumber} | ${item.gutterType}</div>
      ${item.concerns ? `<div class="concerns">⚠️ ${item.concerns}</div>` : ''}
      ${item.error ? `<div class="error-msg">${item.error}</div>` : ''}

      <div class="image-container">
        <img src="${item.imageDataUrl || item.imageUrl}" alt="Page ${item.pageNumber}" />
        ${item.isSpread ? `
        <div class="gutter-shadow" style="left: ${item.gutterLeft}%; width: ${gutterWidth}%"></div>
        <div class="text-boundary left-end" style="left: ${item.leftTextEnds}%"></div>
        <div class="text-boundary right-start" style="left: ${item.rightTextStarts}%"></div>
        <div class="split-line" style="left: ${item.splitPercent}%"></div>
        <div class="boundary-label gutter-label" style="left: ${item.gutterLeft}%">G:${item.gutterLeft.toFixed(0)}%</div>
        <div class="boundary-label gutter-label" style="left: ${item.gutterRight}%">${item.gutterRight.toFixed(0)}%</div>
        <div class="split-label" style="left: ${item.splitPercent}%">CUT:${item.splitPercent.toFixed(1)}%</div>
        ` : ''}
      </div>

      <div class="info">
        ${item.isSpread ? `
        <div>Gutter: <strong>${item.gutterLeft.toFixed(0)}% - ${item.gutterRight.toFixed(0)}%</strong> (${gutterWidth.toFixed(0)}% wide)</div>
        <div>Text: L ends ${item.leftTextEnds.toFixed(0)}% | R starts ${item.rightTextStarts.toFixed(0)}%</div>
        <div>Cut at: <strong>${item.splitPercent.toFixed(1)}%</strong></div>
        ` : '<div>No split needed</div>'}
      </div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <title>Split Detection Review</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      padding: 20px;
      margin: 0;
    }
    h1 {
      text-align: center;
      color: #fff;
      margin-bottom: 10px;
    }
    .summary {
      text-align: center;
      color: #888;
      margin-bottom: 30px;
    }
    .legend {
      display: flex;
      justify-content: center;
      gap: 30px;
      margin-bottom: 30px;
      flex-wrap: wrap;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .legend-box {
      width: 20px;
      height: 20px;
      border-radius: 3px;
    }
    .legend-box.split { background: #ff3366; }
    .legend-box.gutter { background: orange; }
    .legend-box.left-text { background: #4CAF50; }
    .legend-box.right-text { background: #2196F3; }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(600px, 1fr));
      gap: 20px;
      max-width: 1400px;
      margin: 0 auto;
    }
    .card {
      background: #16213e;
      border-radius: 12px;
      overflow: hidden;
      border: 2px solid #0f3460;
    }
    .card.spread { border-color: #ff3366; }
    .card.single { border-color: #4CAF50; }
    .card.error { border-color: #f44336; }

    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      background: #0f3460;
    }
    .num { font-weight: bold; color: #888; }
    .status {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: bold;
    }
    .spread .status { background: #ff3366; color: white; }
    .single .status { background: #4CAF50; color: white; }
    .error .status { background: #f44336; color: white; }
    .confidence {
      margin-left: auto;
      color: #888;
      font-size: 12px;
    }

    .title {
      padding: 12px 16px 4px;
      font-weight: bold;
      font-size: 14px;
    }
    .meta {
      padding: 0 16px 12px;
      color: #888;
      font-size: 12px;
    }
    .concerns {
      padding: 8px 16px;
      background: rgba(255, 193, 7, 0.1);
      color: #ffc107;
      font-size: 13px;
    }
    .error-msg {
      padding: 8px 16px;
      background: rgba(244, 67, 54, 0.1);
      color: #f44336;
      font-size: 13px;
    }

    .image-container {
      position: relative;
      background: #000;
      min-height: 300px;
    }
    .image-container img {
      width: 100%;
      height: auto;
      display: block;
    }
    .split-line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 4px;
      background: #ff3366;
      transform: translateX(-50%);
      z-index: 10;
    }
    .text-boundary {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 3px;
      transform: translateX(-50%);
      z-index: 8;
    }
    .text-boundary.left-end {
      background: #4CAF50;
      border-right: 2px dashed #81C784;
    }
    .text-boundary.right-start {
      background: #2196F3;
      border-left: 2px dashed #64B5F6;
    }
    .gutter-shadow {
      position: absolute;
      top: 0;
      bottom: 0;
      background: rgba(255, 165, 0, 0.25);
      border-left: 2px solid orange;
      border-right: 2px solid orange;
      z-index: 3;
    }
    .boundary-label.gutter-label {
      background: orange;
      color: black;
    }
    .split-label {
      position: absolute;
      top: 10px;
      transform: translateX(-50%);
      background: #ff3366;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      z-index: 15;
    }
    .boundary-label {
      position: absolute;
      bottom: 10px;
      transform: translateX(-50%);
      padding: 3px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: bold;
      z-index: 15;
    }
    .boundary-label.left-label {
      background: #4CAF50;
      color: white;
    }
    .boundary-label.right-label {
      background: #2196F3;
      color: white;
    }

    .info {
      padding: 12px 16px;
      font-size: 13px;
      color: #aaa;
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    .info strong { color: #fff; }
  </style>
</head>
<body>
  <h1>Split Detection Review</h1>
  <div class="summary">${items.length} pages analyzed | ${items.filter(i => i.isSpread).length} spreads | ${items.filter(i => !i.isSpread && !i.error).length} single pages</div>

  <div class="legend">
    <div class="legend-item"><div class="legend-box gutter"></div> Gutter shadow zone</div>
    <div class="legend-item"><div class="legend-box left-text"></div> Left text ends</div>
    <div class="legend-item"><div class="legend-box right-text"></div> Right text starts</div>
    <div class="legend-item"><div class="legend-box split"></div> Cut line</div>
  </div>

  <div class="cards">
    ${cards}
  </div>
</body>
</html>`;
}

async function main() {
  const args = process.argv.slice(2);

  const randomArg = args.find(a => a.startsWith('--random='));
  const bookIdArg = args.find(a => a.startsWith('--book-id='));
  const sampleArg = args.find(a => a.startsWith('--sample='));

  const randomCount = randomArg ? parseInt(randomArg.split('=')[1]) : 10;
  const bookId = bookIdArg?.split('=')[1];
  const sampleSize = sampleArg ? parseInt(sampleArg.split('=')[1]) : undefined;

  const client = await getClient();
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const db = getDb(client);

  try {
    let pages: any[] = [];

    if (bookId) {
      pages = await db.collection('pages')
        .find({ book_id: bookId })
        .sort({ page_number: 1 })
        .toArray();

      if (sampleSize && sampleSize < pages.length) {
        const step = Math.floor(pages.length / sampleSize);
        pages = pages.filter((_, i) => i % step === 0).slice(0, sampleSize);
      }
      console.log(`Analyzing ${pages.length} pages from book...`);
    } else {
      pages = await db.collection('pages').aggregate([
        {
          $match: {
            crop: { $exists: false },
            split_from: { $exists: false },
            book_id: { $exists: true, $ne: null }
          }
        },
        { $sample: { size: randomCount } }
      ]).toArray();
      console.log(`Analyzing ${pages.length} random pages...`);
    }

    const items: ReviewItem[] = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const book = await db.collection('books').findOne({
        $or: [{ id: page.book_id }, { _id: page.book_id }]
      });
      const bookTitle = book?.title || 'Unknown';

      process.stdout.write(`[${i + 1}/${pages.length}] Page ${page.page_number}... `);

      const result = await analyzePage(genAI, page, bookTitle);
      items.push(result);

      const status = result.error ? 'ERROR' : (result.isSpread ? `SPREAD ${result.splitPercent.toFixed(0)}%` : 'SINGLE');
      console.log(status);

      await new Promise(r => setTimeout(r, 300));
    }

    // Generate HTML
    const html = generateHTML(items);
    const outputPath = 'split-review.html';
    fs.writeFileSync(outputPath, html);

    console.log(`\n✓ Generated ${outputPath}`);
    console.log(`  Open in browser: file://${process.cwd()}/${outputPath}`);

  } finally {
    await client.close();
  }
}

main().catch(console.error);
