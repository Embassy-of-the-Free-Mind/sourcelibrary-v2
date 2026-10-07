#!/usr/bin/env node
/**
 * PRIOR ART: none in scripts/audit or scripts/eval for OCR-side polarity (looked: `ls scripts/audit`,
 * `git grep -i negat scripts/`; page-error-taxonomy.md §T8 / #5150 covers inverted sense WITH correct OCR,
 * and #5913 is the prompt side). This compares two stored READS of the same page, so it needs no model.
 *
 * ocr-negation-flip-candidates — list words where two OCR reads of a page differ only by the characters that
 * carry a negation, so a person (or a third read) can decide which read is right (#6142).
 *
 * WHY. The 2026-10-07 shelf overview found OCR dropping a negation, and the English then asserting the
 * opposite, on 5 distinct books in 3 scripts: Tattvasaṃgraha vol I p760 (स्मरणमकारण → स्मरणकारण) and vol II
 * p300 (कारणभेदाप्रति → कारणभेदप्रति), Krom's Mendut (Dutch "niet" dropped), Kats's Rāmāyaṇa reliefs ("geen"
 * → "zijn"), and a Tibetan Kanjur 'Bum volume (an added མ). Sanskrit hides the negation in sandhi — the "not"
 * can be the vowel carried by म, an ā-sign, or one virāma (तद्युक्तम् "that is right" / तदयुक्तम् "that is
 * wrong") — so a prefix match misses it. This pairs each token present in only one read with its nearest
 * token in the other and flags pure insertions/deletions of ≤ 2 characters from a per-script set.
 *
 * WHAT IT CANNOT DO. It cannot tell a dropped negation from a length-mark slip (on the Tattvasaṃgraha, 1,455
 * pairs on 747 of 1,218 pages; most are ā/virāma noise). It is a WORKLIST for a tie-break read, never a
 * verdict, and it sees nothing on a page with only one stored read.
 *
 * Reads: pages.ocr (current read) and the newest page_revisions OCR row (the previous read). Read-only.
 *
 *   node --env-file=.env.production.local scripts/audit/ocr-negation-flip-candidates.mjs \
 *     --books <id,id> [--script devanagari|latin|tibetan] [--out file.json]
 * With no --books it runs the Tattvasaṃgraha positive controls and exits 1 if either is missed.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const CONTROLS = [['6a308257675ed2bdbe36eddd', 760], ['6a30825e675ed2bdbe36f107', 300]];
const BOOKS = arg('books', null)?.split(',') ?? [...new Set(CONTROLS.map(([b]) => b))];
const SCRIPT = arg('script', 'devanagari');
const OUT = arg('out', null);
const NEG_CHARS = {
  devanagari: new Set(['अ', 'ा', 'न', '्', 'म']),
  tibetan: new Set(['མ', 'ི', 'ེ', 'ད', '་']),
  latin: new Set([...'nietgeonu']), // niet / geen / non / ne / un-: coarse on purpose
}[SCRIPT];
if (!NEG_CHARS) throw new Error(`--script must be devanagari, tibetan or latin, not ${SCRIPT}`);

const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/->|<-/g, ' ');
const toks = (s) => strip(s).split(/[\s।॥།,;:()\[\]\-—"“”'‘’०-९0-9.*|]+/).filter((t) => [...t].length >= 4);

/** Pure insertion/deletion of ≤ 2 code points between a and b, or null. */
export function indel(a, b) {
  const A = [...a], B = [...b], n = A.length, m = B.length;
  if (Math.abs(n - m) > 2) return null;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const lcs = L[0][0];
  if (n - lcs + (m - lcs) > 2 || (n - lcs > 0 && m - lcs > 0)) return null;
  const onlyA = [], onlyB = [];
  let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) onlyA.push(A[i++]); else onlyB.push(B[j++]); }
  while (i < n) onlyA.push(A[i++]); while (j < m) onlyB.push(B[j++]);
  return { onlyA, onlyB };
}

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const rows = [];
let compared = 0, single = 0;
for (const book of BOOKS) {
  const pages = await db.collection('pages').find({ book_id: book, 'ocr.data': { $type: 'string' } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
  for (const p of pages) {
    const [prev] = await db.collection('page_revisions').find({ page_id: p.id, field: 'ocr' }).sort({ created_at: -1 }).limit(1).toArray();
    if (!prev?.data) { single++; continue; }
    compared++;
    const cur = new Set(toks(p.ocr.data)), old = new Set(toks(prev.data));
    const curOnly = [...cur].filter((t) => !old.has(t)), oldOnly = [...old].filter((t) => !cur.has(t));
    const hits = [];
    for (const o of oldOnly) for (const n of curOnly) {
      const d = indel(o, n);
      if (!d) continue;
      const diff = [...d.onlyA, ...d.onlyB];
      if (diff.length && diff.every((ch) => NEG_CHARS.has(ch))) hits.push({ dir: d.onlyA.length ? 'current_dropped' : 'current_added', previous: o, current: n, chars: diff.join(''), previous_model: prev.model ?? null });
    }
    if (hits.length) rows.push({ book, page: p.page_number, page_id: p.id, url: `https://sourcelibrary.org/book/${book}?page=${p.page_number}`, hits });
  }
}
await c.close();
if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
const all = rows.flatMap((r) => r.hits);
console.log(`pages compared ${compared} (single read, not judged: ${single}); pages with candidates ${rows.length}; candidate pairs ${all.length}`);
if (!arg('books', null)) {
  let missed = 0;
  for (const [b, pg] of CONTROLS) {
    const hit = rows.find((r) => r.book === b && r.page === pg);
    console.log(`positive control ${b} p${pg}: ${hit ? 'FOUND' : 'MISSED'}`);
    if (!hit) missed++;
  }
  process.exit(missed ? 1 : 0);
}
