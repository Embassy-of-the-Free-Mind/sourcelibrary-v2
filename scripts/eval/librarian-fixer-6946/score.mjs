// Librarian citation fixer (#6946) — score the fixer against the pre-fix labels and the post-fix Opus labels.
// PRIOR ART: scripts/eval/librarian-citations-6946/score.mjs (wrong-page = other + none; wrong_fact apart;
// missing out of every rate) and librarian-cite-ids-6946/score-links.mjs (J1/J2/J3 merge, gate table). This
// adds what a fixer needs: per-link outcome × pre-fix label, links made wrong by a move, correct links dropped,
// the re-judge noise on links the fixer left alone, and the planted-error catch rate.
//
// Usage: node score.mjs --items=<items.jsonl.gz> --fixed=<fixed.jsonl> --judge=<judge dir> --after=<tag>
//          [--gauge-before=<tag>] [--planted=<planted.json>] [--json=<out>] [--group=run|arm]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const flag = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const readMaybeGz = f => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)) : fs.readFileSync(f)).toString('utf8');
const jsonl = f => readMaybeGz(f).split('\n').filter(Boolean).map(l => JSON.parse(l));
const safe = k => k.replace(/[^a-zA-Z0-9_-]+/g, '_');
const WRONG = new Set(['other', 'none']);
const JUDGED = new Set(['cited', 'other', 'none', 'wrong_fact']);
const DROPS = new Set(['drop', 'drop_unverified']);

const items = new Map(jsonl(flag('items')).map(i => [i.key, i]));
const fixed = new Map(jsonl(flag('fixed')).map(r => [r.key, r]));
const judgeDir = flag('judge');

function judgeLabels(tag, key) {
  const f = path.join(judgeDir, 'out', `${safe(key)}-${tag}-J1.json`);
  if (!fs.existsSync(f)) return null;
  return new Map((JSON.parse(fs.readFileSync(f, 'utf8')).links ?? []).map(l => [l.id, l.label]));
}

/** Pre-fix label per link: the run's merged judges, or the gauge's fresh J1. */
function beforeLabels(it) {
  if (it.before) return it.before.map(l => l.label);
  const tag = flag('gauge-before');
  const m = tag ? judgeLabels(tag, it.key) : null;
  if (!m) return null;
  const n = (it.text.match(/\]\(https:\/\/sourcelibrary\.org(?:\/es)?\/book\/[a-z0-9-]+(?:\/page-number\/|\?page=)\d+\)/g) ?? []).length;
  return Array.from({ length: n }, (_, k) => m.get(`L${k + 1}`) ?? 'unlabelled');
}

const per = [];
const problems = [];
for (const [key, r] of fixed) {
  const it = items.get(key);
  const before = beforeLabels(it);
  if (!before) { problems.push(`${key}: no pre-fix labels`); continue; }
  let after = null;
  if (r.changed) {
    const m = judgeLabels(flag('after'), key);
    if (m) {
      // The fixed text's page links are the pre-fix links minus the dropped ones, in order.
      const kept = r.outcomes.filter(o => !DROPS.has(o.outcome));
      after = new Map(kept.map((o, k) => [o.id, m.get(`L${k + 1}`) ?? 'unlabelled']));
      if (m.size !== kept.length) problems.push(`${key}: ${m.size} after-labels for ${kept.length} kept links`);
    }
  }
  r.outcomes.forEach((o, k) => {
    const b = before[k] ?? 'unlabelled';
    const dropped = DROPS.has(o.outcome);
    const a = dropped ? 'dropped' : !r.changed ? b : after ? after.get(o.id) ?? 'unlabelled' : 'unjudged';
    per.push({ key, run: it.run, arm: it.arm, id: o.id, before: b, outcome: o.outcome, after: a, changedAnswer: r.changed });
  });
}

function tally(rows) {
  const t = { links: rows.length, before: {}, outcomes: {}, cross: {} };
  for (const x of rows) {
    t.before[x.before] = (t.before[x.before] ?? 0) + 1;
    t.outcomes[x.outcome] = (t.outcomes[x.outcome] ?? 0) + 1;
    const c = (t.cross[x.outcome] ??= {});
    c[x.before] = (c[x.before] ?? 0) + 1;
  }
  const judgedBefore = rows.filter(x => JUDGED.has(x.before));
  const wrongBefore = judgedBefore.filter(x => WRONG.has(x.before)).length;
  const citedBefore = rows.filter(x => x.before === 'cited');
  // After: only answers whose after-labels exist (or that did not change). A link judged before and after.
  const scorable = judgedBefore.filter(x => x.after !== 'unjudged' && x.after !== 'unlabelled' && x.after !== 'missing');
  const survivors = scorable.filter(x => x.after !== 'dropped' && JUDGED.has(x.after));
  const wrongAfter = survivors.filter(x => WRONG.has(x.after)).length;
  const moves = scorable.filter(x => x.outcome === 'move');
  const madeWrong = moves.filter(x => !WRONG.has(x.before) && (WRONG.has(x.after) || x.after === 'wrong_fact' && x.before === 'cited'));
  const fixedByMove = moves.filter(x => WRONG.has(x.before) && x.after === 'cited');
  const dropped = judgedBefore.filter(x => DROPS.has(x.outcome));
  const citedDropped = citedBefore.filter(x => DROPS.has(x.outcome));
  // Noise floor: links the fixer left as written, inside answers that were re-judged.
  const untouched = scorable.filter(x => x.changedAnswer && !['move', 'drop', 'drop_unverified'].includes(x.outcome) && JUDGED.has(x.after));
  const flips = untouched.filter(x => WRONG.has(x.before) !== WRONG.has(x.after));
  const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
  return {
    ...t,
    judgedBefore: judgedBefore.length, wrongBefore, wrongBeforeRate: pct(wrongBefore, judgedBefore.length),
    scorable: scorable.length, wrongBeforeScorable: scorable.filter(x => WRONG.has(x.before)).length,
    survivors: survivors.length, wrongAfter, wrongAfterRate: pct(wrongAfter, survivors.length),
    wrongPageReduction: pct(scorable.filter(x => WRONG.has(x.before)).length - wrongAfter, scorable.filter(x => WRONG.has(x.before)).length),
    moves: moves.length, madeWrong: madeWrong.length, madeWrongRate: pct(madeWrong.length, scorable.length), fixedByMove: fixedByMove.length,
    dropped: dropped.length, droppedWrong: dropped.filter(x => WRONG.has(x.before)).length, droppedWrongFact: dropped.filter(x => x.before === 'wrong_fact').length,
    citedBefore: citedBefore.length, citedDropped: citedDropped.length, citedDroppedRate: pct(citedDropped.length, citedBefore.length),
    rejudgeNoise: { links: untouched.length, flips: flips.length, rate: pct(flips.length, untouched.length) },
    unjudged: rows.filter(x => x.after === 'unjudged').length,
  };
}

const out = { all: tally(per), groups: {}, problems };
const by = flag('group') ?? 'arm';
for (const x of per) (out.groups[by === 'run' ? x.run : `${x.run}:${x.arm}`] ??= []).push(x);
for (const [g, rows] of Object.entries(out.groups)) out.groups[g] = tally(rows);

if (flag('planted')) {
  // planted.json: [{key, id, kind: adjacent|other_book, from:{slug,page}, to:{slug,page}}]
  const planted = JSON.parse(fs.readFileSync(flag('planted'), 'utf8'));
  const res = {};
  for (const p of planted) {
    const r = fixed.get(p.key);
    const o = r?.outcomes.find(x => x.id === p.id);
    const k = (res[p.kind] ??= { n: 0, caught: 0, moved: 0, restored: 0, dropped: 0, kept: 0, untouched: 0, missing: 0 });
    k.n++;
    if (!o) { k.missing++; continue; }
    if (o.outcome === 'move') { k.caught++; k.moved++; if (o.to?.slug === p.from.slug && Math.abs(o.to.page - p.from.page) <= 0) k.restored++; }
    else if (DROPS.has(o.outcome)) { k.caught++; k.dropped++; }
    else if (o.outcome === 'keep') k.kept++;
    else k.untouched++;
  }
  for (const k of Object.values(res)) k.catchRate = k.n ? +(100 * k.caught / (k.n - k.missing)).toFixed(1) : null;
  out.planted = res;
}

const a = out.all;
console.log(`links ${a.links}; judged before ${a.judgedBefore}; wrong-page before ${a.wrongBefore} (${a.wrongBeforeRate}%)`);
console.log(`scorable ${a.scorable} (wrong before ${a.wrongBeforeScorable}); survivors ${a.survivors}; wrong after ${a.wrongAfter} (${a.wrongAfterRate}%); reduction ${a.wrongPageReduction}%`);
console.log(`moves ${a.moves}: made wrong ${a.madeWrong} (${a.madeWrongRate}% of links), fixed by move ${a.fixedByMove}`);
console.log(`dropped ${a.dropped} (were wrong-page ${a.droppedWrong}, wrong_fact ${a.droppedWrongFact}); cited dropped ${a.citedDropped}/${a.citedBefore} (${a.citedDroppedRate}%)`);
console.log(`re-judge noise on untouched links: ${a.rejudgeNoise.flips}/${a.rejudgeNoise.links} (${a.rejudgeNoise.rate}%); unjudged ${a.unjudged}`);
console.log('outcome × pre-fix label:'); console.table(a.cross);
console.table(Object.fromEntries(Object.entries(out.groups).map(([g, t]) => [g, { links: t.links, wrongBefore: t.wrongBefore, wrongBeforeRate: t.wrongBeforeRate, wrongAfter: t.wrongAfter, wrongAfterRate: t.wrongAfterRate, moves: t.moves, madeWrong: t.madeWrong, citedDropped: `${t.citedDropped}/${t.citedBefore}` }])));
if (out.planted) console.table(out.planted);
if (problems.length) console.log(`problems (${problems.length}):\n  ${problems.slice(0, 20).join('\n  ')}`);
if (flag('json')) fs.writeFileSync(flag('json'), JSON.stringify({ ...out, per }, null, 1));
