#!/usr/bin/env node
/**
 * latin-repair-census-5924/census.mjs — every stored page of the 60 drawn books through the six detectors (#5924).
 *
 * PRIOR ART: ./detectors.mjs + ./controls.mjs (this job; the gate there must pass before a class is counted).
 * Reads $JOB_SCRATCH/draw.json and pages/<book>.jsonl.gz (draw.mjs). Writes $JOB_SCRATCH/census-pages.jsonl.gz
 * (one row per page: flags + the numbers behind them, no page text) and census-books.json. Prints counts only.
 */
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import * as D from './detectors.mjs';
import { loadModels } from './controls.mjs';

const OUT = process.env.JOB_SCRATCH || '/data/scratch/sl/jobs/latin-repair-census';
const th = JSON.parse(fs.readFileSync(path.join(OUT, 'thresholds.json'), 'utf8')); D.INTERLEAVE_T.share = th.interleave_share;
const gate = JSON.parse(fs.readFileSync(path.join(OUT, 'controls.json'), 'utf8')).gate;
for (const [k, v] of Object.entries(gate)) if (!v.pass) throw new Error(`detector ${k} failed its controls — not counted`);
const { lex, lm } = loadModels();
const draw = JSON.parse(fs.readFileSync(path.join(OUT, 'draw.json'), 'utf8'));
const readJsonl = f => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);

export const CLASSES = ['long_s', 'bleed', 'loop', 'interleave', 'truncation', 'empty'];
const rows = []; const books = [];
for (const b of draw) {
  const all = readJsonl(path.join(OUT, 'pages', `${b.book_id}.jsonl.gz`)).sort((x, y) => x.page_number - y.page_number);
  const P = all.filter(p => String(p.text || '').trim());
  const L = P.map(p => D.bodyLines(p.text)); const N = L.map(l => D.letters(l.join(' ')));
  const out = [];
  P.forEach((p, i) => {
    const lines = L[i]; const nb = [L[i - 1], L[i + 1]].filter(Boolean);
    const nbL = []; for (let j = Math.max(0, i - 4); j <= Math.min(P.length - 1, i + 4); j++) if (j !== i) nbL.push(N[j]);
    const lb = D.lineBroken(lines);
    const r = { ls: D.longS(lines, lex), bl: D.bleed(lines, nb), ms: D.marginStrip(p.text, lex), lo: D.loops(p.text, lines), tr: D.truncation(lines, nbL, p.page_type), em: D.empty(p.text, lines, p.page_type, nbL), il: lb ? D.interleave(lines, lm, lex) : { path: 'n/a' } };
    const f = {
      long_s: D.longSFires(r.ls), bleed: D.bleedFires(r.bl, r.ms) && !D.loopFires(r.lo), loop: D.loopFires(r.lo),
      interleave: D.interleaveFires(r.il), truncation: D.truncFires(r.tr) && !D.emptyFires(r.em), empty: D.emptyFires(r.em),
    };
    const fixable = f.long_s || f.bleed || f.loop, reread = f.interleave || f.truncation || f.empty;
    out.push({ book_id: b.book_id, page_number: p.page_number, idx: i, model: p.model, page_type: p.page_type, letters: N[i], line_broken: lb,
      il_applicable: r.il.path === 'hyphen', flags: f, fixable, reread, any: fixable || reread, only_fixable: fixable && !reread,
      ls_hits: r.ls.hits, ls_tokens: r.ls.tokens, ls_ex: r.ls.examples.slice(0, 3), bl: r.bl, ms: r.ms, bl_dupedge: D.bleedDupEdgeFires(r.bl), lo: { share: r.lo.share, uniq: +r.lo.uniqRatio.toFixed(3) },
      tr: r.tr.ratio == null ? null : +r.tr.ratio.toFixed(3), il: r.il.path === 'hyphen' ? [r.il.hyph, r.il.hyphNext, r.il.hyphSkip] : null, il_lm: r.il.share ?? null });
  });
  rows.push(...out);
  const rate = k => out.filter(o => o.flags[k]).length / Math.max(1, out.length);
  books.push({ book_id: b.book_id, century: b.century, engine: b.engine, major_model: b.major_model, pages_total: all.length, pages_with_ocr: P.length,
    rates: Object.fromEntries(CLASSES.map(k => [k, +rate(k).toFixed(4)])),
    reread: +(out.filter(o => o.reread).length / P.length).toFixed(4), fixable: +(out.filter(o => o.fixable).length / P.length).toFixed(4),
    any: +(out.filter(o => o.any).length / P.length).toFixed(4) });
}
fs.writeFileSync(path.join(OUT, 'census-pages.jsonl.gz'), zlib.gzipSync(rows.map(r => JSON.stringify(r)).join('\n')));
fs.writeFileSync(path.join(OUT, 'census-books.json'), JSON.stringify(books, null, 1));
const c = k => rows.filter(r => r.flags[k]).length;
console.log(JSON.stringify({ books: books.length, pages: rows.length, ...Object.fromEntries(CLASSES.map(k => [k, c(k)])), any: rows.filter(r => r.any).length, reread: rows.filter(r => r.reread).length, only_fixable: rows.filter(r => r.only_fixable).length, line_broken: rows.filter(r => r.line_broken).length, il_applicable: rows.filter(r => r.il_applicable).length }));
