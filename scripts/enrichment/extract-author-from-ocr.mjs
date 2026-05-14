#!/usr/bin/env node
/**
 * Infer author / editor from title-page OCR for BPH books whose author is
 * still "Unknown".
 *
 * Scope: books where image_source.provider === 'bph' AND author === 'Unknown'.
 *
 * For each book, the first 10 pages of OCR (the title-page region) are sent
 * to Gemini with a focused prompt asking for author, editor, translator,
 * compiler, plus a confidence + evidence quote.
 *
 * Apply rules:
 *   confidence=high                → set book.author (overwrites "Unknown"),
 *                                    set book.editor if present
 *   confidence=medium              → write to author_inferred / editor_inferred
 *                                    (the main fields are left alone)
 *   confidence=low                 → log only, no DB writes
 *   all-roles-null + high conf     → set anonymous_confirmed = true and
 *                                    author_confirmation_source = 'ai_ocr_review'
 *
 * The script is idempotent — books whose author is no longer "Unknown",
 * or which already have anonymous_confirmed / author_inferred from a
 * prior run, are skipped.
 *
 * Usage:
 *   node scripts/enrichment/extract-author-from-ocr.mjs --dry-run
 *   node scripts/enrichment/extract-author-from-ocr.mjs --apply
 *   node scripts/enrichment/extract-author-from-ocr.mjs --apply --limit 10
 *
 * Outputs:
 *   .claude/docs/bph-author-extraction-2026-05-11.json — per-book results
 *   .claude/docs/bph-author-extraction-2026-05-11.md   — markdown summary
 *
 * GitHub issue: #1682
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

// ── Config ──────────────────────────────────────────────────────────

const MODEL = 'gemini-3.1-flash-lite-preview';
const PAGES_PER_BOOK = 10; // title page lives in the first ~3-5 pages, 10 is safe
const PAGE_OCR_TRUNCATE = 2500; // per-page char cap — title pages are short
const CONCURRENCY = 8;
const DELAY_BETWEEN_BATCHES_MS = 400;

const REPORT_JSON = '.claude/docs/bph-author-extraction-2026-05-11.json';
const REPORT_MD = '.claude/docs/bph-author-extraction-2026-05-11.md';

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// ── Env ─────────────────────────────────────────────────────────────

function loadEnv() {
  const env = {};
  // Prefer .env.production.local (where prod Mongo + Gemini keys live), fall back to .env.local.
  for (const filename of ['.env.production.local', '.env.local']) {
    try {
      const envContent = fs.readFileSync(filename, 'utf8');
      for (const line of envContent.split('\n')) {
        const match = line.match(/^([^=#]+)=(.*)$/);
        if (match) {
          let value = match[2].trim();
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (!(match[1].trim() in env)) env[match[1].trim()] = value;
        }
      }
    } catch { /* file absent — ignore */ }
  }
  return { ...env, ...process.env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

function getApiKeys() {
  const keys = [];
  if (env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY);
  for (let i = 2; i <= 10; i++) {
    if (env[`GEMINI_API_KEY_${i}`]) keys.push(env[`GEMINI_API_KEY_${i}`]);
  }
  return keys;
}

const apiKeys = getApiKeys();
if (apiKeys.length === 0) { console.error('No GEMINI_API_KEY configured'); process.exit(1); }
let keyIndex = 0;

function getClient() {
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  return new GoogleGenerativeAI(key);
}

// ── Prompt ───────────────────────────────────────────────────────────

function extractUbn(book) {
  // BPH UBN is embedded in the IIIF manifest URL, e.g. .../records/11245_3_39944/manifest/
  const url = book.image_source?.iiif_manifest || book.image_source?.source_url || '';
  const m = url.match(/records\/([^/]+)/);
  return m ? m[1] : null;
}

function buildPrompt(book, ocrSamples) {
  const ubn = extractUbn(book);
  const ocrSection = ocrSamples.length > 0
    ? `\n\nOCR text from the first ${ocrSamples.length} pages of this book (the title page is normally somewhere in pages 1-5):\n\n` +
      ocrSamples.map(s => `--- Page ${s.pageNumber} ---\n${s.text}`).join('\n\n')
    : '\n\n(No OCR text available.)';

  return `You are a rare books librarian helping identify authorship of an early modern book whose author record is currently "Unknown".

Book metadata:
- Title: "${book.display_title || book.title || 'Unknown'}"
- Original title: "${book.title || 'Unknown'}"
- Current author field: ${book.author || 'Unknown'}
- Language: ${book.language || 'Unknown'}
- Year: ${book.year || book.published || 'Unknown'}
- BPH UBN: ${ubn || 'Unknown'}
${ocrSection}

Your task: read the title page text and identify whoever is named as author, editor, translator, or compiler. Respond with strict JSON only — no markdown fences, no commentary.

{
  "author": "<Library-of-Congress-style name 'Surname, Given' — the author of the underlying work — or null>",
  "editor": "<editor's name, same format, or null>",
  "translator": "<translator's name, same format, or null>",
  "compiler": "<compiler's name, same format, or null>",
  "confidence": "<high | medium | low>",
  "evidence": "<a short quoted phrase from the OCR that supports the finding — keep it under ~120 chars>",
  "reasoning": "<1-2 sentences explaining how the title page supports the identification (or anonymity)>"
}

Rules:
- Names go surname-first with a comma: "Boehme, Jakob", "Luther, Martin", "Wessling, Johann".
- Use the historically attested form of the name, not a modern Anglicisation.
- If the title page is genuinely anonymous (apocrypha, anonymous pamphlets, Bibles, certain prayer books, biblical books that name no compiler), return null for every role field and set confidence to "high", with reasoning that explains why (e.g. "Title page names no author; this is a Bible printing and the canonical books are anonymous by tradition").
- Bibles, prayer books, catechisms, and liturgical works frequently DO name a translator or editor on the title page (Luther, Tyndale, Wessling, Schmolck, etc.). Look carefully before declaring something anonymous.
- Do not anachronistically attribute a modern editor to a pre-1800 work. If a name appears only in a modern library annotation rather than the historical title page, ignore it.
- "high" means the title page clearly states the role. "medium" means the OCR is suggestive but ambiguous (e.g. damaged text, a name in a preface). "low" means a guess.
- The evidence quote MUST be present verbatim in the supplied OCR. If you can't find a supporting quote, downgrade your confidence.`;
}

// ── Core extraction ─────────────────────────────────────────────────

async function extractAuthor(book, ocrSamples) {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
    },
  });

  const prompt = buildPrompt(book, ocrSamples);
  const startTime = Date.now();
  const result = await model.generateContent(prompt);
  const durationMs = Date.now() - startTime;

  const response = result.response;
  const candidates = response.candidates || [];
  const allParts = candidates[0]?.content?.parts || [];
  const fullText = allParts.map(p => p.text || '').join('');
  const text = (fullText.trim() || response.text().trim());
  const usage = response.usageMetadata || {};

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); }
      catch { return { error: 'parse_failed', raw_response: text.substring(0, 500), pages_checked: ocrSamples.length, usage, duration_ms: durationMs }; }
    } else {
      return { error: 'parse_failed', raw_response: text.substring(0, 500), pages_checked: ocrSamples.length, usage, duration_ms: durationMs };
    }
  }

  return {
    ...parsed,
    pages_checked: ocrSamples.length,
    usage: {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0,
    },
    duration_ms: durationMs,
  };
}

// ── Cost ─────────────────────────────────────────────────────────────

function calculateCost(usage) {
  // gemini-3.1-flash-lite-preview pricing — matches enrich-metadata-text.mjs
  const inputCostPer1M = 0.15;
  const outputCostPer1M = 0.60;
  return (
    (usage.input_tokens / 1_000_000) * inputCostPer1M +
    (usage.output_tokens / 1_000_000) * outputCostPer1M
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function normalizeName(n) {
  if (typeof n !== 'string') return null;
  const trimmed = n.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  // Treat common null-ish responses as missing.
  if (['null', 'none', 'unknown', 'n/a', 'anonymous'].includes(lower)) return null;
  return trimmed;
}

function classifyOutcome(result) {
  const author = normalizeName(result.author);
  const editor = normalizeName(result.editor);
  const translator = normalizeName(result.translator);
  const compiler = normalizeName(result.compiler);
  const conf = (result.confidence || '').toLowerCase();
  const anyRole = author || editor || translator || compiler;

  if (!anyRole && conf === 'high') return { kind: 'anonymous_confirmed', author, editor, translator, compiler, conf };
  if (conf === 'high' && author) return { kind: 'auto_apply', author, editor, translator, compiler, conf };
  if (conf === 'high' && !author && (editor || translator || compiler)) {
    // High confidence in editor/translator but no author — still useful, apply editor field and confirm anonymous-author.
    return { kind: 'apply_editor_only', author, editor, translator, compiler, conf };
  }
  if (conf === 'medium' && anyRole) return { kind: 'inferred_only', author, editor, translator, compiler, conf };
  return { kind: 'low_or_empty', author, editor, translator, compiler, conf };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 200;

  console.log('=== BPH author/editor extraction from OCR ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN (use --apply to write)' : 'APPLYING CHANGES'}`);
  console.log(`Model: ${MODEL}`);
  console.log(`OCR pages per book: ${PAGES_PER_BOOK}`);
  console.log(`API keys: ${apiKeys.length}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Limit: ${limit}\n`);

  const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  const db = mongoClient.db(MONGODB_DB);

  // Idempotency: skip books that already moved past "Unknown" or were
  // resolved (anonymous_confirmed) or inferred (author_inferred) in a prior run.
  const filter = {
    'image_source.provider': 'bph',
    author: 'Unknown',
    anonymous_confirmed: { $ne: true },
    author_inferred: { $exists: false },
  };

  const books = await db.collection('books')
    .find(filter)
    .sort({ pages_count: -1 })
    .limit(limit)
    .toArray();

  console.log(`Found ${books.length} BPH books with author='Unknown' (after idempotency filter)\n`);

  if (books.length === 0) {
    await mongoClient.close();
    return;
  }

  // Stats
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skippedNoOcr = 0;
  let autoApplied = 0;
  let inferredOnly = 0;
  let anonymousConfirmed = 0;
  let lowOrEmpty = 0;
  let totalCost = 0;
  const reportRows = [];

  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.allSettled(batch.map(async (book) => {
      const pages = await db.collection('pages')
        .find(
          { book_id: book.id, 'ocr.data': { $exists: true, $ne: '' } },
          { projection: { page_number: 1, 'ocr.data': 1 } }
        )
        .sort({ page_number: 1 })
        .limit(PAGES_PER_BOOK)
        .toArray();

      if (pages.length === 0) {
        return { book, noOcr: true };
      }

      const ocrSamples = pages.map(p => ({
        pageNumber: p.page_number,
        text: (p.ocr?.data || '').substring(0, PAGE_OCR_TRUNCATE),
      }));

      try {
        const result = await extractAuthor(book, ocrSamples);
        return { book, result };
      } catch (err) {
        return { book, error: err.message };
      }
    }));

    for (const r of batchResults) {
      processed++;
      if (r.status === 'rejected') {
        failed++;
        console.log(`  [${processed}/${books.length}] FAIL ${r.reason}`);
        continue;
      }

      const { book, result, error, noOcr } = r.value;
      const shortTitle = (book.display_title || book.title || '').substring(0, 50);

      if (noOcr) {
        skippedNoOcr++;
        console.log(`  [${processed}/${books.length}] SKIP_NO_OCR  ${shortTitle}`);
        reportRows.push({
          id: book.id, title: book.title, display_title: book.display_title,
          year: book.year || book.published || null, language: book.language || null,
          ubn: extractUbn(book),
          status: 'skipped_no_ocr', before_author: book.author,
        });
        continue;
      }

      if (error || result?.error) {
        failed++;
        const msg = error || result.error;
        console.log(`  [${processed}/${books.length}] FAIL ${shortTitle} — ${msg}`);
        reportRows.push({
          id: book.id, title: book.title, display_title: book.display_title,
          year: book.year || book.published || null, language: book.language || null,
          ubn: extractUbn(book),
          status: 'failed', error: msg, before_author: book.author,
        });
        continue;
      }

      succeeded++;
      const cost = result.usage ? calculateCost(result.usage) : 0;
      totalCost += cost;

      const outcome = classifyOutcome(result);
      const ubn = extractUbn(book);
      const row = {
        id: book.id,
        title: book.title,
        display_title: book.display_title,
        year: book.year || book.published || null,
        language: book.language || null,
        ubn,
        before_author: book.author,
        before_editor: book.editor || null,
        ai_author: outcome.author,
        ai_editor: outcome.editor,
        ai_translator: outcome.translator,
        ai_compiler: outcome.compiler,
        confidence: result.confidence,
        evidence: result.evidence,
        reasoning: result.reasoning,
        cost_usd: cost,
      };

      const updates = {};
      const fieldProv = book.field_provenance || {};
      const provBase = {
        source: 'ai_ocr_review',
        model: MODEL,
        date: new Date(),
        confidence: result.confidence,
        evidence: result.evidence,
        reasoning: result.reasoning,
        pages_checked: result.pages_checked,
        script: 'extract-author-from-ocr.mjs',
      };

      if (outcome.kind === 'auto_apply') {
        autoApplied++;
        row.status = 'auto_applied';
        updates.author = outcome.author;
        fieldProv.author = { ...provBase, previous_value: book.author };
        if (outcome.editor) {
          updates.editor = outcome.editor;
          fieldProv.editor = { ...provBase, previous_value: book.editor || null };
        }
        if (outcome.translator) {
          updates.translator = outcome.translator;
          fieldProv.translator = { ...provBase, previous_value: book.translator || null };
        }
        console.log(`  [${processed}/${books.length}] APPLY  ${shortTitle}`);
        console.log(`      author: ${book.author} -> ${outcome.author}${outcome.editor ? ` | editor: ${outcome.editor}` : ''} | conf=${outcome.conf}`);
      } else if (outcome.kind === 'apply_editor_only') {
        // High confidence editor/translator but no author named — record editor and mark anonymous-author.
        autoApplied++;
        row.status = 'auto_applied_editor_only';
        if (outcome.editor) {
          updates.editor = outcome.editor;
          fieldProv.editor = { ...provBase, previous_value: book.editor || null };
        }
        if (outcome.translator) {
          updates.translator = outcome.translator;
          fieldProv.translator = { ...provBase, previous_value: book.translator || null };
        }
        updates.anonymous_confirmed = true;
        updates.author_confirmation_source = 'ai_ocr_review';
        fieldProv.author = { ...provBase, previous_value: book.author, note: 'anonymous_author_confirmed' };
        console.log(`  [${processed}/${books.length}] EDITOR ${shortTitle}`);
        console.log(`      editor: ${outcome.editor || '—'} | translator: ${outcome.translator || '—'} (author anonymous, conf=${outcome.conf})`);
      } else if (outcome.kind === 'anonymous_confirmed') {
        anonymousConfirmed++;
        row.status = 'anonymous_confirmed';
        updates.anonymous_confirmed = true;
        updates.author_confirmation_source = 'ai_ocr_review';
        fieldProv.author = { ...provBase, previous_value: book.author, note: 'anonymous_confirmed' };
        console.log(`  [${processed}/${books.length}] ANON   ${shortTitle} — ${(result.reasoning || '').substring(0, 80)}`);
      } else if (outcome.kind === 'inferred_only') {
        inferredOnly++;
        row.status = 'inferred_only';
        // Medium confidence — never overwrite author/editor; write to _inferred shadow fields.
        updates.author_inferred = {
          value: outcome.author,
          editor: outcome.editor,
          translator: outcome.translator,
          compiler: outcome.compiler,
          confidence: outcome.conf,
          evidence: result.evidence,
          reasoning: result.reasoning,
          model: MODEL,
          extracted_at: new Date(),
          script: 'extract-author-from-ocr.mjs',
        };
        if (outcome.editor) {
          updates.editor_inferred = {
            value: outcome.editor,
            confidence: outcome.conf,
            evidence: result.evidence,
            model: MODEL,
            extracted_at: new Date(),
          };
        }
        console.log(`  [${processed}/${books.length}] INFER  ${shortTitle}`);
        console.log(`      ai_author: ${outcome.author || '—'} | editor: ${outcome.editor || '—'} | conf=${outcome.conf}`);
      } else {
        lowOrEmpty++;
        row.status = 'low_or_empty';
        console.log(`  [${processed}/${books.length}] LOW    ${shortTitle} — conf=${outcome.conf}, author=${outcome.author || '—'}`);
      }

      reportRows.push(row);

      if (!dryRun && Object.keys(updates).length > 0) {
        updates.updated_at = new Date();
        updates.field_provenance = fieldProv;
        try {
          await db.collection('books').updateOne({ id: book.id }, { $set: updates });
          await db.collection('gemini_usage').insertOne({
            timestamp: new Date(),
            type: 'other',
            mode: 'realtime',
            model: MODEL,
            book_id: book.id,
            book_title: book.display_title || book.title,
            page_count: result.pages_checked,
            input_tokens: result.usage?.input_tokens || 0,
            output_tokens: result.usage?.output_tokens || 0,
            cost_usd: cost,
            status: 'success',
            duration_ms: result.duration_ms,
            endpoint: 'script/extract-author-from-ocr',
          });
        } catch (dbErr) {
          console.log(`    [DB ERROR] ${dbErr.message}`);
          failed++;
          succeeded--;
        }
      }
    }

    if (i + CONCURRENCY < books.length) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('\n=== SUMMARY ===');
  console.log(`Processed:           ${processed}`);
  console.log(`Succeeded:           ${succeeded}`);
  console.log(`Failed:              ${failed}`);
  console.log(`Skipped (no OCR):    ${skippedNoOcr}`);
  console.log(`Auto-applied:        ${autoApplied}`);
  console.log(`Inferred-only:       ${inferredOnly}`);
  console.log(`Anonymous confirmed: ${anonymousConfirmed}`);
  console.log(`Low/empty:           ${lowOrEmpty}`);
  console.log(`Total cost:          $${totalCost.toFixed(4)}`);

  // ── Write report files ───────────────────────────────────────────
  try {
    fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  } catch { /* ok */ }

  const reportPayload = {
    generated_at: new Date().toISOString(),
    mode: dryRun ? 'dry-run' : 'apply',
    model: MODEL,
    summary: {
      processed, succeeded, failed,
      skipped_no_ocr: skippedNoOcr,
      auto_applied: autoApplied,
      inferred_only: inferredOnly,
      anonymous_confirmed: anonymousConfirmed,
      low_or_empty: lowOrEmpty,
      total_cost_usd: Number(totalCost.toFixed(4)),
    },
    books: reportRows,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportPayload, null, 2));
  console.log(`\nReport JSON: ${REPORT_JSON}`);

  // Markdown summary
  const md = [];
  md.push(`# BPH author extraction — ${new Date().toISOString().slice(0, 10)}`);
  md.push('');
  md.push(`Mode: ${dryRun ? '**DRY RUN**' : '**APPLIED**'}`);
  md.push(`Model: \`${MODEL}\``);
  md.push('');
  md.push('## Summary');
  md.push('');
  md.push(`| metric | count |`);
  md.push(`| --- | ---: |`);
  md.push(`| processed | ${processed} |`);
  md.push(`| succeeded | ${succeeded} |`);
  md.push(`| failed | ${failed} |`);
  md.push(`| skipped (no OCR) | ${skippedNoOcr} |`);
  md.push(`| auto-applied | ${autoApplied} |`);
  md.push(`| inferred-only (review) | ${inferredOnly} |`);
  md.push(`| anonymous confirmed | ${anonymousConfirmed} |`);
  md.push(`| low / empty | ${lowOrEmpty} |`);
  md.push(`| total cost (USD) | $${totalCost.toFixed(4)} |`);
  md.push('');

  const sections = [
    ['Auto-applied (author/editor written)', ['auto_applied', 'auto_applied_editor_only']],
    ['Inferred-only (pending review)', ['inferred_only']],
    ['Anonymous confirmed', ['anonymous_confirmed']],
    ['Low confidence / empty (no DB write)', ['low_or_empty']],
    ['Skipped — no OCR', ['skipped_no_ocr']],
    ['Failed', ['failed']],
  ];
  for (const [heading, statuses] of sections) {
    const rows = reportRows.filter(r => statuses.includes(r.status));
    if (rows.length === 0) continue;
    md.push(`## ${heading} (${rows.length})`);
    md.push('');
    md.push('| Title | Year | Lang | AI author | AI editor | Confidence | Evidence |');
    md.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) {
      const t = (r.display_title || r.title || '').replace(/\|/g, '\\|').substring(0, 60);
      const ev = (r.evidence || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').substring(0, 80);
      md.push(`| ${t} | ${r.year ?? ''} | ${r.language ?? ''} | ${r.ai_author ?? ''} | ${r.ai_editor ?? ''} | ${r.confidence ?? ''} | ${ev} |`);
    }
    md.push('');
  }

  fs.writeFileSync(REPORT_MD, md.join('\n'));
  console.log(`Report MD:   ${REPORT_MD}`);

  if (dryRun) console.log('\n(Dry run — use --apply to write to DB.)');
  await mongoClient.close();
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
