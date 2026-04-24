#!/usr/bin/env node
/**
 * Study 3: Thinking Level Sweep
 *
 * Runs Gemini Flash Lite on the 50 hallucination pages at thinking levels
 * NONE, MINIMAL, LOW, MEDIUM, HIGH to find the minimum thinking level
 * that prevents hallucination per language/page profile.
 *
 * Usage:
 *   node scripts/eval/thinking-sweep.mjs --dry-run           # show plan + cost estimate
 *   node scripts/eval/thinking-sweep.mjs                     # run all
 *   node scripts/eval/thinking-sweep.mjs --lang=Hebrew       # run one language
 *   node scripts/eval/thinking-sweep.mjs --level=MINIMAL     # run one level only
 *   node scripts/eval/thinking-sweep.mjs stats               # show results
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env
for (const file of ['.env.production.local', '.env.local']) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
      }
    }
  } catch {}
}

function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      args[key] = rest.length > 0 ? rest.join('=') : true;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const command = args._[0];

const MODEL = 'gemini-3.1-flash-lite-preview';
const THINKING_LEVELS = ['NONE', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
const OCR_PROMPT = 'Transcribe ALL text visible in this image using the appropriate Unicode script. Output ONLY the raw text. No commentary, no translation, no labels, no markdown.';
const RESULTS_DIR = path.join(__dirname, 'results', 'thinking-sweep');
const GT_DIR = path.join(__dirname, 'ground-truth', 'results');

// ── Gemini API ────────────────────────────────────────────────────────

let geminiKeys = [];
let geminiKeyIndex = 0;

function loadGeminiKeys() {
  if (geminiKeys.length > 0) return;
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('GEMINI_API_KEY') && v) geminiKeys.push(v);
  }
  geminiKeys = [...new Set(geminiKeys)];
  if (geminiKeys.length === 0) throw new Error('No GEMINI_API_KEY* env vars set');
  console.log(`Loaded ${geminiKeys.length} Gemini API keys`);
}

function getNextKey() {
  loadGeminiKeys();
  const key = geminiKeys[geminiKeyIndex % geminiKeys.length];
  geminiKeyIndex++;
  return key;
}

async function runOcrWithThinking(imageBuffer, thinkingLevel) {
  const apiKey = getNextKey();
  const b64 = imageBuffer.toString('base64');

  const genConfig = { temperature: 0, maxOutputTokens: 16000 };

  if (thinkingLevel !== 'NONE') {
    genConfig.thinkingConfig = { thinkingLevel };
  }

  const body = {
    contents: [{
      parts: [
        { text: OCR_PROMPT },
        { inline_data: { mime_type: 'image/jpeg', data: b64 } },
      ],
    }],
    generationConfig: genConfig,
  };

  const start = Date.now();
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );

  if (resp.status === 429) {
    throw new Error('RATE_LIMITED');
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  const durationMs = Date.now() - start;

  const parts = data.candidates?.[0]?.content?.parts || [];
  const textParts = parts.filter(p => p.text && !p.thought);
  const text = textParts.map(p => p.text).join('') || parts[0]?.text || '';

  const usage = data.usageMetadata || {};

  return {
    text,
    charCount: text.length,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    thinkingTokens: usage.thoughtsTokenCount || 0,
    durationMs,
    finishReason: data.candidates?.[0]?.finishReason || 'unknown',
  };
}

async function fetchImage(url, timeoutMs = 60000) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status} ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

// ── Main sweep ────────────────────────────────────────────────────────

async function runSweep() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // Load hallucination pages from Study 2 results
  const evalFiles = fs.readdirSync(GT_DIR).filter(f => f.endsWith('.json'));
  const hallPages = [];
  for (const f of evalFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(GT_DIR, f)));
    if (data.evaluation?.hallucination) {
      // Ensure image URL — construct from archived CDN if missing
      if (!data.image_url) {
        data.image_url = `https://images.sourcelibrary.org/archived/${data.book_id}/${data.page_number}.jpg`;
      }
      hallPages.push(data);
    }
  }

  console.log(`\n=== Study 3: Thinking Level Sweep ===`);
  console.log(`Model: ${MODEL}`);
  console.log(`Hallucination pages: ${hallPages.length}`);
  console.log(`Thinking levels: ${THINKING_LEVELS.join(', ')}`);

  // Filter by language if requested
  let pages = hallPages;
  if (args.lang) pages = pages.filter(p => p.language === args.lang);

  const levels = args.level ? [args.level] : THINKING_LEVELS;

  const totalCalls = pages.length * levels.length;
  console.log(`Calls to make: ${totalCalls} (${pages.length} pages x ${levels.length} levels)`);
  console.log(`Estimated cost: ~$${(totalCalls * 0.005).toFixed(2)}\n`);

  if (args['dry-run']) {
    console.log('Pages:');
    for (const p of pages) {
      const existing = levels.map(l => {
        const rFile = path.join(RESULTS_DIR, `${p.book_id}_p${p.page_number}_${l}.json`);
        return fs.existsSync(rFile) ? 'DONE' : 'TODO';
      });
      console.log(`  ${p.language.padEnd(12)} ${p.book_id.slice(0,12)} p${p.page_number.toString().padEnd(4)} ${levels.map((l,i) => `${l}:${existing[i]}`).join(' ')}`);
    }
    return;
  }

  let totalCost = 0;
  let completed = 0;
  let errors = 0;

  for (const page of pages) {
    const imageUrl = page.image_url;
    if (!imageUrl) { console.log(`  SKIP: no image URL for ${page.book_id} p${page.page_number}`); continue; }

    let imageBuffer;
    // Check local cache first
    const localPath = `/tmp/study2-images/${page.book_id}_p${page.page_number}.jpg`;
    if (fs.existsSync(localPath)) {
      imageBuffer = fs.readFileSync(localPath);
    } else {
      // Try archived URL, then original photo URL
      const urls = [
        imageUrl,
        `https://images.sourcelibrary.org/archived/${page.book_id}/${page.page_number}.jpg`,
      ];
      for (const url of urls) {
        try {
          imageBuffer = await fetchImage(url);
          break;
        } catch (e) { /* try next */ }
      }
      if (!imageBuffer) {
        console.log(`  SKIP: could not fetch image for ${page.book_id} p${page.page_number}`);
        errors++;
        continue;
      }
    }

    for (const level of levels) {
      const resultFile = path.join(RESULTS_DIR, `${page.book_id}_p${page.page_number}_${level}.json`);
      if (fs.existsSync(resultFile)) {
        completed++;
        continue; // already done
      }

      let retries = 0;
      let result;
      while (retries < 3) {
        try {
          result = await runOcrWithThinking(imageBuffer, level);
          break;
        } catch (e) {
          if (e.message === 'RATE_LIMITED') {
            retries++;
            console.log(`    Rate limited, waiting 30s (retry ${retries}/3)...`);
            await new Promise(r => setTimeout(r, 30000));
          } else {
            console.log(`    ERROR: ${e.message.slice(0, 100)}`);
            errors++;
            break;
          }
        }
      }

      if (!result) continue;

      const sweepResult = {
        book_id: page.book_id,
        page_number: page.page_number,
        language: page.language,
        thinking_level: level,
        model: MODEL,
        // Results
        ocr_char_count: result.charCount,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        thinking_tokens: result.thinkingTokens,
        duration_ms: result.durationMs,
        finish_reason: result.finishReason,
        // Context from Study 2
        original_ocr_chars: page.existing_ocr_chars,
        original_model: page.existing_ocr_model,
        hallucination_ratio: page.hallucination_ratio,
        actual_text_estimate: page.evaluation?.actual_text_estimate_chars || null,
        // Computed
        ratio_to_estimate: page.evaluation?.actual_text_estimate_chars
          ? +(result.charCount / page.evaluation.actual_text_estimate_chars).toFixed(2)
          : null,
        likely_hallucinated: page.evaluation?.actual_text_estimate_chars
          ? result.charCount > page.evaluation.actual_text_estimate_chars * 3
          : result.charCount > 10000,
        timestamp: new Date().toISOString(),
      };

      fs.writeFileSync(resultFile, JSON.stringify(sweepResult, null, 2));
      completed++;

      const hall = sweepResult.likely_hallucinated ? 'HALL' : 'OK';
      const costEst = (result.inputTokens / 1e6) * 0.075 + (result.outputTokens / 1e6) * 0.30;
      totalCost += costEst;

      console.log(`  ${page.language.padEnd(10)} p${page.page_number.toString().padEnd(4)} ${level.padEnd(8)} ${result.charCount.toString().padStart(7)} chars  think=${result.thinkingTokens.toString().padStart(5)}  ${hall}  $${costEst.toFixed(4)}`);

      // Brief pause between calls
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Completed: ${completed}`);
  console.log(`Errors: ${errors}`);
  console.log(`Estimated cost: $${totalCost.toFixed(2)}`);
}

// ── Stats ────────────────────────────────────────────────────────────

function showStats() {
  if (!fs.existsSync(RESULTS_DIR)) { console.log('No results yet.'); return; }
  const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) { console.log('No results yet.'); return; }

  const results = files.map(f => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f))));

  console.log(`\n=== Study 3: Thinking Sweep Results ===`);
  console.log(`Total results: ${results.length}\n`);

  // Group by language × thinking level
  const table = {};
  for (const r of results) {
    const key = `${r.language}:${r.thinking_level}`;
    if (!table[key]) table[key] = { language: r.language, level: r.thinking_level, chars: [], hallucinated: 0, total: 0, thinkingTokens: [] };
    table[key].chars.push(r.ocr_char_count);
    table[key].thinkingTokens.push(r.thinking_tokens);
    table[key].total++;
    if (r.likely_hallucinated) table[key].hallucinated++;
  }

  // Print table
  const langs = [...new Set(results.map(r => r.language))].sort();

  console.log('=== HALLUCINATION RATE BY LANGUAGE x THINKING LEVEL ===\n');
  console.log(`${'Language'.padEnd(12)} ${'Level'.padEnd(9)} ${'n'.padStart(3)} ${'Hall'.padStart(5)} ${'Rate'.padStart(6)} ${'Med chars'.padStart(10)} ${'Med think'.padStart(10)}`);
  console.log('-'.repeat(60));

  for (const lang of langs) {
    for (const level of THINKING_LEVELS) {
      const key = `${lang}:${level}`;
      const s = table[key];
      if (!s) continue;
      const sortedChars = s.chars.sort((a, b) => a - b);
      const medChars = sortedChars[Math.floor(sortedChars.length / 2)];
      const sortedThink = s.thinkingTokens.sort((a, b) => a - b);
      const medThink = sortedThink[Math.floor(sortedThink.length / 2)];
      const rate = (s.hallucinated / s.total * 100).toFixed(0) + '%';
      console.log(`${lang.padEnd(12)} ${level.padEnd(9)} ${s.total.toString().padStart(3)} ${s.hallucinated.toString().padStart(5)} ${rate.padStart(6)} ${medChars.toString().padStart(10)} ${medThink.toString().padStart(10)}`);
    }
    console.log('');
  }

  // Summary: minimum level per language where hallucination rate = 0
  console.log('=== MINIMUM THINKING LEVEL PER LANGUAGE ===\n');
  for (const lang of langs) {
    let minLevel = 'NONE SUFFICIENT';
    for (const level of THINKING_LEVELS) {
      const key = `${lang}:${level}`;
      const s = table[key];
      if (s && s.hallucinated === 0) {
        minLevel = level;
        break;
      }
    }
    console.log(`  ${lang.padEnd(15)} ${minLevel}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  if (command === 'stats') { showStats(); return; }
  await runSweep();
}

main().catch(err => { console.error(err); process.exit(1); });
