#!/usr/bin/env node
// PRIOR ART: scripts/lib/translation-text-repair.mjs (repairTranslationText / resyncMirrors) — the
// guarded door every stored-translation repair goes through (human-edit skip, conditional write,
// page_revisions row first with before/after hash); used as-is. scripts/maintenance/
// tengyur-draft-repairs-5497.mjs — the other $0 Tengyur repairs (leaked `#`, notes, {a,b} pairs);
// it deliberately KEEPS Markdown heading markers, so nothing existing touches headings.
/**
 * Invented Markdown headings in the Derge Tengyur English (#5497). Deterministic, $0, dry run by default.
 *
 * The source is Esukhia's typed e-text of woodblock leaves: running prose and verse, no headings. Its
 * `#` (Peydurma note points, line-initial ones escaped `\#`) reads to the model as a Markdown heading
 * marker, and the model answered with heading lines — vol. 82 p106 has "# Continuing from the previous
 * section" exactly where the Tibetan has `#ཞེས་བྱ་བ་ནས`.
 *
 * Measured 2026-10-07 on all 128,333 translated pages: 4,394 pages carry 8,183 heading lines. A by-eye
 * sample of 30 lines against the Tibetan found 22 whose WORDS translate real text (verse lines and
 * split sentences set as headings, text titles after {D####}, bam po fascicle markers, colophons,
 * section labels such as ལན་ཚྭ་…བྱེ་བྲག་བཤད་པ) and 8 invented. Among short label headings with no
 * title marker on the page only 5 of 8 were invented, so deleting heading LINES in general would
 * delete translation. Hence three actions, each the most conservative one its evidence supports:
 *
 *   delete  — the whole line, plus one blank line so no double gap is left. Only two shapes:
 *             (a) a continuation notice and nothing else ("Continuing from the previous section");
 *             (b) a bare numbering label ("Verse 8", "Section 21", "Leaf 210", "Volume 197: …") on a
 *                 page whose Tibetan has no numeral at all, so the number cannot translate anything.
 *   demote  — strip the `#` marker, keep every word: a heading whose text is a sentence or verse line
 *             (ends in . , ; : ! ? …, starts lower-case, or runs past 12 words). The words are the
 *             translation; only the heading presentation was invented. Lossless.
 *   leave   — everything else (titles, fascicles, chapters, colophons, short labels). Listed in the
 *             report with the page's title markers, for a per-line judgement; a label that translates
 *             real text cannot be told from an invented one mechanically.
 *
 * Writes: pages.translation.data (+ content_hash) via repairTranslationText — one page_revisions row
 * per page, field 'translation', source 'tengyur-invented-headings-5497', issue 5497. Then the two
 * Supabase mirrors via resyncMirrors(). Skips books with an open translate_batch_runs run (re-checked
 * per book before writing) and human-edited pages. Re-runnable: a page already repaired has nothing
 * left to match; `--resume` also skips books listed in the checkpoint file.
 *
 *   node --env-file=.env.production.local scripts/maintenance/tengyur-invented-headings-5497.mjs \
 *     [--apply] [--out=FILE] [--checkpoint=FILE] [--resume] [--limit-books=N]
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { repairTranslationText, resyncMirrors } from '../lib/translation-text-repair.mjs';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const APPLY = process.argv.includes('--apply');
const RESUME = process.argv.includes('--resume');
const OUT = arg('out') || '/tmp/tengyur-invented-headings-5497.json';
const CHECKPOINT = arg('checkpoint') || '/tmp/tengyur-invented-headings-5497.checkpoint.json';
const LIMIT_BOOKS = Number(arg('limit-books') || Infinity);
const HOLD = 'tengyur-import-5497';
const SOURCE = 'tengyur-invented-headings-5497';
const ISSUE = 5497;

const HEAD = /^(->\s*)?#{1,6} +/;
const NUM_WORD = '(?:\\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-[a-z]+)';
const CONTINUATION = /^\(?(?:continued|continuation|continuing|resuming|resumed)\)?(?:\s+(?:from|of)\s+(?:the\s+)?(?:previous|preceding|prior|last)\s+(?:section|page|leaf|folio|text|passage|discussion|verse))?[.:]?$/i;
// Only labels whose number Tibetan prose never carries. "Section/Part N" is NOT here: measured on the
// dry run, 52 of 54 translate a bam po / rab tu byed pa / le'u ordinal written in words (བམ་པོ་བཅུ་གཅིག་པ).
const NUMBER_LABEL = new RegExp(`^(?:verse|stanza|leaf|folio|page)s?\\s+${NUM_WORD}(?:\\s*[-–]\\s*${NUM_WORD})?\\.?$`, 'i');
const VOLUME_LABEL = /^volume\s+\d+\b/i;
const ORDINAL = /(?:སྐབས|རབ་ཏུ་བྱེད་པ|ལེའུ|བམ་པོ|ཚིགས་སུ་བཅད་པ|ཚིགས་བཅད|ཤླཽ་ཀ|སྡེ་ཚན|དུམ་བུ)[^།]{0,25}?(?:གཅིག|གཉིས|གསུམ|བཞི|ལྔ|དྲུག|བདུན|བརྒྱད|དགུ|བཅུ|ཉི་ཤུ|སུམ་ཅུ|བཞི་བཅུ|ལྔ་བཅུ|དྲུག་ཅུ|བདུན་ཅུ|བརྒྱད་ཅུ|དགུ་བཅུ|བརྒྱ)/;

/** The heading's words, with the marker, centring arrows and emphasis removed. */
export function headingText(line) {
  return line.replace(HEAD, '').replace(/<-\s*$/, '').replace(/[*_]/g, '').trim();
}

/** Tibetan as one string: the e-text breaks lines inside words, and `#` sits inside words. */
function flatTibetan(tib) {
  return String(tib || '').replace(/\\?#/g, '').replace(/\s*\n\s*/g, '');
}

/** Which title/structure markers the page's Tibetan carries (for the report and the numeral test). */
export function sourceMarkers(tib) {
  const t = flatTibetan(tib);
  return {
    D: /\{D\d/.test(t),
    rgya_gar: /རྒྱ་གར་སྐད་དུ|བོད་སྐད་དུ/.test(t),
    rdzogs: /རྫོགས་(?:སོ|ཏེ)/.test(t),
    bam_po: /བམ་པོ/.test(t),
    lehu: /ལེའུ/.test(t),
    numeral: /[0-9༠-༩]/.test(t.replace(/\{D\d+[a-z]?\}/g, '')),
    // A structural ordinal written in words: "fascicle eleven", "chapter two", "verse three".
    ordinal: ORDINAL.test(t),
  };
}

/** Classify one heading line: 'delete' | 'demote' | 'leave', with the reason. */
export function classifyHeading(line, markers) {
  const raw = headingText(line);
  if (/<[a-z]/i.test(raw)) return { action: 'leave', why: 'carries_markup' }; // <term>/<note>: translates source words
  if (!raw) return { action: 'delete', why: 'empty_heading' };
  if (CONTINUATION.test(raw)) return { action: 'delete', why: 'continuation_notice' };
  if (!markers.numeral && !markers.ordinal && !markers.bam_po && (NUMBER_LABEL.test(raw) || VOLUME_LABEL.test(raw))) return { action: 'delete', why: 'numbering_label' };
  const marked = markers.D || markers.rgya_gar || markers.rdzogs || markers.bam_po || markers.lehu;
  // On a page that opens or closes a text, a title line ("In the language of Tibet: …", a long
  // work title) is real structure: there only a line ending like a sentence is demoted.
  const words = raw.split(/\s+/).length;
  const sentenceEnd = /[.,;!?…]["'”’)\]]?$/.test(raw);
  const sentence = marked ? sentenceEnd && !/^in (?:the )?(?:language|indian|tibetan|sanskrit)/i.test(raw)
    : sentenceEnd || /:["'”’)\]]?$/.test(raw) || /^[a-z"'“‘(]/.test(raw) || words > 12;
  if (sentence) return { action: 'demote', why: 'sentence_as_heading' };
  return { action: 'leave', why: marked ? 'label_on_marked_page' : 'label_no_marker' };
}

/** Apply the actions to a page's English. Returns the new text and the per-line decisions. */
export function repairHeadings(text, markers) {
  const lines = String(text).split('\n');
  const decisions = [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!HEAD.test(line)) { out.push(line); continue; }
    const d = classifyHeading(line, markers);
    decisions.push({ line, ...d });
    if (d.action === 'demote') out.push(line.replace(HEAD, (m, arrow) => arrow || ''));
    else if (d.action === 'delete') {
      // Drop one blank line with it, so "para\n\n# X\n\npara" becomes "para\n\npara", never a double gap.
      const prevBlank = out.length === 0 || out[out.length - 1].trim() === '';
      if (prevBlank && i + 1 < lines.length && lines[i + 1].trim() === '') i++;
    } else out.push(line);
  }
  return { text: out.join('\n'), decisions };
}

async function openRunBooks(db, bookIds) {
  const TERMINAL = ['complete', 'parked', 'failed'];
  return new Set((await db.collection('translate_batch_runs').find({ book_id: { $in: bookIds }, phase: { $nin: TERMINAL } }, { projection: { book_id: 1 } }).toArray()).map((r) => r.book_id));
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const done = new Set(RESUME && fs.existsSync(CHECKPOINT) ? JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8')).done_books : []);
  const books = (await db.collection('books').find({ 'pipeline_auto.hold.reason': HOLD }, { projection: { id: 1, title: 1 } }).sort({ id: 1 }).toArray());
  const report = { apply: APPLY, books: books.length, pages_scanned: 0, pages_with_heading: 0, lines: {}, pages_to_change: 0, written: 0, skipped: {}, skipped_books: [], leave_list: [], changes: [] };
  const touched = [];
  let n = 0;
  for (const b of books) {
    if (done.has(b.id)) continue;
    if (n++ >= LIMIT_BOOKS) break;
    if ((await openRunBooks(db, [b.id])).has(b.id)) { report.skipped_books.push(b.id); continue; }
    const pages = await db.collection('pages').find({ book_id: b.id, 'translation.data': { $type: 'string' } }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, translation: 1 } }).toArray();
    for (const p of pages) {
      report.pages_scanned++;
      const en = p.translation.data;
      if (!/^(?:->\s*)?#{1,6} /m.test(en)) continue;
      report.pages_with_heading++;
      const markers = sourceMarkers(p.ocr?.data);
      const { text, decisions } = repairHeadings(en, markers);
      for (const d of decisions) {
        const k = `${d.action}:${d.why}`;
        report.lines[k] = (report.lines[k] || 0) + 1;
        if (d.action === 'leave') report.leave_list.push({ book_id: b.id, page: p.page_number, why: d.why, line: d.line.slice(0, 160), markers });
      }
      if (text === en) continue;
      report.pages_to_change++;
      const r = await repairTranslationText(db, p, text, {
        expectBefore: en, source: SOURCE, issue: ISSUE, jobId: SOURCE, apply: APPLY,
        reason: `invented Markdown headings (#5497): ${decisions.filter((d) => d.action !== 'leave').map((d) => `${d.action} "${headingText(d.line).slice(0, 60)}" (${d.why})`).join('; ')}`,
      });
      if (report.changes.length < 400 || decisions.some((d) => d.action === 'delete')) report.changes.push({ book_id: b.id, page: p.page_number, id: p.id, status: r.status, edits: decisions.filter((d) => d.action !== 'leave').map((d) => `${d.action}: ${d.line.slice(0, 120)}`) });
      if (r.status === 'written') { report.written++; touched.push(p.id); }
      else if (r.status !== 'dry_run') report.skipped[r.why] = (report.skipped[r.why] || 0) + 1;
    }
    done.add(b.id);
    if (APPLY) fs.writeFileSync(CHECKPOINT, JSON.stringify({ done_books: [...done], updated_at: new Date().toISOString() }));
  }
  if (APPLY && touched.length) report.resync = await resyncMirrors(db, touched);
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  const { leave_list, changes, ...summary } = report;
  console.log(JSON.stringify({ ...summary, leave_lines: leave_list.length, out: OUT }, null, 1));
  await client.close();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
