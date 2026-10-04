#!/usr/bin/env node
// PRIOR ART: scripts/lib/translation-text-repair.mjs (repairTranslationText / resyncMirrors) — the
// guarded door every stored-translation repair goes through; used as-is. scripts/maintenance/
// fix-unclosed-note-tags.mjs — the #5644 repair; this script only DERIVES its page list and runs it.
// scripts/eval/tengyur-pilot-qa/mechanical.mjs (PR #5676) — defines the three defects (hash_leak,
// note_unbalanced, D_dropped); the `#` rule below is its hashLeak rule. Nothing existing strips a
// leaked Esukhia `#` from English.
/**
 * The $0 repairs after the Derge Tengyur draft run (#5497, QA finding 3). Deterministic, no model,
 * no retranslation. Dry run by default.
 *
 *   1. `#` — Esukhia peydurma note points the model carried into the English as pseudo-emphasis
 *      ("the #dispositions of all realms#"). Every `#` (and `\#`) is removed except a Markdown
 *      heading marker (1–6 `#` at line start followed by a space). One page_revisions row per page
 *      (repairTranslationText: human-edited pages skipped, conditional write, before/after hash).
 *   2. Unclosed / malformed `<note>` — the page list (noteTagBalance not balanced) is handed to
 *      scripts/maintenance/fix-unclosed-note-tags.mjs, which writes its own revision rows. Run
 *      after step 1, so it reads the text step 1 left.
 *   3. `{D####}` Tohoku text openings lost in the English — NOT written. The reader renders no
 *      text-boundary marker (nothing under src/ reads one), and the opening of every text is already
 *      recorded per page in `ocr.text_edition.tohoku` by the import. Inventing markup in the English
 *      would show as literal braces. This step only verifies that field covers every page whose
 *      source carries a `{D…}` marker, and reports the pages whose English dropped it.
 *
 *   node --env-file=.env.production.local scripts/maintenance/tengyur-draft-repairs-5497.mjs [--apply] [--out=FILE]
 *
 * `--leftovers` (#5797) runs three further deterministic repairs instead, one page_revisions row per page:
 *   4. Esukhia correction pairs `{a,b}` / `(a,b)` leaked into the English (mechanical.mjs corrLeak).
 *      A pair becomes `b`, the editors' reading (as mechanical.mjs cleanSource reads it); inside a
 *      <note>/<gloss>/<meta> that talks about the markup ("two spellings", "corrected to") it becomes
 *      `a / b`, so the note keeps its meaning.
 *   5. The false `<unclear>` on a page-final broken word. The source is a complete e-text, so a side
 *      ending mid-sentence continues on the next side; nothing is illegible. When the LAST thing in the
 *      body is `<unclear>` whose content only describes a gap ("…", "one line of text not
 *      transcribed") and the source side does not end on a `[x]` doubtful mark, the tag becomes "…".
 *      An `<unclear>` that wraps English words (a rendering of the fragment, or a guess at it) is
 *      LISTED, not repaired: unwrapping would present a guess as the translation.
 *   6. A `<note` whose content was written as an attribute (`<note original: "…">`) and never closed
 *      becomes `<note>original: …</note>`.
 * It skips v74–79 and v194–213 (job tengyur-finish-5497) and every book with an open
 * translate_batch_runs run, re-checked per book just before writing.
 *
 *   node --env-file=… scripts/maintenance/tengyur-draft-repairs-5497.mjs --leftovers [--apply] [--out=FILE]
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { repairTranslationText, resyncMirrors, noteTagBalance } from '../lib/translation-text-repair.mjs';

const APPLY = process.argv.includes('--apply');
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) || '/tmp/tengyur-draft-repairs-5497.json';
const HOLD = 'tengyur-import-5497';
const ISSUE = 5497;

/** Remove leaked Esukhia `#` marks; keep Markdown heading markers. */
export function stripHashMarks(text) {
  return String(text).split('\n').map((line) => {
    if (/https?:\/\//.test(line)) return line;
    // A heading marker may follow the reader's centring arrow: "-># Title<-".
    const head = line.match(/^(?:->\s*)?#{1,6} /)?.[0] || '';
    const rest = line.slice(head.length);
    if (!rest.includes('#')) return line;
    // A space survives only between two words: never at either end, never before punctuation or a tag.
    return head + rest.replace(/ ?\\?#+ ?/g, (m, at, s) => {
      const before = s[at - 1], after = s[at + m.length];
      return m.includes(' ') && before !== undefined && after !== undefined && !/[\s.,;:!?)\]<]/.test(after) && !/[\s(\[>]/.test(before) ? ' ' : '';
    });
  }).join('\n');
}

const TIB = /[ༀ-࿿]/;
const PAIR = /[({]([^(){},\n]{0,40}),([^(){},\n]{0,40})[)}]/g;
const MARKUP_TALK = /\bOCR\b|variant|spelling|correct|\breads?\b|\btwo\b|alternat|emend|transcri|curly|bracket|scribal|edition/i;

/**
 * 4. Resolve leaked Esukhia correction pairs. In running text and plain notes a pair becomes `b`, the
 * editors' reading. In a note that discusses the markup ("variant spellings", "the OCR reads") it
 * becomes `a / b`, so the note still says what it said; dropping such a note would hide the one sign
 * that the English followed the uncorrected reading (v169 p406: "this meadow" for དེ་རིང་, today).
 */
export function fixCorrectionPairs(text) {
  // Both readings Tibetan: a model's own "(རྫུན་, false)" gloss is not an Esukhia pair.
  const isPair = (a, b) => TIB.test(a) && TIB.test(b);
  let resolved = 0, kept_both = 0;
  let out = String(text).replace(/<(note|gloss|meta)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m) => {
    if (!MARKUP_TALK.test(m)) return m;
    return m.replace(PAIR, (pm, a, b) => { if (!isPair(a, b)) return pm; kept_both++; return `${a.trim()} / ${b.trim()}`; });
  });
  out = out.replace(PAIR, (m, a, b) => {
    if (!isPair(a, b)) return m;
    resolved++;
    return b.trim();
  });
  return { text: out, resolved, kept_both };
}

const GAP_TALK = /obscur|illegib|unreadable|missing|cut off|continu|incomplete|\blines?\b|\btext\b|\bwords?\b|syllable|fragment|partial|broken|damag|next (?:page|side)|truncat|transcri|character|lacuna|not visible|\bends?\b/i;
const GAP_OPENS = /^(?:\.\.\.|…|\[|\(|(?:one|two|three) (?:or|line|lines|word|words|syllable|syllables|character|characters|half|more|partial|incomplete|broken|truncated|illegible|unclear|continu)|a few\b|few\b|several\b|half\b|\d|remain|rest\b|final\b|last\b|end\b|text\b|sentence\b|lines?\b|words?\b|syllables?\b|characters?\b|unclear\b|unreadable\b|illegible\b|unfinished\b|incomplete\b|portion\b|continu|partial|not (?:transcribed|legible|visible|fully)|the (?:line|text|sentence|rest|remainder|remaining|final|last|next|following)\b|is continued\b|missing\b|obscured\b|cut off\b|truncated\b|broken (?:off|text|line|word)|page break|end of)/i;
const TAIL_TAGS = /<(summary|keywords|meta|vocab|vocabulary)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * 5. Classify (and for the gap-description class, repair) a page-final `<unclear>`.
 * @returns {{kind: 'none'|'not_final'|'src_doubtful'|'words'|'gap', text: string, content?: string}}
 */
export function fixFinalUnclear(text, src) {
  const s = String(text);
  const at = s.lastIndexOf('<unclear>');
  if (at < 0) return { kind: 'none', text: s };
  const close = s.indexOf('</unclear>', at);
  if (close < 0) return { kind: 'not_final', text: s };
  const content = s.slice(at + 9, close);
  const rest = s.slice(close + 10);
  if (content.includes('<') || /[A-Za-zÀ-ɏༀ-࿿]|<(?!\/?(?:summary|keywords|meta|vocab|vocabulary)\b)/.test(rest.replace(TAIL_TAGS, ''))) return { kind: 'not_final', text: s, content };
  const srcEnd = String(src || '').replace(/[\s\\#]+$/, '').slice(-60);
  if (/\[/.test(srcEnd.replace(/\[\d+\.?[ab]\]/g, '').slice(-30))) return { kind: 'src_doubtful', text: s, content };
  // A description of a gap opens like one ("one line …", "2 characters …", "text continues …"); words that
  // merely contain "obscured" or "broken" ("the obscuration of knowledge") are a rendering, not a description.
  const gap = /^[\s.…]*$/.test(content) || (GAP_TALK.test(content) && GAP_OPENS.test(content.trim()) && content.trim().split(/\s+/).length <= 10);
  if (!gap) return { kind: 'words', text: s, content };
  // "…men <unclear>one line not transcribed</unclear>." → "…men…"
  const head = s.slice(0, at).replace(/[ \t]+$/, '');
  const tail = rest.replace(/^[ \t]*[.,;:]*/, '');
  return { kind: 'gap', text: `${head}…${tail}`, content };
}

/** 6. `<note original: "X">` (content written as an attribute, never closed) → `<note>original: X</note>`. */
export function fixAttributeNote(text) {
  const s = String(text);
  if (noteTagBalance(s).balanced) return s;
  return s.replace(/<note\s+(original|sanskrit|tibetan)\s*:\s*"([^"<>]*)"\s*>/gi, (m, k, v) => `<note>${k}: ${v}</note>`);
}

/** The first changed stretch, ±150 characters, for the dry-run diff file. */
function around(a, b) {
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return { before: a.slice(Math.max(0, i - 150), a.length - j + 150), after: b.slice(Math.max(0, i - 150), b.length - j + 150) };
}

const OUT_OF_SCOPE_VOLS = new Set([74, 75, 76, 77, 78, 79, ...Array.from({ length: 20 }, (_, i) => 194 + i)]);

async function openRunBooks(db, bookIds) {
  const TERMINAL = ['complete', 'parked', 'failed'];
  return new Set((await db.collection('translate_batch_runs').find({ book_id: { $in: bookIds }, phase: { $nin: TERMINAL } }, { projection: { book_id: 1 } }).toArray()).map((r) => r.book_id));
}

async function leftovers() {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const books = await db.collection('books').find({ $or: [{ 'pipeline_auto.hold.reason': HOLD }, { title: /Derge Tengyur, vol\./ }] }, { projection: { id: 1, title: 1, 'catalog_ids.derge_tengyur_volume': 1 } }).toArray();
  const volOf = (b) => b.catalog_ids?.derge_tengyur_volume ?? +((b.title || '').match(/vol\. (\d+)/) || [])[1];
  const open = await openRunBooks(db, books.map((b) => b.id));
  const inScope = books.filter((b) => !OUT_OF_SCOPE_VOLS.has(volOf(b)) && !open.has(b.id));
  const report = {
    apply: APPLY, books: books.length, books_in_scope: inScope.length,
    skipped_books: { out_of_scope_volume: books.filter((b) => OUT_OF_SCOPE_VOLS.has(volOf(b))).length, open_run: books.filter((b) => !OUT_OF_SCOPE_VOLS.has(volOf(b)) && open.has(b.id)).map((b) => volOf(b)) },
    pages_scanned: 0,
    pairs: { pages: 0, resolved: 0, kept_both: 0 }, unclear: { gap_pages: 0, words_pages: 0, src_doubtful: 0, not_final: 0, gap_content: {} },
    attr_note: { pages: 0 }, still_unbalanced: [], written: 0, skipped: {}, words_list: [],
  };
  const diffs = fs.createWriteStream(OUT.replace(/\.json$/, '') + '-diffs.jsonl');
  const touched = [];
  for (const b of inScope) {
    const vol = volOf(b);
    const pending = [];
    const cur = db.collection('pages').find({ book_id: b.id, 'translation.data': { $exists: true, $nin: [null, ''] } }, { projection: { id: 1, book_id: 1, page_number: 1, translation: 1, 'ocr.data': 1 } });
    for await (const p of cur) {
      report.pages_scanned++;
      const en = p.translation.data;
      const why = [];
      const cp = fixCorrectionPairs(en);
      let text = cp.text;
      if (cp.resolved || cp.kept_both) { report.pairs.pages++; report.pairs.resolved += cp.resolved; report.pairs.kept_both += cp.kept_both; why.push(`correction pairs: ${cp.resolved} resolved to the editors' reading, ${cp.kept_both} written a / b in a note about the markup`); }
      const fu = fixFinalUnclear(text, p.ocr?.data);
      if (fu.kind === 'gap') {
        report.unclear.gap_pages++; text = fu.text; why.push('false page-final <unclear> → …');
        const k = fu.content.trim().toLowerCase().slice(0, 50) || '(empty)'; report.unclear.gap_content[k] = (report.unclear.gap_content[k] || 0) + 1;
      } else if (fu.kind === 'words') { report.unclear.words_pages++; report.words_list.push({ vol, page: p.page_number, page_id: p.id, url: `https://sourcelibrary.org/book/${b.id}?page=${p.page_number}`, content: fu.content.slice(0, 120) }); }
      else if (fu.kind === 'src_doubtful') report.unclear.src_doubtful++;
      else if (fu.kind === 'not_final') report.unclear.not_final++;
      const an = fixAttributeNote(text);
      if (an !== text) { report.attr_note.pages++; text = an; why.push('attribute-style <note> closed'); }
      if (!noteTagBalance(text).balanced) report.still_unbalanced.push(`https://sourcelibrary.org/book/${b.id}?page=${p.page_number}`);
      if (text !== en) pending.push({ p, en, text, why });
    }
    if (!pending.length) continue;
    // Re-check just before writing: a run opened on this book since the scan started means hands off.
    if (APPLY && (await openRunBooks(db, [b.id])).has(b.id)) { report.skipped.open_run_at_write = (report.skipped.open_run_at_write || 0) + pending.length; continue; }
    for (const { p, en, text, why } of pending) {
      const r = await repairTranslationText(db, p, text, { expectBefore: en, source: 'tengyur-draft-repairs-5497', reason: `leftover repairs (#5797): ${why.join('; ')}`, issue: 5797, jobId: 'tengyur-check-5497', apply: APPLY });
      if (r.status === 'written') { report.written++; touched.push(p.id); }
      else if (r.status !== 'dry_run') report.skipped[r.why] = (report.skipped[r.why] || 0) + 1;
      diffs.write(JSON.stringify({ vol, page: p.page_number, page_id: p.id, why, status: r.status, before: around(en, text).before, after: around(en, text).after }) + '\n');
    }
  }
  await new Promise((r) => diffs.end(r));
  if (APPLY && touched.length) report.resync = await resyncMirrors(db, touched);
  await c.close();
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ ...report, words_list: report.words_list.length, unclear: { ...report.unclear, gap_content: Object.entries(report.unclear.gap_content).sort((a, b) => b[1] - a[1]).slice(0, 25) } }, null, 1));
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const bookIds = (await db.collection('books').find({ $or: [{ 'pipeline_auto.hold.reason': HOLD }, { title: /Derge Tengyur, vol\./ }] }, { projection: { id: 1 } }).toArray()).map((b) => b.id);
  const report = { apply: APPLY, books: bookIds.length, pages_translated: 0, hash: { pages: 0, marks: 0, written: 0, skipped: {} }, notes: { pages: 0, ids: [] }, tohoku: { src_pages: 0, field_missing: [], en_dropped: 0 } };
  const touched = [];
  const cur = db.collection('pages').find({ book_id: { $in: bookIds }, 'translation.data': { $exists: true, $nin: [null, ''] } }, { projection: { id: 1, book_id: 1, page_number: 1, translation: 1, 'ocr.data': 1, 'ocr.text_edition.tohoku': 1 } });
  for await (const p of cur) {
    report.pages_translated++;
    const en = p.translation.data;
    // 3. Tohoku openings: recorded in the field? dropped from the English?
    const srcD = [...String(p.ocr?.data || '').matchAll(/\{(D\d+[a-z]?(?:-\d+)?)\}/g)].map((m) => m[1]);
    if (srcD.length) {
      report.tohoku.src_pages++;
      const field = p.ocr?.text_edition?.tohoku || [];
      if (!srcD.every((d) => field.includes(d))) report.tohoku.field_missing.push(p.id);
      if (!srcD.every((d) => en.includes(`{${d}}`))) report.tohoku.en_dropped++;
    }
    // 1. `#`
    const next = stripHashMarks(en);
    let text = en;
    if (next !== en) {
      report.hash.pages++;
      report.hash.marks += (en.match(/#/g) || []).length - (next.match(/#/g) || []).length;
      const r = await repairTranslationText(db, p, next, { expectBefore: en, source: 'tengyur-draft-repairs-5497', reason: 'strip Esukhia peydurma # marks leaked into the English (QA finding 3)', issue: ISSUE, jobId: 'tengyur-complete-5497', apply: APPLY });
      if (r.status === 'written') { report.hash.written++; touched.push(p.id); text = next; }
      else if (r.status === 'dry_run') text = next;
      else report.hash.skipped[r.why] = (report.hash.skipped[r.why] || 0) + 1;
    }
    // 2. note balance, on the text step 1 leaves
    if (!noteTagBalance(text).balanced) { report.notes.pages++; report.notes.ids.push(p.id); }
  }
  if (APPLY && touched.length) report.hash.resync = await resyncMirrors(db, touched);
  await c.close();
  if (report.notes.ids.length) {
    const idsFile = OUT.replace(/\.json$/, '') + '-note-ids.json';
    fs.writeFileSync(idsFile, JSON.stringify(report.notes.ids));
    const args = ['scripts/maintenance/fix-unclosed-note-tags.mjs', `--ids=${idsFile}`, `--out=${OUT.replace(/\.json$/, '')}-notes-diff.json`, ...(APPLY ? ['--apply'] : [])];
    report.notes.run = execFileSync(process.execPath, args, { encoding: 'utf8', env: process.env, timeout: 1800000 }).trim().split('\n').slice(-6);
  }
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ ...report, notes: { ...report.notes, ids: report.notes.ids.length }, tohoku: { ...report.tohoku, field_missing: report.tohoku.field_missing.length } }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) (process.argv.includes('--leftovers') ? leftovers : main)().catch((e) => { console.error(e); process.exit(1); });
