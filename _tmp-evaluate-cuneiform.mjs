#!/usr/bin/env node
// Cuneiform Tablet OCR — Evaluation Script
// Runs OCR + translation on imported cuneiform tablets, compares vs CDLI ground truth
//
// Usage:
//   secret-lover run -- node _tmp-evaluate-cuneiform.mjs --run-ocr       # Run OCR on all tablets
//   secret-lover run -- node _tmp-evaluate-cuneiform.mjs --run-translate  # Run translation on OCR'd pages
//   secret-lover run -- node _tmp-evaluate-cuneiform.mjs --evaluate       # Compare vs ground truth
//   secret-lover run -- node _tmp-evaluate-cuneiform.mjs --status         # Show current status
//   secret-lover run -- node _tmp-evaluate-cuneiform.mjs --all            # OCR + translate + evaluate

import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

const args = process.argv.slice(2);
const RUN_OCR = args.includes('--run-ocr') || args.includes('--all');
const RUN_TRANSLATE = args.includes('--run-translate') || args.includes('--all');
const EVALUATE = args.includes('--evaluate') || args.includes('--all');
const STATUS = args.includes('--status');
const MODEL = 'gemini-2.5-flash';

if (!RUN_OCR && !RUN_TRANSLATE && !EVALUATE && !STATUS) {
  console.log('Usage: node _tmp-evaluate-cuneiform.mjs [--run-ocr] [--run-translate] [--evaluate] [--status] [--all]');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Gemini client
// ---------------------------------------------------------------------------
function getGemini() {
  const key = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('No GEMINI_API_KEY found');
  return new GoogleGenerativeAI(key);
}

// ---------------------------------------------------------------------------
// Run OCR on one page using cuneiform prompt
// ---------------------------------------------------------------------------
async function runOcrOnPage(db, genAI, page, ocrPrompt) {
  const imageUrl = page.photo || page.photo_original;
  if (!imageUrl) {
    console.log(`    No photo for page ${page.page_number}`);
    return null;
  }

  console.log(`    OCR page ${page.page_number}: ${page.page_label || 'face'}...`);

  // Download image
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) {
    console.log(`    Failed to fetch image: ${imgResp.status}`);
    return null;
  }
  const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
  const mimeType = imgResp.headers.get('content-type') || 'image/jpeg';

  // Call Gemini
  const model = genAI.getGenerativeModel({ model: MODEL });
  const startMs = Date.now();

  const result = await model.generateContent([
    { inlineData: { mimeType, data: imgBuffer.toString('base64') } },
    { text: ocrPrompt },
  ]);

  const durationMs = Date.now() - startMs;
  const response = result.response;
  const text = response.text();
  const usage = response.usageMetadata;

  console.log(`    Done (${durationMs}ms, ${usage?.totalTokenCount || '?'} tokens)`);

  // Save to page
  await db.collection('pages').updateOne(
    { id: page.id },
    {
      $set: {
        'ocr.data': text,
        'ocr.model': MODEL,
        'ocr.language': page.ocr?.language || 'Unknown',
        'ocr.source': 'ai',
        'ocr.prompt_name': 'Cuneiform OCR',
        'ocr.prompt_version': 'v1-poc',
        'ocr.updated_at': new Date(),
        updated_at: new Date(),
      },
    }
  );

  // Log to gemini_usage
  await db.collection('gemini_usage').insertOne({
    type: 'ocr',
    mode: 'realtime',
    model: MODEL,
    book_id: page.book_id,
    page_ids: [page.id],
    input_tokens: usage?.promptTokenCount || 0,
    output_tokens: usage?.candidatesTokenCount || 0,
    total_tokens: usage?.totalTokenCount || 0,
    status: 'success',
    duration_ms: durationMs,
    endpoint: 'cuneiform-poc',
    prompt_name: 'Cuneiform OCR',
    timestamp: new Date(),
  });

  return text;
}

// ---------------------------------------------------------------------------
// Run translation on one page using cuneiform prompt
// ---------------------------------------------------------------------------
async function runTranslateOnPage(db, genAI, page, translationPrompt) {
  const ocrText = page.ocr?.data;
  if (!ocrText) {
    console.log(`    No OCR data for page ${page.page_number}`);
    return null;
  }

  console.log(`    Translate page ${page.page_number}...`);

  const model = genAI.getGenerativeModel({ model: MODEL });
  const startMs = Date.now();

  const prompt = translationPrompt + '\n\n--- ATF Input ---\n' + ocrText;
  const result = await model.generateContent(prompt);

  const durationMs = Date.now() - startMs;
  const response = result.response;
  const text = response.text();
  const usage = response.usageMetadata;

  console.log(`    Done (${durationMs}ms, ${usage?.totalTokenCount || '?'} tokens)`);

  // Save to page
  await db.collection('pages').updateOne(
    { id: page.id },
    {
      $set: {
        'translation.data': text,
        'translation.model': MODEL,
        'translation.language': 'English',
        'translation.source': 'ai',
        'translation.updated_at': new Date(),
        updated_at: new Date(),
      },
    }
  );

  // Log to gemini_usage
  await db.collection('gemini_usage').insertOne({
    type: 'translation',
    mode: 'realtime',
    model: MODEL,
    book_id: page.book_id,
    page_ids: [page.id],
    input_tokens: usage?.promptTokenCount || 0,
    output_tokens: usage?.candidatesTokenCount || 0,
    total_tokens: usage?.totalTokenCount || 0,
    status: 'success',
    duration_ms: durationMs,
    endpoint: 'cuneiform-poc',
    prompt_name: 'Cuneiform Translation',
    timestamp: new Date(),
  });

  return text;
}

// ---------------------------------------------------------------------------
// Extract ATF lines from AI output (strip metadata tags)
// ---------------------------------------------------------------------------
function extractAtfLines(text) {
  if (!text) return [];

  // Try to extract from <transliteration> block first
  const translitMatch = text.match(/<transliteration>([\s\S]*?)<\/transliteration>/);
  const atfBlock = translitMatch ? translitMatch[1] : text;

  return atfBlock
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    // Filter out XML tags and metadata lines
    .filter((l) => !l.startsWith('<') || l.startsWith('<column'))
    // Keep lines that look like ATF (numbered lines, surface markers, column markers)
    .filter((l) => /^\d+[\.\)]/.test(l) || /^@/.test(l) || /^column /i.test(l) || /^\$/.test(l));
}

// ---------------------------------------------------------------------------
// Simple line-level comparison
// ---------------------------------------------------------------------------
function compareAtf(aiAtf, groundTruth) {
  const aiLines = extractAtfLines(aiAtf);
  const gtLines = extractAtfLines(groundTruth);

  if (gtLines.length === 0) {
    return { error: 'No ground truth ATF available for comparison' };
  }

  // Normalize for comparison (lowercase, collapse whitespace, remove trailing periods)
  const normalize = (s) =>
    s.toLowerCase().replace(/\s+/g, ' ').replace(/\.+$/, '').trim();

  let exactMatches = 0;
  let partialMatches = 0;
  const comparisons = [];

  // Compare line by line (best effort — ATF formats may differ)
  const maxLines = Math.max(aiLines.length, gtLines.length);
  for (let i = 0; i < maxLines; i++) {
    const ai = aiLines[i] || '';
    const gt = gtLines[i] || '';
    const aiNorm = normalize(ai);
    const gtNorm = normalize(gt);

    const exact = aiNorm === gtNorm;
    // Partial match: >50% of gt words appear in ai
    const gtWords = gtNorm.split(' ').filter((w) => w.length > 0);
    const aiWords = new Set(aiNorm.split(' '));
    const overlap = gtWords.filter((w) => aiWords.has(w)).length;
    const partial = gtWords.length > 0 && overlap / gtWords.length > 0.5;

    if (exact) exactMatches++;
    else if (partial) partialMatches++;

    comparisons.push({
      line: i + 1,
      ai: ai || '(missing)',
      gt: gt || '(missing)',
      exact,
      partial,
      overlap: gtWords.length > 0 ? (overlap / gtWords.length).toFixed(2) : 'N/A',
    });
  }

  return {
    ai_lines: aiLines.length,
    gt_lines: gtLines.length,
    exact_matches: exactMatches,
    partial_matches: partialMatches,
    total_compared: maxLines,
    exact_pct: maxLines > 0 ? ((exactMatches / maxLines) * 100).toFixed(1) : 0,
    partial_pct: maxLines > 0 ? (((exactMatches + partialMatches) / maxLines) * 100).toFixed(1) : 0,
    comparisons,
  };
}

// ---------------------------------------------------------------------------
// Extract metadata tags from OCR output
// ---------------------------------------------------------------------------
function extractTag(text, tag) {
  const match = text?.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 's'));
  return match ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  try {
    // Find cuneiform books
    const books = await db
      .collection('books')
      .find({ 'metadata.script_type': 'cuneiform' })
      .sort({ 'metadata.difficulty': 1 })
      .toArray();

    if (books.length === 0) {
      console.log('No cuneiform tablets found. Run _tmp-import-cuneiform.mjs first.');
      return;
    }

    console.log(`Found ${books.length} cuneiform tablets\n`);

    // -----------------------------------------------------------------------
    // Status
    // -----------------------------------------------------------------------
    if (STATUS) {
      console.log('=== Status ===\n');
      for (const book of books) {
        const pagesList = await db
          .collection('pages')
          .find({ book_id: book.id })
          .sort({ page_number: 1 })
          .toArray();

        const ocrDone = pagesList.filter((p) => p.ocr?.data).length;
        const transDone = pagesList.filter((p) => p.translation?.data).length;
        const hasAtf = !!book.metadata?.atf_ground_truth;

        console.log(`${book.metadata.cdli_id}: ${book.title}`);
        console.log(`  Pages: ${pagesList.length} | OCR: ${ocrDone}/${pagesList.length} | Trans: ${transDone}/${pagesList.length} | ATF ground truth: ${hasAtf ? 'yes' : 'no'}`);
        console.log(`  Difficulty: ${book.metadata.difficulty} | Period: ${book.metadata.period}`);
        console.log();
      }
      return;
    }

    // -----------------------------------------------------------------------
    // Run OCR
    // -----------------------------------------------------------------------
    if (RUN_OCR) {
      console.log('=== Running Cuneiform OCR ===\n');

      // Get prompt from DB
      const ocrPrompt = await db.collection('prompts').findOne({ name: 'Cuneiform OCR' });
      if (!ocrPrompt) {
        console.log('ERROR: Cuneiform OCR prompt not found. Run import script first.');
        return;
      }

      const genAI = getGemini();

      for (const book of books) {
        console.log(`  ${book.metadata.cdli_id}: ${book.title}`);
        const pagesList = await db
          .collection('pages')
          .find({ book_id: book.id })
          .sort({ page_number: 1 })
          .toArray();

        for (const page of pagesList) {
          if (page.ocr?.data) {
            console.log(`    Page ${page.page_number}: already has OCR, skipping`);
            continue;
          }
          try {
            await runOcrOnPage(db, genAI, page, ocrPrompt.content);
          } catch (e) {
            console.log(`    ERROR on page ${page.page_number}: ${e.message}`);
          }
          // Small delay between calls
          await new Promise((r) => setTimeout(r, 1000));
        }
        console.log();
      }
    }

    // -----------------------------------------------------------------------
    // Run Translation
    // -----------------------------------------------------------------------
    if (RUN_TRANSLATE) {
      console.log('=== Running Cuneiform Translation ===\n');

      const transPrompt = await db.collection('prompts').findOne({ name: 'Cuneiform Translation' });
      if (!transPrompt) {
        console.log('ERROR: Cuneiform Translation prompt not found. Run import script first.');
        return;
      }

      const genAI = getGemini();

      for (const book of books) {
        console.log(`  ${book.metadata.cdli_id}: ${book.title}`);
        const pagesList = await db
          .collection('pages')
          .find({ book_id: book.id })
          .sort({ page_number: 1 })
          .toArray();

        for (const page of pagesList) {
          if (!page.ocr?.data) {
            console.log(`    Page ${page.page_number}: no OCR yet, skipping`);
            continue;
          }
          if (page.translation?.data) {
            console.log(`    Page ${page.page_number}: already translated, skipping`);
            continue;
          }
          try {
            await runTranslateOnPage(db, genAI, page, transPrompt.content);
          } catch (e) {
            console.log(`    ERROR on page ${page.page_number}: ${e.message}`);
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        console.log();
      }
    }

    // -----------------------------------------------------------------------
    // Evaluate vs Ground Truth
    // -----------------------------------------------------------------------
    if (EVALUATE) {
      console.log('=== Evaluating vs CDLI Ground Truth ===\n');

      const report = [];
      report.push('# Cuneiform OCR Evaluation Report');
      report.push(`\nGenerated: ${new Date().toISOString()}`);
      report.push(`Model: ${MODEL}`);
      report.push(`Tablets evaluated: ${books.length}\n`);

      const summaryRows = [];

      for (const book of books) {
        const cdliId = book.metadata.cdli_id;
        const groundTruth = book.metadata?.atf_ground_truth;

        report.push(`---`);
        report.push(`\n## ${cdliId}: ${book.title}`);
        report.push(`- **Period:** ${book.metadata.period}`);
        report.push(`- **Language:** ${book.language}`);
        report.push(`- **Script:** ${book.metadata.cuneiform_script}`);
        report.push(`- **Difficulty:** ${book.metadata.difficulty}`);
        report.push(`- **CDLI:** https://cdli.earth/artifacts/${book.metadata.cdli_number}`);
        report.push(`- **Source Library:** https://sourcelibrary.org/book/${book.slug}`);

        const pagesList = await db
          .collection('pages')
          .find({ book_id: book.id })
          .sort({ page_number: 1 })
          .toArray();

        for (const page of pagesList) {
          const ocrText = page.ocr?.data;
          const transText = page.translation?.data;

          report.push(`\n### Page ${page.page_number}: ${page.page_label || 'face'}`);

          if (!ocrText) {
            report.push('*No OCR data yet*');
            continue;
          }

          // Extract AI metadata
          const aiScript = extractTag(ocrText, 'script');
          const aiLanguage = extractTag(ocrText, 'language');
          const aiPeriod = extractTag(ocrText, 'period');
          const aiCondition = extractTag(ocrText, 'condition');
          const aiGenre = extractTag(ocrText, 'genre');
          const aiConfidence = extractTag(ocrText, 'confidence');
          const aiNotes = extractTag(ocrText, 'notes');

          report.push(`\n**AI Metadata:**`);
          if (aiScript) report.push(`- Script: ${aiScript} ${aiScript?.toLowerCase().includes(book.metadata.cuneiform_script.toLowerCase()) ? '(correct)' : `(expected: ${book.metadata.cuneiform_script})`}`);
          if (aiLanguage) report.push(`- Language: ${aiLanguage}`);
          if (aiPeriod) report.push(`- Period: ${aiPeriod}`);
          if (aiGenre) report.push(`- Genre: ${aiGenre}`);
          if (aiCondition) report.push(`- Condition: ${aiCondition}`);
          if (aiConfidence) report.push(`- Confidence: ${aiConfidence}`);

          // ATF comparison
          if (groundTruth) {
            const comparison = compareAtf(ocrText, groundTruth);
            if (comparison.error) {
              report.push(`\n**ATF Comparison:** ${comparison.error}`);
            } else {
              report.push(`\n**ATF Comparison:**`);
              report.push(`- AI lines: ${comparison.ai_lines}`);
              report.push(`- Ground truth lines: ${comparison.gt_lines}`);
              report.push(`- Exact matches: ${comparison.exact_matches} (${comparison.exact_pct}%)`);
              report.push(`- Partial matches: ${comparison.partial_matches}`);
              report.push(`- Combined accuracy: ${comparison.partial_pct}%`);

              summaryRows.push({
                cdli_id: cdliId,
                title: book.title.substring(0, 40),
                difficulty: book.metadata.difficulty,
                ai_lines: comparison.ai_lines,
                gt_lines: comparison.gt_lines,
                exact_pct: comparison.exact_pct,
                partial_pct: comparison.partial_pct,
                confidence: aiConfidence || 'N/A',
              });

              // Show first 10 mismatches
              const mismatches = comparison.comparisons
                .filter((c) => !c.exact)
                .slice(0, 10);
              if (mismatches.length > 0) {
                report.push(`\n**Sample mismatches (first ${mismatches.length}):**`);
                for (const m of mismatches) {
                  report.push(`- Line ${m.line}:`);
                  report.push(`  - AI: \`${m.ai}\``);
                  report.push(`  - GT: \`${m.gt}\``);
                  report.push(`  - Overlap: ${m.overlap}`);
                }
              }
            }
          } else {
            report.push(`\n**ATF Comparison:** No ground truth available. Manual review needed.`);
          }

          // AI notes
          if (aiNotes) {
            report.push(`\n**AI Notes:**`);
            report.push(aiNotes);
          }

          // Translation preview
          if (transText) {
            const preview = transText.substring(0, 500);
            report.push(`\n**Translation preview:**`);
            report.push('```');
            report.push(preview + (transText.length > 500 ? '...' : ''));
            report.push('```');
          }
        }
        report.push('');
      }

      // Summary table
      if (summaryRows.length > 0) {
        report.push('\n---\n');
        report.push('## Summary');
        report.push('');
        report.push('| CDLI ID | Title | Difficulty | AI Lines | GT Lines | Exact % | Combined % | Confidence |');
        report.push('|---------|-------|-----------|----------|----------|---------|-----------|------------|');
        for (const r of summaryRows) {
          report.push(`| ${r.cdli_id} | ${r.title} | ${r.difficulty} | ${r.ai_lines} | ${r.gt_lines} | ${r.exact_pct}% | ${r.partial_pct}% | ${r.confidence} |`);
        }
      }

      // Write report
      const reportText = report.join('\n');
      const reportPath = 'scripts/output/cuneiform-evaluation-report.md';
      writeFileSync(reportPath, reportText);
      console.log(`Report written to ${reportPath}`);
      console.log(`\n${reportText.substring(0, 2000)}...`);
    }
  } finally {
    await client.close();
  }
}

main().catch(console.error);
