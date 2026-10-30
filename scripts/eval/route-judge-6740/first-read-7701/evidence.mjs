// PRIOR ART: scripts/eval/estimator/router-table/evidence/derive_backfill.py (writes router evidence from verdicts, but
// for the #7517 cells, pooled over script type) and scripts/eval/router-next-7263/split_evidence.py (the by-script cut,
// from evidence_pages rows this test has none of). This writes both for the #7701 no-stored-text cells, arms A and B.
//   node scripts/eval/route-judge-6740/first-read-7701/evidence.mjs <route-judge DIR> scripts/eval/estimator/router-table/evidence
// #7701: router evidence for the no-stored-text cells, unsplit and by script type (the read's own <script> tag:
// handwritten -> manuscript, printed or mixed -> print, none -> unknown; scripts/eval/router-next-7263/script-type.mjs rule).
import fs from 'node:fs';
import path from 'node:path';
const [R, EV] = process.argv.slice(2);
const key = JSON.parse(fs.readFileSync(`${R}/key.json`)), s = JSON.parse(fs.readFileSync(`${R}/sample.json`));
const V = new Map(fs.readFileSync(`${R}/verdicts-opus.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
const wt = (v) => (v.defects || []).some((d) => d.severity === 'wrong_text');
const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';
const agg = (rows) => { const n = rows.length, k = rows.filter((r) => r.accept).length, w = rows.filter((r) => r.wt).length; const cl = {};
  for (const r of rows) for (const c of r.classes) cl[c] = (cl[c] || 0) + 1;
  return { n, books: new Set(rows.map((r) => r.book_id)).size, accept: `${k}/${n}`, wrong_text_pages: `${w}/${n}`, delivered: `${rows.filter((r) => r.delivered).length}/${n}`, filter_cut: `${rows.filter((r) => r.cut).length}/${n}`,
    classes_k_of_n: Object.fromEntries(Object.entries(cl).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, `${v}/${n}`])) }; };
const unsplit = { generated_by: 'scripts/eval/route-judge-6740/results/first-read-7701-2026-10-29 (job ocr-first-7701, #7701; no model calls in this step)',
  provenance: '#7701 router cell test: judge.mjs draw --cells=la-blank,de-blank,fr-blank (the first-read lane frame), correct (agy gemini-3.8-flash-low, AGY_HOME .agy-james, Latin/German 4 a call), packet, judge (Opus, image, blind, wrong-page controls passed), score; written = the drawn pages cli-ocr.mjs apply --first-read-only --print-only would write (dry run)',
  judge: 'claude-opus-5-5 (claude -p), reading each output against the page image; no Opus text is the key (the route-judge prompt)', cells: {} };
const byScript = { generated_by: unsplit.generated_by, cells: {} };
const calls = {};
for (const [cell, cs] of Object.entries(s.cells)) {
  const [A, B] = cs.routes;
  const dirOf = (r) => path.join(R, 'corr', cell, r.replace(/[^a-z0-9]+/gi, '_'));
  const skipped = JSON.parse(fs.readFileSync(`${R}/dry-${cell}.json`)).skipped_pages || {};
  const vOf = (route, id) => { const k = key.find((x) => x.cell === cell && x.route === route && x.kind === 'item' && x.page_id === id); return k && V.get(k.judged_as); };
  const meta = (r, id) => { try { return JSON.parse(fs.readFileSync(path.join(dirOf(r), `${id}.meta.json`))); } catch { return null; } };
  // agy calls per page, measured over every page each route read (A: whole blocks; B: one correction a page + re-reads)
  for (const r of [A, B]) { const ms = fs.readdirSync(dirOf(r)).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dirOf(r), f))));
    const n = r === A && cs.correctors[A].perCall > 1 ? new Set(ms.map((m) => m.call_id ?? m.page_id)).size + ms.filter((m) => m.call_pages === 1 && m.call_id == null).length * 0 : ms.reduce((t, m) => t + (m.calls ?? 1), 0);
    (calls[cell] ??= {})[r] = { calls: n, pages: ms.length, per_page: +(n / ms.length).toFixed(3) }; }
  const row = (p, v, extra = {}) => { const m = meta(A, p.page_id); const text = fs.existsSync(path.join(dirOf(A), `${p.page_id}.txt`)) ? fs.readFileSync(path.join(dirOf(A), `${p.page_id}.txt`), 'utf8') : '';
    const tag = (text.match(/<script>\s*(\w+)\s*<\/script>/i)?.[1] || '').toLowerCase();
    return { page_id: p.page_id, book_id: p.book_id, accept: !!v?.accept, wt: !!v && wt(v), classes: [...new Set((v?.defects || []).map(cls))], delivered: !!v, cut: /cut/.test(m?.wrapper || m?.error_class || ''),
      written: !(p.page_id in skipped), script: tag === 'handwritten' ? 'manuscript' : tag ? 'print' : 'unknown', ...extra }; };
  const rowsA = cs.pages.map((p) => row(p, vOf(A, p.page_id)));
  // B as the lane would serve it: its correction where it gave one (UNCHANGED is A's text), else A's read.
  const rowsB = cs.pages.map((p) => { const vb = vOf(B, p.page_id); return row(p, vb ?? vOf(A, p.page_id), { b_fell_back: !vb }); });
  const routes = {
    [A]: { ...agg(rowsA), note: 'every drawn page; a filter-cut or failed read counts as not accepted (the #7517 convention)' },
    [`${A}-written`]: { ...agg(rowsA.filter((r) => r.written)), note: 'the drawn pages the lane writes (delivered and past cli-ocr.mjs apply --first-read-only --print-only); a page not written stays scans-only' },
    [B]: { ...agg(rowsB), note: `arm B: ${A} then the #7558 correction pass on it (fc template, the image, one page a call); where it gave no correction the page serves ${A}'s read` },
    [`${B}-written`]: { ...agg(rowsB.filter((r) => r.written)), note: `arm B on the pages the lane writes (${A}-written's pages)` } };
  unsplit.cells[cell] = { task: 'ocr', lang: cs.lang, frame: cs.frame, agy_calls: calls[cell], routes };
  for (const sc of ['print', 'manuscript', 'unknown']) {
    const pick = (rows) => rows.filter((r) => r.script === sc);
    const rs = Object.fromEntries([[A, agg(pick(rowsA))], [`${A}-written`, agg(pick(rowsA).filter((r) => r.written))], [B, agg(pick(rowsB))], [`${B}-written`, agg(pick(rowsB).filter((r) => r.written))]].filter(([, x]) => x.n > 0));
    if (Object.keys(rs).length) byScript.cells[`${cell}|${sc}`] = { routes: rs };
  }
  console.log(cell, JSON.stringify(calls[cell]), Object.entries(routes).map(([r, x]) => `${r} ${x.accept} wt ${x.wrong_text_pages}`).join(' | '));
}
fs.writeFileSync(path.join(EV, 'first-read-7701.score.json'), JSON.stringify(unsplit, null, 1) + '\n');
fs.writeFileSync(path.join(EV, 'by-script', 'first-read-7701.score.json'), JSON.stringify(byScript, null, 1) + '\n');
