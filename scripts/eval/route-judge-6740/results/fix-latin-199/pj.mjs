// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs — its judgePrompt, parseVerdict and opusCall are imported unchanged;
// its `packet` and `judge` stages are wired to named cells and to one judge (Opus, verdicts-opus.jsonl), so they cannot
// build a packet from two correct.mjs read dirs or run a second judge model over a chosen set of arms (v3#199: no model
// judges its own correction). This writes judge.mjs's files (packet.json, key.json, verdicts-<judge>.jsonl) for
// paired-arm.mjs check/score. No database, no writes to pages.
//   node pj.mjs build --out=DIR --spec=spec.json
//   node pj.mjs judge --out=DIR --judge=fable --model=fable [--concurrency=3] [--stop-at=ISO] [--weekly-max=95]
// spec: { lang, pages:[{page_id,book_id,page_number,image_file}], arms:{arm:{page_id:text}}, judges:{judge:[arm,...]},
//         controls: 2, repeats: {arm, n} }
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { createHash } from 'node:crypto';
const ROOT = process.env.SL_ROOT || process.cwd();
const { judgePrompt, parseVerdict, opusCall } = await import(path.join(ROOT, 'scripts/eval/route-judge-6740/judge.mjs'));
const limits = await import(path.join(ROOT, 'scripts/lib/model-limits.mjs'));
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(arg('out')); const STAGE = process.argv[2];
const h = (s) => createHash('sha1').update(s).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
if (STAGE === 'build') {
  const spec = JSON.parse(fs.readFileSync(arg('spec'), 'utf8'));
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  const items = new Map(), key = [];
  const judgesOf = (arm) => Object.entries(spec.judges).filter(([, a]) => a.includes(arm)).map(([j]) => j);
  const add = (kind, arm, pg, text, extra = {}) => {
    const img = path.join(OUT, 'img', `${h('img:' + pg.page_id).slice(0, 12)}.jpg`);
    if (!fs.existsSync(img)) fs.copyFileSync(pg.image_file, img);
    const id = `j${h(`${pg.page_id}:${extra.salt ?? ''}:${text}`).slice(0, 12)}`;
    if (!items.has(id)) items.set(id, { id, task: 'ocr', lang: spec.lang, image_file: img, text });
    key.push({ id: `k${h(`${kind}:${arm}:${pg.page_id}:${extra.other ?? ''}`).slice(0, 10)}`, judged_as: id, cell: spec.cell, route: arm, kind, page_id: pg.page_id, book_id: pg.book_id, page_number: pg.page_number, judges: judgesOf(arm), ...(extra.other && { other: extra.other }), ...(extra.unchanged && { unchanged: true }) });
  };
  for (const [arm, texts] of Object.entries(spec.arms)) {
    const ok = spec.pages.filter((p) => texts[p.page_id]?.trim());
    for (const p of ok) add('item', arm, p, texts[p.page_id], { unchanged: arm !== spec.baseline && texts[p.page_id] === spec.arms[spec.baseline]?.[p.page_id] });
    for (let i = 0; i < (spec.controls ?? 2) && ok.length > 2; i++) {
      const sp = ok[i], other = ok.find((o, j) => j >= Math.floor(ok.length / 2) + i && o.book_id !== sp.book_id);
      add('wrong_page', arm, sp, texts[other.page_id], { other: other.page_id });
    }
    if (spec.repeats?.arm === arm) for (const p of ok.slice(-spec.repeats.n)) add('repeat', arm, p, texts[p.page_id], { salt: 'repeat' });
  }
  const list = [...items.values()].sort((a, b) => h('order:' + a.id).localeCompare(h('order:' + b.id)));
  fs.writeFileSync(path.join(OUT, 'packet.json'), JSON.stringify({ items: list }));
  fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));
  const t = {}; for (const k of key) t[`${k.route}/${k.kind}`] = (t[`${k.route}/${k.kind}`] ?? 0) + 1;
  console.log(`packet: ${list.length} items, ${key.length} key rows`, t);
} else if (STAGE === 'judge') {
  const judge = arg('judge'), model = arg('model', judge), stopAt = arg('stop-at') ? Date.parse(arg('stop-at')) : Infinity, WEEKLY = Number(arg('weekly-max', 95));
  const want = new Set(J('key.json').filter((k) => k.judges.includes(judge)).map((k) => k.judged_as));
  const file = path.join(OUT, `verdicts-${judge}.jsonl`);
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const done = new Set(prev.filter((r) => r.verdict).map((r) => r.id)); const tries = new Map(); for (const r of prev) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const todo = J('packet.json').items.filter((it) => want.has(it.id) && !done.has(it.id) && (tries.get(it.id) ?? 0) < 3);
  console.log(`${judge}: ${todo.length} of ${want.size} items to judge`);
  let stop = null, i = 0;
  const one = async (it) => {
    if (Date.now() > stopAt) { stop = { reason: 'stop-at reached' }; return; }
    const b = limits.claudeBlocked({ weeklyMax: WEEKLY, sessionMax: 98 }); if (b) { stop = b; return; }
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'pj-'));
    try {
      fs.copyFileSync(it.image_file, path.join(ws, 'page.jpg'));
      const t0 = Date.now();
      const r = await opusCall(judgePrompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws, model);
      if (r.cls === 'quota') { stop = { reason: 'quota reply: ' + r.text.slice(0, 120) }; return; }
      const v = parseVerdict(r.text);
      fs.appendFileSync(file, JSON.stringify({ id: it.id, judge, model: r.model, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 500), usage: r.usage, list_usd: r.cost, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.id}: ${v ? `accept=${v.accept} ${v.fidelity} (${(v.defects || []).length} defects)` : `unparsed ${r.cls ?? ''}`} [${r.model}]`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency', 3))));
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log(`BLOCKED (${stop.reason})`); process.exit(3); }
} else { console.error('build | judge'); process.exit(2); }
