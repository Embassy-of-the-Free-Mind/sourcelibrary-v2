// PRIOR ART: scripts/eval/defect-notes-7263/rollup.mjs (this job) — classes only; scripts/eval/lib/quality-census-detectors.mjs
// classifies the TEXT (notes, scan warnings), not a judge's note about it. The regexes below were written after reading
// seeded samples of each class (samples.mjs); they count the judge's own words, so a pattern's count is the judge's view.
/**
 * Named patterns over the judge's `what` (and quote) text. Prints notes / pages / books per pattern per frame, the top
 * book's share, and writes $JOB_SCRATCH/pattern-pages.json (page lists for the by-eye check; stays out of the repo).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
const S = process.env.JOB_SCRATCH;
const SERVED = new Set(['confidence-7866', 'test:judged-expand-7263']);
const rows = zlib.gunzipSync(fs.readFileSync(`${S}/rows.jsonl.gz`)).toString().split('\n').map(JSON.parse)
  .filter((r) => !String(r.instrument || '').startsWith('step-t'));
const ser = (d) => d.severity === 'misleads' || d.severity === 'wrong_text';
const ms = (r) => /hand|manuscript/.test(r.script_type || '') || /manuscript/.test(`${r.cell}`);
const LATN = /^(Latin|German|French|English|Italian|Spanish|Dutch|de|fr|la|Danish|Latin-English|Russian)$/;
export const PATTERNS = {
  empty_page: { task: 'ocr', test: (d, r) => d.class === 'O18' && !String(d.quote || '').trim().replace(/<[^>]+>/g, '') },
  unclear_blanket: { task: 'ocr', test: (d) => /^(O18|O14|O5)$/.test(d.class) && /placeholder|<unclear>|unclear marks?|marked unclear|left untranscribed|effectively (left )?(un|empty)/i.test(d.what) },
  loop: { task: 'ocr', test: (d) => /loop|over and over|hundreds of times|repeat(s|ed)? (it|them)?\s*(\d+|many|several|dozens)|fill the|again and again/i.test(d.what) },
  invented_hard_hand: { task: 'ocr', test: (d, r) => d.class === 'O1' && ms(r) },
  invented_print: { task: 'ocr', test: (d, r) => d.class === 'O1' && !ms(r) },
  abridged: { task: 'ocr', test: (d) => /representative|summari[sz]|ellips|reduced to (a few|fragments|scraps)|only (a|\d+) .{0,20}(sections|lines) (of|for)|described (rather|instead)|paraphras/i.test(d.what) },
  line_dropped: { task: 'ocr', test: (d) => d.class === 'O5' && /\b(line|lines|column|row|entry|hemistich|verse|block|paragraph)\b/i.test(d.what) && !/representative|summari|ellips/i.test(d.what) },
  word_dropped: { task: 'ocr', test: (d) => d.class === 'O5' && !/\b(line|lines|column|row|entry|hemistich|verse|block|paragraph)\b/i.test(d.what) },
  ri_yue_zh: { task: 'ocr', test: (d) => /日/.test(d.what) && /曰/.test(d.what) },
  long_s: { task: 'ocr', test: (d) => /long[- ]?s\b|ſ.{0,12}(misread|as f)|read as 'f'/i.test(d.what) },
  show_through: { task: 'ocr', test: (d) => /show-?through|mirror|bleed-?through|other side of the leaf|reverse of the leaf/i.test(d.what) },
  margin_gloss: { task: 'ocr', test: (d) => d.class === 'O12' },
  numerals: { task: 'ocr', test: (d) => d.class === 'O7' },
  wrong_leaf: { task: 'ocr', test: (d) => /^(I1|I4|I5|O3)$/.test(d.class) },
  misread_latin_print: { task: 'ocr', test: (d, r) => d.class === 'O6' && !ms(r) && LATN.test(r.lang) },
  misread_latin_ms: { task: 'ocr', test: (d, r) => d.class === 'O6' && ms(r) && LATN.test(r.lang) },
  misread_other_script: { task: 'ocr', test: (d, r) => d.class === 'O6' && !LATN.test(r.lang) },
  tr_summary_invents: { task: 'translation', test: (d) => /summary|keyword/i.test(`${d.what}`) && /^(T10|O1|T7|O6|E2|T8)$/.test(d.class) },
  tr_note_invents: { task: 'translation', test: (d) => d.class === 'T10' && !/summary|keyword/i.test(d.what) },
  tr_repeat_marks: { task: 'translation', test: (d) => /repeat(ition)? marks?|丨|｜|ditto/i.test(`${d.what} ${d.quote}`) },
  tr_sense_flip: { task: 'translation', test: (d) => d.class === 'T8' },
  tr_omission: { task: 'translation', test: (d) => /^(T9|T1)$/.test(d.class) },
  tr_word_sense: { task: 'translation', test: (d) => d.class === 'O6' },
};
const frames = { served: rows.filter((r) => SERVED.has(r.lane)), arms: rows.filter((r) => !SERVED.has(r.lane)) };
const out = {}; const pages = {};
for (const [fname, rs] of Object.entries(frames)) {
  const totalSer = rs.reduce((s, r) => s + r.defects.filter(ser).length, 0);
  for (const [p, P] of Object.entries(PATTERNS)) {
    const sub = rs.filter((r) => (r.task === 'translation') === (P.task === 'translation'));
    if (!sub.length) continue;
    let notes = 0; const pg = new Set(); const bk = {}; const routes = {}; const list = [];
    for (const r of sub) { const hit = r.defects.filter((d) => ser(d) && P.test(d, r)); if (!hit.length) continue; notes += hit.length; pg.add(r.id); bk[r.book_id] = (bk[r.book_id] ?? 0) + hit.length; routes[r.route] = (routes[r.route] ?? 0) + 1; list.push({ id: r.id, page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, lang: r.lang, script: r.script_type, route: r.route, image_url: r.image_url, notes: hit }); }
    const top = Math.max(0, ...Object.values(bk));
    out[`${fname}|${p}`] = { notes, share_of_serious: +(notes / totalSer).toFixed(3), pages: pg.size, of_pages: sub.length, page_share: +(pg.size / sub.length).toFixed(3), books: Object.keys(bk).length, top_book_share: notes ? +(top / notes).toFixed(3) : null, routes: Object.entries(routes).sort((a, b) => b[1] - a[1]).slice(0, 5) };
    pages[`${fname}|${p}`] = list;
  }
}
fs.writeFileSync(`${S}/pattern-pages.json`, JSON.stringify(pages));
fs.writeFileSync(`${S}/patterns.json`, JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(34)} notes ${String(v.notes).padStart(5)} (${(v.share_of_serious * 100).toFixed(1)}% of serious) pages ${v.pages}/${v.of_pages} books ${v.books} top ${v.top_book_share} routes ${v.routes.map((x) => x.join(':')).join(' ')}`);
