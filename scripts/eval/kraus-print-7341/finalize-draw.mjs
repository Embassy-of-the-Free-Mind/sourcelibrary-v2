#!/usr/bin/env node
// PRIOR ART: scripts/eval/arabic-mss-gate-7341/finalize-draw.mjs — records the gate's by-eye picks and splits two-leaf
// frames; Kraus is photographed one page a frame, so this only records the picks and what each page carries, in the
// gate's draw.json shape so the gate's prep/key/judge/score glue runs on it unchanged.
/**
 * draw.json for the Kraus 25-page print test (#7341): each stratum's first candidate that is a text page.
 *   node scripts/eval/kraus-print-7341/finalize-draw.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.JOB_SCRATCH;
// by-eye screen 2026-10-26 of the contact sheets: every stratum's FIRST candidate is a text page, so no skips. Not
// reached: p1 (binding), p4 (blank), p567 (errata), p581 (library bookplate). What each pick carries, by eye:
const FEATURES = {
  16: 'text + 6-line apparatus', 27: 'text + heavy apparatus (half page)', 65: 'section heading mid-page + apparatus',
  87: 'section heading (al-ṭilasmāt) + apparatus', 112: 'text + apparatus', 139: 'text, numbers in words, 1-line apparatus',
  152: 'text + apparatus, vocalised words', 174: 'text + apparatus, marginal folio numbers', 190: 'SHORT: 4 lines of text + 2 notes (end of a treatise)',
  221: 'text + apparatus', 252: 'text + heavy apparatus', 267: 'section heading + heavy apparatus (half page)',
  283: 'treatise opening (al-Khawāṣṣ al-kabīr heading) + heavy apparatus', 310: 'text + heavy apparatus', 331: 'short text block + heavy apparatus',
  354: 'text + apparatus', 383: 'text + apparatus + bibliographic footnote', 409: 'list/table of terms + text + apparatus',
  440: 'dense text, 1-line apparatus', 465: 'text + apparatus', 475: 'treatise opening (basmala, heading) + apparatus + footnote',
  506: 'dense text, 1-line apparatus', 534: 'text + apparatus', 540: 'text + apparatus', 563: 'text + apparatus',
};
const cand = JSON.parse(fs.readFileSync(path.join(ROOT, 'candidates.json'), 'utf8'));
const pages = cand.strata.map((s) => {
  const c = s.candidates[0];
  if (!FEATURES[c.page]) throw new Error(`no screen note for p${c.page}`);
  return { uid: `${cand.book_id}_${c.page}`, book_id: cand.book_id, page: c.page, stratum: s.stratum, cell: 'ar-print', leaf: null, crop: null,
    image: path.join(ROOT, 'img', `${cand.book_id}_${c.page}.jpg`), features: FEATURES[c.page],
    url: `https://sourcelibrary.org/book/${cand.book_id}?page=${c.page}`, archived: c.url };
});
fs.writeFileSync(path.join(ROOT, 'draw.json'), JSON.stringify({ seed: cand.seed, rule: cand.rule, exclude: cand.exclude, skipped_by_eye: {}, pages }, null, 1));
console.log(pages.length, 'pages:', pages.map((p) => p.page).join(' '));
