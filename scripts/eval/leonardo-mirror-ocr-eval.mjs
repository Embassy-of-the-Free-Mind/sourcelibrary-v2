#!/usr/bin/env node
/**
 * Leonardo Mirror-Script OCR Evaluation
 * GitHub Issue #990
 *
 * Tests whether Gemini is truly reading Leonardo's mirror writing
 * or reconstructing from training data.
 *
 * Tests:
 *   1. cross-model  — Same pages through Gemini Flash, Flash Lite, and Claude
 *   2. resolution   — Same page at max, 1024px, 512px resolution
 *   3. hallucination — Synthetic control: blank/diagram pages
 *   4. translation   — Spot-check translations against OCR
 *   5. report        — Generate summary report from saved results
 *
 * Usage:
 *   node scripts/eval/leonardo-mirror-ocr-eval.mjs --test cross-model
 *   node scripts/eval/leonardo-mirror-ocr-eval.mjs --test resolution
 *   node scripts/eval/leonardo-mirror-ocr-eval.mjs --test hallucination
 *   node scripts/eval/leonardo-mirror-ocr-eval.mjs --test translation
 *   node scripts/eval/leonardo-mirror-ocr-eval.mjs --test all
 *   node scripts/eval/leonardo-mirror-ocr-eval.mjs --test report
 */

import { MongoClient } from 'mongodb';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'leonardo-eval-results');

// Book config
const BOOK_ID = '6991ead72f801130a473e94e';
const IA_ID = 'etudessurlacheve00leon';
const IIIF_BASE = `https://iiif.archive.org/image/iiif/3/${IA_ID}%2F${IA_ID}_jp2.zip%2F${IA_ID}_jp2%2F${IA_ID}`;

// Pages to evaluate (odd = content pages with mirror script)
const EVAL_PAGES = {
  content: [49, 53, 17, 21, 29],       // Dense mirror-script pages
  blank: [30, 50],                       // Known blank pages
  illustration: [37, 45],               // Illustration-heavy, less text
};

// Models
const GEMINI_FLASH = 'gemini-3-flash-preview';
const GEMINI_LITE = 'gemini-3.1-flash-lite-preview';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// OCR prompt (simplified for evaluation — same core as v10)
const OCR_PROMPT = `Transcribe this historical manuscript page to plain text.

This is a page from a Leonardo da Vinci manuscript. The text may be written in mirror-script (right to left). Transcribe it as normal left-to-right Italian.

Rules:
1. Preserve original spelling, capitalization, punctuation
2. Mark illegible text with <unclear>...</unclear>
3. Describe diagrams briefly in [brackets]
4. If the page is blank or has no text, say "BLANK PAGE" and describe any images present
5. Do NOT add interpretive notes, translations, or scholarly commentary
6. Do NOT reconstruct text you cannot actually read — only transcribe what is visible`;

// -------------------------------------------------------------------
// Utilities
// -------------------------------------------------------------------

function iiifUrl(pageNum, size = 'max') {
  // IA IIIF: page 49 → filename _0049.jp2 (0-padded, matches canvas label)
  const padded = String(pageNum).padStart(4, '0');
  return `${IIIF_BASE}_${padded}.jp2/full/${size}/0/default.jpg`;
}

async function fetchImageAsBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

function saveResult(testName, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${testName}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`  Saved: ${file}`);
}

function loadResult(testName) {
  const file = path.join(RESULTS_DIR, `${testName}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// Strip our annotation tags for pure text comparison
function stripTags(text) {
  return text
    .replace(/<[^>]+>[^<]*<\/[^>]+>/g, '') // paired tags
    .replace(/<[^>]+\/>/g, '')              // self-closing tags
    .replace(/<[^>]+>/g, '')                // orphan tags
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Simple word-level similarity (Jaccard on word sets)
function wordSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// Character-level edit distance (Levenshtein), capped for perf
function editDistance(a, b, maxLen = 5000) {
  a = a.substring(0, maxLen);
  b = b.substring(0, maxLen);
  const m = a.length, n = b.length;
  const dp = Array(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

function cer(reference, hypothesis) {
  const dist = editDistance(reference, hypothesis);
  return reference.length === 0 ? 0 : dist / reference.length;
}

function wer(reference, hypothesis) {
  const refWords = reference.split(/\s+/);
  const hypWords = hypothesis.split(/\s+/);
  const dist = editDistance(refWords.join(' '), hypWords.join(' '));
  return refWords.length === 0 ? 0 : dist / refWords.join(' ').length;
}

// Count <unclear> tags
function countUnclear(text) {
  return (text.match(/<unclear>/g) || []).length;
}

// -------------------------------------------------------------------
// Gemini OCR
// -------------------------------------------------------------------

async function geminiOcr(imageBase64, model, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
        { text: OCR_PROMPT },
      ],
    }],
  });
  return response.text || '';
}

// -------------------------------------------------------------------
// Claude OCR
// -------------------------------------------------------------------

async function claudeOcr(imageBase64) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: OCR_PROMPT },
      ],
    }],
  });
  return response.content[0]?.text || '';
}

// -------------------------------------------------------------------
// Test 1: Cross-Model Comparison
// -------------------------------------------------------------------

async function testCrossModel() {
  console.log('\n=== TEST 1: Cross-Model Comparison ===\n');

  const results = [];
  const pages = [...EVAL_PAGES.content.slice(0, 3)]; // 3 content pages

  for (const pageNum of pages) {
    console.log(`Page ${pageNum}:`);
    const url = iiifUrl(pageNum);
    console.log(`  Fetching image: ${url}`);
    const imgB64 = await fetchImageAsBase64(url);
    console.log(`  Image size: ${(imgB64.length * 0.75 / 1024).toFixed(0)}KB`);

    const pageResult = { page: pageNum, models: {} };

    // Gemini Flash
    console.log(`  Running ${GEMINI_FLASH}...`);
    try {
      const t0 = Date.now();
      pageResult.models.gemini_flash = {
        text: await geminiOcr(imgB64, GEMINI_FLASH, process.env.GEMINI_API_KEY),
        elapsed_ms: Date.now() - t0,
      };
      console.log(`    ${pageResult.models.gemini_flash.text.length} chars, ${pageResult.models.gemini_flash.elapsed_ms}ms`);
    } catch (e) {
      console.log(`    ERROR: ${e.message}`);
      pageResult.models.gemini_flash = { error: e.message };
    }

    // Gemini Lite
    console.log(`  Running ${GEMINI_LITE}...`);
    try {
      const t0 = Date.now();
      pageResult.models.gemini_lite = {
        text: await geminiOcr(imgB64, GEMINI_LITE, process.env.GEMINI_API_KEY),
        elapsed_ms: Date.now() - t0,
      };
      console.log(`    ${pageResult.models.gemini_lite.text.length} chars, ${pageResult.models.gemini_lite.elapsed_ms}ms`);
    } catch (e) {
      console.log(`    ERROR: ${e.message}`);
      pageResult.models.gemini_lite = { error: e.message };
    }

    // Claude
    if (process.env.ANTHROPIC_API_KEY) {
      console.log(`  Running ${CLAUDE_MODEL}...`);
      try {
        const t0 = Date.now();
        pageResult.models.claude = {
          text: await claudeOcr(imgB64),
          elapsed_ms: Date.now() - t0,
        };
        console.log(`    ${pageResult.models.claude.text.length} chars, ${pageResult.models.claude.elapsed_ms}ms`);
      } catch (e) {
        console.log(`    ERROR: ${e.message}`);
        pageResult.models.claude = { error: e.message };
      }
    } else {
      console.log('  Skipping Claude (no ANTHROPIC_API_KEY)');
    }

    // Compare models pairwise
    const models = Object.entries(pageResult.models).filter(([, v]) => v.text);
    if (models.length >= 2) {
      pageResult.comparisons = {};
      for (let i = 0; i < models.length; i++) {
        for (let j = i + 1; j < models.length; j++) {
          const [nameA, dataA] = models[i];
          const [nameB, dataB] = models[j];
          const textA = stripTags(dataA.text);
          const textB = stripTags(dataB.text);
          pageResult.comparisons[`${nameA}_vs_${nameB}`] = {
            word_similarity: wordSimilarity(textA, textB),
            len_a: textA.length,
            len_b: textB.length,
            unclear_a: countUnclear(dataA.text),
            unclear_b: countUnclear(dataB.text),
          };
          console.log(`    ${nameA} vs ${nameB}: ${(wordSimilarity(textA, textB) * 100).toFixed(1)}% word overlap`);
        }
      }
    }

    results.push(pageResult);

    // Rate limit pause
    await new Promise(r => setTimeout(r, 2000));
  }

  saveResult('cross-model', results);
  return results;
}

// -------------------------------------------------------------------
// Test 2: Resolution Sensitivity
// -------------------------------------------------------------------

async function testResolution() {
  console.log('\n=== TEST 2: Resolution Sensitivity ===\n');

  const results = [];
  const resolutions = ['max', '1024,', '512,'];
  const pages = [49, 53]; // Two content pages

  for (const pageNum of pages) {
    console.log(`Page ${pageNum}:`);
    const pageResult = { page: pageNum, resolutions: {} };

    for (const res of resolutions) {
      const url = iiifUrl(pageNum, res);
      console.log(`  Resolution ${res}: ${url.substring(0, 80)}...`);

      try {
        const imgB64 = await fetchImageAsBase64(url);
        console.log(`    Image: ${(imgB64.length * 0.75 / 1024).toFixed(0)}KB`);

        const t0 = Date.now();
        const text = await geminiOcr(imgB64, GEMINI_FLASH, process.env.GEMINI_API_KEY);
        const elapsed = Date.now() - t0;

        pageResult.resolutions[res] = {
          text,
          elapsed_ms: elapsed,
          image_kb: Math.round(imgB64.length * 0.75 / 1024),
          text_length: text.length,
          unclear_count: countUnclear(text),
        };

        console.log(`    ${text.length} chars, ${countUnclear(text)} unclear, ${elapsed}ms`);
      } catch (e) {
        console.log(`    ERROR: ${e.message}`);
        pageResult.resolutions[res] = { error: e.message };
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    // Compare max vs lower resolutions
    const maxText = stripTags(pageResult.resolutions['max']?.text || '');
    for (const res of ['1024,', '512,']) {
      const resText = stripTags(pageResult.resolutions[res]?.text || '');
      if (maxText && resText) {
        const sim = wordSimilarity(maxText, resText);
        console.log(`  max vs ${res}: ${(sim * 100).toFixed(1)}% word overlap, CER≈${(cer(maxText, resText) * 100).toFixed(1)}%`);
        pageResult.resolutions[res].vs_max = {
          word_similarity: sim,
          cer: cer(maxText, resText),
        };
      }
    }

    results.push(pageResult);
  }

  saveResult('resolution', results);
  return results;
}

// -------------------------------------------------------------------
// Test 3: Hallucination Detection
// -------------------------------------------------------------------

async function testHallucination() {
  console.log('\n=== TEST 3: Hallucination Detection ===\n');

  const results = [];

  // Test 3a: Known blank pages — model should say BLANK
  console.log('3a: Known blank pages (should produce no Italian text)');
  for (const pageNum of EVAL_PAGES.blank) {
    const url = iiifUrl(pageNum);
    console.log(`  Page ${pageNum}: ${url.substring(0, 80)}...`);

    try {
      const imgB64 = await fetchImageAsBase64(url);
      const text = await geminiOcr(imgB64, GEMINI_FLASH, process.env.GEMINI_API_KEY);

      const isBlank = /blank\s*page/i.test(text);
      const italianWords = stripTags(text).split(/\s+/).filter(w => w.length > 3).length;

      results.push({
        test: 'blank_page',
        page: pageNum,
        text,
        detected_blank: isBlank,
        italian_word_count: italianWords,
        pass: isBlank && italianWords < 10,
      });

      console.log(`    Detected blank: ${isBlank}, Italian words: ${italianWords} → ${isBlank && italianWords < 10 ? 'PASS' : 'FAIL'}`);
    } catch (e) {
      console.log(`    ERROR: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // Test 3b: Illustration-heavy pages — check if model invents text for diagrams
  console.log('\n3b: Illustration-heavy pages (should have limited text)');
  for (const pageNum of EVAL_PAGES.illustration) {
    const url = iiifUrl(pageNum);
    console.log(`  Page ${pageNum}:`);

    try {
      const imgB64 = await fetchImageAsBase64(url);
      const text = await geminiOcr(imgB64, GEMINI_FLASH, process.env.GEMINI_API_KEY);
      const stripped = stripTags(text);

      results.push({
        test: 'illustration_page',
        page: pageNum,
        text,
        text_length: stripped.length,
        word_count: stripped.split(/\s+/).length,
      });

      console.log(`    ${stripped.length} chars, ${stripped.split(/\s+/).length} words`);
    } catch (e) {
      console.log(`    ERROR: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // Test 3c: Known passages cross-check
  // Check if model produces text from DIFFERENT Leonardo folios (not on this page)
  console.log('\n3c: Cross-folio contamination check');
  console.log('  Checking if OCR contains passages from other Leonardo works...');

  // Well-known Leonardo quotes NOT from optics pages
  const knownPassages = [
    { text: 'la pittura è composizione di luce e di tenebre', source: 'Treatise on Painting, Part 2' },
    { text: 'il moto è causa d\'ogni vita', source: 'Codex Atlanticus' },
    { text: 'la scienza è il capitano e la pratica sono i soldati', source: 'Manuscript I' },
  ];

  // Get existing OCR from DB for content pages
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const pages = await db.collection('pages').find(
    { book_id: BOOK_ID, page_number: { $in: EVAL_PAGES.content } },
    { projection: { page_number: 1, 'ocr.data': 1, _id: 0 } }
  ).toArray();

  for (const passage of knownPassages) {
    const found = pages.some(p =>
      (p.ocr?.data || '').toLowerCase().includes(passage.text.toLowerCase())
    );
    results.push({
      test: 'cross_folio',
      passage: passage.text,
      source: passage.source,
      found_in_ocr: found,
      verdict: found ? 'SUSPICIOUS — may be reciting training data' : 'CLEAN — not found',
    });
    console.log(`  "${passage.text.substring(0, 50)}..." → ${found ? 'FOUND (suspicious)' : 'not found (clean)'}`);
  }

  await client.close();

  saveResult('hallucination', results);
  return results;
}

// -------------------------------------------------------------------
// Test 4: Translation Quality Audit
// -------------------------------------------------------------------

async function testTranslation() {
  console.log('\n=== TEST 4: Translation Quality Audit ===\n');

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const results = [];
  const pages = await db.collection('pages').find(
    { book_id: BOOK_ID, page_number: { $in: EVAL_PAGES.content } },
    { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1, _id: 0 } }
  ).sort({ page_number: 1 }).toArray();

  for (const page of pages) {
    const ocr = stripTags(page.ocr?.data || '');
    const trans = stripTags(page.translation?.data || '');

    if (!trans || trans.length < 50) {
      console.log(`Page ${page.page_number}: No translation (${trans.length} chars) — skipping`);
      continue;
    }

    // Check: does the translation contain Italian words (untranslated)?
    // Common Italian words that should be translated
    const italianMarkers = ['della', 'delle', 'nella', 'quello', 'questa', 'perché', 'quando', 'essere', 'l\'ombra', 'ombra'];
    const untranslatedWords = italianMarkers.filter(w =>
      trans.toLowerCase().includes(w) && !trans.toLowerCase().includes(`<term>${w}`)
    );

    // Check: OCR-translation word overlap (should be low for different languages)
    const ocrWords = new Set(ocr.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const transWords = new Set(trans.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const overlap = [...ocrWords].filter(w => transWords.has(w));
    const overlapRatio = ocrWords.size > 0 ? overlap.length / ocrWords.size : 0;

    // Check: translation length ratio (should be roughly 0.8-1.5x for Italian→English)
    const lengthRatio = ocr.length > 0 ? trans.length / ocr.length : 0;

    const result = {
      page: page.page_number,
      ocr_length: ocr.length,
      trans_length: trans.length,
      length_ratio: Math.round(lengthRatio * 100) / 100,
      untranslated_words: untranslatedWords,
      word_overlap_ratio: Math.round(overlapRatio * 100) / 100,
      overlapping_words: overlap.slice(0, 10),
      flags: [],
    };

    if (lengthRatio < 0.3) result.flags.push('SUSPICIOUSLY_SHORT');
    if (lengthRatio > 3.0) result.flags.push('SUSPICIOUSLY_LONG — may contain hallucinated content');
    if (overlapRatio > 0.4) result.flags.push('HIGH_OVERLAP — translation may not be translating');
    if (untranslatedWords.length > 3) result.flags.push('MANY_UNTRANSLATED — Italian words left in English text');

    results.push(result);

    console.log(`Page ${page.page_number}: ratio=${lengthRatio.toFixed(2)}, overlap=${(overlapRatio * 100).toFixed(0)}%, flags=[${result.flags.join(', ')}]`);
  }

  await client.close();
  saveResult('translation', results);
  return results;
}

// -------------------------------------------------------------------
// Report Generation
// -------------------------------------------------------------------

function generateReport() {
  console.log('\n=== EVALUATION REPORT: Leonardo Mirror-Script OCR ===\n');

  const crossModel = loadResult('cross-model');
  const resolution = loadResult('resolution');
  const hallucination = loadResult('hallucination');
  const translation = loadResult('translation');

  const lines = [];
  lines.push('# Leonardo Mirror-Script OCR Evaluation Report');
  lines.push(`Date: ${new Date().toISOString().split('T')[0]}`);
  lines.push(`Book: Etudes sur la chevelure et le traite de peinture (${BOOK_ID})`);
  lines.push(`Models tested: ${GEMINI_FLASH}, ${GEMINI_LITE}, ${CLAUDE_MODEL}`);
  lines.push('');

  // Cross-model summary
  if (crossModel) {
    lines.push('## 1. Cross-Model Comparison');
    lines.push('');
    lines.push('| Page | Flash chars | Lite chars | Claude chars | Flash↔Lite | Flash↔Claude | Lite↔Claude |');
    lines.push('|------|-----------|-----------|-------------|-----------|-------------|-------------|');

    for (const p of crossModel) {
      const fc = p.models.gemini_flash?.text?.length || '-';
      const lc = p.models.gemini_lite?.text?.length || '-';
      const cc = p.models.claude?.text?.length || '-';
      const fl = p.comparisons?.gemini_flash_vs_gemini_lite?.word_similarity;
      const fcc = p.comparisons?.gemini_flash_vs_claude?.word_similarity;
      const lcc = p.comparisons?.gemini_lite_vs_claude?.word_similarity;
      lines.push(`| ${p.page} | ${fc} | ${lc} | ${cc} | ${fl ? (fl * 100).toFixed(1) + '%' : '-'} | ${fcc ? (fcc * 100).toFixed(1) + '%' : '-'} | ${lcc ? (lcc * 100).toFixed(1) + '%' : '-'} |`);
    }
    lines.push('');

    // Interpretation
    const avgSim = crossModel.reduce((sum, p) => {
      const vals = Object.values(p.comparisons || {}).map(c => c.word_similarity).filter(Boolean);
      return sum + (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
    }, 0) / crossModel.length;

    if (avgSim > 0.6) {
      lines.push('**Interpretation:** High cross-model agreement suggests models are reading the actual image content,');
      lines.push('not simply reciting training data (different models would recite differently).');
    } else if (avgSim > 0.3) {
      lines.push('**Interpretation:** Moderate agreement — models partially converge on the same text.');
      lines.push('Some content may be genuinely read while other portions may be reconstructed.');
    } else {
      lines.push('**Interpretation:** Low agreement — models produce substantially different text.');
      lines.push('This could indicate hallucination or genuine difficulty with the mirror script.');
    }
    lines.push('');
  }

  // Resolution summary
  if (resolution) {
    lines.push('## 2. Resolution Sensitivity');
    lines.push('');
    lines.push('| Page | Res | Image KB | Chars | Unclear | vs Max (word sim) | vs Max (CER) |');
    lines.push('|------|-----|----------|-------|---------|-------------------|--------------|');

    for (const p of resolution) {
      for (const [res, data] of Object.entries(p.resolutions)) {
        if (data.error) continue;
        lines.push(`| ${p.page} | ${res} | ${data.image_kb} | ${data.text_length} | ${data.unclear_count} | ${data.vs_max?.word_similarity ? (data.vs_max.word_similarity * 100).toFixed(1) + '%' : '(ref)'} | ${data.vs_max?.cer ? (data.vs_max.cer * 100).toFixed(1) + '%' : '(ref)'} |`);
      }
    }
    lines.push('');

    // Interpretation
    const lowResResults = resolution.flatMap(p =>
      Object.entries(p.resolutions)
        .filter(([res, d]) => res === '512,' && d.vs_max)
        .map(([, d]) => d.vs_max)
    );

    if (lowResResults.length > 0) {
      const avgSim512 = lowResResults.reduce((s, d) => s + d.word_similarity, 0) / lowResResults.length;
      if (avgSim512 > 0.8) {
        lines.push('**Interpretation:** Output is stable across resolutions — the model produces similar text even at 512px.');
        lines.push('This is SUSPICIOUS: genuine OCR of difficult handwriting should degrade at lower resolution.');
        lines.push('Stable output suggests the model may be pattern-matching on visual features + training data.');
      } else if (avgSim512 > 0.5) {
        lines.push('**Interpretation:** Moderate degradation at low resolution — consistent with genuine OCR.');
        lines.push('The model reads more at higher resolution, suggesting it is at least partially reading the image.');
      } else {
        lines.push('**Interpretation:** Strong degradation at low resolution — strong evidence of genuine OCR.');
        lines.push('The model clearly depends on image resolution to read the text.');
      }
    }
    lines.push('');
  }

  // Hallucination summary
  if (hallucination) {
    lines.push('## 3. Hallucination Detection');
    lines.push('');

    const blankTests = hallucination.filter(r => r.test === 'blank_page');
    const crossFolio = hallucination.filter(r => r.test === 'cross_folio');

    if (blankTests.length) {
      lines.push('### Blank page control');
      for (const t of blankTests) {
        lines.push(`- Page ${t.page}: ${t.pass ? 'PASS' : 'FAIL'} — detected blank: ${t.detected_blank}, Italian words: ${t.italian_word_count}`);
      }
      lines.push('');
    }

    if (crossFolio.length) {
      lines.push('### Cross-folio contamination');
      for (const t of crossFolio) {
        lines.push(`- "${t.passage.substring(0, 60)}..." (${t.source}): ${t.verdict}`);
      }
      lines.push('');
    }

    const anyFail = blankTests.some(t => !t.pass) || crossFolio.some(t => t.found_in_ocr);
    if (anyFail) {
      lines.push('**WARNING:** Some hallucination indicators detected. Review flagged items above.');
    } else {
      lines.push('**Result:** No hallucination detected. Blank pages correctly identified, no cross-folio contamination.');
    }
    lines.push('');
  }

  // Translation summary
  if (translation) {
    lines.push('## 4. Translation Quality');
    lines.push('');
    lines.push('| Page | OCR len | Trans len | Ratio | Overlap | Flags |');
    lines.push('|------|---------|-----------|-------|---------|-------|');
    for (const t of translation) {
      lines.push(`| ${t.page} | ${t.ocr_length} | ${t.trans_length} | ${t.length_ratio} | ${(t.word_overlap_ratio * 100).toFixed(0)}% | ${t.flags.join(', ') || 'OK'} |`);
    }
    lines.push('');
  }

  // Overall verdict
  lines.push('## Overall Verdict');
  lines.push('');
  lines.push('(Fill in after reviewing all test results)');
  lines.push('');
  lines.push('## Recommendations');
  lines.push('');
  lines.push('- [ ] If cross-model agreement is high AND resolution sensitivity is moderate: Gemini is likely reading the images. Safe to batch re-OCR Leonardo manuscripts with v10.');
  lines.push('- [ ] If resolution sensitivity is low (stable across resolutions): Gemini may be partially reconstructing. Consider human-in-the-loop verification for critical folios.');
  lines.push('- [ ] If hallucination tests fail: Do NOT batch re-OCR without a specialized mirror-script prompt.');

  const report = lines.join('\n');

  // Save report
  const reportPath = path.join(RESULTS_DIR, 'report.md');
  fs.writeFileSync(reportPath, report);
  console.log(report);
  console.log(`\nReport saved: ${reportPath}`);

  return report;
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const testArg = args.find(a => a.startsWith('--test='))?.split('=')[1]
    || args[args.indexOf('--test') + 1]
    || 'report';

  // Verify env
  if (!process.env.MONGODB_URI) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY && testArg !== 'translation' && testArg !== 'report') {
    console.error('Missing GEMINI_API_KEY');
    process.exit(1);
  }

  console.log(`Leonardo Mirror-Script OCR Evaluation`);
  console.log(`Test: ${testArg}`);
  console.log(`Results dir: ${RESULTS_DIR}`);

  try {
    switch (testArg) {
      case 'cross-model':
        await testCrossModel();
        break;
      case 'resolution':
        await testResolution();
        break;
      case 'hallucination':
        await testHallucination();
        break;
      case 'translation':
        await testTranslation();
        break;
      case 'all':
        await testCrossModel();
        await testResolution();
        await testHallucination();
        await testTranslation();
        generateReport();
        break;
      case 'report':
        generateReport();
        break;
      default:
        console.error(`Unknown test: ${testArg}`);
        console.error('Available: cross-model, resolution, hallucination, translation, all, report');
        process.exit(1);
    }
  } catch (e) {
    console.error('Fatal error:', e);
    process.exit(1);
  }
}

main();
