#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs — its judgePrompt (one output, the page image, the source OCR,
// taxonomy-tagged defects) is THE prompt here, imported; its packet/judge stages read route-judge cells, not a pilot's
// written pages. scripts/eval/agy-per-call-7503/prep.mjs — the planted controls (#7518): the same five tampered CTL
// reads are rebuilt here from its reads.jsonl + controls-tamper.json, not re-made, so no new agy call.
/**
 * QA of the #7503 Siku translation pilot: a blind Opus judge on 30 WRITTEN pages (1-2 per book, seeded 7503) plus
 * #7518's five planted controls (3 with a sentence dropped, 2 with the next page's first sentence appended; each built
 * from a separate fresh read), shuffled together so the judge cannot tell a control from a pilot page.
 *
 *   node --env-file=.env.production.local scripts/eval/siku-pilot-7503/qa.mjs packet --out=DIR
 *   node scripts/eval/siku-pilot-7503/qa.mjs judge --out=DIR [--concurrency=3]
 *   node scripts/eval/siku-pilot-7503/qa.mjs score --out=DIR [--name=qa-score]   (writes results/<name>.json)
 *   Calibration: packet --books=F --no-controls (F: a JSON list of {id}) draws the same way from another frame.
 *
 * The pilot text judged is what is SERVED (pages.translation.data, <summary>/<keywords> cut as #7518 cut them), so
 * run it after `cli-translate.mjs apply --apply`. A control is CAUGHT when the judge does not accept it and names a
 * non-cosmetic omission (drop) or addition/bleed (bleed) defect. Fewer than all five caught: probe_broken.
 * Read-only: no writes to pages, books or R2.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { judgePrompt } from '../route-judge-6740/judge.mjs';
import { parseJson } from '../translate-cli-lane-7075/sample.mjs';
import { wilson } from '../lib/agreement-stats.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(arg('out') || '.');
const N = 30, SALT = 'siku-pilot-7503';
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const body = (t) => String(t || '').replace(/<summary>[\s\S]*?<\/summary>/g, '').replace(/<keywords>[\s\S]*?<\/keywords>/g, '').trim();
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

async function packet() {
  const { MongoClient } = await import('mongodb');
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = c.db('bookstore').collection('pages');
  const PR = { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1 };
  // --books=F: a calibration frame (a JSON list of {id}), e.g. the skqs-flash-pilot-5600 books kept as drafts (1/call).
  const frame = arg('books') ? { book_id: { $in: JSON.parse(fs.readFileSync(arg('books'), 'utf8')).map((b) => b.id) } } : { id: { $in: JSON.parse(fs.readFileSync(path.join(HERE, 'results/page-ids.json'), 'utf8')) } };
  const got = (await pages.find(frame, { projection: PR }).toArray()).filter((p) => p.translation?.data?.trim());
  // 1-2 per book: seeded order of books, one page each, then a second round until N.
  const byBook = new Map();
  for (const p of [...got].sort((a, b) => h(SALT + a.id).localeCompare(h(SALT + b.id)))) byBook.set(p.book_id, [...(byBook.get(p.book_id) ?? []), p]);
  const books = [...byBook].sort((a, b) => h(SALT + a[0]).localeCompare(h(SALT + b[0])));
  const pick = [];
  for (let r = 0; pick.length < N && r < 2; r++) for (const [, l] of books) if (l[r] && pick.length < N) pick.push(l[r]);
  const items = pick.map((p) => ({ kind: 'pilot', page_id: p.id, book_id: p.book_id, page_number: p.page_number, model: p.translation.model, image_url: getPageSource(p), source: p.ocr?.data ?? '', text: body(p.translation.data) }));
  // #7518's controls, rebuilt exactly as prep.mjs built them: CTL read body minus the dropped sentence / plus the moved one.
  const P = path.join(HERE, '../agy-per-call-7503');
  const ctl = new Map(jsonl(path.join(P, 'reads.jsonl')).filter((r) => r.arm === 'CTL').map((r) => [r.page_id, r.text]));
  // --no-controls: a calibration run whose judge was already validated by the controls of the main run.
  const tamper = process.argv.includes('--no-controls') ? {} : JSON.parse(fs.readFileSync(path.join(P, 'controls-tamper.json'), 'utf8'));
  const cp = new Map((await pages.find({ id: { $in: Object.keys(tamper) } }, { projection: PR }).toArray()).map((p) => [p.id, p]));
  for (const [id, t] of Object.entries(tamper)) {
    const b = body(ctl.get(id));
    if (!b.includes(t.sentence) && t.kind === 'drop') throw new Error(`control ${id}: sentence not in CTL read`);
    const text = t.kind === 'drop' ? b.replace(t.sentence, '').replace(/ {2,}/g, ' ') : `${b}\n\n${t.sentence}`;
    const p = cp.get(id);
    items.push({ kind: `control_${t.kind}`, page_id: id, book_id: p.book_id, page_number: p.page_number, image_url: getPageSource(p), source: p.ocr?.data ?? '', text, planted: t.sentence });
  }
  await c.close();
  items.forEach((it) => { it.id = `q${h(`${it.kind}:${it.page_id}`).slice(0, 10)}`; });
  items.sort((a, b) => h(`order:${a.id}`).localeCompare(h(`order:${b.id}`)));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'packet.json'), JSON.stringify({ items }, null, 1));
  console.log(`packet: ${items.length} items (${pick.length} pilot pages in ${new Set(pick.map((p) => p.book_id)).size} books, ${items.length - pick.length} controls)`);
}

const QUOTA = /usage limit|limit reached|hit your (?:usage )?limit|rate.?limit|out of extra usage/i;
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
/** route-judge-6740's opusCall: Opus with the image in its workspace, Read as its only tool. */
function opusCall(prompt, cwd) {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', '--model', 'opus', '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 900e3);
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '');
      resolve({ text, cls: (j.is_error || code !== 0) && QUOTA.test(text + out + err) ? 'quota' : code !== 0 ? `exit_${code}` : null, model: Object.keys(j.modelUsage || {})[0] ?? null, usage: j.usage ?? null, cost: j.total_cost_usd ?? null });
    });
  });
}
const parseVerdict = (t) => parseJson(t, (v) => typeof v.accept === 'boolean' && Number(v.fidelity) >= 1 && Number(v.fidelity) <= 5 && Array.isArray(v.defects ?? []));

async function judge() {
  const file = path.join(OUT, 'verdicts-opus.jsonl');
  const done = new Set(jsonl(file).filter((r) => r.verdict).map((r) => r.id));
  const todo = J('packet.json').items.filter((it) => !done.has(it.id));
  console.log(`opus: ${todo.length} items to judge`);
  let i = 0, stop = null;
  const one = async (it) => {
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'siku-qa-'));
    try {
      const res = await fetch(it.image_url);
      if (!res.ok) { fs.appendFileSync(file, JSON.stringify({ id: it.id, verdict: null, raw: `image HTTP ${res.status}` }) + '\n'); return; }
      fs.writeFileSync(path.join(ws, 'page.jpg'), Buffer.from(await res.arrayBuffer()));
      const t0 = Date.now();
      const r = await opusCall(judgePrompt({ task: 'translation', lang: 'Classical Chinese', source: it.source, text: it.text }, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws);
      if (r.cls === 'quota') { stop = r.text.slice(0, 200); return; }
      const v = parseVerdict(r.text);
      fs.appendFileSync(file, JSON.stringify({ id: it.id, model: r.model, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 500), usage: r.usage, list_usd: r.cost, secs: Math.round((Date.now() - t0) / 1000) }) + '\n');
      console.log(`  ${it.id}: ${v ? `accept=${v.accept} ${v.fidelity} (${v.defects.length} defects)` : `unparsed ${r.cls ?? ''}`}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log(`STOPPED: quota reply: ${stop}`); process.exit(3); }
}

// Defect classes -> the #7518 report's columns (page-error-taxonomy.md codes; severity "cosmetic" never counts).
const COLS = {
  sense_error: ['O6', 'O7', 'T7', 'T8'],
  omission: ['T1', 'T9', 'O5'],
  cross_page_bleed: ['T4', 'T5', 'T6'],
  wrong_leaf: ['I1'],
  invented: ['O1', 'O3', 'T10'],
};
const NAME = /\bnames?\b|personal|surname|place[- ]name|title|official|courtesy|transliterat|romaniz/i;
const real = (d) => d.severity && d.severity !== 'cosmetic';

function score() {
  const items = new Map(J('packet.json').items.map((it) => [it.id, it]));
  const V = new Map(jsonl(path.join(OUT, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  const pilot = [...items.values()].filter((it) => it.kind === 'pilot' && V.has(it.id));
  const ci = (k, n) => ({ k, n, pct: n ? Math.round((100 * k) / n) : null, ci95: wilson(k, n).map((x) => Math.round(100 * x)) });
  const has = (v, cls) => v.defects.some((d) => real(d) && cls.includes(String(d.class).toUpperCase()));
  const rows = pilot.map((it) => {
    const v = V.get(it.id);
    return { page_id: it.page_id, book_id: it.book_id, page_number: it.page_number, accept: v.accept, fidelity: v.fidelity,
      ...Object.fromEntries(Object.entries(COLS).map(([k, cls]) => [k, has(v, cls)])),
      names: v.defects.some((d) => real(d) && NAME.test(`${d.what ?? ''}`)),
      wrong_text: v.defects.some((d) => d.severity === 'wrong_text'),
      defects: v.defects.map((d) => `${d.class}/${d.severity}: ${d.what ?? ''} «${String(d.quote ?? '').slice(0, 80)}»`), note: v.reader_note };
  });
  const n = rows.length;
  const controls = [...items.values()].filter((it) => it.kind.startsWith('control')).map((it) => {
    const v = V.get(it.id);
    const want = it.kind === 'control_drop' ? ['T9', 'O5', 'T1'] : ['T5', 'T4', 'T6', 'O1', 'E2', 'T10', 'O4'];
    return { page_id: it.page_id, kind: it.kind, judged: !!v, accept: v?.accept ?? null, fidelity: v?.fidelity ?? null, caught: !!v && !v.accept && has(v, want), defects: v?.defects.map((d) => `${d.class}/${d.severity}: ${d.what ?? ''}`) ?? [] };
  });
  const caught = controls.filter((x) => x.caught).length;
  const report = {
    judged: n, books: new Set(rows.map((r) => r.book_id)).size,
    probe: caught === controls.length ? 'ok' : 'probe_broken', controls_caught: `${caught}/${controls.length}`, controls,
    usable: ci(rows.filter((r) => r.accept).length, n),
    ...Object.fromEntries(['sense_error', 'omission', 'cross_page_bleed', 'names', 'wrong_leaf', 'invented', 'wrong_text'].map((k) => [k, ci(rows.filter((r) => r[k]).length, n)])),
    fidelity_mean: +(rows.reduce((a, r) => a + r.fidelity, 0) / (n || 1)).toFixed(2),
    gate: { rule: '0 wrong-leaf, 0 invented, sense errors <= 1 page in 3 (skqs-flash-pilot-5600, Derek 2026-10-27)' },
    rows,
  };
  report.gate.pass = report.wrong_leaf.k === 0 && report.invented.k === 0 && report.sense_error.k * 3 <= n;
  report.routing_floor = { rule: 'usable >= 75% (the #7518 1/call floor)', pass: n > 0 && report.usable.k / n >= 0.75 };
  fs.writeFileSync(path.join(HERE, `results/${arg('name') || 'qa-score'}.json`), JSON.stringify(report, null, 1) + '\n');
  const { rows: _r, controls: _c, ...head } = report;
  console.log(JSON.stringify(head, null, 1));
}

await ({ packet, judge, score }[process.argv[2]] ?? (() => { console.error('stages: packet | judge | score'); process.exit(2); }))();
