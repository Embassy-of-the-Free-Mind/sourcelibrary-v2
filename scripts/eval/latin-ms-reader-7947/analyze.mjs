#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-strata-7947/analyze.mjs (the rates, severity mapping and book-cluster bootstrap of the
// census this test follows; its lib.mjs claimsOf/kindOf/classOf are imported); scripts/eval/route-judge-6740/
// cheap-routes-7701 `run.mjs evidence` (the router-table score shape: per cell, per route, accept and wrong_text k/n,
// classes_k_of_n, paired counts). Neither compares several readers of one draw judged in the same packets.
/**
 * #7947 reader test, step 4: per arm, against the stored text judged in the same packets, the confirmed sense-error rate
 * per 1,000 words, accept and wrong-text k/n, paired page counts, and the floor of RULE.md. Pure: files in, files out.
 *
 *   node scripts/eval/latin-ms-reader-7947/analyze.mjs --scratch <job dir> --out <results dir>
 * Writes <out>/analysis.json and <out>/latin-ms-reader-7947.score.json (router-table evidence shape).
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
import { classOf, kindOf, claimsOf } from '../latin-strata-7947/lib.mjs';

const args = process.argv.slice(2);
const opt = (k) => args[args.indexOf(`--${k}`) + 1];
const SCR = opt('scratch'), OUT = opt('out');
const J = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));
const ROUTE = { stored: 'stored (Flash-Lite)', agyread: 'agy-flash-low@4', armc: 'pero>agy-flash-low (arm c, E3 put-back)', opus: 'claude-opus (claude-ocr.mjs, 1 a call)', liteopus: 'lite>opus (correct.mjs)' };
const COST_ORDER = ['armc', 'agyread', 'opus', 'liteopus'];
const WRONG_KINDS = new Set(['invented text', 'invented margin', 'wrong leaf', 'strip of several openings: described or invented, not read']);

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * s.length)))]; };
function rateCI(bs, seed, B = 4000) {
  const W = bs.reduce((s, b) => s + b.words, 0);
  if (!W) return { point: null, ci95: null };
  const point = (1000 * bs.reduce((s, b) => s + b.n, 0)) / W;
  const rng = makeRng(seed), sims = [];
  for (let i = 0; i < B; i++) { let n = 0, w = 0; for (let k = 0; k < bs.length; k++) { const b = bs[Math.floor(rng() * bs.length)]; n += b.n; w += b.words; } sims.push(w ? (1000 * n) / w : 0); }
  return { point: +point.toFixed(2), ci95: [+pct(sims, 0.025).toFixed(2), +pct(sims, 0.975).toFixed(2)] };
}

const result = { issue: 7947, generated: new Date().toISOString().slice(0, 10), rule: 'scripts/eval/latin-ms-reader-7947/RULE.md', sets: {} };
const score = { generated_by: 'scripts/eval/latin-ms-reader-7947/analyze.mjs (job latin-ms-reader-7947, #7947)',
  provenance: '#7947 reader test on the #7947 draw (no re-draw): lite-read manuscripts (26 books, 78 pages) and the 1450-1500 print cell (8 books, 24 pages); arms read on the same pages; one Opus reader per book judging every arm blind (neutral labels, shuffled), REVIEWER.md + JUDGE-ADDENDUM.md; every serious call re-read by a second Opus reader (SECOND-READER.md), blind to arm',
  judge: 'claude-opus (claude -p), REVIEWER.md against the page image; confirmed = second reader confirmed or reclassified (still serious)', cells: {} };

for (const SET of ['ms', 'inc']) {
  const D = path.join(SCR, 'judge', SET);
  if (!fs.existsSync(path.join(D, 'first/reviews'))) continue;
  const set = J(SCR, 'sets', `${SET}.json`);
  const served = J(D, 'served.json');
  const key = J(D, 'key.json');
  const reviews = fs.readdirSync(path.join(D, 'first/reviews')).filter((f) => f.endsWith('.json')).flatMap((f) => J(D, 'first/reviews', f));
  if (!reviews.length) continue;
  const second = fs.existsSync(path.join(D, 'second/verdicts.json')) ? J(D, 'second/verdicts.json') : [];
  const verdict = new Map(second.map((v) => [v.claim_id, v]));
  const arms = [...new Set(Object.values(key).map((k) => k.arm))];
  const rows = [];   // one per (arm, page)
  for (const r of reviews) {
    const k = key[r.book_id];
    if (!k) continue;
    for (const rp of r.pages || []) {
      const p = set.find((x) => x.book_id === k.book_id && x.page_number === rp.page_number);
      if (!p) continue;
      const row = { arm: k.arm, book_id: k.book_id, page_number: p.page_number, words: p.words, ocr_score: rp.ocr_score, right_page: rp.right_page,
        source: served.find((s) => s.page_id === p.page_id).arms[k.arm].source, judged: { serious: 0, wrong: 0 }, confirmed: { serious: 0, wrong: 0 }, classes: [], calls: [] };
      for (const c of claimsOf(r.book_id, rp)) {
        if (c.lane === 'tr' || c.e.severity !== 'serious') continue;
        const v = verdict.get(c.claim_id);
        const cls = v?.verdict === 'misclassified' && v.class ? v.class : c.e.class;
        const wrong = /^(I1|I2|O1|O2|O3)$/.test(classOf({ class: cls })) || WRONG_KINDS.has(kindOf({ ...c.e, class: cls }, c.lane));
        row.judged.serious++; if (wrong) row.judged.wrong++;
        const conf = !second.length || !v ? null : (v.verdict === 'confirmed' || v.verdict === 'misclassified');
        row.calls.push({ claim_id: c.claim_id, class: classOf({ class: cls }), kind: kindOf({ ...c.e, class: cls }, c.lane), second: v?.verdict ?? null, ocr: c.e.ocr ?? null, image: c.e.image ?? null, problem: c.e.problem ?? c.e.note ?? null });
        if (conf) { row.confirmed.serious++; if (wrong) row.confirmed.wrong++; row.classes.push(classOf({ class: cls })); }
      }
      rows.push(row);
    }
  }
  const mode = second.length ? 'confirmed' : 'judged';
  const out = { pages: set.length, books: new Set(set.map((p) => p.book_id)).size, words: set.reduce((s, p) => s + p.words, 0), mode,
    second_reader: second.length ? Object.fromEntries(Object.entries(second.reduce((m, v) => ((m[v.verdict] = (m[v.verdict] ?? 0) + 1), m), {}))) : null, arms: {} };
  // The stored arm's #7947 baseline: that census's confirmed serious OCR/page calls on these pages (translation calls out).
  const base = set.map((p) => ({ book_id: p.book_id, words: p.words, n: (p.base_7947.kinds || []).filter((k) => !k.startsWith('tr:')).length }));
  const baseBooks = Object.values(base.reduce((m, p) => ((m[p.book_id] ??= { words: 0, n: 0 }), (m[p.book_id].words += p.words), (m[p.book_id].n += p.n), m), {}));
  out.stored_7947_baseline = { ...rateCI(baseBooks, 794700), pages_clean: base.filter((p) => !p.n).length, note: 'the #7947 census\'s confirmed serious OCR/page calls on these pages (one reader, judging OCR and translation together)' };
  const S = new Map(rows.filter((r) => r.arm === 'stored').map((r) => [`${r.book_id}:${r.page_number}`, r]));
  arms.forEach((arm, i) => {
    const rs = rows.filter((r) => r.arm === arm);
    const books = Object.values(rs.reduce((m, r) => ((m[r.book_id] ??= { words: 0, n: 0, nj: 0 }), (m[r.book_id].words += r.words), (m[r.book_id].n += r[mode].serious), (m[r.book_id].nj += r.judged.serious), m), {}));
    const cls = rs.flatMap((r) => [...new Set(r.classes)]).reduce((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {});
    const paired = { better: 0, worse: 0, same: 0, gains_wrong_text: [] };
    for (const r of rs) {
      const s = S.get(`${r.book_id}:${r.page_number}`);
      if (!s || arm === 'stored') continue;
      const d = r[mode].serious - s[mode].serious;
      paired[d < 0 ? 'better' : d > 0 ? 'worse' : 'same']++;
      if (r[mode].wrong && !s[mode].wrong) paired.gains_wrong_text.push(`${r.book_id}:${r.page_number}`);
    }
    out.arms[arm] = { route: ROUTE[arm], pages: rs.length, books: books.length, read_served: rs.filter((r) => r.source === 'read').length,
      sense_per_1000: rateCI(books, 7947 + i), sense_per_1000_judged: rateCI(books.map((b) => ({ ...b, n: b.nj })), 8947 + i),
      accept: `${rs.filter((r) => !r[mode].serious).length}/${rs.length}`, wrong_text_pages: `${rs.filter((r) => r[mode].wrong).length}/${rs.length}`,
      ocr_score_le2: `${rs.filter((r) => r.ocr_score != null && r.ocr_score <= 2).length}/${rs.length}`,
      ocr_score_mean: +(rs.filter((r) => r.ocr_score != null).reduce((s, r) => s + r.ocr_score, 0) / Math.max(1, rs.filter((r) => r.ocr_score != null).length)).toFixed(2),
      classes_k_of_n: Object.fromEntries(Object.entries(cls).sort((a, b) => b[1] - a[1]).map(([c, n]) => [c, `${n}/${rs.length}`])),
      ...(arm !== 'stored' && { paired_vs_stored: { ...paired, gains_wrong_text: paired.gains_wrong_text.length, gains_wrong_text_pages: paired.gains_wrong_text } }) };
  });
  const s = out.arms.stored;
  for (const arm of arms.filter((a) => a !== 'stored')) {
    const a = out.arms[arm];
    const halves = a.sense_per_1000.point <= s.sense_per_1000.point / 2;
    const noGain = a.paired_vs_stored.gains_wrong_text === 0;
    const noBad = SET !== 'inc' || a.ocr_score_le2.startsWith('0/');
    a.floor = { halves_rate: halves, no_page_gains_invented_text: noGain, ...(SET === 'inc' && { no_page_wrong_or_mostly_wrong: noBad }), clears: halves && noGain && noBad };
  }
  out.cheapest_clearing = COST_ORDER.find((a) => out.arms[a]?.floor?.clears) ?? null;
  out.rows = rows;
  result.sets[SET] = out;
  score.cells[SET === 'ms' ? 'latin-manuscript-lite-7947' : 'latin-incunabula-7947'] = { task: 'ocr', lang: 'Latin',
    frame: { rule: SET === 'ms' ? 'the #7947 draw: live Latin books, form on the image manuscript, all 3 drawn pages Flash-Lite, microfilm strips excluded; 3 pages a book at 25/50/75%' : 'the #7947 draw: live Latin books dated 1450-1500, printed (on the image); 3 pages a book at 25/50/75%', books: out.books, pages: out.pages },
    routes: Object.fromEntries(arms.map((arm) => [ROUTE[arm], { n: out.arms[arm].pages, books: out.arms[arm].books, accept: out.arms[arm].accept, wrong_text_pages: out.arms[arm].wrong_text_pages,
      sense_per_1000_words: out.arms[arm].sense_per_1000, classes_k_of_n: out.arms[arm].classes_k_of_n,
      note: arm === 'stored' ? 'the stored text, judged in the same packets' : `served = the arm's read where usable, else the stored text (RULE.md); read on ${out.arms[arm].read_served}/${out.arms[arm].pages}` }])) };
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'analysis.json'), JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(OUT, 'latin-ms-reader-7947.score.json'), JSON.stringify(score, null, 1));
for (const [SET, o] of Object.entries(result.sets)) {
  console.log(`\n== ${SET} (${o.mode}; ${o.books} books, ${o.pages} pages, ${o.words} words) — #7947 baseline stored ${o.stored_7947_baseline.point} [${o.stored_7947_baseline.ci95}]`);
  for (const [arm, a] of Object.entries(o.arms)) console.log(arm.padEnd(9), `${a.sense_per_1000.point} [${a.sense_per_1000.ci95}]`.padEnd(20), `judged ${a.sense_per_1000_judged.point}`.padEnd(14), `accept ${a.accept}`.padEnd(13), `wrong ${a.wrong_text_pages}`.padEnd(11), `≤2 ${a.ocr_score_le2}`.padEnd(9), `mean ${a.ocr_score_mean}`, a.paired_vs_stored ? JSON.stringify({ b: a.paired_vs_stored.better, w: a.paired_vs_stored.worse, gain: a.paired_vs_stored.gains_wrong_text }) : '', a.floor ? `floor ${a.floor.clears}` : '');
  console.log('cheapest clearing:', o.cheapest_clearing);
}
