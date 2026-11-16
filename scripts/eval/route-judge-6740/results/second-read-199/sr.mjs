// PRIOR ART: scripts/eval/correction-pass-7818/lib.mjs judgeAgy (route-judge-6740 judgePrompt through agy Gemini, imported
// unchanged) and scripts/eval/confidence-7866/judge.mjs (its Gemini stage: the /quota fail-closed check, resize >4 MB),
// scripts/eval/route-judge-6740/results/fix-scripts-199/audit.mjs (the better/same/worse rule the #199 wave audits used,
// restated in rel() below so this read and those audits mean the same thing). scripts/eval/error-zoo/second-read.mjs
// does not fit: it confirms a single flagged text, it does not compare a written text with the text it replaced.
/**
 * v3#199 second read: every page the four #199 correction jobs wrote (fix-latin, fix-euro, fix-scripts, fix-cjk), and
 * every correction their writer refused under its guards, judged BLIND against the page image by Gemini 3.8 Flash low
 * through agy (a judge outside the Claude family that wrote them). One text a call, the same judgePrompt as the jobs'
 * audits; the written text and the text it replaced are separate calls, in shuffled order, under random ids.
 * Read-only against Mongo; files only, under --out (default $JOB_SCRATCH/sr).
 *
 *   prep     reads OUT/manifest.jsonl (built by the job from the four jobs' lists), fetches each page, its image, and for a
 *            written page the text it replaced (page_revisions row of the run), and writes items.jsonl + texts/ + img/,
 *            with 12 wrong-page controls and 12 repeats.
 *   judge    --shard=i/n [--concurrency=2]   (AGY_HOME picks the Gemini pool) → verdicts-<i>.jsonl
 *   score    → score.json (per page: written vs replaced, refused correction vs stored)
 *   confirm  items for a second, fresh judgement of both texts of every page round 1 called worse (role confirm-*)
 *   revert   → revert/<run_id>.json: written pages worse in BOTH rounds (the input of revert-run.mjs --page-ids-file)
 *   eye      [--prompt-dirs=a,b]  → apply/ (reads, metas, prompts, prompt-ref.json) + by-eye.jsonl: the refused
 *            corrections both Gemini calls accepted and round 1 did not rate worse than the stored text, book not held now.
 *            Written by cli-ocr.mjs apply --out=OUT/apply --by-eye=OUT/by-eye.jsonl (dry run first).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { judgeAgy } from '../../../correction-pass-7818/lib.mjs';
import { pageImageUrl } from '../../../spot-check/lib.mjs';
import { agyQuota, AGY_GEMINI_EMPTY } from '../../../../lib/agy-cli.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(arg('out', path.join(process.env.JOB_SCRATCH || '/tmp', 'sr')));
const MODEL = 'gemini-3.8-flash-low';
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const P = (...a) => path.join(OUT, ...a);
const rid = () => 'j' + crypto.randomBytes(6).toString('hex');
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const cmd = process.argv[2];

/** The #199 audits' rule: worse = lower fidelity, or accepted → not accepted; better = the reverse; else same. */
export function rel(c, s) {
  const worse = c.fidelity < s.fidelity || (s.accept && !c.accept);
  const better = !worse && (c.fidelity > s.fidelity || (!s.accept && c.accept));
  return worse ? 'worse' : better ? 'better' : 'same';
}

async function image(pageId, url) {
  const f = P('img', `${pageId}.jpg`);
  if (fs.existsSync(f)) return f;
  const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/199 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(60e3) });
  if (!r.ok) throw new Error(`image HTTP ${r.status}`);
  let buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 4e6) { const { default: sharp } = await import('sharp'); buf = await sharp(buf).resize(3000, 3000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(); }
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
  return f;
}

if (cmd === 'prep') {
  const man = jsonl(P('manifest.jsonl'));
  const have = new Map(jsonl(P('pages.jsonl')).map((p) => [`${p.kind}:${p.page_id}`, p]));
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect(); const db = client.db('bookstore');
  fs.mkdirSync(P('texts'), { recursive: true });
  const books = new Map();
  for (const m of man) {
    if (have.has(`${m.kind}:${m.page_id}`)) continue;
    const pg = await db.collection('pages').findOne({ id: m.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, translation_withheld: 1, photo: 1, cropped_photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1 } });
    if (!books.has(m.book_id)) books.set(m.book_id, await db.collection('books').findOne({ id: m.book_id }, { projection: { language: 1, title: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold_reason': 1 } }));
    const b = books.get(m.book_id);
    const row = { ...m, lang: Array.isArray(b?.language) ? b.language.join('/') : b?.language || 'unknown', held: b?.pipeline_auto?.status === 'held', hold_reason: b?.pipeline_auto?.hold_reason ?? null, withheld: !!pg?.translation_withheld };
    const cur = pg?.ocr?.data ?? '';
    let corr, stored;
    if (m.kind === 'written') {
      const rev = await db.collection('page_revisions').findOne({ run_id: m.run_id, page_id: m.page_id, field: 'ocr' });
      if (!rev) { row.skip = 'no revision row for the run'; }
      else { corr = cur; stored = String(rev.data ?? ''); row.holds = sha(cur).slice(0, 16) === rev.next_hash; if (!row.holds) row.skip = 'page changed since the run wrote it'; }
    } else {
      corr = fs.readFileSync(m.read_file, 'utf8'); stored = cur;
      row.read_sha256 = sha(corr); row.stored_sha256 = sha(cur);
      if (m.stored_sha16 && sha(cur).slice(0, 16) !== m.stored_sha16) { row.skip = 'stored text changed since the correction was read'; }
    }
    const url = pg && pageImageUrl(pg);
    if (!row.skip) { try { row.image = await image(m.page_id, url); } catch (e) { row.skip = `image: ${e.message}`; } }
    if (!row.skip) {
      row.corr_id = rid(); row.stored_id = rid();
      fs.writeFileSync(P('texts', `${row.corr_id}.txt`), corr); fs.writeFileSync(P('texts', `${row.stored_id}.txt`), stored);
    }
    fs.appendFileSync(P('pages.jsonl'), JSON.stringify(row) + '\n');
    console.log(`${m.kind} ${m.page_id} ${row.skip ?? 'ok'}`);
  }
  await client.close();
  // items: manuscripts first, then print; each page's two texts as separate, shuffled calls
  if (!fs.existsSync(P('items.jsonl'))) {
    const pages = jsonl(P('pages.jsonl')).filter((p) => !p.skip);
    const items = (ms) => shuffle(pages.filter((p) => !!p.ms === ms).flatMap((p) => [
      { id: p.corr_id, page_id: p.page_id, role: p.kind === 'written' ? 'written' : 'refused-corr', lang: p.lang, image: p.image },
      { id: p.stored_id, page_id: p.page_id, role: p.kind === 'written' ? 'replaced' : 'refused-stored', lang: p.lang, image: p.image }]));
    const all = [...items(true), ...items(false)];
    // controls: 12 wrong-page (page a's image, a written text from another book), 12 repeats of a written text
    const w = shuffle(pages.filter((p) => p.kind === 'written'));
    const ctl = [];
    for (let i = 0; i < 12 && w.length > 24; i++) {
      const a = w[i], b = w.find((x, j) => j > 12 && x.book_id !== a.book_id && !ctl.some((c) => c.other === x.page_id));
      const id = rid(); fs.copyFileSync(P('texts', `${b.corr_id}.txt`), P('texts', `${id}.txt`));
      ctl.push({ id, page_id: a.page_id, role: 'wrong_page', other: b.page_id, lang: a.lang, image: a.image });
    }
    for (let i = 12; i < 24 && i < w.length; i++) { const a = w[i]; const id = rid(); fs.copyFileSync(P('texts', `${a.corr_id}.txt`), P('texts', `${id}.txt`)); ctl.push({ id, page_id: a.page_id, role: 'repeat', of: a.corr_id, lang: a.lang, image: a.image }); }
    // controls spread through the queue so a quota stop does not leave them all unjudged
    for (const c of ctl) all.splice(crypto.randomInt(Math.min(all.length, 600)), 0, c);
    fs.writeFileSync(P('items.jsonl'), all.map((x) => JSON.stringify(x)).join('\n') + '\n');
    console.log(`items ${all.length} (${pages.length} pages, ${ctl.length} controls)`);
  }
} else if (cmd === 'judge') {
  const [i, n] = arg('shard', '0/1').split('/').map(Number);
  const file = P(arg('vfile', `verdicts-${i}.jsonl`)); // --vfile=verdicts-NN.jsonl for an extra items file, so it never shares a shard's file
  const done = new Set(jsonl(file).filter((r) => r.verdict).map((r) => r.id));
  const tries = new Map(); for (const r of jsonl(file)) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const src = arg('items', 'items.jsonl');
  const todo = jsonl(P(src)).filter((it, k) => k % n === i && !done.has(it.id) && (tries.get(it.id) ?? 0) < 2);
  console.log(`shard ${i}/${n} (${process.env.AGY_HOME || 'default'}): ${todo.length} to judge`);
  let k = 0, stop = null, qAt = 0;
  const quotaOk = () => {
    if (Date.now() - qAt < 10 * 60e3) return null; qAt = Date.now();
    const q = agyQuota(); if (!q) return 'agy /quota unreadable: fail closed';
    if (!(q.gemini.weekly >= 0.2)) return `agy Gemini weekly pool under 20% (${q.gemini.weekly})`;
    if (!(q.gemini.h5 == null || q.gemini.h5 >= AGY_GEMINI_EMPTY)) return `agy Gemini 5h pool empty (${q.gemini.h5})`;
    return null;
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', 2)) }, async () => {
    while (!stop && k < todo.length) {
      const why = quotaOk(); if (why) { stop = why; break; }
      const it = todo[k++];
      let g; const t0 = Date.now();
      try { g = await judgeAgy({ lang: it.lang, text: fs.readFileSync(P('texts', `${it.id}.txt`), 'utf8') }, fs.readFileSync(it.image), { model: MODEL }); } catch (e) { g = { verdict: null, err: String(e.message || e).slice(0, 200) }; }
      if (g.quota) { stop = `agy quota (${g.err})`; break; }
      fs.appendFileSync(file, JSON.stringify({ id: it.id, role: it.role, page_id: it.page_id, pool: process.env.AGY_HOME || 'default', ...g, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.role} ${it.id}: ${g.verdict ? `accept=${g.verdict.accept} f${g.verdict.fidelity}` : `none ${g.cls ?? g.err ?? ''}`}`);
    }
  }));
  console.log(stop ? `STOPPED: ${stop}` : 'shard done'); if (stop) process.exit(3);
} else if (cmd === 'score' || cmd === 'confirm') {
  const V = new Map(); for (const f of fs.readdirSync(OUT).filter((f) => /^verdicts-\d+\.jsonl$/.test(f))) for (const r of jsonl(P(f))) if (r.verdict) V.set(r.id, r.verdict);
  const pages = jsonl(P('pages.jsonl')); const items = jsonl(P('items.jsonl')); const conf = jsonl(P('confirm-items.jsonl'));
  if (cmd === 'confirm') {
    const rows = [];
    for (const p of pages.filter((p) => p.kind === 'written' && !p.skip)) {
      const c = V.get(p.corr_id), s = V.get(p.stored_id); if (!c || !s || rel(c, s) !== 'worse') continue;
      if (conf.some((x) => x.page_id === p.page_id)) continue;
      for (const [role, src] of [['confirm-written', p.corr_id], ['confirm-replaced', p.stored_id]]) { const id = rid(); fs.copyFileSync(P('texts', `${src}.txt`), P('texts', `${id}.txt`)); rows.push({ id, page_id: p.page_id, role, of: src, lang: p.lang, image: p.image }); }
    }
    // refused corrections the first read accepted: a second, fresh judgement of the correction before any write
    for (const p of pages.filter((p) => p.kind === 'refused' && !p.skip)) {
      const c = V.get(p.corr_id); if (!c?.accept || conf.some((x) => x.page_id === p.page_id)) continue;
      const id = rid(); fs.copyFileSync(P('texts', `${p.corr_id}.txt`), P('texts', `${id}.txt`)); rows.push({ id, page_id: p.page_id, role: 'confirm-refused-corr', of: p.corr_id, lang: p.lang, image: p.image });
    }
    fs.appendFileSync(P('confirm-items.jsonl'), rows.map((x) => JSON.stringify(x)).join('\n') + (rows.length ? '\n' : ''));
    console.log(`confirm items: ${rows.length}`); process.exit(0);
  }
  const cv = (pid, role) => { const x = conf.find((c) => c.page_id === pid && c.role === role); return x ? V.get(x.id) : undefined; };
  const out = { written: [], refused: [], controls: { wrong_page: [], repeat: [] } };
  for (const p of pages) {
    const base = { page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, job: p.job, run_id: p.run_id, corrector: p.corrector, ms: !!p.ms, held: p.held, skip: p.skip };
    if (p.skip) { out[p.kind].push(base); continue; }
    const c = V.get(p.corr_id), s = V.get(p.stored_id);
    const r = { ...base, corr: c ? [c.accept, c.fidelity] : null, stored: s ? [s.accept, s.fidelity] : null, rel: c && s ? rel(c, s) : null };
    if (p.kind === 'written' && r.rel === 'worse') {
      const c2 = cv(p.page_id, 'confirm-written'), s2 = cv(p.page_id, 'confirm-replaced');
      r.confirm = c2 && s2 ? [c2.accept, c2.fidelity, s2.accept, s2.fidelity] : null;
      r.confirm_rel = c2 && s2 ? rel(c2, s2) : null;
      r.worse_note = c.reader_note; r.worse_defects = (c.defects || []).filter((d) => d.severity !== 'cosmetic').slice(0, 5);
    }
    if (p.kind === 'refused') { const c2 = cv(p.page_id, 'confirm-refused-corr'); r.confirm = c2 ? [c2.accept, c2.fidelity] : null; r.read_sha256 = p.read_sha256; r.read_file = p.read_file; r.note = c?.reader_note; }
    out[p.kind].push(r);
  }
  for (const it of items.filter((x) => x.role === 'wrong_page')) { const v = V.get(it.id); out.controls.wrong_page.push(v ? { accept: v.accept, fidelity: v.fidelity, held: !v.accept && v.fidelity <= 2 } : null); }
  for (const it of items.filter((x) => x.role === 'repeat')) { const a = V.get(it.id), b = V.get(it.of); out.controls.repeat.push(a && b ? { a: [a.accept, a.fidelity], b: [b.accept, b.fidelity], flip: a.accept !== b.accept, d: Math.abs(a.fidelity - b.fidelity) } : null); }
  // the confirm round's own noise: each worse page's written text judged twice
  const tally = (rows, key) => { const t = {}; for (const r of rows) { const k = key(r); t[k] ??= { pages: 0, judged: 0, better: 0, same: 0, worse: 0, worse_confirmed: 0, skipped: 0 }; const x = t[k]; x.pages++; if (r.skip) { x.skipped++; continue; } if (!r.rel) continue; x.judged++; x[r.rel]++; if (r.rel === 'worse' && r.confirm_rel === 'worse') x.worse_confirmed++; } return t; };
  out.by_job = tally(out.written, (r) => r.job); out.by_form = tally(out.written, (r) => (r.ms ? 'manuscript' : 'print'));
  out.by_job_form = tally(out.written, (r) => `${r.job} ${r.ms ? 'ms' : 'print'}`); out.by_corrector_form = tally(out.written, (r) => `${r.corrector} ${r.ms ? 'ms' : 'print'}`);
  out.total = tally(out.written, () => 'all');
  fs.writeFileSync(P('score.json'), JSON.stringify(out, null, 1));
  const { written, refused, ...show } = out; console.log(JSON.stringify(show, null, 1));
  console.log(`refused: ${refused.length}, judged ${refused.filter((r) => r.corr).length}, accepted ${refused.filter((r) => r.corr?.[0]).length}, confirmed ${refused.filter((r) => r.corr?.[0] && r.confirm?.[0]).length}`);
} else if (cmd === 'revert') {
  const sc = JSON.parse(fs.readFileSync(P('score.json'), 'utf8'));
  const runs = {};
  for (const r of sc.written) if (r.rel === 'worse' && r.confirm_rel === 'worse') (runs[r.run_id] ??= []).push(r.page_id);
  fs.mkdirSync(P('revert'), { recursive: true });
  for (const [run, ids] of Object.entries(runs)) fs.writeFileSync(P('revert', `${run}.json`), JSON.stringify(ids));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, v.length]))));
} else if (cmd === 'eye') {
  const sc = JSON.parse(fs.readFileSync(P('score.json'), 'utf8'));
  const pages = new Map(jsonl(P('pages.jsonl')).filter((p) => p.kind === 'refused').map((p) => [p.page_id, p]));
  const promptDirs = arg('prompt-dirs', '').split(',').filter(Boolean);
  const dir = P('apply'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'prompts'), { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect(); const db = client.db('bookstore');
  const rows = [], left = []; let ref = null;
  for (const r of sc.refused) {
    const p = pages.get(r.page_id);
    const book = await db.collection('books').findOne({ id: r.book_id }, { projection: { 'pipeline_auto.status': 1 } });
    const why = r.skip ? `skipped: ${r.skip}` : !r.corr ? 'not judged' : !r.corr[0] ? 'round 1 does not accept the correction'
      : !r.confirm ? 'confirm call not judged' : !r.confirm[0] ? 'confirm call does not accept the correction'
      : r.rel === 'worse' ? 'rated worse than the stored text' : book?.pipeline_auto?.status === 'held' ? 'book held' : null;
    if (why) { left.push({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, job: r.job, ms: r.ms, why, corr: r.corr, confirm: r.confirm, stored: r.stored }); continue; }
    const meta = JSON.parse(fs.readFileSync(p.read_file.replace(/\.txt$/, '.meta.json'), 'utf8'));
    const cands = [path.join(p.read_dir, meta.prompt_sent_file), ...promptDirs.map((d) => path.join(d, p.wave ?? '', meta.prompt_sent_file))];
    const pf = cands.find((f) => fs.existsSync(f)); if (!pf) throw new Error(`no prompt file for ${r.page_id}: ${cands.join(' ')}`);
    const refs = [path.join(p.read_dir, 'prompt-ref.json'), ...promptDirs.map((d) => path.join(d, p.wave ?? '', 'prompt-ref.json'))].filter((f) => fs.existsSync(f));
    const thisRef = fs.readFileSync(refs[0], 'utf8'); if (ref != null && ref !== thisRef) throw new Error(`prompt-ref differs for ${r.page_id}`); ref = thisRef;
    fs.copyFileSync(pf, path.join(dir, meta.prompt_sent_file));
    fs.copyFileSync(p.read_file, path.join(dir, `${r.page_id}.txt`)); fs.writeFileSync(path.join(dir, `${r.page_id}.meta.json`), JSON.stringify(meta, null, 1));
    rows.push({ page_id: r.page_id, read_sha256: sha(fs.readFileSync(p.read_file, 'utf8').trim()), verdict: 'read-matches-image',
      checked_by: `Gemini 3.8 Flash low (agy), blind against the image, two calls (fidelity ${r.corr[1]} and ${r.confirm[1]}; stored text ${r.stored?.[1] ?? '?'}), second-read-199`,
      at: new Date().toISOString(), note: `guard-refused correction by ${r.corrector} (${r.job}, ${r.run_id}); ${String(r.note ?? '').slice(0, 300)}` });
  }
  await client.close();
  if (ref != null) fs.writeFileSync(path.join(dir, 'prompt-ref.json'), ref);
  fs.writeFileSync(P('by-eye.jsonl'), rows.map((x) => JSON.stringify(x)).join('\n') + (rows.length ? '\n' : ''));
  fs.writeFileSync(P('refused-left.json'), JSON.stringify(left, null, 1));
  const t = {}; for (const x of left) t[x.why] = (t[x.why] || 0) + 1;
  console.log(`by-eye rows: ${rows.length}; left: ${left.length}`, t);
}
