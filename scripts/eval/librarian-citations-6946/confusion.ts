/**
 * Librarian citations (#6946) — how the pass treated each link the judges labelled.
 * PRIOR ART: score.mjs (rates per run); this joins one judge run's labels on the BEFORE answers to what
 * the pass did with the same link (kept / moved / dropped, and the router's verdict), for tuning.
 * Usage: npx tsx confusion.ts <judge dir> <replay out.jsonl> <run, e.g. J1> [all]
 */
import fs from 'node:fs';
import path from 'node:path';
import { answerUnits } from '@/lib/embassy/grounding';
import { claimKey, linkedClaims } from '@/lib/embassy/citation-pages';

const [dir, replay, run, which] = process.argv.slice(2);
const links = JSON.parse(fs.readFileSync(path.join(dir, 'links-before.json'), 'utf8'));
const rows = fs.readFileSync(replay, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const tally: Record<string, number> = {};
for (const r of rows) {
  const qid = r.key.replace(/:.*/, '');
  const f = path.join(dir, 'out', `${qid}-before-${run}.json`);
  if (!fs.existsSync(f)) continue;
  const labels = new Map(JSON.parse(fs.readFileSync(f, 'utf8')).links.map((l: { id: string }) => [l.id, l]));
  const verdicts = new Map<string, string | null>((which === 'all' ? r.verdictsAll : r.verdicts) ?? []);
  // Claims of the BEFORE text (what the judges read), keyed the way the pass keys them.
  const claims = answerUnits(r.before).flatMap(u => (u.kind === 'image' ? [] : linkedClaims(r.before.slice(u.start, u.end), u.kind).map(c => ({ ...c, at: u.start + c.link.start }))));
  const after = which === 'all' ? r.textAll : r.text;
  for (const l of links[r.key] as Array<{ id: string; slug: string; page: number; at: number }>) {
    const lab = labels.get(l.id) as { label: string; page?: string } | undefined;
    const c = claims.find(x => x.at === l.at);
    const v = c ? verdicts.get(claimKey(c.link, c.claim)) : undefined;
    const vs = v === undefined ? 'noverdict' : v === null ? 'none' : 'page';
    const url = `/book/${l.slug}`;
    const still = after.includes(`${url}/page-number/${l.page})`) || after.includes(`${url}?page=${l.page})`);
    const k = `${lab?.label ?? '?'}\t${vs}\t${still ? 'kept' : 'changed'}`;
    tally[k] = (tally[k] ?? 0) + 1;
    if (lab && lab.label !== 'cited' && lab.label !== 'missing' && process.env.SHOW) console.log(qid, l.id, lab.label, vs, still ? 'kept' : 'changed', c ? c.claim.slice(0, 90) : '(no claim found)');
  }
}
for (const [k, v] of Object.entries(tally).sort()) console.log(v, k);
