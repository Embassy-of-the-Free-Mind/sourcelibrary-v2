#!/usr/bin/env node
// PRIOR ART: scripts/eval/seam-ab-5678.mjs (#5701) — the seam A/B whose outputs and blind verdicts this
// re-reads; its positionalSpans() is the post-hoc "Amendment 2" reading, an eval-only copy that never
// reached the lane. scripts/eval/folio-markers-5678.mjs (#5682) — the Tengyur preview blocks. Neither
// re-parses with the lane's own parser; this does, at $0, so the parse the lane would ship is the one
// scored.
/**
 * Folio markers: the positional parser re-read over the existing outputs (#5678). No model calls, no
 * writes outside scripts/eval/results/folio-positional-5678/.
 *
 *   node scripts/eval/folio-positional-5678.mjs
 *
 * 1. Seam A/B (scripts/eval/results/seam-ab-5678/): every marker block (arms B and C, 240) parsed by
 *    scripts/lib/folio-markers.mjs as it is NOW, against the literal parse recorded at collect time
 *    (`o.markers`). The blind verdicts were given on the harness's post-hoc positional spans, so each
 *    block's new spans are cut to the same turn window and compared with the packet text the judges
 *    read (not with positionalSpans() re-run: that imports this parser). Where they agree, the
 *    verdict carries over.
 * 2. Re-score: a break is a real seam defect when the new parse leaves either page empty, or both
 *    judges flagged a real defect (realDefect, the registered consensus rule).
 * 3. Tengyur preview (scripts/eval/results/folio-markers-5678/blocks/): every page's span is the same
 *    under the new parser as the one stored in the block file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseFolioMarkedText } from '../lib/folio-markers.mjs';
import { realDefect, display } from './seam-ab-5678.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), 'results');
const AB = path.join(ROOT, 'seam-ab-5678');
const TG = path.join(ROOT, 'folio-markers-5678', 'blocks');
const OUT = path.join(ROOT, 'folio-positional-5678');
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const units = new Map(readJsonl(path.join(AB, 'sample.jsonl')).map((u) => [u.unit, u]));
const outs = readJsonl(path.join(AB, 'outputs.jsonl')).filter((o) => o.arm === 'B' || o.arm === 'C');

// verdicts: unit|arm|slot → verdict (originals only, as phaseScore reads them)
const { key } = JSON.parse(fs.readFileSync(path.join(AB, 'packet-key.json'), 'utf8'));
const cell = new Map();
for (const f of fs.readdirSync(path.join(AB, 'verdicts')).filter((x) => x.endsWith('.jsonl'))) {
  const m = f.match(/packet-(\d+)-judge-(\d+)/); if (!m) continue;
  for (const r of readJsonl(path.join(AB, 'verdicts', f))) {
    const k = key[r.id]; if (!k || k.repeat_of_unit) continue;
    for (const [letter, src] of Object.entries(k.versions)) if (!src.startsWith('PLANT') && r.versions?.[letter]) cell.set(`${k.unit}|${src}|j${m[2]}`, r.versions[letter]);
  }
}

// What the judges read: unit|arm → the turn window of N and N+1 (packet text, originals only).
const tailW = (t, n) => (t.length > n ? `…${t.slice(t.length - n).replace(/^\S*\s/, '')}` : t);   // as in seam-ab-5678 phasePackets
const headW = (t, n) => (t.length > n ? `${t.slice(0, n).replace(/\s\S*$/, '')}…` : t);
const NONE = '(NO ENGLISH FOR THIS PAGE)';
const window = (en, en1) => ({ end: en ? tailW(display(en), 850) : NONE, start: en1 ? headW(display(en1), 700) : NONE });
const judgedText = new Map();
for (const f of fs.readdirSync(path.join(AB, 'packets')).filter((x) => x.endsWith('.jsonl'))) {
  for (const it of readJsonl(path.join(AB, 'packets', f))) {
    const k = key[it.id]; if (!k || k.repeat_of_unit) continue;
    for (const v of it.versions) judgedText.set(`${k.unit}|${k.versions[v.letter]}`, { end: v.en_n_end, start: v.en_n1_start });
  }
}

const rows = outs.map((o) => {
  const u = units.get(o.unit);
  const nums = u.pages.map((p) => p.page_number);
  const lit = o.markers || {};
  const oldFail = !o.raw || !!lit.missing?.length || !!lit.duplicated?.length || !!lit.outOfOrder;
  const p = o.raw ? parseFolioMarkedText(o.raw, nums) : null;
  const newSpans = Object.fromEntries(nums.map((n) => [n, p?.pages.find((x) => x.page_number === n)?.span || null]));
  const newFail = nums.some((n) => !newSpans[n]);
  const seen = judgedText.get(`${o.unit}|${o.arm}`);
  const mine = window(newSpans[nums[0]], newSpans[nums[1]]);
  const sameAsJudged = !!seen && seen.end === mine.end && seen.start === mine.start;
  const judged = ['j1', 'j2'].map((s) => cell.get(`${o.unit}|${o.arm}|${s}`)).filter(Boolean);
  const judgedBoth = judged.length === 2 && judged.every(realDefect);
  return {
    unit: o.unit, arm: o.arm, stratum: u.stratum, reading: p?.reading || 'no-output', rejected: p?.rejected || null, old_fail: oldFail, new_fail: newFail, same_spans_as_judged: sameAsJudged,
    judged_real_both: judgedBoth, defect_old: oldFail || judgedBoth, defect_new: newFail || judgedBoth,
  };
});

const summary = {};
for (const stratum of ['pagebreak', 'control']) {
  for (const arm of ['B', 'C']) {
    const rs = rows.filter((r) => r.stratum === stratum && r.arm === arm);
    const n = (f) => rs.filter(f).length;
    summary[`${stratum}/${arm}`] = {
      blocks: rs.length,
      readings: rs.reduce((a, r) => ({ ...a, [r.reading]: (a[r.reading] || 0) + 1 }), {}),
      parse_fail_old: n((r) => r.old_fail), parse_fail_new: n((r) => r.new_fail),
      spans_differ_from_judged: n((r) => !r.same_spans_as_judged),
      real_defects_old_parse: n((r) => r.defect_old), real_defects_new_parse: n((r) => r.defect_new),
      defects_removed_by_parse: n((r) => r.defect_old && !r.defect_new),
    };
  }
}

// Tengyur preview: the stored per-page spans must survive the new parser unchanged.
const tengyur = fs.readdirSync(TG).filter((f) => f.endsWith('.json')).map((f) => {
  const b = JSON.parse(fs.readFileSync(path.join(TG, f), 'utf8'));
  const p = parseFolioMarkedText(b.response, b.pages);
  const stored = new Map((b.parsed?.pages || []).map((x) => [x.page_number, x.span || '']));
  const differ = p.pages.filter((x) => (stored.get(x.page_number) ?? '') !== x.span).map((x) => x.page_number);
  return { block: b.key, reading: p.reading, missing: p.missing, pages_differing_from_stored: differ };
});

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'blocks.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const report = { at: new Date().toISOString(), seam_ab: summary, tengyur };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
