// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs and paired-arm.mjs — the judge prompt, call and parse are imported from judge.mjs unchanged; this is the job's thin driver (judge model choice, per-wave audit draw/record, wave report), kept here as the record of how v3#199 ran, not as a reusable tool.
// v3#199 fix-scripts: per-wave audit. draw: 10 random written pages (from apply's --emit-written file) into a jd packet
// (written text + the text it replaced, both judged blind by the model that did NOT write them).
// record: verdicts -> book_checks via recordPageVerdicts, method lane-spot-check.
//   draw   --wave=DIR --writer=opus [--n=10] [--spread]     (needs DIR/written.jsonl, DIR/reads, DIR/stored)
//   record --wave=DIR --writer=opus --run=fix-scripts-wN-ocr [--apply]
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { randomBytes, randomInt } from 'node:crypto';
const R = '/root/worktrees/job-fix-scripts/';
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const W = path.resolve(arg('wave')), writer = arg('writer'), judge = arg('judge', writer === 'opus' ? 'fable' : 'opus'), A = path.join(W, 'audit');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
if (process.argv[2] === 'draw') {
  fs.mkdirSync(A, { recursive: true });
  const man = new Map(jsonl(path.join(W, 'manifest.jsonl')).map((m) => [m.page_id, m]));
  const written = jsonl(path.join(W, 'written.jsonl')).filter((w) => w.apply);
  const pool = [...written]; for (let i = pool.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const N = Number(arg('n', 10)); const pick = [];
  if (process.argv.includes('--spread')) { const seen = new Set(); for (const w of pool) { const l = man.get(w.page_id)?.group; if (!seen.has(l) && pick.length < N) { seen.add(l); pick.push(w); } } }
  const books = new Set(pick.map((p) => p.book_id));
  for (const w of pool) { if (pick.length >= N) break; if (pick.includes(w) || books.has(w.book_id)) continue; books.add(w.book_id); pick.push(w); }
  for (const w of pool) { if (pick.length >= N) break; if (!pick.includes(w)) pick.push(w); }
  const items = [], key = [], assign = {};
  for (const w of pick) { const m = man.get(w.page_id); const image = path.join(W, 'reads', `ws-${w.page_id}`, `${w.page_id}.jpg`); const stored = fs.readFileSync(path.join(W, 'stored', `${w.page_id}.txt`), 'utf8');
    for (const [route, text] of [['stored', stored], [writer, w.text]]) { const id = 'j' + randomBytes(6).toString('hex'); items.push({ id, task: 'ocr', lang: m.language, text, image_file: image }); assign[id] = [judge]; key.push({ id: `${route}:${w.page_id}`, judged_as: id, cell: m.group, route, kind: 'item', page_id: w.page_id, book_id: w.book_id, language: m.language }); } }
  // one wrong-page control: first page's image with the last page's written text
  if (pick.length > 1) { const a = pick[0], b = pick[pick.length - 1]; const id = 'j' + randomBytes(6).toString('hex'); items.push({ id, task: 'ocr', lang: man.get(a.page_id).language, text: b.text, image_file: path.join(W, 'reads', `ws-${a.page_id}`, `${a.page_id}.jpg`) }); assign[id] = [judge]; key.push({ id: `wp:${writer}:${judge}:${a.page_id}`, judged_as: id, cell: 'control', route: writer, kind: 'wrong_page', page_id: a.page_id, book_id: a.book_id }); }
  items.sort(() => randomInt(3) - 1);
  fs.writeFileSync(path.join(A, 'packet.json'), JSON.stringify({ items }, null, 1)); fs.writeFileSync(path.join(A, 'key.json'), JSON.stringify(key, null, 1)); fs.writeFileSync(path.join(A, 'assign.json'), JSON.stringify(assign, null, 1));
  console.log(`audit draw: ${pick.length} pages of ${written.length} written; judge ${judge}; languages ${pick.map((p) => man.get(p.page_id).language).join(', ')}`);
} else {
  const { recordPageVerdicts } = await import(R + 'scripts/lib/book-checks.mjs'); const { kindOfClass } = await import(R + 'scripts/lib/review-vocabulary.mjs'); const { MongoClient } = await import('mongodb');
  const key = JSON.parse(fs.readFileSync(path.join(A, 'key.json'), 'utf8')); const pk = new Map(JSON.parse(fs.readFileSync(path.join(A, 'packet.json'), 'utf8')).items.map((i) => [i.id, i]));
  const V = new Map(jsonl(path.join(A, `verdicts-${judge}.jsonl`)).filter((r) => r.verdict).map((r) => [r.id, r]));
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect(); const db = client.db('bookstore');
  const tr = new Map((await db.collection('pages').find({ id: { $in: key.map((k) => k.page_id) } }, { projection: { id: 1, 'translation.data': 1 } }).toArray()).map((p) => [p.id, p.translation?.data ?? '']));
  const verdicts = []; let worse = 0, better = 0, same = 0; const lines = [];
  for (const k of key.filter((k) => k.route === writer && k.kind === 'item')) {
    const c = V.get(k.judged_as)?.verdict, s = V.get(key.find((x) => x.id === `stored:${k.page_id}`).judged_as)?.verdict; if (!c || !s) { lines.push(`${k.page_id}: no verdict`); continue; }
    const w = c.fidelity < s.fidelity || (s.accept && !c.accept), b = !w && (c.fidelity > s.fidelity || (!s.accept && c.accept)); if (w) worse++; else if (b) better++; else same++;
    const bad = (c.defects || []).filter((d) => d.severity === 'wrong_text' || d.severity === 'misleads'); const serious = c.accept === false || c.fidelity <= 3;
    const errors = serious ? (bad.length ? bad : [{ class: 'E2', what: c.reader_note }]).slice(0, 8).map((d) => ({ stage: 'ocr', ...(d.class && /^[A-Z]\d+$/.test(d.class) && kindOfClass(d.class) ? { kind: kindOfClass(d.class) } : {}), problem: `${d.what || ''}${d.quote ? ` — "${String(d.quote).slice(0, 200)}"` : ''}`.slice(0, 600) })) : [];
    verdicts.push({ page_id: k.page_id, outcome: serious ? 'serious' : (c.defects || []).length ? 'minor' : 'clean', page_verdict: serious ? (c.fidelity <= 1 ? 'fix' : 'caveat') : 'show', verdict: `accept=${c.accept} fidelity=${c.fidelity}; replaced text accept=${s.accept} fidelity=${s.fidelity} (${w ? 'worse' : b ? 'better' : 'same'})`, note: String(c.reader_note || '').slice(0, 600), errors, defects: [], judged: { ocr: pk.get(k.judged_as).text, translation: tr.get(k.page_id) } });
    lines.push(`${k.book_id} ${k.page_id} ${k.language}: stored ${s.accept ? 'A' : 'R'}${s.fidelity} -> written ${c.accept ? 'A' : 'R'}${c.fidelity} ${w ? 'WORSE' : b ? 'better' : 'same'}`);
  }
  const ctl = key.filter((k) => k.kind === 'wrong_page').map((k) => V.get(k.judged_as)?.verdict).map((v) => (v ? `accept=${v.accept} fidelity=${v.fidelity}` : 'none'));
  const model = [...V.values()][0]?.model;
  const out = await recordPageVerdicts(db, { method_id: 'lane-spot-check', method_version: 1, run_id: `${arg('run')}-audit`, checked_at: new Date().toISOString(), selection: 'random', stages: ['ocr'], reader: { kind: 'model', model: model ?? `claude -p --model ${judge}`, image_opened: true }, evidence_path: `box:${os.hostname()}:${path.join(A, `verdicts-${judge}.jsonl`)}`, reader_warning: false, frame: { lane: 'fix-scripts (v3#199)', run_id: arg('run'), pages_drawn: verdicts.length, rubric: 'judge.mjs judgePrompt (accept, fidelity 1-5); serious = not accepted or fidelity <= 3' }, note: `v3#199 wave audit: written by ${writer}, judged blind by ${judge}${judge === writer ? ' (same-family: a fresh blind session of the writing model)' : ''}`, verdicts }, { apply: process.argv.includes('--apply') });
  await client.close();
  const res = { judged: verdicts.length, better, same, worse, control: ctl, recorded: { inserted: out.inserted, already: out.already, failed: out.failed, rows: out.rows.length }, lines };
  fs.writeFileSync(path.join(A, 'audit-result.json'), JSON.stringify(res, null, 1)); console.log(JSON.stringify(res, null, 1));
}
