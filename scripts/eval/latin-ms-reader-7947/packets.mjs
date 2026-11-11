#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-strata-7947/build-second.mjs (packets for REVIEWER.md / SECOND-READER.md from the #7947
// draw: one arm, the stored text); scripts/batch/cli-ocr.mjs apply (the read checks and the arm-c E3 put-back mirrored in
// served() below, which apply runs only on its way to a write). Nothing turned several readers' outputs of one draw into
// blind per-book packets.
/**
 * #7947 reader test, step 2: what each arm serves on each drawn page, and the blind judge packets.
 *
 *   node scripts/eval/latin-ms-reader-7947/packets.mjs --set ms|inc --scratch <job dir>
 *
 * Reads <scratch>/sets/<set>.json and the arm folders <scratch>/arms/<set>-<arm>. Writes
 *   <scratch>/judge/<set>/served.json   per page and arm: the text served, its source (read | stored | …) and why
 *   <scratch>/judge/<set>/packets/packet-<book>.json   one book a packet, one entry per arm, shuffled, neutral labels
 *   <scratch>/judge/<set>/key.json      label → arm (the judge never sees this folder's key)
 * An arm that gives nothing usable for a page serves the stored text there (RULE.md). No Mongo, no model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
import { ocrReadProblem } from '../../lib/cli-chatter.mjs';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';
import { correctionDiffs, applyDiffVerdicts, longSPass } from '../../lib/correction-diff-guard.mjs';

const args = process.argv.slice(2);
const opt = (k) => args[args.indexOf(`--${k}`) + 1];
const SET = opt('set');
const SCR = opt('scratch');
export const ARMS = { ms: ['stored', 'agyread', 'armc', 'opus'], inc: ['stored', 'agyread', 'liteopus'] };
const set = JSON.parse(fs.readFileSync(path.join(SCR, 'sets', `${SET}.json`), 'utf8'));

// cli-ocr.mjs apply's read checks (its REFUSAL, longWords and MIN_SHARED, copied: they are not exported).
const REFUSAL = /\bI (cannot|can't|am unable to) (provide|transcribe|reproduce)|content restrictions|safety filters|^#{2,3} Summary\b|overview and summary of the text|prompt could not be submitted/im;
const longWords = (t) => new Set((String(t).replace(/<[^>]+>/g, ' ').replace(/-\n/g, '').toLowerCase().replace(/æ/g, 'ae').replace(/ſ/g, 's').replace(/v/g, 'u').match(/\p{L}{5,}/gu) || []));
const shared = (stored, text) => { const was = longWords(stored), now = longWords(text); return { was: was.size, share: [...now].filter((w) => was.has(w)).length / Math.max(1, now.size) }; };
const nWords = (s) => String(s).split(/\s+/).filter(Boolean).length;
const tagShape = (t) => (String(t).match(/<\/?[a-z-]+/g) || []).join(' ');
const handOf = (t) => (String(t).match(/<script>\s*(\w+)\s*<\/script>/i)?.[1] || '').toLowerCase() || null;

function readOf(dir, pageId) {
  const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${pageId}.meta.json`), 'utf8')); } catch { return null; } })();
  if (!meta) return { why: 'no read' };
  const text = (() => { try { return fs.readFileSync(path.join(dir, `${pageId}.txt`), 'utf8').trim(); } catch { return ''; } })();
  if (meta.outcome && meta.outcome !== 'corrected') return { why: `corrector: ${meta.outcome}`, meta };   // correct.mjs
  if (meta.exit !== 0) return { why: `exit ${meta.exit}${meta.error_class ? ` (${meta.error_class})` : ''}`, meta };
  if (meta.wrapper) return { why: `wrapper: ${meta.wrapper}`, meta };
  if (text.length < 5) return { why: 'empty', meta };
  if (/^UNCHANGED\.?$/i.test(text)) return { why: 'corrector: UNCHANGED', meta };
  if (/^CONTAIN\s*:/i.test(text) && !/<page-type>/.test(text)) return { why: 'corrector: CONTAIN', meta, contain: text.slice(0, 300) };
  if (REFUSAL.test(text)) return { why: 'refusal', meta, text };
  if (!meta.outcome && (text.match(/<page-type>/g) || []).length !== 1) return { why: 'no single <page-type> header', meta };
  const chatter = ocrReadProblem(text, { header: !meta.outcome });
  if (chatter) return { why: `chatter: ${chatter}`, meta };
  if (loopVerdict(text).refuse) return { why: 'repetition loop', meta };
  return { text, meta };
}

/** Arm c as the lane writes it over a stored draft: long-s pass, then every flagged change put back to the stored reading. */
function armcServed(stored, text) {
  const ls = longSPass(text, { lang: 'la', convention: stored });
  const { flags } = correctionDiffs(stored, ls.text, { lang: 'la' });
  const kinds = {}; for (const f of flags) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
  const guard = { flags: flags.length, kinds, long_s_tells: ls.tells.length };
  const tagIn = (t, [x, y]) => /[<>]/.test(String(t).slice(x, y));
  if (flags.some((f) => tagIn(stored, f.a) || tagIn(ls.text, f.b))) return { why: 'put-back spans a tag (stored stands)', guard };
  if (flags.some((f) => !nWords(f.draft) || nWords(f.draft) !== nWords(f.next))) return { why: 'put-back not like-for-like (stored stands)', guard };
  const back = applyDiffVerdicts(stored, ls.text, flags, flags.map((f) => ({ i: f.i, winner: 'draft' })));
  guard.put_back = back.reverted;
  if (tagShape(back.text) !== tagShape(ls.text)) return { why: 'put-back changed the tag structure (stored stands)', guard };
  if (back.text.trim() === stored.trim()) return { why: 'every change put back (stored stands)', guard };
  return { text: back.text, guard };
}

const served = [];
for (const p of set) {
  const row = { page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, words: p.words, arms: {} };
  for (const arm of ARMS[SET]) {
    if (arm === 'stored') { row.arms.stored = { source: 'stored', text: p.ocr }; continue; }
    const dir = path.join(SCR, 'arms', `${SET}-${arm}`, arm === 'liteopus' ? 'reads' : '');
    const r = readOf(dir, p.page_id);
    const a = { source: 'read', why: r.why ?? null, hand: r.text ? handOf(r.text) : null, contain: r.contain ?? null };
    if (r.text) {
      const sh = shared(p.ocr, r.text);
      a.shared_words = +sh.share.toFixed(3);
      // cli-ocr.mjs apply's 40% floor against the stored text (a gate on the WRITE, recorded; the read is still judged)
      a.below_40pct_floor = sh.was >= 40 && sh.share < 0.4;
      if (arm === 'armc') {
        a.print_only_skip = a.hand !== 'printed';   // the lane's writer is print only
        const c = armcServed(p.ocr, r.text);
        a.guard = c.guard;
        if (c.text) a.text = c.text; else { a.source = 'stored'; a.why = c.why; a.text = p.ocr; }
      } else a.text = r.text;
    } else { a.source = 'stored'; a.text = p.ocr; }
    row.arms[arm] = a;
  }
  served.push(row);
}

const OUT = path.join(SCR, 'judge', SET);
fs.mkdirSync(path.join(OUT, 'packets'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'served.json'), JSON.stringify(served, null, 1));
const rng = makeRng(20261103 + (SET === 'inc' ? 1 : 0));
const key = {};
const books = [...new Set(set.map((p) => p.book_id))];
books.forEach((bid, bi) => {
  const pages = set.filter((p) => p.book_id === bid);
  const order = ARMS[SET].map((a) => [rng(), a]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  const letters = 'kmrtw';
  const entries = order.map((arm, i) => {
    const label = `b${String(bi + 1).padStart(2, '0')}-${letters[i]}`;
    key[label] = { arm, book_id: bid };
    return { slot: i + 1, book_id: label, tradition: null,
      book: { title: pages[0].title, published: pages[0].published, language: 'Latin' },
      structure: null, run: pages.map((p) => p.page_number),
      pages: pages.map((p) => ({ page_number: p.page_number, image_url: p.image_url, crop: p.crop,
        ocr: served.find((s) => s.page_id === p.page_id).arms[arm].text, translation: null })) };
  });
  fs.writeFileSync(path.join(OUT, 'packets', `packet-${String(bi + 1).padStart(2, '0')}.json`), JSON.stringify(entries, null, 1));
});
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));
const tally = {};
for (const r of served) for (const [arm, a] of Object.entries(r.arms)) {
  const t = (tally[arm] ??= { read: 0, stored: 0, why: {}, below_40pct_floor: 0, print_only_skip: 0, put_back: 0, pages_put_back: 0 });
  t[a.source === 'read' ? 'read' : 'stored']++;
  if (a.why) t.why[a.why] = (t.why[a.why] || 0) + 1;
  if (a.below_40pct_floor) t.below_40pct_floor++;
  if (a.print_only_skip) t.print_only_skip++;
  if (a.guard?.put_back) { t.put_back += a.guard.put_back; t.pages_put_back++; }
}
fs.writeFileSync(path.join(OUT, 'served-tally.json'), JSON.stringify(tally, null, 1));
console.log(`${SET}: ${books.length} packets`, JSON.stringify(tally, null, 1));
