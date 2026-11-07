#!/usr/bin/env node
// PRIOR ART: tests/unit/block-page-guard.test.ts reads the same fixture with fixed expectations; this prints what the
// guard does on it, so those expectations are read off a run, not guessed (#5021).
import fs from 'node:fs';
import { blockPageRefusals, lengthRatioK } from '../../lib/block-page-guard.mjs';
const F = JSON.parse(fs.readFileSync('tests/fixtures/block-page-guard-5021.json', 'utf8'));
const pad = (x) => (x ? x[0] + ' ' + '~'.repeat(Math.max(0, x[1] - x[0].length - 1)) : '');
const page = (p) => ({ page_number: p.page_number, page_type: p.page_type, ocr: { data: pad(p.src) } });
for (const [k, c] of Object.entries(F.controls)) {
  const bk = lengthRatioK(c.pages.filter((p) => p.en).map((p) => ({ src: pad(p.src), en: pad(p.en), type: p.page_type })), { min: 5 });
  for (const size of [2, 4, 8]) {
    let caught = 0, al = 0, outside = 0;
    for (let s = 0; s + size <= c.pages.length; s++) {
      const w = c.pages.slice(s, s + size);
      if (!w.some((p) => c.shifted.includes(p.page_number))) continue;
      al++;
      const tr = new Map(w.filter((p) => p.en).map((p) => [p.page_number, pad(p.en)]));
      const prev = c.pages[s - 1], next = c.pages[s + size];
      const r = blockPageRefusals(w.map(page), tr, { prevOcr: prev ? pad(prev.src) : null, nextOcr: next ? pad(next.src) : null, k: bk });
      if (r.some((x) => c.shifted.includes(x.page_number))) caught++;
      outside += r.filter((x) => !c.shifted.includes(x.page_number)).length;
    }
    console.log(k, `size ${size}: caught ${caught}/${al} alignments; refusals outside shifted pages ${outside}`);
  }
}
for (const [fam, wins] of Object.entries(F.clean)) {
  let refused = 0; const why = [];
  for (const w of wins) {
    const tr = new Map(w.pages.map((p) => [p.page_number, pad(p.en)]));
    const r = blockPageRefusals(w.pages.map(page), tr, { prevOcr: w.prevSrc ? pad(w.prevSrc) : null, nextOcr: w.nextSrc ? pad(w.nextSrc) : null });
    refused += r.length; if (r.length) why.push(`${w.book_id}:${r.map((x) => `${x.page_number} ${x.reason} ${x.detail}`).join('; ')}`);
  }
  console.log(fam, `clean: ${refused} pages refused of ${wins.length * 4}`, why.join(' | '));
}
