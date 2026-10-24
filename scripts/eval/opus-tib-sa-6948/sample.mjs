#!/usr/bin/env node
// PRIOR ART: scripts/eval/tib-translator-6948/sample.py — one page per book from the #6948 frame, CANON / OTHER by
// title (its CANON regex is copied here). It draws single pages for a judge; this draws a BLOCK of consecutive pages
// per book for a translation pilot, assigns the per-call arm, and picks the one page per book the auditor reads.
/**
 * sample.mjs — $0, no database. The stage-1 pilot draw for job opus-tib-sa-6948 (#6948), seed 6948.
 *   80 Tibetan books (40 CANON + 40 OTHER by title, as #6948's sample.py) and 40 Sanskrit books, at random from the
 *   frames (frame.mjs); per book one block of up to 10 consecutive frame pages. Arms: within each stratum, half the
 *   books are read at --per-call=10 and half at --per-call=1. One page of each block is the audit page.
 *   node scripts/eval/opus-tib-sa-6948/sample.mjs      reads $JOB_SCRATCH/frame-{bo,sa}.jsonl, writes $JOB_SCRATCH/pilot.json
 *   and $JOB_SCRATCH/pilot/<arm>.json (JSON page-id arrays in page order, the claude-translate.mjs input).
 */
import fs from 'node:fs';

const S = process.env.JOB_SCRATCH;
const SEED = 6948;
export const CANON = /kanjur|kangyur|tengyur|tanjur|bka['’]? ?['’]?gyur|bstan ?['’]?gyur|བཀའ་འགྱུར|བསྟན་འགྱུར|derge|^(kanjur )?['’]?bum\s+\S+$|khri brgyad stong|nyi khri|brgyad stong/i;

export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const shuffle = (xs, r) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };
export const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

/** Group frame rows by book, pages in page order. */
export function byBook(rows) {
  const m = new Map();
  for (const r of rows) (m.get(r.book_id) || m.set(r.book_id, []).get(r.book_id)).push(r);
  for (const ps of m.values()) ps.sort((a, b) => a.page_number - b.page_number);
  return m;
}

/**
 * A block of up to `n` consecutive frame pages around a random page of the book. The random page is drawn from the
 * pages that have a frame neighbour when the book has any: the frame is scattered (21% of Tibetan frame pages have
 * no frame page on either side, 2026-10-24), and a one-page block is the same call at 10/call and at 1/call, so it
 * would teach the per-call comparison nothing.
 */
export function pickBlock(pages, r, n = 10) {
  const paired = pages.map((p, i) => i).filter((i) => pages[i - 1]?.page_number === pages[i].page_number - 1 || pages[i + 1]?.page_number === pages[i].page_number + 1);
  const k = paired.length ? paired[Math.floor(r() * paired.length)] : Math.floor(r() * pages.length);
  let s = k, e = k;
  while (s > 0 && pages[s - 1].page_number + 1 === pages[s].page_number) s--;
  while (e < pages.length - 1 && pages[e].page_number + 1 === pages[e + 1].page_number) e++;
  const start = Math.max(s, Math.min(k, e - n + 1));
  return pages.slice(start, Math.min(e + 1, start + n));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = rng(SEED);
  const pilot = [];
  const draw = (lang, stratum, pool, n) => {
    const ids = shuffle([...pool.keys()].sort(), r).slice(0, n);
    ids.forEach((bookId, i) => {
      const block = pickBlock(pool.get(bookId), r);
      const audit = block[Math.floor(r() * block.length)];
      pilot.push({ lang, stratum, arm: `${lang}-pc${i % 2 ? 1 : 10}`, book_id: bookId, title: block[0].title, hold: block[0].hold, pages: block.map((p) => ({ id: p.page_id, n: p.page_number })), audit_page_id: audit.page_id });
    });
    if (ids.length < n) console.error(`${lang} ${stratum}: only ${ids.length} books`);
  };
  const bo = byBook(readJsonl(`${S}/frame-bo.jsonl`));
  const canon = new Map([...bo].filter(([, ps]) => CANON.test((ps[0].title || '').trim())));
  const other = new Map([...bo].filter(([k]) => !canon.has(k)));
  draw('bo', 'CANON', canon, 40);
  draw('bo', 'OTHER', other, 40);
  draw('sa', 'ALL', byBook(readJsonl(`${S}/frame-sa.jsonl`)), 40);   // 28 books in the frame on 2026-10-24: all of them
  fs.mkdirSync(`${S}/pilot`, { recursive: true });
  fs.writeFileSync(`${S}/pilot.json`, JSON.stringify({ seed: SEED, at: new Date().toISOString(), books: { bo_canon: canon.size, bo_other: other.size }, pilot }, null, 1));
  const arms = {};
  for (const b of pilot) (arms[b.arm] ??= []).push(...b.pages.map((p) => p.id));
  for (const [a, ids] of Object.entries(arms)) fs.writeFileSync(`${S}/pilot/${a}.json`, JSON.stringify(ids));
  console.log(JSON.stringify({ frame_books: { bo_canon: canon.size, bo_other: other.size }, arms: Object.fromEntries(Object.entries(arms).map(([a, ids]) => [a, ids.length])) }));
}
