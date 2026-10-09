#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-notes-free/run-arms.mjs (#5919) — the production prompt door through
// callGemini; reused here for three pages with no arms, no envelope (cost is cents, capped below) and the
// write-door transform applied after the call. scripts/maintenance/retranslate-pages.mjs — its dry run makes
// no model call, so it cannot show what the guard would store.
/**
 * #5902 live check: one untranslated page each of a Latin, a Chinese and an Arabic book, through the
 * production translation prompt and model routing, then through the same transform writePageTranslation
 * applies before `translation.data` is stored (sanitize → guard → unwrap → stray-script). Prints what WOULD
 * be stored. Writes nothing to pages.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/translation-write-guard-5902/live-dry.mjs [--pick-only]
 *
 * Output: results/translation-write-guard-5902/live-dry.json (raw model text, stored text, guard counts, cost).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import {
  loadTranslationPrompts, buildTranslationPrompt, getTranslateModelForBook, SAFETY_SETTINGS,
  sanitizeTranslationTags, isTranslatablePage, PAGE_BREAK_SCOPED,
} from '../../lib/translate-core.mjs';
import { guardTermDefinitions } from '../../lib/translation-write-guard.mjs';
import { unwrapHiddenTranslation } from '../../lib/hidden-translation.mjs';
import { strayScriptVerdict } from '../../lib/stray-script.mjs';
import { costOf } from '../../lib/model-pricing.mjs';

const PICK_ONLY = process.argv.includes('--pick-only');
const MAX_USD = 0.5;
const OUT = new URL('../results/translation-write-guard-5902/', import.meta.url).pathname;
const LANGS = ['Latin', 'Chinese', 'Arabic'];

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
try {
  const prompts = await loadTranslationPrompts(db);
  const picks = [];
  for (const lang of LANGS) {
    // A live book in this language with OCR'd, untranslated pages; the first translatable page past the front matter.
    const books = await db.collection('books').find(
      { language: lang, visible: true, pages_count: { $gt: 20 }, pages_translated: { $gt: 0 } },
      { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, image_source: 1, pages_count: 1, pages_translated: 1, pipeline_auto: 1 } }
    ).sort({ id: 1 }).limit(200).toArray();
    let pick = null;
    for (const book of books) {
      if (book.pipeline_auto?.held) continue;
      const page = await db.collection('pages').findOne(
        { book_id: book.id, page_number: { $gt: 10 }, 'ocr.data': { $type: 'string' }, $expr: { $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 600] },
          $or: [{ translation: null }, { 'translation.data': null }, { 'translation.data': '' }, { 'translation.data': { $exists: false } }] },
        { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1 }, sort: { page_number: 1 } }
      );
      if (!page || !isTranslatablePage(page).ok) continue;
      pick = { book, page }; break;
    }
    if (!pick) throw new Error(`no untranslated ${lang} page found`);
    console.log(`${lang.padEnd(8)} ${pick.book.id} p${pick.page.page_number}  ${(pick.book.display_title || pick.book.title || '').slice(0, 60)}  ocr=${pick.page.ocr.data.length} → ${getTranslateModelForBook(pick.book)}`);
    picks.push({ lang, ...pick });
  }
  if (PICK_ONLY) process.exit(0);

  let runUsd = 0;
  const results = [];
  for (const { lang, book, page } of picks) {
    if (runUsd > MAX_USD) throw new Error(`spend cap $${MAX_USD} reached`);
    const near = async (n) => (await db.collection('pages').findOne({ book_id: book.id, page_number: n }, { projection: { 'ocr.data': 1, 'translation.data': 1 } })) || {};
    const prev = await near(page.page_number - 1), next = await near(page.page_number + 1);
    const { prompt, promptRef } = buildTranslationPrompt({
      prompts, book, ocrText: page.ocr.data, previousTranslation: prev.translation?.data || null,
      prevOcrText: prev.ocr?.data, nextOcrText: next.ocr?.data, pageBreak: PAGE_BREAK_SCOPED,
    });
    const model = getTranslateModelForBook(book);
    // translate-worker: no temperature (model default 1), thinking off, the worker's output cap.
    const maxOutputTokens = Math.min(32768, Math.max(4096, page.ocr.data.length + 1200));
    const res = await callGemini({
      model, prompt, endpoint: 'scripts/eval/translation-write-guard-5902/live-dry.mjs', thinkingBudget: 0, temperature: 1,
      maxOutputTokens, safetySettings: SAFETY_SETTINGS, type: 'eval', bookId: book.id, pageIds: [page.id],
      promptVersion: `v${promptRef?.version}`, triggeredBy: 'guard-5902:live-dry',
    });
    const cost = costOf(model, res.inputTokens, res.outputTokens);
    runUsd += cost;
    // writePageTranslation's transform, step by step, so the guard's own change is visible.
    const sanitized = sanitizeTranslationTags(res.text);
    const guarded = guardTermDefinitions(sanitized);
    const unwrapped = unwrapHiddenTranslation({ ocr: page.ocr.data, tr: guarded.text, type: page.page_type }).text;
    const stored = strayScriptVerdict(unwrapped, { ocr: page.ocr.data, language: book.language });
    const after = stored.text;
    const r = {
      lang, book_id: book.id, page_id: page.id, page_number: page.page_number, model,
      prompt: { name: promptRef?.name, version: promptRef?.version },
      cost_usd: cost, inputTokens: res.inputTokens, outputTokens: res.outputTokens, finishReason: res.finishReason,
      guard: guarded.n, guard_changed: guarded.text !== sanitized, stray_refuse: !!stored.refuse,
      counts: {
        term: (after.match(/<term>/g) || []).length,
        term_with_colon_definition: (after.match(/<term>[^<\n]*?:\s+\p{L}[^<]*<\/term>/gu) || []).length,
        term_then_bracket: (after.match(/<\/term>[ \t]?\[/g) || []).length,
        term_then_gloss: (after.match(/<\/term>\s*<gloss/g) || []).length,
        note: (after.match(/<note>/g) || []).length,
      },
      raw: res.text, would_store: after,
    };
    results.push(r);
    console.log(`\n=== ${lang} ${book.id} p${page.page_number} ${model} $${cost.toFixed(4)} guard=${JSON.stringify(r.guard)} changed=${r.guard_changed}`);
    console.log(JSON.stringify(r.counts));
    console.log(after.slice(0, 1500));
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'live-dry.json', JSON.stringify({ run_at: new Date().toISOString(), total_usd: runUsd, results }, null, 1));
  console.log(`\ntotal $${runUsd.toFixed(4)} → ${OUT}live-dry.json (nothing written to pages)`);
} finally {
  await c.close();
}
