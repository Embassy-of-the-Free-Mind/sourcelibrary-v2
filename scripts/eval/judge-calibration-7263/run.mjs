#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs (the judge, its wrong-page control, its packet/key split) and
// scripts/eval/correction-pass-7818/lib.mjs (judgeAbsolute = that judge on an image buffer; paceCheck = the box's pace
// guard; the agy call shape of correctionRead): reused. Neither can read a page that is not in Mongo, nor score a verdict
// against a human transcription; this draws CHURRO-DS pages instead (see lib.mjs).
/**
 * Judge calibration against CHURRO-DS (#7263). Everything bulky lives in OUT ($JOB_SCRATCH/judge-cal-7263); the
 * committed summary (no CHURRO text: research-only licence) is results/.
 *
 *   node scripts/eval/judge-calibration-7263/run.mjs draw    [--n=20]   one page per source document, 7 strata
 *   node scripts/eval/judge-calibration-7263/run.mjs images             fetch, fit to 2,000 px long edge (JPEG)
 *   node --env-file=<.env.production.local> scripts/eval/judge-calibration-7263/run.mjs reads --by=agy|opus
 *                                        the live OCR prompt (read from Mongo, no writes) on the image alone
 *   node scripts/eval/judge-calibration-7263/run.mjs packet             candidates + truth key
 *   node scripts/eval/judge-calibration-7263/run.mjs judge  [--limit=N] [--concurrency=3]   Opus, judgeAbsolute, capped
 *   node scripts/eval/judge-calibration-7263/run.mjs score              results/score.json + rows.jsonl
 *
 * DESIGN (per page, 20 pages a stratum): one REAL read (agy gemini-3.8-flash-low on half the pages, Opus through
 * `claude -p` on the other half, alternating in the seeded order), one PLANTED gold (S1 / S2 / S3 rotating), and the
 * GOLD itself on half the pages; 2 wrong-page controls a stratum (this image, another page's gold); 20 repeat
 * judgements (a seeded subset judged twice) for the judge's own stability. Judge calls are capped at 400 (JUDGE_CAP).
 * Truth: windowed CER of the candidate against the gold <= TAU (primary 1%; 0.5%, 2%, 5% as sensitivities).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { STRATA, goldText, cerOf, cerLines, werTolerant, refChars, plantGraded, confusion, plugIn, logitFit, clusterBoot, wilson } from './lib.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = process.argv[2];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'judge-cal-7263'));
const META = arg('meta') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'churro', 'meta.json');
const RESULTS = path.join(HERE, 'results');
const N = Number(arg('n') || 20);
const JUDGE_CAP = 400;
const TAU = 0.01, TAUS = [0.005, 0.01, 0.02, 0.05];
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1)); };
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
fs.mkdirSync(OUT, { recursive: true });

/** The source document of a CHURRO example: the example id less its last _/space-separated token, if one is left. */
export const docKey = (id) => { const [ds, rest = ''] = id.split(/\/(.*)/s); const m = rest.match(/^(.*\S)[_ -][^_ -]*$/); return `${ds}/${m && m[1].length >= 3 ? m[1] : rest}`; };

function draw() {
  const rows = JSON.parse(fs.readFileSync(META, 'utf8'));
  const sample = [], docs = new Set();   // one page per document across ALL strata (a multilingual MS is drawn once)
  for (const st of STRATA) {
    const pool = rows.filter((r) => r.main_language === st.lang && r.document_type === st.type)
      .map((r) => ({ r, gold: goldText(r.cleaned_transcription) }))
      .filter(({ gold }) => { const c = refChars(gold, st.script); return c >= 200 && c <= 6000; })   // a page with a real body of text, not a newspaper sheet (the judge reads it whole)
      .sort((a, b) => h(`cal7263${a.r.example_id}`).localeCompare(h(`cal7263${b.r.example_id}`)));
    // One page per source document; documents spread over collections first (round-robin by dataset_id).
    const byDs = new Map(); for (const x of pool) byDs.set(x.r.dataset_id, [...(byDs.get(x.r.dataset_id) ?? []), x]);
    const dss = [...byDs.keys()].sort((a, b) => h(`cal7263${a}`).localeCompare(h(`cal7263${b}`)));
    const got = [];
    for (let round = 0; got.length < N && round < 20; round++) for (const ds of dss) {
      if (got.length >= N) break;
      const x = byDs.get(ds).filter((y) => !docs.has(docKey(y.r.example_id)))[0];
      if (!x || byDs.get(ds).indexOf(x) < 0) continue;
      byDs.set(ds, byDs.get(ds).filter((y) => y !== x)); docs.add(docKey(x.r.example_id));
      got.push(x);
    }
    got.forEach(({ r, gold }, i) => sample.push({ page: r.example_id, stratum: st.id, lang: st.lang, type: st.type, script: st.script, dataset_id: r.dataset_id, doc: docKey(r.example_id),
      split: r.split, row_idx: r.row_idx, image_url: r.image, gold_sha: h(gold).slice(0, 16), gold_chars: refChars(gold, st.script),
      reader: i % 2 === 0 ? 'agy-flash-low' : 'opus', plant: ['S1', 'S2', 'S3'][i % 3], gold_item: i % 2 === 1, idx: i }));
    console.log(`${st.id}: ${got.length} pages from ${new Set(got.map((x) => x.r.dataset_id)).size} collections (pool ${pool.length})`);
    for (const { r, gold } of got) fs.writeFileSync(path.join(OUT, 'gold', `${safe(r.example_id)}.txt`), gold, { flag: 'w' });
  }
  W('sample.json', { drawn_at: new Date().toISOString(), n: N, salt: 'cal7263', meta: path.basename(META), pages: sample });
}
const safe = (id) => id.replace(/[^A-Za-z0-9._-]+/g, '_');
fs.mkdirSync(path.join(OUT, 'gold'), { recursive: true });
const goldOf = (p) => fs.readFileSync(path.join(OUT, 'gold', `${safe(p.page)}.txt`), 'utf8');
const imgFile = (p) => path.join(OUT, 'img', `${safe(p.page)}.jpg`);

async function images() {
  const sharp = (await import('sharp')).default;
  const s = J('sample.json');
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  for (const p of s.pages) {
    if (fs.existsSync(imgFile(p))) continue;
    let buf = null;
    for (let t = 0; t < 4 && !buf; t++) {
      const r = await fetch(p.image_url).catch(() => null);
      if (r?.ok) buf = Buffer.from(await r.arrayBuffer()); else await new Promise((z) => setTimeout(z, 3000));
    }
    if (!buf) { console.log(`no image: ${p.page}`); continue; }
    await sharp(buf).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(imgFile(p));
  }
  console.log(`images: ${s.pages.filter((p) => fs.existsSync(imgFile(p))).length}/${s.pages.length}`);
}

// ── the real reads: the live OCR prompt on the image alone, as cli-ocr.mjs read sends it (sentinels-6523) ──
async function reads() {
  const by = arg('by');
  if (!['agy', 'opus'].includes(by)) throw new Error('--by=agy|opus');
  const { MongoClient } = await import('mongodb');
  const { getProductionOcrPrompt } = await import('../lib/production-prompt.mjs');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const prompt = await getProductionOcrPrompt(c.db('bookstore')); await c.close();
  const { OCR_SENTINEL_INSTRUCTION } = await import('../../lib/cli-chatter.mjs');
  const { agyCall, installToolGate, unwrapRead, CLI_SAFE_ARGS } = await import('../../lib/agy-cli.mjs');
  const { opusCall } = await import('../route-judge-6740/judge.mjs');
  const { paceCheck } = await import('../correction-pass-7818/lib.mjs');
  const limits = await import('../../lib/model-limits.mjs');
  const s = J('sample.json');
  const dir = path.join(OUT, `reads-${by}`); fs.mkdirSync(dir, { recursive: true });
  const todo = s.pages.filter((p) => (p.reader === 'agy-flash-low') === (by === 'agy') && fs.existsSync(imgFile(p)) && !fs.existsSync(path.join(dir, `${safe(p.page)}.json`)));
  console.log(`${by}: ${todo.length} pages to read (prompt v${prompt.version} ${prompt.name})`);
  const pace = {}; let stop = null, i = 0;
  const one = async (p) => {
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cal7263-'));
    try {
      fs.copyFileSync(imgFile(p), path.join(ws, 'page.jpg'));
      const t0 = Date.now(); let rec;
      if (by === 'agy') {
        // cli-ocr.mjs imageInstruction('sentinels-6523'), restated (it is not exported).
        const sent = `${prompt.text}\n\nThe page image to transcribe is attached: @./page.jpg Transcribe it in the format above. ${OCR_SENTINEL_INSTRUCTION}\n`;
        installToolGate(ws);
        let r = await agyCall(['-p', sent, '--model', 'gemini-3.8-flash-low', ...CLI_SAFE_ARGS], ws);
        if (r.not_called || r.cls === 'quota') { stop = r.err ?? r.cls; return; }
        if (r.cls === 'denied_tool' && r.conversation) r = await agyCall(['-p', 'Running commands is not available here. Answer directly from the attached file now, following the instructions above exactly.', '--model', 'gemini-3.8-flash-low', ...CLI_SAFE_ARGS, '--conversation', r.conversation], ws);
        const u = unwrapRead(r.text);
        rec = { model: 'gemini-3.8-flash-low', text: u.text, problem: u.problem ?? null, cls: r.cls ?? null };
      } else {
        const block = await paceCheck(limits, pace); if (block) { stop = block; return; }
        const sent = `${prompt.text}\n\nThe page image to transcribe is the file ./page.jpg in your working directory: open it with Read, then transcribe it in the format above. ${OCR_SENTINEL_INSTRUCTION}\n`;
        const r = await opusCall(sent, ws);
        if (r.cls === 'quota') { stop = 'quota reply'; return; }
        const u = unwrapRead(r.text);
        rec = { model: r.model, text: u.text, problem: u.problem ?? null, cls: r.cls ?? null, usage: r.usage, list_usd: r.cost };
      }
      fs.writeFileSync(path.join(dir, `${safe(p.page)}.json`), JSON.stringify({ page: p.page, prompt_version: prompt.version, prompt_sha: h(prompt.text).slice(0, 16), secs: Math.round((Date.now() - t0) / 1000), ...rec }));
      console.log(`  ${p.stratum} ${p.page}: ${rec.text.length} chars ${rec.problem ?? ''} ${rec.cls ?? ''}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log(`STOPPED: ${stop}`); process.exit(3); }
}
const readOf = (p) => { const by = p.reader === 'opus' ? 'opus' : 'agy'; const f = path.join(OUT, `reads-${by}`, `${safe(p.page)}.json`); try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// ── the packet: one judge item per distinct (page, text); the key carries the truth ──
function packet() {
  const s = J('sample.json');
  const items = [], key = [], skipped = [];
  const add = (p, kind, text, extra = {}) => {
    const id = `c${h(`${p.page}:${h(text)}`).slice(0, 12)}`;
    if (!items.some((x) => x.id === id)) items.push({ id, lang: p.lang, page: p.page, text });
    key.push({ id, page: p.page, stratum: p.stratum, kind, ...extra });
  };
  for (const st of [...new Set(s.pages.map((p) => p.stratum))]) {
    const ps = s.pages.filter((p) => p.stratum === st && fs.existsSync(imgFile(p)));
    for (const p of ps) {
      const gold = goldOf(p);
      if (p.gold_item) add(p, 'gold', gold, { cer: 0, cer_lines: 0 });
      let pl = null; for (let t = 0; t < 6 && !pl; t++) pl = plantGraded(gold, p.plant, p.script, 7263 + t * 101 + p.idx);
      if (pl) add(p, 'plant', pl.text, { severity: p.plant, cer: pl.cer, cer_lines: cerLines(gold, pl.text, p.script), ops: pl.op_counts }); else skipped.push({ page: p.page, why: `no ${p.plant} band` });
      const rd = readOf(p);
      if (rd?.text?.trim()) { const c = cerOf(gold, rd.text, p.script); add(p, 'read', rd.text, { reader: p.reader, model: rd.model, cer: c.cer, cer_lines: cerLines(gold, rd.text, p.script), wer_tolerant: werTolerant(gold, rd.text, p.script), aligned: c.aligned, read_problem: rd.problem }); }
      else skipped.push({ page: p.page, why: `no ${p.reader} read` });
    }
    // Wrong-page controls: this page's image, the gold of another page in the stratum (not counted in sens/spec).
    for (let i = 0; i < 2 && ps.length > 4; i++) { const p = ps[i], o = ps[ps.length - 1 - i]; add(p, 'wrong_page', goldOf(o), { other: o.page, cer: cerOf(goldOf(p), goldOf(o), p.script).cer }); }
  }
  // Repeats: 20 seeded items judged a second time (a distinct id so the judge sees it fresh).
  const reps = [...items].sort((a, b) => h(`rep${a.id}`).localeCompare(h(`rep${b.id}`))).slice(0, 20);
  for (const it of reps) { items.push({ ...it, id: `r${it.id.slice(1)}`, repeat_of: it.id }); key.push({ ...key.find((k) => k.id === it.id), id: `r${it.id.slice(1)}`, repeat_of: it.id }); }
  const order = items.map((it) => [h(`order7263${it.id}`), it]).sort((a, b) => a[0].localeCompare(b[0])).map(([, it]) => it);
  W('packet.json', { items: order }); W('key.json', key); W('packet-skipped.json', skipped);
  const tally = {}; for (const k of key) { const t = `${k.kind}${k.severity ? `:${k.severity}` : ''}${k.reader ? `:${k.reader}` : ''}${k.repeat_of ? ':repeat' : ''}`; tally[t] = (tally[t] ?? 0) + 1; }
  console.log(`packet: ${order.length} judge items (cap ${JUDGE_CAP}); skipped ${skipped.length}`, tally);
  if (order.length > JUDGE_CAP) throw new Error(`packet ${order.length} > cap ${JUDGE_CAP}`);
}

async function judge() {
  const { judgeAbsolute, paceCheck } = await import('../correction-pass-7818/lib.mjs');
  const limits = await import('../../lib/model-limits.mjs');
  const s = J('sample.json'), pages = new Map(s.pages.map((p) => [p.page, p]));
  const pk = J('packet.json').items, file = path.join(OUT, 'verdicts-opus.jsonl');
  const prior = jsonl(file), done = new Set(prior.filter((r) => r.verdict).map((r) => r.id));
  const tries = new Map(); for (const r of prior) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  let calls = prior.length; const limit = Number(arg('limit') || Infinity);
  const todo = pk.filter((it) => !done.has(it.id) && (tries.get(it.id) ?? 0) < 2);
  console.log(`opus judge: ${todo.length} of ${pk.length} to judge; ${calls} calls made so far (cap ${JUDGE_CAP})`);
  const pace = {}; let stop = null, i = 0, made = 0;
  const one = async (it) => {
    if (stop) return;
    if (calls >= JUDGE_CAP || made >= limit) { stop = stop ?? `cap (${calls} calls)`; return; }
    const block = await paceCheck(limits, pace); if (block) { stop = block; return; }
    calls++; made++;
    const r = await judgeAbsolute({ lang: it.lang, text: it.text }, fs.readFileSync(imgFile(pages.get(it.page))));
    if (r.cls === 'quota') { stop = 'quota reply'; calls--; return; }
    fs.appendFileSync(file, JSON.stringify({ id: it.id, at: new Date().toISOString(), ...r }) + '\n');
    console.log(`  ${it.id}: ${r.verdict ? `accept=${r.verdict.accept} ${r.verdict.fidelity}` : `unparsed ${r.cls ?? ''}`} (${r.secs}s)`);
  };
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log(`STOPPED: ${stop}`); if (!/^cap/.test(stop)) process.exit(3); }
}

// ── score ──
function score() {
  const key = J('key.json'), verdicts = new Map(jsonl(path.join(OUT, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r]));
  const s = J('sample.json'), pages = new Map(s.pages.map((p) => [p.page, p]));
  const rows = key.map((k) => {
    const v = verdicts.get(k.id)?.verdict;
    return { ...k, judged: !!v, j: v ? v.accept : null, fidelity: v ? Number(v.fidelity) : null, wrong_text: v ? (v.defects || []).some((d) => d.severity === 'wrong_text') : null,
      defect_classes: v ? (v.defects || []).map((d) => `${d.class}:${d.severity}`) : null, dataset_id: pages.get(k.page)?.dataset_id, type: pages.get(k.page)?.type };
  });
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const cal = rows.filter((r) => r.judged && ['gold', 'plant', 'read'].includes(r.kind) && !r.repeat_of);
  // Truth: CER <= tau, by METRIC. Primary cer_lines (order-free, lib.mjs cerLines); cer (windowed) as a sensitivity.
  const truth = (tau, m) => (r) => ({ ...r, cer: r[m], t: r[m] <= tau });
  const strata = [...new Set(s.pages.map((p) => p.stratum))];
  const out = { generated_at: new Date().toISOString(), judge: 'Opus via claude -p, route-judge-6740 judgePrompt unchanged (correction-pass-7818 judgeAbsolute)', tau_primary: TAU, metric_primary: 'cer_lines',
    judge_calls: jsonl(path.join(OUT, 'verdicts-opus.jsonl')).length, items_judged: verdicts.size, items: key.length,
    sample: { pages: s.pages.length, by_stratum: Object.fromEntries(strata.map((st) => [st, { pages: s.pages.filter((p) => p.stratum === st).length, collections: new Set(s.pages.filter((p) => p.stratum === st).map((p) => p.dataset_id)).size }])) } };
  const table = (R, seed) => ({ pooled: confusion(R, seed), print: confusion(R.filter((r) => r.type === 'print'), seed + 1), manuscript: confusion(R.filter((r) => r.type !== 'print'), seed + 2),
    ...Object.fromEntries(strata.map((st, i) => [st, confusion(R.filter((r) => r.stratum === st), seed + 10 + i)])) });
  out.calibration = {}, out.calibration_synthetic = {}, out.calibration_reads = {};
  for (const m of ['cer_lines', 'cer']) {
    out.calibration[m] = {}; out.calibration_synthetic[m] = {}; out.calibration_reads[m] = {};
    for (const tau of TAUS) {
      const R = cal.map(truth(tau, m));
      out.calibration[m][tau] = table(R, 1);
      out.calibration_synthetic[m][tau] = table(R.filter((r) => r.kind !== 'read'), 101);   // gold + plants: the truth is exact
      out.calibration_reads[m][tau] = table(R.filter((r) => r.kind === 'read'), 201);       // real reads: truth = CER against a human gold
    }
  }
  // Acceptance by candidate kind: what the judge does with each band.
  const kinds = {};
  for (const r of cal) { const t = r.kind === 'plant' ? `plant ${r.severity}` : r.kind === 'read' ? `read ${r.reader}` : r.kind; (kinds[t] ??= []).push(r); }
  out.by_kind = Object.fromEntries(Object.entries(kinds).map(([t, rs]) => [t, { n: rs.length, accepted: rs.filter((r) => r.j).length, accept_ci: wilson(rs.filter((r) => r.j).length, rs.length),
    cer_median: median(rs.map((r) => r.cer)), cer_lines_median: median(rs.map((r) => r.cer_lines)), under_1pct_lines: rs.filter((r) => r.cer_lines <= TAU).length, wrong_text: rs.filter((r) => r.wrong_text).length,
    by_stratum: Object.fromEntries(strata.map((st) => { const x = rs.filter((r) => r.stratum === st); return [st, `${x.filter((r) => r.j).length}/${x.length}`]; })) }]));
  // The CER at which the judge accepts half the time (logistic on log10 CER; gold excluded: CER 0 has no log).
  const lf = cal.filter((r) => r.kind !== 'gold').map((r) => ({ ...r, cer: r.cer_lines }));
  const lfs = lf.filter((r) => r.kind === 'plant');
  out.cer50 = { metric: 'cer_lines', pooled: logitFit(lf), pooled_ci: clusterBoot(lf, (x) => logitFit(x).cer50, 5), print: logitFit(lf.filter((r) => r.type === 'print')), manuscript: logitFit(lf.filter((r) => r.type !== 'print')),
    plants_only: logitFit(lfs), plants_only_ci: clusterBoot(lfs, (x) => logitFit(x).cer50, 6) };
  // Self-preference (DBG, arXiv 2506.02592): bias = judge verdict - gold verdict, on Opus-written vs Gemini-written reads.
  out.self_preference = {};
  for (const m of ['cer_lines', 'cer']) {
    out.self_preference[m] = {};
    for (const tau of TAUS) {
      const R = cal.filter((r) => r.kind === 'read').map(truth(tau, m)).map((r) => ({ ...r, bias: (r.j ? 1 : 0) - (r.t ? 1 : 0) }));
      const grp = (g) => R.filter((r) => r.reader === g);
      const dbg = (x) => { const o = x.filter((r) => r.reader === 'opus'), a = x.filter((r) => r.reader !== 'opus'); return o.length && a.length ? mean(o.map((r) => r.bias)) - mean(a.map((r) => r.bias)) : null; };
      out.self_preference[m][tau] = { opus: summ(grp('opus')), gemini: summ(grp('agy-flash-low')), dbg: dbg(R), dbg_ci: clusterBoot(R, dbg, 7),
        print: dbg(R.filter((r) => r.type === 'print')), print_ci: clusterBoot(R.filter((r) => r.type === 'print'), dbg, 8),
        manuscript: dbg(R.filter((r) => r.type !== 'print')), manuscript_ci: clusterBoot(R.filter((r) => r.type !== 'print'), dbg, 9) };
    }
    // CER-matched self-preference: logistic accept ~ log10 CER + opus, on reads only.
    out.self_preference[m].cer_adjusted = logit2(cal.filter((r) => r.kind === 'read').map((r) => ({ ...r, cer: r[m] })));
  }
  // Real reads by error band and reader: where the self-preference sits (order-free CER; abbreviation-tolerant WER).
  const band = (x, cuts) => cuts.findIndex((c, i) => x >= c && x < (cuts[i + 1] ?? 2));
  out.reads_by_band = {};
  for (const [m, cuts] of [['cer_lines', [0, 0.01, 0.03, 0.1]], ['wer_tolerant', [0, 0.02, 0.05, 0.15]]]) {
    out.reads_by_band[m] = {};
    for (const who of ['opus', 'agy-flash-low']) for (const ty of ['print', 'manuscript']) {
      const R = cal.filter((r) => r.kind === 'read' && r.reader === who && (ty === 'print') === (r.type === 'print'));
      out.reads_by_band[m][`${who} ${ty}`] = cuts.map((c, i) => { const x = R.filter((r) => band(r[m], cuts) === i); return { from: c, to: cuts[i + 1] ?? 1, accepted: `${x.filter((r) => r.j).length}/${x.length}` }; });
    }
  }
  // Why the judge rejected a gold transcription (defect classes only; the quotes are CHURRO text and stay out).
  out.gold_rejected = rows.filter((r) => r.kind === 'gold' && !r.repeat_of && r.j === false).map((r) => ({ page: r.page, stratum: r.stratum, dataset_id: r.dataset_id, fidelity: r.fidelity, defects: r.defect_classes }));
  // Controls and the judge's own stability.
  const ctl = rows.filter((r) => r.kind === 'wrong_page' && r.judged);
  out.controls = { wrong_page: { n: ctl.length, passed: ctl.filter((r) => !r.j && r.fidelity <= 2).length } };
  const reps = rows.filter((r) => r.repeat_of && r.judged).map((r) => ({ a: rows.find((x) => x.id === r.repeat_of && !x.repeat_of)?.j, b: r.j })).filter((x) => x.a != null);
  out.controls.repeat = { n: reps.length, same: reps.filter((x) => x.a === x.b).length };
  fs.writeFileSync(path.join(RESULTS, 'score.json'), JSON.stringify(out, null, 1));
  const line = (v) => `sens ${f(v.sens)} [${v.sens_ci?.map(f)}] spec ${f(v.spec)} [${v.spec_ci?.map(f)}] k ${f(v.kappa)} [${v.kappa_ci?.map(f)}] n ${v.n}`;
  for (const [name, t] of [['all', out.calibration], ['synthetic', out.calibration_synthetic], ['reads', out.calibration_reads]]) { console.log(`== ${name} (cer_lines, 1%)`); for (const [k, v] of Object.entries(t.cer_lines[TAU])) console.log(`  ${k.padEnd(11)} ${line(v)}`); }
  console.log(JSON.stringify({ by_kind: out.by_kind, cer50: out.cer50, sp: out.self_preference.cer_lines[TAU], sp_adj: out.self_preference.cer_lines.cer_adjusted, sp_windowed: out.self_preference.cer[TAU].dbg, controls: out.controls }, null, 1));
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const f = (x) => (x == null ? '-' : Number(x).toFixed(2));
const summ = (R) => ({ n: R.length, judge_accept: R.filter((r) => r.j).length, gold_accept: R.filter((r) => r.t).length, bias: mean(R.map((r) => r.bias)), cer_median: median(R.map((r) => r.cer)) });
/** accept ~ a + b log10 CER + c opus (Newton); c > 0 = the judge accepts Opus text more at the same CER. */
function logit2(rows) {
  const X = rows.map((r) => [1, Math.log10(Math.max(r.cer, 1e-4)), r.reader === 'opus' ? 1 : 0]), Y = rows.map((r) => (r.j ? 1 : 0));
  let b = [0, -1, 0], H;
  for (let it = 0; it < 60; it++) {
    const g = [0, 0, 0]; H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    X.forEach((x, i) => { const p = 1 / (1 + Math.exp(-x.reduce((s, v, k) => s + v * b[k], 0))), w = p * (1 - p); for (let a = 0; a < 3; a++) { g[a] += (Y[i] - p) * x[a]; for (let c = 0; c < 3; c++) H[a][c] += w * x[a] * x[c]; } });
    const d = solve3(H, g); if (!d) break; b = b.map((v, k) => v + d[k]); if (Math.max(...d.map(Math.abs)) < 1e-8) break;
  }
  const inv = inv3(H), se = inv ? Math.sqrt(inv[2][2]) : null;
  return { n: rows.length, coef_opus: b[2], se, ci: se ? [b[2] - 1.96 * se, b[2] + 1.96 * se] : null, coef_log10_cer: b[1] };
}
function inv3(m) { const [[a, b, c], [d, e, f2], [g, hh, i]] = m; const A = e * i - f2 * hh, B = -(d * i - f2 * g), C = d * hh - e * g, det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return null;
  return [[A / det, -(b * i - c * hh) / det, (b * f2 - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f2 - c * d) / det], [C / det, -(a * hh - b * g) / det, (a * e - b * d) / det]]; }
function solve3(m, g) { const v = inv3(m); return v ? v.map((row) => row.reduce((s, x, k) => s + x * g[k], 0)) : null; }

// ── the worked plug-in example on one router cell ──
function ppi() {
  // The worked example (record §5): a router cell's judged k/n per route, corrected with the calibration's sensitivity
  // and specificity (lib.mjs plugIn). --cell=<router row id>; --table=<router table json> (default: current.json's);
  // --set=all|synthetic|reads; --strata=print,la-print (each a calibration row). Writes results/ppi-<cell>.json.
  const sc = JSON.parse(fs.readFileSync(path.join(RESULTS, 'score.json'), 'utf8'));
  const RT = path.resolve(HERE, '../estimator/router-table');
  const tableId = arg('table') || JSON.parse(fs.readFileSync(path.join(RT, 'current.json'), 'utf8')).table;
  const tbl = JSON.parse(fs.readFileSync(path.join(RT, `${tableId}.json`), 'utf8'));
  const cell = tbl.rows.find((r) => r.id === (arg('cell') || 'latin-lite/print'));
  const m = arg('metric') || 'cer_lines', tau = Number(arg('tau') || TAU), set = arg('set') || 'all';
  const cal = { all: sc.calibration, synthetic: sc.calibration_synthetic, reads: sc.calibration_reads }[set][m][tau];
  const out = { table: tableId, cell: cell.id, decision: `${cell.decision} ${cell.route}`, metric: m, tau, set, routes: {} };
  for (const r of cell.routes.filter((x) => x.tested && x.eff)) {
    const [k, n] = r.eff;   // the book-scaled judged k / n the router's Beta posterior uses
    out.routes[r.id] = { k: +k.toFixed(2), n: +n.toFixed(2), raw: `${r.k}/${r.n}`, ...Object.fromEntries((arg('strata') || 'print,la-print').split(',').map((st) => [st, plugIn({ k, n }, cal[st])])) };
  }
  fs.writeFileSync(path.join(RESULTS, `ppi-${cell.id.replace(/\W+/g, '_')}-${set}.json`), JSON.stringify(out, null, 1));
  for (const [id, r] of Object.entries(out.routes)) for (const st of Object.keys(r).filter((x) => typeof r[x] === 'object')) {
    const p = r[st]; console.log(`${id.padEnd(22)} ${st.padEnd(8)} judged ${r.k}/${r.n} = ${f(p.p_observed)} [${p.naive_ci.map(f)}] -> corrected ${f(p.theta)} (raw ${f(p.theta_raw)}) delta [${p.delta_ci.map(f)}] boot [${p.boot_ci.map(f)}]  sens ${f(p.sens)} spec ${f(p.spec)}`);
  }
}

const STAGES = { draw, images, reads, packet, judge, score, ppi };
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!STAGES[STAGE]) { console.error(`usage: run.mjs ${Object.keys(STAGES).join('|')}`); process.exit(2); }
  await STAGES[STAGE]();
}
