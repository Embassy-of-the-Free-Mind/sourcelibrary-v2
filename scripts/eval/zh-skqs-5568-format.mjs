#!/usr/bin/env node
/**
 * PRIOR ART: the #5547 pilot's writer dry-run (zh-cohort-5547-pilot.mjs — `loopVerdict` and
 * `missingProvenance` on 5 pages, one per book; it does not run the translation lane's gates, the
 * fields the OCR collector derives from the text, or look at what Paddle puts in the text);
 * scripts/lib/syriac-kraken-lane.mjs `ocrSetFields` / `envelope` (the specialist-lane write this
 * dry-run imitates). Pure functions only — no Mongo writes, no Gemini.
 *
 * #5568 test 3 — would PaddleOCR-VL's raw output pass the production OCR writer and the translation
 * lane unchanged? Every page of every pilot volume read to ≥ 90 %, through the same checks the
 * collector (scripts/batch/collect-batch-results.mjs) and translate-core apply, plus a scan for
 * what Paddle writes that a Gemini read does not (kana from the 版心 margin, markup, empties).
 *
 *   node scripts/eval/zh-skqs-5568-format.mjs [--pilot=/root/zh-ocr-eval-5547/pilot] [--dir=/root/zh-skqs-5568]
 *   node --env-file=… scripts/eval/zh-skqs-5568-format.mjs --prod-sample   (reads 3 stored lite pages to show the envelope)
 */
import fs from 'fs';
import path from 'path';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';
import { extractPageType, extractColumns, parseDetectedImages } from '../lib/ocr-result-parse.mjs';
import { missingProvenance, contentHash } from '../lib/write-provenance.mjs';
import { isTranslatablePage, hasTranslatableSource, isBlankFromOcr, isDegenerateSource, bodyLen, buildTranslationPrompt } from '../lib/translate-core.mjs';
import { unverifiedScriptShare } from '../lib/stale-translation.mjs';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const PILOT = argOf('pilot', '/root/zh-ocr-eval-5547/pilot');
const DIR = argOf('dir', '/root/zh-skqs-5568');

if (process.argv.includes('--prod-sample')) {
  const { connect, disconnect } = await import('./lib/sampling.mjs');
  const { db } = await connect();
  const ids = JSON.parse(fs.readFileSync(path.join(PILOT, '..', 'cohort.json'), 'utf8'));
  const inflight = (ids.inflight || []).map(x => x.id || x.book_id || x).slice(0, 120);
  const pages = await db.collection('pages').find({ book_id: { $in: inflight }, 'ocr.data': { $exists: true, $ne: '' }, 'ocr.model': /gemini/ }, { projection: { _id: 0, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, page_type: 1 } }).limit(3).toArray();
  for (const p of pages) console.log(JSON.stringify({ book_id: p.book_id, page: p.page_number, model: p.ocr.model, source: p.ocr.source, page_type: p.page_type, head: p.ocr.data.slice(0, 400) }));
  await disconnect();
  process.exit(0);
}

const books = JSON.parse(fs.readFileSync(path.join(PILOT, 'books.json'), 'utf8')).books;
const KANA = /[぀-ヿ]/u;
const MARKUP = /<(?!\/?(?:column-break)\b)[a-z][^>]*>|^\s*#{1,6}\s|\|\s*-{3,}|\\\(|\$\$|!\[/m;
const MARGIN = /四庫全書/;
const now = new Date('2026-10-01T00:00:00Z');
const c = { pages: 0, books: 0, empty: 0, over_25k: 0, loop_refuse: 0, page_type: 0, columns: 0, detected_images: 0, translatable: 0, not_translatable: {}, blank_from_ocr: 0, degenerate: 0, unverified_script: 0, kana_pages: 0, markup_pages: 0, margin_line_pages: 0, han_chars: 0, provenance_missing_as_paddle: 0, provenance_missing_without_engine: 0, wrappers_stripped_changes_text: 0 };
const examples = { kana: [], markup: [] };
let promptOk = null;
for (const b of books) {
  const dir = path.join(PILOT, 'out', b.book_id);
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => /^\d+\.txt$/.test(f)).sort();
  if (files.length < 0.9 * (b.pages_count || 1)) continue;
  c.books++;
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const pn = +f.slice(0, -4);
    c.pages++;
    if (!text.trim()) { c.empty++; }
    if (text.length > 25000) c.over_25k++;
    if (loopVerdict(text).refuse) c.loop_refuse++;
    if (extractPageType(text)) c.page_type++;
    if (extractColumns(text)) c.columns++;
    if (parseDetectedImages(text).length) c.detected_images++;
    const page = { page_number: pn, ocr: { data: text }, page_type: undefined };
    const t = isTranslatablePage(page);
    if (t.ok) c.translatable++; else c.not_translatable[t.reason] = (c.not_translatable[t.reason] || 0) + 1;
    if (isBlankFromOcr(text)) c.blank_from_ocr++;
    if (isDegenerateSource(text)) c.degenerate++;
    if (unverifiedScriptShare(text).share >= 0.3) c.unverified_script++;
    if (KANA.test(text)) { c.kana_pages++; if (examples.kana.length < 6) examples.kana.push({ book: b.book_id, page: pn, line: text.split('\n').find(l => KANA.test(l)) }); }
    if (/<img\b/.test(text)) c.img_tag_pages = (c.img_tag_pages || 0) + 1;
    if (/<table\b/.test(text)) c.table_tag_pages = (c.table_tag_pages || 0) + 1;
    if (MARKUP.test(text)) { c.markup_pages++; if (examples.markup.length < 6) examples.markup.push({ book: b.book_id, page: pn, line: text.split('\n').find(l => MARKUP.test(l))?.slice(0, 80) }); }
    if (text.split('\n').some(l => MARGIN.test(l))) c.margin_line_pages++;
    if (stripEditorialWrappers(text).trim() !== text.trim()) c.wrappers_stripped_changes_text++;
    c.han_chars += [...text].filter(ch => /\p{Script=Han}/u.test(ch)).length;
    // The $set a Paddle lane would write, shaped like the Syriac Kraken lane's (specialist engine block).
    const sub = { data: text, source: 'paddle', updated_at: now, content_hash: contentHash(text), engine: { name: 'paddleocr-vl', model: 'PaddleOCR-VL-1.6', run: 'paddle-zh-pilot' } };
    if (missingProvenance('ocr', sub).missing.length) c.provenance_missing_as_paddle++;
    // the same text with NO engine block at all, under an unlisted source: does the checker notice?
    if (missingProvenance('ocr', { data: text, source: 'paddle', updated_at: now, content_hash: contentHash(text) }).missing.length) c.provenance_missing_without_engine++;
    if (promptOk === null && t.ok) {
      const prompts = { translation: { text: 'Translate this {source_language} text into {target_language}.', ref: {} }, english: { text: '', ref: {} } };
      const { prompt } = buildTranslationPrompt({ prompts, book: { title: b.title, language: 'Chinese' }, ocrText: text });
      promptOk = { ok: prompt.includes(text), chars: prompt.length, body_len: bodyLen(text) };
    }
  }
}
const out = { ...c, examples, build_translation_prompt: promptOk };
out.note_provenance = 'missingProvenance treats any source outside {ai,batch_api,pipeline_preview,kraken,bdrc,mineru,ia_djvu} as content_hash+updated_at only — a paddle write with no engine block passes';
fs.writeFileSync(path.join(DIR, 'format.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
