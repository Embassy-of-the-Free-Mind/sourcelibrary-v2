#!/usr/bin/env node
/**
 * PRIOR ART: src/lib/dedup.ts and scripts/import/enumerate-dedupe-source.ts decide whether a CANDIDATE
 * import duplicates a held book (title/edition match before insert); scripts/audit/baselines/
 * duplicate-fingerprints.json groups books by page-image fingerprint. Neither answers #4270's
 * question for a cohort already imported: how many of these books print juan that another of our
 * books (held or live) of the same Kanripo work already prints — i.e. would be OCR'd twice. That
 * needs work_id + a juan range parsed from the Siku volume title, which nothing in the repo parses.
 *
 * #5547 step 5 — duplicate share of the Chinese held cohort. Read-only.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-cohort-5547-duplicates.mjs \
 *     [--held=/root/preview-stubs-4719/ids-chinese-held-5481.txt] [--out=scripts/eval/results/chinese-cohort-5547/duplicates.json]
 *
 * A held book is a DUPLICATE READ when another held book, or a live book (visible, pages_count > 0),
 * carries the same work_id AND a title juan range that overlaps its own. Juan ranges come from the
 * title: 卷N, 卷N~卷M (Chinese numerals), 卷N之M (counted as juan N). A book whose title carries no
 * parseable juan is reported in its own bucket ("same work, juan unknown"), never as a duplicate.
 * Pages are counted from pages_count.
 */
import fs from 'fs';
import path from 'path';
import { connect, disconnect } from './lib/sampling.mjs';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const HELD = argOf('held', '/root/preview-stubs-4719/ids-chinese-held-5481.txt');
const OUT = argOf('out', 'scripts/eval/results/chinese-cohort-5547/duplicates.json');

const DIG = { 〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export function cnNum(s) {
  if (/^\d+$/.test(s)) return +s;
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch in DIG) cur = DIG[ch];
    else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
    else if (ch === '千') { total += (cur || 1) * 1000; cur = 0; }
    else return null;
  }
  return total + cur;
}
const NUM = '[〇零一二兩三四五六七八九十百千\\d]+';
/**
 * Juan key from a title, or null: [lo, hi] plus `sub` (the 之N part of 卷N之M — a sub-juan, so 卷十三之一 and
 * 卷十三之四 are different text) and `part` (what stands between the work title's '·' and 卷, e.g. 論語通 vs
 * 孟子通 — separately numbered sub-works). Both learned from the text check (verify) on 2026-10-01.
 */
export function juanRange(title) {
  const t = String(title || '');
  const m = t.match(new RegExp(`·?([^·()（）]*?)卷(${NUM})(?:之(${NUM})|([上中下]))?(?:[~～至\\-—]卷?(${NUM})?(?:之(${NUM})|([上中下]))?)?`));
  if (!m) return null;
  const lo = cnNum(m[2]), hi = m[5] ? cnNum(m[5]) : lo;
  if (lo == null || hi == null) return null;
  const r = [Math.min(lo, hi), Math.max(lo, hi)];
  // 之N (sub-juan) and 上/中/下 (half-juan) both name a PART of a juan
  r.sub = (m[3] || m[4] || '') + (m[6] || m[7] ? `~${m[6] || m[7]}` : ''); r.part = (m[1] || '').replace(/^.*·/, '').trim();
  return r;
}
const compatible = (a, b) => a && b && a.part === b.part && (!a.sub || !b.sub || a.sub === b.sub);
const overlaps = (a, b) => compatible(a, b) && a[0] <= b[1] && b[0] <= a[1];
/** the strict tier: the same juan range, same sub-work, same sub-juan */
const sameKey = (a, b) => compatible(a, b) && a[0] === b[0] && a[1] === b[1] && a.sub === b.sub;

async function main() {
  const held = new Set(fs.readFileSync(HELD, 'utf8').split('\n').map(s => s.trim()).filter(Boolean));
  const { db } = await connect();
  const P = { id: 1, title: 1, work_id: 1, pages_count: 1, visible: 1, pages_ocr: 1, hidden_reason: 1 };
  const heldBooks = await db.collection('books').find({ id: { $in: [...held] } }, { projection: P }).toArray();
  const works = [...new Set(heldBooks.map(b => b.work_id).filter(Boolean))];
  const kin = await db.collection('books').find({ work_id: { $in: works } }, { projection: P, maxTimeMS: 120000 }).toArray();
  const byWork = new Map();
  for (const b of kin) { if (!byWork.has(b.work_id)) byWork.set(b.work_id, []); byWork.get(b.work_id).push(b); }
  const rows = [];
  for (const b of heldBooks) {
    const r = juanRange(b.title);
    const others = (byWork.get(b.work_id) || []).filter(o => o.id !== b.id && (held.has(o.id) || (o.visible === true && (o.pages_count || 0) > 0)));
    const dupOf = r ? others.filter(o => overlaps(r, juanRange(o.title))) : [];
    const exactOf = r ? others.filter(o => sameKey(r, juanRange(o.title))) : [];
    const sameWorkNoJuan = !r ? others.length : others.filter(o => !juanRange(o.title)).length;
    rows.push({ id: b.id, title: b.title, work_id: b.work_id, kr: /^kr:/.test(b.work_id || ''), pages: b.pages_count || 0, juan: r, siblings: others.length,
      dup: dupOf.length > 0, exact: exactOf.length > 0, exact_with: exactOf.slice(0, 3).map(o => ({ id: o.id, title: o.title, held: held.has(o.id), live: o.visible === true && (o.pages_count || 0) > 0 })), dup_with: dupOf.slice(0, 5).map(o => ({ id: o.id, title: o.title, held: held.has(o.id), live: o.visible === true && (o.pages_count || 0) > 0, pages_ocr: o.pages_ocr || 0 })),
      dup_with_live_ocrd: dupOf.some(o => !held.has(o.id) && (o.pages_ocr || 0) >= 0.9 * (o.pages_count || 1)), same_work_juan_unknown: !r && others.length > 0 ? others.length : 0 });
  }
  const sum = f => rows.filter(f).reduce((s, r) => s + r.pages, 0);
  // REDUNDANT reads: cluster books (held + live) by exact key; a cluster needs ONE reading, so its redundant
  // held copies are all held members when a live member exists, else all held members but the largest.
  const keyOf = b => { const r = juanRange(b.title); return r && b.work_id ? `${b.work_id}|${r.part}|${r[0]}-${r[1]}|${r.sub}` : null; };
  const clusters = new Map();
  for (const b of kin) { if (!(held.has(b.id) || (b.visible === true && (b.pages_count || 0) > 0))) continue; const k = keyOf(b); if (!k) continue; if (!clusters.has(k)) clusters.set(k, []); clusters.get(k).push(b); }
  let redundantBooks = 0, redundantPages = 0, multi = 0;
  for (const members of clusters.values()) {
    if (members.length < 2) continue; multi++;
    const hm = members.filter(b => held.has(b.id)).sort((a, b) => (b.pages_count || 0) - (a.pages_count || 0));
    const liveOutside = members.some(b => !held.has(b.id));
    const red = liveOutside ? hm : hm.slice(1);
    redundantBooks += red.length; redundantPages += red.reduce((s, b) => s + (b.pages_count || 0), 0);
  }
  const n = f => rows.filter(f).length;
  // a duplicate PAIR inside the held set is one extra read, not two: count each held-only cluster's extra copies once
  const summary = {
    generated_at: new Date().toISOString(), held_books: rows.length, held_pages: sum(() => true),
    work_id: { kanripo: n(r => r.kr), local: n(r => r.work_id && !r.kr), none: n(r => !r.work_id) },
    juan_parsed: n(r => r.juan), juan_unparsed: n(r => !r.juan),
    with_any_sibling_same_work: n(r => r.siblings > 0),
    duplicate_books: n(r => r.dup), duplicate_pages: sum(r => r.dup),
    exact_key_books: n(r => r.exact), exact_key_pages: sum(r => r.exact),
    exact_key_clusters: multi, redundant_books: redundantBooks, redundant_pages: redundantPages,
    exact_key_of_live_book: n(r => r.exact && r.exact_with.some(d => d.live && !d.held)), exact_key_of_live_book_pages: sum(r => r.exact && r.exact_with.some(d => d.live && !d.held)),
    duplicate_of_live_book: n(r => r.dup && r.dup_with.some(d => d.live && !d.held)), duplicate_of_live_book_pages: sum(r => r.dup && r.dup_with.some(d => d.live && !d.held)),
    duplicate_of_live_fully_ocrd: n(r => r.dup_with_live_ocrd), duplicate_of_live_fully_ocrd_pages: sum(r => r.dup_with_live_ocrd),
    duplicate_within_held_only: n(r => r.dup && r.dup_with.every(d => d.held)),
    juan_unknown_same_work: n(r => !r.juan && r.siblings > 0), juan_unknown_same_work_pages: sum(r => !r.juan && r.siblings > 0),
    examples: rows.filter(r => r.dup).slice(0, 12).map(r => ({ title: r.title, juan: r.juan, dup_with: r.dup_with.map(d => `${d.title}${d.held ? ' [held]' : ' [live]'}`) })),
  };
  // VERIFY against text (a juan number can restart inside 前集/後集 or a 集 division, so a title match is
  // not a duplicate by itself): for a seeded sample of flagged pairs, compare the stored preview OCR
  // (pages 1–25, already read) — per page of A, the best character-bigram Dice against any page of B;
  // the pair's score is the median over A's pages with ≥ 100 Han characters. ≥ 0.6 = same text.
  const VERIFY = parseInt(argOf('verify', '40'), 10);
  if (VERIFY) {
    let h = 5547; const rnd = () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = [];
    for (const [tier, f] of [['exact', r => r.exact], ['overlap-only', r => r.dup && !r.exact]]) {
      const flagged = rows.filter(f).sort((a, b) => a.id.localeCompare(b.id)); let k = 0;
      while (k < VERIFY && flagged.length) { pick.push({ ...flagged.splice(Math.floor(rnd() * flagged.length), 1)[0], tier }); k++; }
    }
    const han = s => [...String(s || '')].filter(c => /\p{Script=Han}/u.test(c)).join('');
    const bigrams = s => { const m = new Map(); for (let i = 0; i + 1 < s.length; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
    const dice = (a, b) => { let inter = 0, na = 0, nb = 0; for (const v of a.values()) na += v; for (const v of b.values()) nb += v; for (const [g, v] of a) inter += Math.min(v, b.get(g) || 0); return na + nb ? 2 * inter / (na + nb) : 0; };
    const texts = async id => (await db.collection('pages').find({ book_id: id, page_number: { $lte: 30 }, 'ocr.data': { $exists: true } }, { projection: { page_number: 1, 'ocr.data': 1 }, maxTimeMS: 30000 }).toArray()).map(p => han(p.ocr.data)).filter(t => t.length >= 100);
    const verified = [];
    for (const r of pick) {
      const partner = r.tier === 'exact' ? r.exact_with[0] : r.dup_with[0];
      const A = await texts(r.id), B = (await texts(partner.id)).map(bigrams);
      if (!A.length || !B.length) { verified.push({ id: r.id, title: r.title, partner: partner.title, score: null, reason: `no comparable OCR (A ${A.length}, B ${B.length} pages)` }); continue; }
      const per = A.map(a => Math.max(...B.map(b => dice(bigrams(a), b)))).sort((x, y) => x - y);
      verified.push({ tier: r.tier, id: r.id, title: r.title, partner: partner.title, partner_held: partner.held, pages_compared: per.length, score: +per[per.length >> 1].toFixed(3) });
    }
    const scored = verified.filter(v => v.score != null);
    const tally = t => { const x = scored.filter(v => v.tier === t); return { scored: x.length, same_text: x.filter(v => v.score >= 0.6).length, different_text: x.filter(v => v.score < 0.3).length, ambiguous: x.filter(v => v.score >= 0.3 && v.score < 0.6).length }; };
    summary.verify = { sampled: pick.length, exact: tally('exact'), overlap_only: tally('overlap-only'), rule: 'median over A pages (≥100 Han chars, pages ≤30) of best char-bigram Dice vs any B page; ≥0.6 same text, <0.3 different', pairs: verified };
  }
  await disconnect();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // rows: the exact-key books only (the counted tier), compact — the overlap tier verified at 3/30 and is not used
  fs.writeFileSync(OUT, JSON.stringify({ summary, rows: rows.filter(r => r.exact).map(r => ({ id: r.id, title: r.title, work_id: r.work_id, pages: r.pages, juan: r.juan, exact_with: r.exact_with.map(o => o.id) })) }));
  console.log(JSON.stringify(summary, null, 1));
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch(e => { console.error(e); process.exit(1); });
