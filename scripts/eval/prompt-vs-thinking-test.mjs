#!/usr/bin/env node
/**
 * Prompt vs Thinking A/B Test
 *
 * Tests whether a simple prompt modification can prevent hallucination
 * as effectively as thinkingLevel: HIGH (which costs ~30% more).
 *
 * Arms:
 *   A: Lite, no thinking, standard prompt     (baseline — should hallucinate)
 *   B: Lite, thinkingLevel: HIGH, standard prompt  (known fix)
 *   C: Lite, no thinking, anti-hallucination prompt (free fix?)
 *   D: Lite, no thinking, length-constrained prompt (free fix?)
 */

import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

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

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const MODEL = 'gemini-3.1-flash-lite-preview';

// ── Prompts ──────────────────────────────────────────────────────────

const PROMPTS = {
  standard: 'Transcribe ALL text visible in this image using the appropriate Unicode script. Output ONLY the raw text. No commentary, no translation, no labels, no markdown.',

  anti_hallucination: `Transcribe the text visible in this image using the appropriate Unicode script.

CRITICAL RULES:
- ONLY transcribe text you can actually see on the page.
- STOP immediately when you reach the end of the visible text.
- Do NOT generate, continue, or fabricate any text beyond what is physically present.
- If a character is unclear, write [?]. Never guess at extended passages.
- A typical manuscript page contains 500-3000 characters. If your output exceeds 5000 characters, you are likely hallucinating.

Output ONLY the raw transcription. No commentary.`,

  length_constrained: `Transcribe the text visible in this image. Use the original script (Hebrew, Greek, Arabic, etc.).

IMPORTANT: This is a single page. Your transcription should be proportional to the visible text — typically 500 to 3000 characters. Output ONLY what you see. Stop when the page ends.`,

  minimal: 'OCR this page. Original script only. Stop at end of visible text.',
};

// ── Gemini API ───────────────────────────────────────────────────────

let keys = [];
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith('GEMINI_API_KEY') && v) keys.push(v);
}
keys = [...new Set(keys)];
let ki = 0;

async function callGemini(imageBuffer, prompt, thinking = false) {
  const apiKey = keys[ki++ % keys.length];
  const genConfig = { temperature: 0, maxOutputTokens: 16000 };
  if (thinking) genConfig.thinkingConfig = { thinkingLevel: 'HIGH' };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: imageBuffer.toString('base64') } },
        ]}],
        generationConfig: genConfig,
      }),
    }
  );

  if (resp.status === 429) throw new Error('RATE_LIMITED');
  const data = await resp.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('') || parts[0]?.text || '';
  const usage = data.usageMetadata || {};
  return {
    chars: text.length,
    thinkTokens: usage.thoughtsTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    inputTokens: usage.promptTokenCount || 0,
  };
}

// ── Main ─────────────────────────────────────────────────────────────

async function run() {
  // Pick 20 pages: 4 per language from the worst hallucinations
  const data = JSON.parse(fs.readFileSync('scripts/eval/results/hallucination-detections.json'));
  const det = data.detections;

  const testPages = [];
  const langCounts = {};
  for (const d of det) {
    const c = langCounts[d.language] || 0;
    if (c >= 4) continue;
    langCounts[d.language] = c + 1;
    testPages.push(d);
    if (testPages.length >= 20) break;
  }

  console.log(`=== PROMPT vs THINKING A/B TEST ===`);
  console.log(`Model: ${MODEL}`);
  console.log(`Pages: ${testPages.length}`);
  console.log(`Arms: A (standard), B (thinking:HIGH), C (anti-hallucination prompt), D (length-constrained)\n`);

  const ARMS = [
    { id: 'A', name: 'Standard', prompt: PROMPTS.standard, thinking: false },
    { id: 'B', name: 'Thinking HIGH', prompt: PROMPTS.standard, thinking: true },
    { id: 'C', name: 'Anti-hall prompt', prompt: PROMPTS.anti_hallucination, thinking: false },
    { id: 'D', name: 'Length-constrained', prompt: PROMPTS.length_constrained, thinking: false },
  ];

  console.log(`${'Lang'.padEnd(10)} ${'p#'.padStart(4)} ${'Original'.padStart(8)}  ${'A:Std'.padStart(7)} ${'B:Think'.padStart(7)} ${'C:Anti'.padStart(7)} ${'D:Short'.padStart(7)}`);
  console.log('-'.repeat(58));

  const results = [];

  for (const page of testPages) {
    // Get image
    const localPath = `/tmp/study2-images/${page.book_id}_p${page.page_number}.jpg`;
    let imgBuf;
    if (fs.existsSync(localPath)) {
      imgBuf = fs.readFileSync(localPath);
    } else {
      const { data: p } = await sb.from('pages')
        .select('archived_photo,photo')
        .eq('book_id', page.book_id).eq('page_number', page.page_number).single();
      const url = p?.archived_photo || p?.photo || `https://images.sourcelibrary.org/archived/${page.book_id}/${page.page_number}.jpg`;
      try {
        const r = await fetch(url);
        imgBuf = Buffer.from(await r.arrayBuffer());
      } catch {
        console.log(`  ${page.language} p${page.page_number} — SKIP (no image)`);
        continue;
      }
    }

    const row = { language: page.language, page: page.page_number, book_id: page.book_id, original: page.ocr_chars };

    for (const arm of ARMS) {
      let retries = 0;
      while (retries < 3) {
        try {
          const r = await callGemini(imgBuf, arm.prompt, arm.thinking);
          row[arm.id] = r.chars;
          row[arm.id + '_think'] = r.thinkTokens;
          break;
        } catch (e) {
          if (e.message === 'RATE_LIMITED') {
            retries++;
            await new Promise(r => setTimeout(r, 15000));
          } else {
            row[arm.id] = -1;
            console.error(`    ERROR ${arm.id}: ${e.message.slice(0, 80)}`);
            break;
          }
        }
      }
      await new Promise(r => setTimeout(r, 300));
    }

    results.push(row);

    const flag = (v) => v > 10000 ? `${v}!` : v.toString();
    console.log(
      `${page.language.padEnd(10)} ${('p' + page.page_number).padStart(4)} ${page.ocr_chars.toString().padStart(8)}  ${flag(row.A || 0).padStart(7)} ${flag(row.B || 0).padStart(7)} ${flag(row.C || 0).padStart(7)} ${flag(row.D || 0).padStart(7)}`
    );
  }

  // Summary
  console.log('\n=== SUMMARY ===\n');
  const hallThreshold = 10000;
  for (const arm of ARMS) {
    const hallCount = results.filter(r => (r[arm.id] || 0) > hallThreshold).length;
    const medChars = results.map(r => r[arm.id] || 0).sort((a, b) => a - b)[Math.floor(results.length / 2)];
    console.log(`${arm.id}: ${arm.name.padEnd(22)} hallucinated: ${hallCount}/${results.length} (${(hallCount / results.length * 100).toFixed(0)}%)  median chars: ${medChars}`);
  }

  // Save
  const outPath = 'scripts/eval/results/prompt-vs-thinking-test.json';
  fs.writeFileSync(outPath, JSON.stringify({ arms: ARMS.map(a => ({ id: a.id, name: a.name, prompt: a.prompt, thinking: a.thinking })), results, meta: { date: new Date().toISOString(), model: MODEL, pages: testPages.length } }, null, 2));
  console.log(`\nSaved: ${outPath}`);
}

run().catch(e => console.error(e));
