/**
 * Librarian citations (#6946) — the router's verdicts against the judges' labels, and guard rules
 * simulated over them (no model calls). Tune on the A arm (dev), report on the B arm.
 *
 * PRIOR ART: confusion.ts (labels × what the pass did, per link); this works per ROUTED claim, with the
 * deterministic word overlap of the claim on its cited page and on the router's page, so a guard rule can
 * be tried offline before it ships.
 *
 * Usage: npx tsx routes.ts <replay out.jsonl (--direct)> <arm A|B> <judge dir> <tag> <run>
 */
import fs from 'node:fs';
import path from 'node:path';
import { answerUnits } from '@/lib/embassy/grounding';
import { claimKey, linkedClaims } from '@/lib/embassy/citation-pages';

const [replay, arm, dir, tag, run] = process.argv.slice(2);
const rows = fs.readFileSync(replay, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.key.endsWith(`:${arm}`));
const links = JSON.parse(fs.readFileSync(path.join(dir, `links-${tag}.json`), 'utf8'));

type R = { qid: string; label: string; to: string | null; from: string; cited: number; toO: number | null; target?: string; judgePage?: string; claim: string };
const out: R[] = [];
for (const r of rows) {
  const qid = r.key.replace(/:.*/, '');
  const f = path.join(dir, 'out', `${qid}-${tag}-${run}.json`);
  if (!fs.existsSync(f)) continue;
  const labels = new Map(JSON.parse(fs.readFileSync(f, 'utf8')).links.map((l: { id: string }) => [l.id, l]));
  const claims = answerUnits(r.before).flatMap(u => (u.kind === 'image' ? [] : linkedClaims(r.before.slice(u.start, u.end), u.kind).map(c => ({ ...c, at: u.start + c.link.start }))));
  for (const rt of r.report.routes ?? []) {
    const c = claims.find(x => claimKey(x.link, x.claim) === rt.key);
    const l = c ? (links[r.key] as Array<{ id: string; at: number }>).find(x => x.at === c.at) : undefined;
    const lab = l ? labels.get(l.id) as { label: string; page?: string } | undefined : undefined;
    out.push({ qid, label: lab?.label ?? 'unmatched', to: rt.to, from: rt.from, cited: rt.citedOverlap, toO: rt.toOverlap, judgePage: lab?.page, claim: c?.claim.slice(0, 80) ?? '' });
  }
}

const decision = (x: R) => (x.to === x.from ? 'keep' : x.to === null ? 'drop' : 'move');
const wrong = (x: R) => ['other', 'none', 'wrong_fact'].includes(x.label);
const t: Record<string, number> = {};
for (const x of out) t[`${x.label}\t${decision(x)}`] = (t[`${x.label}\t${decision(x)}`] ?? 0) + 1;
console.log(`${out.length} routed claims (${arm})`);
for (const [k, v] of Object.entries(t).sort()) console.log(`  ${v}\t${k}`);
if (process.env.SHOW) for (const x of out.filter(y => decision(y) !== 'keep' || wrong(y))) console.log(`  ${x.qid} ${x.label.padEnd(10)} ${decision(x).padEnd(4)} cited=${x.cited} to=${x.toO ?? '-'} judge→${x.judgePage ?? ''} | ${x.claim}`);

// Guard rules: a move or drop only stands when the overlap says so too.
for (const dropMax of [1, 0.8, 0.7, 0.6, 0.5]) for (const moveMargin of [-1, 0, 0.1, 0.2]) {
  let fixed = 0, broke = 0, wrongAct = 0;
  for (const x of out) {
    const d = decision(x);
    const ok = d === 'drop' ? x.cited <= dropMax : d === 'move' ? (x.toO ?? 0) >= x.cited + moveMargin : false;
    if (!ok) continue;
    if (wrong(x)) fixed++; else if (x.label === 'cited') broke++; else wrongAct++;
  }
  console.log(`dropIf cited≤${dropMax} moveIf to≥cited+${moveMargin}: acts on ${fixed} wrong, ${broke} judged-cited, ${wrongAct} other`);
}
