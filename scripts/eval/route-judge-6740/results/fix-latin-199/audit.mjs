// PRIOR ART: scripts/batch/siku-translate-lane.mjs spotCheck/recordSpot — wired to the Siku lane's own draw, JUDGE prompt
// and translation rubric; it cannot sample a cli-ocr apply's written pages or score a correction against the text it
// replaced. This draws a wave's 10-page audit, builds the pj.mjs spec (stored vs written, one judge), tallies
// worse/better and records the verdicts through recordPageVerdicts (method lane-spot-check). v3#199.
//   node audit.mjs spec   <wave> <judge> <corrector>     -> $S/w<wave>/audit/spec.json   (then pj.mjs build + judge)
//   node audit.mjs record <wave> <judge> <corrector> [--apply]
import fs from 'node:fs'; import path from 'node:path';
const ROOT = process.env.SL_ROOT || process.cwd();
const S = process.env.JOB_SCRATCH; const [, , STAGE, N, JUDGE, CORR] = process.argv; const APPLY = process.argv.includes('--apply');
const W = `${S}/w${N}`, A = `${W}/audit`;
const MODEL_ID = { fable: 'claude-fable-5-2', opus: 'claude-opus-5-5' };
const { MongoClient } = await import(path.join(ROOT, 'node_modules/mongodb/lib/index.js')).then((m) => m.default ?? m);
const client = await MongoClient.connect(process.env.MONGODB_URI); const db = client.db('bookstore');
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (STAGE === 'spec') {
  fs.mkdirSync(A, { recursive: true });
  const written = lines(`${W}/written.jsonl`);
  const man = new Map(lines(`${W}/manifest.jsonl`).map((r) => [r.page_id, r]));
  const sh = (a) => a.map((x) => [Math.random(), x]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  const pool = sh(written.map((w) => ({ ...man.get(w.page_id), page_id: w.page_id })));
  const pick = [], books = new Set();
  for (const p of pool) if (pick.length < 10 && !books.has(p.book_id)) { pick.push(p); books.add(p.book_id); }
  for (const p of pool) if (pick.length < 10 && !pick.includes(p)) pick.push(p);
  const live = new Map((await db.collection('pages').find({ id: { $in: pick.map((p) => p.page_id) } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p.ocr?.data ?? '']));
  const spec = { lang: 'Latin', cell: `fix-latin-w${N}`, baseline: 'stored', controls: 2,
    pages: pick.map((p) => ({ page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, image_file: `${W}/reads/ws-${p.page_id}/${p.page_id}.jpg`, cellx: p.cellx })),
    arms: { stored: Object.fromEntries(pick.map((p) => [p.page_id, fs.readFileSync(`${W}/stored/${p.page_id}.txt`, 'utf8')])), [CORR]: Object.fromEntries(pick.map((p) => [p.page_id, live.get(p.page_id)])) },
    judges: { [JUDGE]: ['stored', CORR] } };
  for (const p of spec.pages) if (!fs.existsSync(p.image_file)) throw new Error('no image ' + p.image_file);
  fs.writeFileSync(`${A}/spec.json`, JSON.stringify(spec));
  console.log(`audit w${N}: ${pick.length} pages in ${books.size} books; written pool ${written.length}`);
} else if (STAGE === 'record') {
  const key = JSON.parse(fs.readFileSync(`${A}/key.json`)); const spec = JSON.parse(fs.readFileSync(`${A}/spec.json`));
  const V = new Map(lines(`${A}/verdicts-${JUDGE}.jsonl`).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  const st = new Map(key.filter((k) => k.kind === 'item' && k.route === 'stored').map((k) => [k.page_id, V.get(k.judged_as)]));
  const wp = key.filter((k) => k.kind === 'wrong_page').map((k) => V.get(k.judged_as));
  const wt = (v) => (v.defects || []).filter((d) => d.severity === 'wrong_text');
  let better = 0, same = 0, worse = 0, missing = 0; const verdicts = [], rows = [];
  for (const k of key.filter((k) => k.kind === 'item' && k.route === CORR)) {
    const a = V.get(k.judged_as), s = st.get(k.page_id); if (!a || !s) { missing++; continue; }
    const w = a.fidelity < s.fidelity || (s.accept && !a.accept), b = !w && (a.fidelity > s.fidelity || (!s.accept && a.accept));
    if (w) worse++; else if (b) better++; else same++;
    rows.push({ page_id: k.page_id, book_id: k.book_id, page_number: k.page_number, stored: `${s.accept ? 'A' : 'r'}${s.fidelity}/wt${wt(s).length}`, written: `${a.accept ? 'A' : 'r'}${a.fidelity}/wt${wt(a).length}`, rel: w ? 'worse' : b ? 'better' : 'same' });
    const serious = !a.accept && (a.fidelity <= 3 || wt(a).length > 0);
    verdicts.push({ page_id: k.page_id, outcome: serious ? 'serious' : (a.defects || []).length ? 'minor' : 'clean', page_verdict: a.fidelity <= 2 ? 'fix' : serious ? 'caveat' : 'show',
      verdict: `${a.accept ? 'accept' : 'reject'}, fidelity ${a.fidelity}; replaced text judged ${s.accept ? 'accept' : 'reject'}, fidelity ${s.fidelity}`, note: a.reader_note,
      ...(serious ? { errors: (wt(a).length ? wt(a) : (a.defects || []).slice(0, 3)).slice(0, 5).map((d) => ({ stage: 'ocr', class: d.class, problem: `${d.what}${d.quote ? ` ("${String(d.quote).slice(0, 80)}")` : ''}` })) } : {}),
      defects: a.defects || [], judged: { ocr: spec.arms[CORR][k.page_id] } });
  }
  for (const v of verdicts) if (v.outcome === 'serious' && !v.errors.length) v.errors = [{ stage: 'ocr', problem: v.note || 'judge rejected the page without a listed defect' }];
  const { recordPageVerdicts } = await import(path.join(ROOT, 'scripts/lib/book-checks.mjs'));
  const out = await recordPageVerdicts(db, { method_id: 'lane-spot-check', method_version: 1, run_id: `fix-latin-w${N}-audit`, checked_at: new Date(), selection: 'random', stages: ['ocr'],
    reader: { kind: 'model', model: MODEL_ID[JUDGE], image_opened: true }, evidence_path: `scripts/eval/route-judge-6740/results/fix-latin-199/audit-w${N}/`, reader_warning: false,
    frame: { lane: `fix-latin-w${N}`, pages_drawn: spec.pages.length, verdicts_kept: verdicts.length, corrector: MODEL_ID[CORR] },
    note: `v3#199 wave ${N}: ${MODEL_ID[CORR]} corrections of measured-bad Latin pages, 10 random writes judged blind against the image by ${MODEL_ID[JUDGE]} with the route judge's rubric (accept + fidelity 1-5), each beside the text it replaced`, verdicts }, { apply: APPLY });
  const res = { wave: N, judge: JUDGE, corrector: CORR, better, same, worse, missing, controls: wp.map((v) => v ? `accept=${v.accept} f${v.fidelity}` : 'none'), rows, recorded: { apply: APPLY, rows: out.rows.length, inserted: out.inserted, already: out.already, failed: out.failed } };
  fs.writeFileSync(`${A}/audit-result${APPLY ? '' : '-dry'}.json`, JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, null, 1));
}
await client.close();
