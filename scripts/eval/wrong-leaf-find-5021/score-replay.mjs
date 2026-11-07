#!/usr/bin/env node
// PRIOR ART: scripts/eval/block-guard-5021/score.mjs (scores fresh blocks with the guard only, no reference text) and
// scripts/lib/block-drift.mjs translationProse (reused). Here each section of a replayed block is attributed by its
// English against ONE-PAGE reference translations of n-1, n, n+1 (a one-page call sees no other leaf, so it cannot
// slide), and the instrument is checked first on the stored English Opus labelled (#5021 part A).
/**
 *   node --env-file=.env.production.local scripts/eval/wrong-leaf-find-5021/score-replay.mjs BLOCKS.jsonl REPLAY_DIR LABELS.jsonl OUT.json
 * Attribution: content words (letters, 4+, lower case, minus a stop list) of the section; containment in each
 * reference = shared words / section words. verdict own when own >= both neighbours; next/prev when a neighbour beats
 * own by MARGIN; else tie. A section under 40 words is 'short'. Reads the stored English (live, or the withhold's
 * page_revisions snapshot) for the instrument check. Read-only.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { translationProse, dropDriftedPages } from '../../lib/block-drift.mjs';
import { stripAnchor } from '../../lib/block-page-guard.mjs';

const [BLOCKS, DIR, LABELS, OUT] = process.argv.slice(2);
const MARGIN = 0.05;
const STOP = new Set('that this with from have were which their there they them then than when what will would been into also upon your these those such only more most other some very said shall should could being after before about where while whom whose unto thee thou thus same each both many much must made make like over under again even here just itself himself because through without between among against'.split(' '));
const words = (t) => new Set((translationProse(String(t || '')).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').match(/\p{L}{4,}/gu) || []).filter((w) => !STOP.has(w)));
const contain = (a, b) => { if (!a.size) return 0; let k = 0; for (const w of a) if (b.has(w)) k++; return k / a.size; };
export function attribute(text, refs, n) {
  const A = words(text);
  if (A.size < 40) return { v: 'short', size: A.size };
  const s = Object.fromEntries([[-1, 'prev'], [0, 'own'], [1, 'next']].map(([d, k]) => [k, refs.has(n + d) ? contain(A, refs.get(n + d)) : null]));
  const best = Math.max(s.prev ?? -1, s.next ?? -1);
  const v = s.own == null ? 'noref' : s.own >= best ? 'own' : best - s.own >= MARGIN ? (s.next === best ? 'next' : 'prev') : 'tie';
  return { v, ...Object.fromEntries(Object.entries(s).map(([k, x]) => [k, x == null ? null : Math.round(x * 100) / 100])) };
}
const read = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const blocks = read(BLOCKS);
const calls = read(`${DIR}/calls.jsonl`).filter((c) => c.text != null);
const labels = new Map(read(LABELS).map((b) => [b.b, new Map(b.pages.filter((p) => p.y).map((p) => [p.n, p.y]))]));
const c = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = c.db('bookstore');
const out = { blocks: [], summary: {} };
const tally = {};
const bump = (k, v) => { tally[k] ||= {}; tally[k][v] = (tally[k][v] || 0) + 1; };
for (const b of blocks) {
  const refs = new Map(calls.filter((x) => x.block === b.id && x.arm === 'single').map((x) => [x.pages[0], words(x.text)]));
  const lo = Math.min(...b.pages) - 1, hi = Math.max(...b.pages) + 1;
  const ps = await db.collection('pages').find({ book_id: b.book_id, page_number: { $gte: lo, $lte: hi } }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.updated_at': 1, 'translation.data': 1, 'translation.updated_at': 1, translation_withheld: 1 } }).toArray();
  const by = new Map(ps.map((p) => [p.page_number, p]));
  const wh = ps.filter((p) => typeof p.translation?.data !== 'string' && p.translation_withheld).map((p) => p.id);
  const revs = wh.length ? await db.collection('page_revisions').find({ page_id: { $in: wh }, field: 'translation' }, { projection: { page_id: 1, data: 1, original_date: 1, created_at: 1 } }).sort({ created_at: -1 }).toArray() : [];
  const rv = new Map(); for (const r of revs) if (!rv.has(r.page_id) && typeof r.data === 'string' && r.data.length) rv.set(r.page_id, r);
  const stored = new Map(b.pages.map((n) => { const p = by.get(n); return [n, typeof p?.translation?.data === 'string' ? p.translation.data : rv.get(p?.id)?.data ?? null]; }));
  const writtenAt = Math.min(...b.pages.map((n) => { const p = by.get(n); return new Date(p?.translation?.updated_at || rv.get(p?.id)?.original_date || 0).getTime(); }).filter(Boolean));
  const ocrChanged = b.pages.some((n) => by.get(n)?.ocr?.updated_at && new Date(by.get(n).ocr.updated_at).getTime() > writtenAt + 5000);
  const lab = labels.get(b.book_id) || new Map();
  const row = { id: b.id, kind: b.kind, book_id: b.book_id, lang: b.lang, pages: b.pages, onset: b.onset ?? null, ocr_changed_since_write: ocrChanged, stored: {}, arms: {} };
  for (const n of b.pages) {
    const a = attribute(stored.get(n), refs, n);
    row.stored[n] = { ...a, opus: lab.get(n) ?? null };
    if (lab.get(n)) bump(`instrument:opus=${lab.get(n)}`, a.v);
  }
  for (const x of calls.filter((y) => y.block === b.id && y.arm !== 'single')) {
    const secs = [...x.text.matchAll(/<translation\s+page="(\d+)">([\s\S]*?)<\/translation>/g)].map((m) => ({ tag: Number(m[1]), text: stripAnchor(m[2]).text }));
    const att = secs.map((s) => ({ tag: s.tag, len: s.text.length, ...attribute(s.text, refs, s.tag) }));
    const vs = att.map((a) => a.v);
    const slid = vs.filter((v) => v === 'next' || v === 'prev').length;
    const r = { sections: secs.length, expected: b.pages.length, tags_in_order: secs.map((s) => s.tag).join(',') === b.pages.join(','), verdicts: vs.join(' '), slid_sections: slid, att };
    if (x.arm === 'anchor') {
      const tr = new Map(secs.map((s) => [s.tag, s.text]));
      const anchors = new Map((x.anchors || []).map((a) => [a.page, { first: a.first, last: a.last }]));
      const pages = b.pages.map((n) => by.get(n));
      const { drifted } = dropDriftedPages(pages, new Map(tr), { caseless: /chinese|japanese|tibetan/i.test(b.lang || ''), anchors, prevOcr: by.get(lo)?.ocr?.data ?? null, nextOcr: by.get(hi)?.ocr?.data ?? null });
      r.guard = drifted.map((d) => `${d.prev}:${d.kind}`);
    }
    row.arms[`${x.arm}${x.rep}`] = r;
    bump(`${b.kind}:${x.arm}`, slid ? 'slid' : secs.length !== b.pages.length ? 'count-mismatch' : 'clean');
  }
  out.blocks.push(row);
}
await c.close();
out.summary = tally;
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify(tally, null, 1));
