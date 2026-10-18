#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr.mjs apply and scripts/batch/cli-translate.mjs apply — the CLI writers this copies its
// guards and provenance from. Neither fits: cli-ocr refuses a read sharing under 40% of its words with the stored OCR
// (the stored flash-lite text on the Dresden Codex is a wrong description, so every leaf would be refused) and wants one
// transcription per call; cli-translate translates the stored OCR, whereas here ONE Opus reading of a leaf becomes both
// fields. scripts/batch/claude-ocr.mjs is the sealed `claude -p` reader whose claudeCall() the reading run used.
/**
 * Write structured READINGS of a pictorial / glyphic codex leaf (#6559: the Dresden Codex) as the page's text. One
 * Opus reading per leaf, made by `claude -p --model opus` on the subscription with the leaf's tiles and the
 * reference commentary's pages (the run's prompt is kept beside each reading), in five Markdown sections:
 *
 *   ## 1. Numerals   ## 2. Calendar signs   ## 3. Figures   ## 4. Glyph captions   ## 5. What <reference> says
 *
 * becomes
 *   ocr          a header (language, script, page type) + a provenance line + sections 1-4: the structured
 *                transcription (numerals by row/column with red/black and the arithmetic self-check, calendar signs,
 *                figures, glyph captions with [unread glyph]);
 *   translation  a provenance line + sections 3 and 5: the English account of the page, the reference's interpretation
 *                attributed and linked to its page.
 *
 *   node --env-file=.env.production.local scripts/batch/codex-reading-apply.mjs --out=DIR --book=ID \
 *        --reference-book=ID --reference-cite="Förstemann, Commentary on the Maya Manuscript … (1906)" \
 *        --codex-name="Dresden Codex" --reason="..." [--leaves=1,2,3] [--apply]
 *
 * DIR holds, per leaf, leafNN.md (the reading), leafNN.md.meta.json ({leaf, cp, model, code, cls, started_at,
 * finished_at, usage}) and leafNN.prompt.txt (the exact prompt sent). leaf = the page's page_number; cp = the codex's
 * own page number, which the provenance line names.
 *
 * Dry run unless --apply. Per leaf it refuses: a failed call, sections missing or out of order, a section 5 with no link
 * to the reference book, a repetition loop, a human-edited OCR or translation, a page whose OCR changed after the
 * reading started, and (inside the translation door) a translation the health gate refuses — the dry run runs that
 * gate too. A write snapshots the old OCR and translation to page_revisions, stamps an `anthropic` cli engine block
 * (claude version, model, prompt hash, the image, the reference pages) and `ocr.pipeline`, leaves one sweep_log row per
 * page and one book_events row per book, and recounts the book.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { saveRevisionBeforeOverwrite } from '../lib/page-revisions.mjs';
import { geminiEngine, engineNameForCli, imageInput, translationInput, ocrProvenance, notRecorded, contentHash, codeVersion, host } from '../lib/write-provenance.mjs';
import { liftOcrTags } from '../lib/ocr-result-parse.mjs';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { writePageTranslation, syncBookTranslationCounters, assessTranslationHealth } from '../lib/translate-core.mjs';

const CALL_SITE = 'scripts/batch/codex-reading-apply.mjs';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out') && path.resolve(arg('out'));
const BOOK = arg('book');
const REF_BOOK = arg('reference-book');
const REF_CITE = arg('reference-cite');
const CODEX = arg('codex-name') || 'the codex';
const REASON = arg('reason');
const APPLY = process.argv.includes('--apply');
const LEAVES = arg('leaves') ? new Set(arg('leaves').split(',').map(Number)) : null;
const LANE = arg('lane') || 'codex-reading-6559';
if (!OUT || !BOOK || !REF_BOOK || !REF_CITE || !REASON) { console.error('usage: codex-reading-apply.mjs --out=DIR --book=ID --reference-book=ID --reference-cite=TEXT --reason=TEXT [--codex-name=NAME] [--leaves=1,2] [--apply]'); process.exit(2); }

const SECTIONS = [/^## 1\. Numerals\s*$/m, /^## 2\. Calendar signs\s*$/m, /^## 3\. Figures\s*$/m, /^## 4\. Glyph captions\s*$/m, /^## 5\. What .+ says\s*$/m];

/** The five section bodies, or a reason the reading is refused. */
export function splitReading(md, refBook) {
  const t = String(md || '').trim();
  const at = SECTIONS.map((re) => { const m = t.match(re); return m ? { i: m.index, len: m[0].length } : null; });
  if (at.some((x) => !x)) return { why: `section ${at.findIndex((x) => !x) + 1} missing` };
  if (at.some((x, k) => k && x.i <= at[k - 1].i)) return { why: 'sections out of order' };
  if (t.slice(0, at[0].i).trim()) return { why: 'text before section 1' };
  const body = at.map((x, k) => t.slice(x.i + x.len, k + 1 < at.length ? at[k + 1].i : undefined).trim());
  if (body.some((b) => b.length < 2)) return { why: `section ${body.findIndex((b) => b.length < 2) + 1} empty` };
  if (!new RegExp(`sourcelibrary\\.org/book/${refBook}\\?page=\\d+`).test(body[4])) return { why: 'section 5 has no link to the reference book' };
  return { body, headings: at.map((x) => t.slice(x.i, x.i + x.len).trim()) };
}

export function composeOcr({ body, headings }, { codex, cp, leaf, refCite }) {
  return `<language>Maya hieroglyphic script</language>\n<script>handwritten</script>\n<page-type>text</page-type>\n\n`
    + `*${codex}, page ${cp} (leaf ${leaf} of this facsimile). A structured reading by Claude Opus, checked against ${refCite}. Numerals are read from the leaf; glyphs not identified with confidence are marked [unread glyph].*\n\n`
    + [0, 1, 2, 3].map((k) => `${headings[k]}\n\n${body[k]}`).join('\n\n');
}

export function composeTranslation({ body, headings }, { codex, cp, refCite }) {
  return `*${codex}, page ${cp}: what the page shows, and what ${refCite} says about it. The numerals, dates and glyph captions are in the transcription.*\n\n`
    + `## Figures\n\n${body[2]}\n\n## ${headings[4].replace(/^## 5\.\s*/, '')}\n\n${body[4]}`;
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const book = await db.collection('books').findOne({ id: BOOK });
if (!book) { console.error(`book ${BOOK} not found`); process.exit(2); }
const CLAUDE_VERSION = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout?.trim().split(' ')[0] || 'unknown';
const CODE_VERSION = await codeVersion();
const runId = `codex-reading-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
const tally = { written: 0, skipped: {}, written_page_ids: [] };
const skip = (leaf, why) => { tally.skipped[why] = (tally.skipped[why] || 0) + 1; console.log(`  skip leaf ${leaf}: ${why}`); };
const nums = [];
const models = new Set();

const files = fs.readdirSync(OUT).filter((f) => /^leaf\d+\.md$/.test(f)).sort();
for (const f of files) {
  const leaf = Number(f.match(/\d+/)[0]);
  if (LEAVES && !LEAVES.has(leaf)) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(OUT, `${f}.meta.json`), 'utf8'));
  if (meta.cls || meta.code !== 0) { skip(leaf, `call failed: ${meta.cls || meta.code}`); continue; }
  if (meta.leaf !== leaf) { skip(leaf, 'meta is for another leaf'); continue; }
  const promptFile = path.join(OUT, f.replace(/\.md$/, '.prompt.txt'));
  if (!fs.existsSync(promptFile)) { skip(leaf, 'no prompt file: the prompt sent is not on record'); continue; }
  const sent = fs.readFileSync(promptFile, 'utf8');
  if (!sent.includes(`codex page ${meta.cp}`)) { skip(leaf, 'prompt file is for another codex page'); continue; }
  const md = fs.readFileSync(path.join(OUT, f), 'utf8');
  const parts = splitReading(md, REF_BOOK);
  if (parts.why) { skip(leaf, parts.why); continue; }
  if (loopVerdict(md).refuse) { skip(leaf, 'repetition loop'); continue; }
  const page = await db.collection('pages').findOne({ book_id: BOOK, page_number: leaf }, { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, archived_photo: 1, photo: 1, ocr: 1, translation: 1 } });
  if (!page) { skip(leaf, 'page not found'); continue; }
  if (page.ocr?.edited_by || page.ocr?.source === 'manual') { skip(leaf, 'human-edited OCR'); continue; }
  if (page.translation?.edited_by || page.translation?.source === 'manual') { skip(leaf, 'human-edited translation'); continue; }
  if (meta.started_at && page.ocr?.updated_at && new Date(page.ocr.updated_at) > new Date(meta.started_at)) { skip(leaf, 'OCR rewritten after this reading started'); continue; }
  const ctx = { codex: CODEX, cp: meta.cp, leaf, refCite: REF_CITE };
  const ocrText = composeOcr(parts, ctx);
  const trText = composeTranslation(parts, ctx);
  const health = assessTranslationHealth(ocrText, trText, { lang: book.language });
  if (!health.healthy) { skip(leaf, `translation health gate: ${health.reason}`); continue; }
  const refPages = [...new Set([...parts.body[4].matchAll(new RegExp(`${REF_BOOK}\\?page=(\\d+)`, 'g'))].map((m) => Number(m[1])))];
  console.log(`  ${APPLY ? 'WRITE' : 'would write'} leaf ${leaf} = ${CODEX} p.${meta.cp}: ocr ${page.ocr?.data?.length ?? 0} -> ${ocrText.length} chars, translation ${page.translation?.data?.length ?? 0} -> ${trText.length} chars, reference pages ${refPages.join(',')}`);
  if (!APPLY) { tally.written++; continue; }

  const imageUrl = getPageSource(page);
  const base = {
    name: engineNameForCli('claude'), call_site: CALL_SITE, api: 'cli', cli: { name: 'claude', version: CLAUDE_VERSION }, model: meta.model,
    prompt: { id: LANE, name: `${CODEX} structured reading (image tiles + reference pages)`, version: '1', text: sent },
    generationConfig: notRecorded('claude -p exposes no temperature, output cap or thinking setting; the model id names the tier'),
    run: { job_id: runId, code_version: CODE_VERSION, host: host(), at: new Date(meta.finished_at || Date.now()), read_started_at: meta.started_at, read_site: 'claude -p (sealed, --tools Read)', reason: REASON },
  };
  const reference = { book_id: REF_BOOK, cite: REF_CITE, pages_cited: refPages };
  const ocrEngine = geminiEngine({ ...base, input: { ...imageInput({ url: imageUrl, mime: 'image/jpeg' }), tiles: 'overview + 3 full-width thirds + 6 half-width tiles, 5% overlap', reference, reading_hash: contentHash(md) } });
  await saveRevisionBeforeOverwrite(db, page.id, 'ocr', { reason: 'codex_reading', jobId: runId });
  const r = await db.collection('pages').updateOne(
    { id: page.id, 'ocr.updated_at': page.ocr?.updated_at ?? { $exists: false } },
    { $set: {
      ocr: { data: ocrText, language: page.ocr?.language ?? 'auto-detect', model: meta.model, updated_at: new Date(), source: 'ai', pipeline: LANE, ...ocrProvenance(ocrText, ocrEngine) },
      ...liftOcrTags(ocrText),
      updated_at: new Date(),
    } },
  );
  if (r.modifiedCount !== 1) { skip(leaf, 'page changed between read and write'); continue; }
  const fresh = await db.collection('pages').findOne({ id: page.id }, { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1 } });
  const trEngine = geminiEngine({ ...base, input: { ...translationInput({ ocrText: fresh.ocr.data, ocrUpdatedAt: fresh.ocr.updated_at, context: { derived_from: 'the same reading as the OCR (sections 3 and 5)', reading_hash: contentHash(md) } }), reference } });
  const res = await writePageTranslation(db, { page: fresh, book, text: trText, promptRef: { id: LANE, name: base.prompt.name, version: '1' }, model: meta.model, jobId: runId, note: 'codex_reading', refuseUnhealthy: true, engine: trEngine });
  if (!res.written && (res.protected || res.unhealthy)) console.log(`    translation NOT written: ${res.protected ? 'human-edited' : res.reason} (the OCR was)`);
  await recordSweepAction(db, { sweep: 'codex-reading', book_id: BOOK, action: 'codex-reading-written', detail: { page_id: page.id, page_number: leaf, codex_page: meta.cp, from_model: page.ocr?.model ?? null, to_model: meta.model, translation_written: !!res.written, run: runId, reason: REASON, reference } });
  nums.push(leaf);
  models.add(meta.model);
  tally.written++;
  tally.written_page_ids.push(page.id);
}

if (APPLY && nums.length) {
  await recountBook(db, BOOK, { reason: 'codex-reading' });
  await syncBookTranslationCounters(db, BOOK);
  await db.collection('book_events').insertOne({ book_id: BOOK, type: 'ocr_reread', at: new Date(), source: CALL_SITE, details: { run: runId, api: 'cli', models: [...models], pages: nums.length, page_numbers: nums.sort((a, b) => a - b), reason: REASON, reference_book: REF_BOOK, fields: ['ocr', 'translation'] } });
}
console.log(`\n${APPLY ? 'written' : 'would write'}: ${tally.written}   skipped: ${JSON.stringify(tally.skipped)}${APPLY ? `   run ${runId}` : '   (dry run; add --apply)'}`);
fs.writeFileSync(path.join(OUT, `apply-summary-${APPLY ? runId : 'dry'}.json`), JSON.stringify({ at: new Date().toISOString(), apply: APPLY, run: APPLY ? runId : null, reason: REASON, ...tally }, null, 1));
await client.close();
