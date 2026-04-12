#!/usr/bin/env node
/**
 * Leonardo Mirror-Flip + Control Comparison Test
 *
 * Tests:
 * A) Leonardo mirror-script pages — flipped horizontally → normal text
 * B) BPH manuscript (Drebbel, Latin handwriting) — baseline for manuscript OCR
 * C) Printed book (Vitruvius, Latin) — baseline for printed OCR
 *
 * Each test: 2 OCR runs on the same image → measure run-to-run consistency.
 * If flipped Leonardo consistency >> unflipped (~7%), the model CAN read
 * the text but specifically fails on mirror orientation.
 *
 * Usage: node scripts/eval/leonardo-mirror-flip-test.mjs
 */

import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'leonardo-eval-results');

const GEMINI_FLASH = 'gemini-3-flash-preview';

// --- Image sources ---

function leonardoIiifUrl(pageNum) {
  const id = 'etudessurlacheve00leon';
  const padded = String(pageNum).padStart(4, '0');
  return `https://iiif.archive.org/image/iiif/3/${id}%2F${id}_jp2.zip%2F${id}_jp2%2F${id}_${padded}.jp2/full/max/0/default.jpg`;
}

function vitruviusIiifUrl(pageNum) {
  const id = 'mvitrvviidearchi00vitr';
  const padded = String(pageNum).padStart(4, '0');
  return `https://iiif.archive.org/image/iiif/3/${id}%2F${id}_jp2.zip%2F${id}_jp2%2F${id}_${padded}.jp2/full/max/0/default.jpg`;
}

function drebbelR2Url(pageNum) {
  const padded = String(pageNum).padStart(4, '0');
  return `https://images.sourcelibrary.org/pages/6836f8ee811c8ab472a49e36/${padded}.jpg`;
}

// --- Prompts ---

const PROMPT_GENERIC = `Transcribe this historical manuscript page to plain text.

Rules:
1. Preserve original spelling, capitalization, punctuation
2. Mark illegible text with <unclear>...</unclear>
3. Describe diagrams briefly in [brackets]
4. If the page is blank or has no text, say "BLANK PAGE"
5. Do NOT add interpretive notes, translations, or scholarly commentary
6. Do NOT reconstruct text you cannot actually read — only transcribe what is visible`;

// --- Utilities ---

async function fetchImage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    } catch (e) {
      if (attempt === retries) throw new Error(`Fetch ${url.substring(0, 60)}... failed after ${retries} attempts: ${e.message}`);
      console.log(`  Fetch retry ${attempt}/${retries}: ${e.message}`);
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
}

async function flipImage(buffer) {
  return sharp(buffer).flop().toBuffer();
}

async function geminiOcr(imageBase64, apiKey, retries = 3) {
  const ai = new GoogleGenAI({ apiKey });
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_FLASH,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
            { text: PROMPT_GENERIC },
          ],
        }],
      });
      return response.text || '';
    } catch (e) {
      if (attempt === retries) throw e;
      console.log(`    Retry ${attempt}/${retries}: ${e.message}`);
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }
}

function stripTags(text) {
  return text
    .replace(/<[^>]+>[^<]*<\/[^>]+>/g, '')
    .replace(/<[^>]+\/>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wordSet(text) {
  return new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 2));
}

function jaccard(a, b) {
  const setA = wordSet(a);
  const setB = wordSet(b);
  const inter = [...setA].filter(x => setB.has(x));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : inter.length / union.size;
}

function countUnclear(text) {
  return (text.match(/<unclear>/g) || []).length;
}

async function runTwoOcr(label, imageB64, apiKey) {
  const runs = [];
  for (let i = 1; i <= 2; i++) {
    console.log(`  Run ${i}...`);
    const t0 = Date.now();
    const text = await geminiOcr(imageB64, apiKey);
    const elapsed = Date.now() - t0;
    const stripped = stripTags(text);
    runs.push({ run: i, text, stripped, chars: text.length, unclear: countUnclear(text), elapsed_ms: elapsed });
    console.log(`    ${text.length} chars, ${countUnclear(text)} unclear, ${elapsed}ms`);
    console.log(`    ${stripped.substring(0, 150).replace(/\n/g, ' ')}`);
    if (i < 2) await new Promise(r => setTimeout(r, 5000));
  }
  const consistency = jaccard(runs[0].stripped, runs[1].stripped);
  console.log(`  Consistency (run1↔run2): ${(consistency * 100).toFixed(1)}%`);
  return { label, runs, consistency };
}

// --- Main ---

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('Missing GEMINI_API_KEY');
    process.exit(1);
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  console.log('Leonardo Mirror-Flip + Control Comparison');
  console.log('=========================================\n');

  const allResults = [];

  // ----- A. Leonardo mirror pages (flipped) -----
  console.log('=== A. LEONARDO MIRROR-SCRIPT (FLIPPED) ===\n');

  for (const pageNum of [49, 53]) {
    const url = leonardoIiifUrl(pageNum);
    console.log(`Leonardo p${pageNum}: fetching...`);
    const imgBuf = await fetchImage(url);
    const flippedBuf = await flipImage(imgBuf);
    console.log(`  Original ${(imgBuf.length / 1024).toFixed(0)}KB → Flipped ${(flippedBuf.length / 1024).toFixed(0)}KB`);

    // Save flipped for inspection
    fs.writeFileSync(path.join(RESULTS_DIR, `leonardo_p${pageNum}_flipped.jpg`), flippedBuf);

    const result = await runTwoOcr(`leonardo_p${pageNum}_flipped`, flippedBuf.toString('base64'), process.env.GEMINI_API_KEY);
    result.page = pageNum;
    result.type = 'mirror_flipped';
    allResults.push(result);

    await new Promise(r => setTimeout(r, 5000));
  }

  // ----- A2. Leonardo UNFLIPPED (fresh runs for direct comparison) -----
  console.log('\n=== A2. LEONARDO MIRROR-SCRIPT (UNFLIPPED — fresh) ===\n');

  for (const pageNum of [49, 53]) {
    const url = leonardoIiifUrl(pageNum);
    console.log(`Leonardo p${pageNum} unflipped: fetching...`);
    const imgBuf = await fetchImage(url);

    const result = await runTwoOcr(`leonardo_p${pageNum}_unflipped`, imgBuf.toString('base64'), process.env.GEMINI_API_KEY);
    result.page = pageNum;
    result.type = 'mirror_unflipped';
    allResults.push(result);

    await new Promise(r => setTimeout(r, 5000));
  }

  // ----- B. Manuscript control (BPH Drebbel — Latin handwriting) -----
  console.log('\n=== B. MANUSCRIPT CONTROL (Drebbel — Latin handwriting) ===\n');

  for (const pageNum of [15, 25]) {
    const url = drebbelR2Url(pageNum);
    console.log(`Drebbel p${pageNum}: fetching ${url}...`);
    try {
      const imgBuf = await fetchImage(url);
      console.log(`  ${(imgBuf.length / 1024).toFixed(0)}KB`);

      const result = await runTwoOcr(`drebbel_p${pageNum}`, imgBuf.toString('base64'), process.env.GEMINI_API_KEY);
      result.page = pageNum;
      result.type = 'manuscript';
      allResults.push(result);
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 5000));
  }

  // ----- C. Printed control (Vitruvius — Latin printed text) -----
  console.log('\n=== C. PRINTED CONTROL (Vitruvius — Latin printed text) ===\n');

  for (const pageNum of [30, 50]) {
    const url = vitruviusIiifUrl(pageNum);
    console.log(`Vitruvius p${pageNum}: fetching...`);
    try {
      const imgBuf = await fetchImage(url);
      console.log(`  ${(imgBuf.length / 1024).toFixed(0)}KB`);

      const result = await runTwoOcr(`vitruvius_p${pageNum}`, imgBuf.toString('base64'), process.env.GEMINI_API_KEY);
      result.page = pageNum;
      result.type = 'printed';
      allResults.push(result);
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 5000));
  }

  // ----- Summary -----
  console.log('\n\n============================================');
  console.log('SUMMARY: Run-to-Run Consistency by Text Type');
  console.log('============================================\n');

  console.log('| Source | Page | Type | Chars | Unclear | Consistency |');
  console.log('|--------|------|------|-------|---------|-------------|');

  for (const r of allResults) {
    const chars = r.runs[0]?.chars || '-';
    const unclear = r.runs[0]?.unclear || '-';
    console.log(`| ${r.label.padEnd(30)} | ${String(r.page).padStart(4)} | ${r.type.padEnd(16)} | ${String(chars).padStart(5)} | ${String(unclear).padStart(7)} | ${(r.consistency * 100).toFixed(1).padStart(10)}% |`);
  }

  // Averages by type
  const byType = {};
  for (const r of allResults) {
    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r.consistency);
  }

  console.log('\nAverages:');
  for (const [type, vals] of Object.entries(byType)) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    console.log(`  ${type}: ${(avg * 100).toFixed(1)}%`);
  }

  // Cross-compare flipped vs unflipped
  const flipped = allResults.filter(r => r.type === 'mirror_flipped');
  const unflipped = allResults.filter(r => r.type === 'mirror_unflipped');

  if (flipped.length && unflipped.length) {
    console.log('\nFlipped vs unflipped (same pages):');
    for (const f of flipped) {
      const u = unflipped.find(r => r.page === f.page);
      if (u) {
        // Compare flipped run1 vs unflipped run1
        const crossSim = jaccard(f.runs[0].stripped, u.runs[0].stripped);
        console.log(`  Page ${f.page}: flipped consistency=${(f.consistency * 100).toFixed(1)}%, unflipped=${(u.consistency * 100).toFixed(1)}%, cross=${(crossSim * 100).toFixed(1)}%`);
      }
    }
  }

  console.log('\nInterpretation:');
  const avgFlipped = byType.mirror_flipped?.reduce((a, b) => a + b, 0) / (byType.mirror_flipped?.length || 1);
  const avgUnflipped = byType.mirror_unflipped?.reduce((a, b) => a + b, 0) / (byType.mirror_unflipped?.length || 1);
  const avgPrinted = byType.printed?.reduce((a, b) => a + b, 0) / (byType.printed?.length || 1);
  const avgManuscript = byType.manuscript?.reduce((a, b) => a + b, 0) / (byType.manuscript?.length || 1);

  if (avgFlipped > avgUnflipped * 2 && avgFlipped > 0.3) {
    console.log('  FLIPPING HELPS: Mirror orientation is the primary failure mode.');
    console.log('  Consider pre-processing Leonardo images with horizontal flip before OCR.');
  } else if (avgFlipped > avgUnflipped * 1.3) {
    console.log('  FLIPPING HELPS SOMEWHAT: Mirror orientation contributes to errors but is not the only issue.');
  } else {
    console.log('  FLIPPING DOES NOT HELP: The difficulty is not specific to mirror orientation.');
  }

  if (avgPrinted > 0.5) {
    console.log(`  PRINTED BASELINE: ${(avgPrinted * 100).toFixed(0)}% — model is highly consistent on printed text.`);
  }
  if (avgManuscript > 0) {
    console.log(`  MANUSCRIPT BASELINE: ${(avgManuscript * 100).toFixed(0)}% — this is the ceiling for handwritten text.`);
  }

  // Save
  const outPath = path.join(RESULTS_DIR, 'mirror-flip.json');
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved: ${outPath}`);
}

main();
