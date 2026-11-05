// PRIOR ART: lib.mjs (this directory: candidates / chooseEdits / applyEdits) and verify.mjs (the C image check). No
// other planter fits (see lib.mjs). This is the step that fixes the sample: run once, before any arm.
/**
 * #8171 plant. Reads <priv>/draw-{A,B,C}.json, <priv>/passages/*.json, <priv>/verify-C.jsonl, <priv>/c-search-results.jsonl.
 *   A, B: 2-3 edits per passage, seeded, from every candidate site.
 *   C:    in draw order, a passage is used if its web search found no copy, its image check passed the decoy (the edited
 *         window came back "no"), and >= 2 of its checked sites came back "yes"; edits are chosen only among those.
 *         The first 40 such passages are group C.
 *   Baselines: 20 passages (4 A, 8 B, 8 C, seeded) are ALSO sent unedited. Subset: 30 (10 per group, seeded) for the
 *   Opus arm and the second Flash run.
 * Writes <priv>/plant/<slug>.json (texts: never committed) and scripts/eval/zh-planted-8171/sample.json (public: ids,
 * offsets, edit types, hashes; for group C, our own OCR, also the changed characters).
 *   node scripts/eval/zh-planted-8171/plant.mjs --priv=DIR
 */
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { fileURLToPath } from 'url';
import { candidates, chooseEdits, applyEdits, sitesToCheck, decoyIndex, makeRng } from './lib.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const PRIV = argOf('priv'); const OUT = path.join(PRIV, 'plant'); fs.mkdirSync(OUT, { recursive: true });
const SEED = 8171;
const seedOf = (s) => SEED ^ parseInt(crypto.createHash('sha256').update(`edits:${s}`).digest('hex').slice(0, 8), 16);
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(PRIV, f), 'utf8'));
const jsonl = (f) => fs.readFileSync(path.join(PRIV, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const P = (slug) => JSON.parse(fs.readFileSync(path.join(PRIV, 'passages', `${slug}.json`), 'utf8'));
// Excluded from C before planting: CBETA membership of this title was not checked (Buddhist hagiography).
const C_EXCLUDE = new Set(['釋氏源流應化事蹟']);

const verify = new Map(jsonl('verify-C.jsonl').map((r) => [r.slug, r]));
const search = new Map(jsonl('c-search-results.jsonl').map((r) => [r.slug, r]));
const rows = [];
const plantOne = (p, cands, group, extra = {}) => {
  const edits = chooseEdits(p.text, cands, seedOf(p.slug), 3, 10);
  if (edits.length < 2) return null;
  const a = applyEdits(p.text, edits);
  const rec = { ...p, group, edited: a.text, edits: a.edits, ...extra };
  fs.writeFileSync(path.join(OUT, `${p.slug}.json`), JSON.stringify(rec));
  return rec;
};
for (const r of J('draw-A.json').filter((x) => x.slug)) { const p = P(r.slug); const x = plantOne(p, candidates(p.text), 'A'); if (x) rows.push(x); else console.log('A short', r.slug); }
for (const r of J('draw-B.json').filter((x) => x.slug)) { const p = P(r.slug); const x = plantOne(p, candidates(p.text), 'B'); if (x) rows.push(x); else console.log('B short', r.slug); }
const cLog = [];
for (const r of J('draw-C.json').filter((x) => x.slug)) {
  if (rows.filter((x) => x.group === 'C').length >= 40) break;
  const p = P(r.slug); const v = verify.get(r.slug); const s = search.get(r.slug);
  const why = [];
  if (C_EXCLUDE.has(r.work)) why.push('excluded title');
  if (!s) why.push('not searched'); else if (s.verdict !== 'not_found') why.push('found by search');
  let ok = [];
  if (!v?.answers) why.push('not image-checked');
  else {
    const sites = sitesToCheck(p.text, r.slug); const di = decoyIndex(r.slug, sites.length);
    const ans = (i) => String(v.answers[String((i >= di ? i + 1 : i) + 1)] || '').toLowerCase();
    if (String(v.answers[String(di + 1)] || '').toLowerCase() !== 'no') why.push('decoy not rejected');
    ok = sites.filter((e, i) => ans(i) === 'yes');
    if (ok.length < 2) why.push(`${ok.length} confirmed sites`);
  }
  cLog.push({ slug: r.slug, work: r.work, used: !why.length, why, confirmed: ok.length });
  if (why.length) continue;
  const x = plantOne(p, ok, 'C', { search: s.verdict, confirmed_sites: ok.length });
  if (x) rows.push(x);
}
// baselines and subset, seeded within group
const pick = (g, n, tag) => { const rng = makeRng(seedOf(`${tag}:${g}`)); return rows.filter((x) => x.group === g).map((x) => [rng(), x.slug]).sort((a, b) => a[0] - b[0]).slice(0, n).map(([, s]) => s); };
const baseline = new Set([...pick('A', 4, 'base'), ...pick('B', 8, 'base'), ...pick('C', 8, 'base')]);
const subset = new Set([...pick('A', 10, 'sub'), ...pick('B', 10, 'sub'), ...pick('C', 10, 'sub')]);
const pub = rows.map((x) => ({
  slug: x.slug, group: x.group, sub: x.sub ?? null, work: x.work, source: x.source, kr: x.kr ?? null, pb: x.pb ?? null, anchor: x.anchor ?? null,
  book_id: x.book_id ?? null, page_id: x.page_id ?? null, page_number: x.page_number ?? null, ocr_model: x.ocr_model ?? null, offset: x.offset, han: x.han,
  sha256_original: sha(x.text), sha256_edited: sha(x.edited), baseline: baseline.has(x.slug), subset: subset.has(x.slug),
  edits: x.edits.map((e) => ({ type: e.type, name_list: e.group ?? null, at: e.at, pos: e.pos, len_orig: e.lenOrig, len_edited: e.lenEdited, ...(x.group === 'C' ? { before: e.before, after: e.after } : {}) })),
}));
const count = (g) => pub.filter((x) => x.group === g).length;
fs.writeFileSync(path.join(here, 'sample.json'), JSON.stringify({ issue: 8171, seed: SEED, made_at: new Date().toISOString(),
  licence_note: 'CBETA (CC BY-NC-SA 4.0) and Kanripo (CC BY-SA, version unstated) text is never committed: ids, offsets, edit types and hashes only. Group C is our own OCR.',
  counts: { A: count('A'), B: count('B'), C: count('C'), edits: pub.reduce((s, x) => s + x.edits.length, 0), baseline: baseline.size, subset: subset.size },
  c_selection: cLog, passages: pub }, null, 1));
console.log(JSON.stringify({ A: count('A'), B: count('B'), C: count('C'), edits: pub.reduce((s, x) => s + x.edits.length, 0) }));
console.log('C log:', cLog.filter((c) => !c.used).map((c) => `${c.slug} ${c.why.join('; ')}`).join('\n  '));
const types = {}; for (const x of pub) for (const e of x.edits) { const k = `${x.group}:${e.type}`; types[k] = (types[k] || 0) + 1; } console.log(types);
