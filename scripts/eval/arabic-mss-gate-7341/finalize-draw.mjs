#!/usr/bin/env node
// PRIOR ART: draw.mjs (this dir) — candidates + contact sheets; this records the by-eye picks and splits two-leaf
// openings (all five BnF codices are photographed as openings) into one leaf, which the brief requires.
/**
 * draw.json for #7341: the screened picks (the first candidates in seeded order that pass the screen), with every
 * landscape frame split at its gutter (GUTTER, read by eye). Pick 1 of a book takes the RIGHT
 * leaf (read first in an Arabic codex), pick 2 the LEFT, so both leaf positions are in the set.
 *   node scripts/eval/arabic-mss-gate-7341/finalize-draw.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.env.JOB_SCRATCH;
// by-eye screen 2026-10-25 (skipped, in draw order): 5099 p107 (letter table + blank leaf); 4d119 p18 (binding);
// Kraus p106 (blank). Every other first-two candidate passed.
const PICKS = {
  '6ade30b13326a0839b2d1c42': [385, 231, 158, 320],
  '6ade3ec29b50b5cefadcb4a4': [22, 57], '6ade3ec99b50b5cefadcb53d': [17, 73], '6ade3ecf9b50b5cefadcb5f2': [71, 155],
  '6ade4ab2fb322b4ac41da372': [46, 196], '6ade4ab9fb322b4ac41da485': [17, 39], '6ade4d049fdb4f8d74799000': [30, 111],
  '6ade4d099fdb4f8d747990d9': [140, 169], '6ade4d0d9fdb4f8d747991bb': [46, 19], '6ade4d119fdb4f8d74799227': [13, 9],
  '6ade4d149fdb4f8d7479923b': [34, 29], '6ade4d189fdb4f8d747992cd': [33, 132], '6ade4d1c9fdb4f8d7479936f': [70, 155],
  '6ade4d209fdb4f8d74799441': [111, 38],
};
const SKIPPED = { '6ade4ab2fb322b4ac41da372': [107], '6ade4d119fdb4f8d74799227': [18], '6ade30b13326a0839b2d1c42': [106] };

// Gutter of each opening as a fraction of the frame width, read by eye against a ruler overlay. The automatic
// darkest-column search was tried first and missed by up to 12% (it locks onto ink columns), cutting line ends of
// the facing leaf into the crop; on 10 frames a hand reading is cheaper than a detector.
const GUTTER = {
  '6ade3ec29b50b5cefadcb4a4_22': 0.500, '6ade3ec29b50b5cefadcb4a4_57': 0.500, '6ade3ec99b50b5cefadcb53d_17': 0.510,
  '6ade3ec99b50b5cefadcb53d_73': 0.505, '6ade3ecf9b50b5cefadcb5f2_71': 0.495, '6ade3ecf9b50b5cefadcb5f2_155': 0.495,
  '6ade4ab2fb322b4ac41da372_46': 0.495, '6ade4ab2fb322b4ac41da372_196': 0.505, '6ade4ab9fb322b4ac41da485_17': 0.513,
  '6ade4ab9fb322b4ac41da485_39': 0.520,
};

const cand = JSON.parse(fs.readFileSync(path.join(ROOT, 'candidates.json'), 'utf8'));
fs.mkdirSync(path.join(ROOT, 'leaf'), { recursive: true });
const pages = [];
for (const b of cand.books) {
  for (const [i, pn] of PICKS[b.book_id].entries()) {
    const c = b.candidates.find((x) => x.page === pn);
    const src = path.join(ROOT, 'img', `${b.book_id}_${pn}.jpg`);
    let image = src, leaf = null, crop = null;
    if (c.w > c.h * 1.2) {
      const g = Math.round(c.w * GUTTER[`${b.book_id}_${pn}`]);
      leaf = i % 2 === 0 ? 'right' : 'left';
      crop = leaf === 'right' ? { left: g, top: 0, width: c.w - g, height: c.h } : { left: 0, top: 0, width: g, height: c.h };
      image = path.join(ROOT, 'leaf', `${b.book_id}_${pn}_${leaf}.jpg`);
      await sharp(src).extract(crop).jpeg({ quality: 92 }).toFile(image);
    }
    pages.push({ uid: `${b.book_id}_${pn}${leaf ? '_' + leaf[0] : ''}`, book_id: b.book_id, page: pn, cell: b.cell, leaf, crop, image,
      url: `https://sourcelibrary.org/book/${b.book_id}?page=${pn}`, archived: c.url });
  }
}
fs.writeFileSync(path.join(ROOT, 'draw.json'), JSON.stringify({ seed: cand.seed, rule: cand.rule, skipped_by_eye: SKIPPED, pages }, null, 1));
console.log(pages.length, 'pages;', pages.filter((p) => p.leaf).length, 'split');
