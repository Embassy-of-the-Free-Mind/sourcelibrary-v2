#!/usr/bin/env node
/**
 * build-work-gold-set.mjs — generate a stratified human-labeling set of book
 * PAIRS for calibrating the work_id resolver (issue #2909).
 *
 * The probe harness gives a LOWER BOUND on error; this set turns that into a real
 * precision/recall number + inter-rater κ, by sampling the hard cases (where κ is
 * low = the grain boundary) and the probe's own predictions (to score it), plus
 * easy controls (to anchor κ and catch labeler error). Deterministic — no RNG —
 * so re-running yields the identical set.
 *
 * Each pair carries the probe's PREDICTION (same/different) so the scorer can
 * compute the probe's precision per stratum. A human marks `label`
 * (same/different/ambiguous) and `notes`. Two independent labelers → κ.
 *
 * Strata:
 *   oversplit_high  probe=same  — identical sig-title set + same surname
 *   oversplit_med   probe=same  — title Jaccard ≥0.7
 *   anchor_miss     probe=same  — QID work vs local-id sibling
 *   overmerge       probe=diff  — two books inside one work_id, different authors
 *   hard_commentary probe=?     — a base-text vs a "with X commentary" sibling
 *   hard_volume     probe=?     — "Vol. N" vs "Vol. M" of the same title (grain Q)
 *   control_same    probe=same  — two books in one work_id, high title overlap
 *   control_diff    probe=diff  — different work_id + author + tradition
 *   random_within   probe=same  — UNIFORM-random pair sharing a work_id (de-biases
 *                                 the curated strata: measures resolver precision on
 *                                 the ORDINARY cluster, not just suspicious ones)
 *   random_pair     probe=diff  — UNIFORM-random pair across the whole corpus
 *                                 (anchors the base rate / specificity; catches
 *                                 surprise same-works the probe never flagged)
 *
 * SCOPE LIMIT (be honest): pair-labeling measures the PRECISION of the resolver's
 * "same" assertions (random_within) and of the probe's flags (oversplit_*,
 * anchor_miss are partial recall candidates). It does NOT give full RECALL — "what
 * same-work siblings did we MISS?" needs a per-book sibling-search labeling frame,
 * a separate (costlier) task. random_within + the oversplit strata bound it; they
 * don't close it.
 *
 * Usage:
 *   node scripts/eval/build-work-gold-set.mjs [--per-stratum 40] [--out FILE]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const PER = (() => { const i = process.argv.indexOf('--per-stratum'); return i > -1 ? +process.argv[i + 1] : 40; })();
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > -1 ? process.argv[i + 1] : 'scripts/output/work-gold-set-unlabeled.jsonl'; })();

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'with', 'from', 'vol', 'volume', 'part', 'tome', 'band', 'book', 'der', 'die', 'des', 'von', 'und', 'of', 'les', 'la', 'le', 'el', 'für', 'mit', 'thor', 'bu', 'sogs', 'rnam', 'pa', 'ba']);
const sig = (s) => [...new Set(norm(s).split(' ').filter((t) => t.length >= 4 && !STOP.has(t)))];
const surname = (a) => norm(a).split(' ').filter(Boolean).pop() || '';
const commentRe = /\b(comm(\.|entary)?|with .* commentary|bhashya|bhāṣya|tika|ṭīkā|glossa|scholia|annotation|cum commento|espositione|notes by)\b/i;
const volRe = /\b(vol|volume|part|tome|band|tomus)\.?\s*[ivxlcdm0-9]/i;
// stable string hash → deterministic order (no RNG; RNG is unavailable anyway)
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); };
const pairId = (a, b) => [a, b].sort().join('__');

function thin(b) { return { id: b.id, author: b.author, title: b.title, language: b.language, year: b.published ?? b.year ?? null, url: `https://sourcelibrary.org/book/${b.id}` }; }

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const books = client.db(process.env.MONGODB_DB || 'bookstore').collection('books');
  const all = await books.find({ visible: true, pages_translated: { $gt: 0 } })
    .project({ _id: 0, id: 1, work_id: 1, author: 1, title: 1, language: 1, published: 1 }).toArray();
  const withW = all.filter((b) => b.work_id && b.id);

  const byWid = new Map();
  for (const b of withW) { if (!byWid.has(b.work_id)) byWid.set(b.work_id, []); byWid.get(b.work_id).push(b); }
  const repByWid = new Map(); for (const [w, arr] of byWid) repByWid.set(w, arr[0]);
  const bySurname = new Map();
  for (const [w, b] of repByWid) { const sn = surname(b.author); if (sn.length < 4) continue; if (!bySurname.has(sn)) bySurname.set(sn, []); bySurname.get(sn).push({ w, b, toks: new Set(sig(b.title)) }); }

  const strata = {}; const add = (s, a, b, pred) => { (strata[s] = strata[s] || []).push({ stratum: s, probe_prediction: pred, a: thin(a), b: thin(b), _k: pairId(a.id, b.id) }); };

  // OVER-SPLIT high/med + ANCHOR-MISS (cross-work_id, same surname)
  for (const [sn, items] of bySurname) {
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j]; if (A.toks.size < 2 || B.toks.size < 2) continue;
      const inter = [...A.toks].filter((t) => B.toks.has(t)).length;
      const jac = inter / new Set([...A.toks, ...B.toks]).size;
      const aKey = [...A.toks].sort().join(' '), bKey = [...B.toks].sort().join(' ');
      const isQ = (x) => /^Q\d+$/.test(x);
      if (isQ(A.w) !== isQ(B.w) && jac >= 0.6 && inter >= 2) add('anchor_miss', A.b, B.b, 'same');
      else if (aKey === bKey && A.b.language !== 'Tibetan') add('oversplit_high', A.b, B.b, 'same');
      else if (jac >= 0.7 && inter >= 3 && A.b.language !== 'Tibetan') add('oversplit_med', A.b, B.b, 'same');
    }
  }
  // OVER-MERGE: two books inside one work_id with different surnames
  for (const [w, arr] of byWid) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      if (surname(arr[i].author) && surname(arr[j].author) && surname(arr[i].author) !== surname(arr[j].author)) add('overmerge', arr[i], arr[j], 'different');
    }
  }
  // CONTROL same: two books in one work_id, high title overlap (easy same)
  for (const [w, arr] of byWid) {
    if (arr.length < 2) continue;
    const A = arr[0], B = arr[1]; const ta = new Set(sig(A.title)), tb = new Set(sig(B.title));
    const inter = [...ta].filter((t) => tb.has(t)).length;
    if (inter >= 2 && surname(A.author) === surname(B.author)) add('control_same', A, B, 'same');
  }
  // CONTROL diff: stride-paired across different work_id + surname + language (easy different)
  const sorted = [...withW].sort((x, y) => (x.id < y.id ? -1 : 1));
  for (let i = 0; i + 137 < sorted.length; i += 53) {
    const A = sorted[i], B = sorted[i + 137];
    if (A.work_id !== B.work_id && surname(A.author) !== surname(B.author) && A.language !== B.language) add('control_diff', A, B, 'different');
  }
  // HARD commentary: same surname, one title has a commentary marker, the other doesn't, share ≥2 tokens
  for (const [sn, items] of bySurname) {
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const A = items[i].b, B = items[j].b; const ca = commentRe.test(A.title), cb = commentRe.test(B.title);
      if (ca === cb) continue; const inter = [...items[i].toks].filter((t) => items[j].toks.has(t)).length;
      if (inter >= 2) add('hard_commentary', A, B, '?');
    }
  }
  // HARD volume: same surname, both volume-marked, share ≥3 tokens, different work_id
  for (const [sn, items] of bySurname) {
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const A = items[i].b, B = items[j].b; if (!volRe.test(A.title) || !volRe.test(B.title)) continue;
      const inter = [...items[i].toks].filter((t) => items[j].toks.has(t)).length;
      if (inter >= 3 && items[i].w !== items[j].w) add('hard_volume', A, B, '?');
    }
  }

  // RANDOM_WITHIN: uniform-random pair sharing a work_id (multi-book works, sorted
  // by hash for a deterministic uniform draw — NOT the suspicious ones).
  const multiWorks = [...byWid.entries()].filter(([, arr]) => arr.length >= 2).sort((a, b) => hash(a[0]) - hash(b[0]));
  for (const [w, arr] of multiWorks) { const A = arr[0], B = arr[1]; add('random_within', A, B, 'same'); }
  // RANDOM_PAIR: uniform-random pairs across the whole corpus (deterministic walk
  // with a large coprime stride → spread-out draws; almost all truly different).
  const N = sorted.length, OFF = 7919;
  for (let i = 0; i < N; i += 29) { const A = sorted[i], B = sorted[(i + OFF) % N]; if (A.id !== B.id && A.work_id !== B.work_id) add('random_pair', A, B, 'different'); }

  // deterministic sample per stratum (sort by hash of pair key, take PER)
  const picked = [];
  for (const [s, arr] of Object.entries(strata)) {
    const uniq = [...new Map(arr.map((p) => [p._k, p])).values()].sort((x, y) => hash(x._k) - hash(y._k));
    picked.push(...uniq.slice(0, PER));
  }
  // pseudo-shuffle the final set so labelers don't see a stratum in a block
  picked.sort((x, y) => hash('z' + x._k) - hash('z' + y._k));
  const rows = picked.map((p, i) => ({ pair_id: i + 1, stratum: p.stratum, probe_prediction: p.probe_prediction, a: p.a, b: p.b, label: '', confidence: '', notes: '' }));

  fs.mkdirSync('scripts/output', { recursive: true });
  fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const tally = {}; for (const r of rows) tally[r.stratum] = (tally[r.stratum] || 0) + 1;
  console.log(`Wrote ${rows.length} pairs → ${OUT}`);
  console.log('by stratum:', JSON.stringify(tally, null, 1));
  console.log('\nLabel each pair: label ∈ {same, different, ambiguous}. See .claude/docs/work-identity-gold-rubric.md');
  console.log('Two independent labelers → run scripts/eval/score-work-gold-set.mjs for probe P/R + κ.');
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
