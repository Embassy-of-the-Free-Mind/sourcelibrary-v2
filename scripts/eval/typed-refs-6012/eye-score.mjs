#!/usr/bin/env node
// #6012: by-eye verdicts against the machine's CURRENT claims (pairs.jsonl / aligned-pages.jsonl), so a
// rule change after the reading re-scores the same blind verdicts. Writes the verdicts (no typed text,
// no images) to scripts/eval/typed-refs-6012/eye-verdicts.json for the PR.
// PRIOR ART: ground-truth-5935/floor.mjs scores difference verdicts (ours / theirs / variant); #5126's
// leaf-check.json is a list without a claim to score against.
import fs from 'node:fs';
import path from 'node:path';
import { argOf } from './lib.mjs';
const WORK = argOf('work', '/data/scratch/sl/typed-refs-6012');
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const out = { read_on: '2026-10-06', readers: 'Claude subagents, one per source and check, reading the page image; the machine claim was withheld from them', title: {}, leaf: {} };
for (const [src, dir] of [['dta', 'dta'], ['camena', 'camena'], ['eebo-tcp', 'eebo']]) {
  const pairs = new Map(readJsonl(`${WORK}/${dir}/pairs.jsonl`).map((p) => [`${p.source_id}|${p.book_id}`, p]));
  const pages = new Map(readJsonl(`${WORK}/${dir}/aligned-pages.jsonl`).map((p) => [`${p.source_id}|${p.book_id}|${p.page_number}`, p]));
  for (const kind of ['title', 'leaf']) {
    const d = path.join(WORK, 'eye', kind, src);
    if (!fs.existsSync(`${d}/verdicts.jsonl`)) continue;
    const idx = new Map(JSON.parse(fs.readFileSync(`${d}/index.json`, 'utf8')).map((i) => [i.id, i]));
    const rows = readJsonl(`${d}/verdicts.jsonl`).map((v) => {
      const i = idx.get(v.id);
      if (kind === 'title') { const p = pairs.get(`${i.source_id}|${i.book_id}`); return { id: v.id, source_id: i.source_id, book_id: i.book_id, page_number: i.page_number, claimed_kind: p?.kind ?? null, tier: p?.tier, congruent_share: p?.congruent_share, eye: v.verdict, eye_confidence: v.confidence, image_imprint: v.image_imprint, evidence: String(v.evidence || '').slice(0, 400) }; }
      const p = pages.get(`${i.source_id}|${i.book_id}|${i.page_number}`);
      return { id: v.id, source_id: i.source_id, book_id: i.book_id, page_number: i.page_number, claimed_kind: p?.kind ?? null, congruent: p?.congruent ?? null, overlap: p?.overlap ?? null, engine: i.engine, leaf: v.leaf, boundaries: v.boundaries, wording: v.wording, typed_errors: (v.typed_errors || []).length, note: String(v.note || '').slice(0, 300) };
    });
    let s;
    if (kind === 'title') {
      const judged = rows.filter((r) => r.eye !== 'cannot-tell' && r.claimed_kind);
      const se = judged.filter((r) => r.claimed_kind === 'same-edition'), sw = judged.filter((r) => r.claimed_kind === 'same-work-other-edition');
      s = { read: rows.length, judged: judged.length, cannot_tell: rows.length - judged.length, same_work_or_closer: judged.filter((r) => r.eye !== 'different-work').length, kind_agrees: judged.filter((r) => r.eye === r.claimed_kind).length,
        claimed_same_edition: se.length, of_those_same_edition_by_eye: se.filter((r) => r.eye === 'same-edition').length, claimed_other_edition: sw.length, of_those_other_edition_by_eye: sw.filter((r) => r.eye === 'same-work-other-edition').length, different_work: judged.filter((r) => r.eye === 'different-work').map((r) => r.id) };
    } else {
      const c = rows.filter((r) => r.congruent), nc = rows.filter((r) => r.congruent === false);
      s = { read: rows.length, same_leaf: rows.filter((r) => r.leaf === 'same-leaf').length, wrong_leaf: rows.filter((r) => r.leaf === 'wrong-leaf').length,
        claimed_on_page_breaks: c.length, of_those_exact_by_eye: c.filter((r) => r.boundaries === 'exact').length, of_those_same_setting: c.filter((r) => r.wording === 'same-setting').length,
        claimed_off_page_breaks: nc.length, of_those_superset_or_partial: nc.filter((r) => r.boundaries !== 'exact').length, pages_with_a_typed_error: rows.filter((r) => r.typed_errors > 0).length };
    }
    out[kind][src] = { summary: s, rows };
    console.log(kind, src, JSON.stringify(s));
  }
}
// EEBO-TCP translations: the relation (20 texts) and the passage placement (12 pages).
for (const kind of ['translation', 'passage']) {
  const d = path.join(WORK, 'eye', kind, 'eebo-tcp');
  if (!fs.existsSync(`${d}/verdicts.jsonl`)) continue;
  const idx = new Map(JSON.parse(fs.readFileSync(`${d}/index.json`, 'utf8')).map((i) => [i.id, i]));
  const rows = readJsonl(`${d}/verdicts.jsonl`).map((v) => { const i = idx.get(v.id); return kind === 'translation'
    ? { id: v.id, source_id: i.source_id, book_id: i.book_id, tier: i.tier, eye: v.verdict, eye_confidence: v.confidence, read_from: v.read_from, evidence: String(v.evidence || '').slice(0, 400) }
    : { id: v.id, source_id: i.source_id, book_id: i.book_id, page_number: i.page_number, typed_page_idx: i.typed_page_idx, score: i.score, margin: i.margin, passage: v.passage, coverage: v.coverage, fidelity_note: String(v.fidelity_note || '').slice(0, 300) }; });
  const count = (k) => rows.reduce((a, r) => { a[r[k]] = (a[r[k]] || 0) + 1; return a; }, {});
  const s = kind === 'translation' ? { read: rows.length, by_verdict: count('eye'), relation_holds: rows.filter((r) => /^(translation-of-this-work|contains-translation-of-this-work|our-book-contains-the-original)$/.test(r.eye)).length, by_tier: rows.reduce((a, r) => { const ok = /^(translation|contains|our-book)/.test(r.eye); a[r.tier] ??= [0, 0]; a[r.tier][0] += ok ? 1 : 0; a[r.tier][1]++; return a; }, {}) }
    : { read: rows.length, by_passage: count('passage'), by_coverage: count('coverage') };
  out[kind] = { 'eebo-tcp': { summary: s, rows } };
  console.log(kind, JSON.stringify(s));
}
fs.writeFileSync('scripts/eval/typed-refs-6012/eye-verdicts.json', JSON.stringify(out, null, 1));
