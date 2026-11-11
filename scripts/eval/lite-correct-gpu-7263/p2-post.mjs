#!/usr/bin/env node
// PRIOR ART: scripts/batch/ocr-convergence/correct.mjs parseAnswer (UNCHANGED / CONTAIN / a transcription; not exported
// for one-page inline replies, so the same three-way rule is applied here) and scripts/lib/cli-chatter.mjs
// ocrReadProblem (the chatter / restarted-read / duplicated-reply check, used as is).
// PREREG amendment 1: turns the raw P2 replies into rows the sets' scorers read (UNCHANGED → the draft; CONTAIN → not
// read), and scores format compliance per page for P2 and for P1's lite replies.
// Usage: node p2-post.mjs <zh scratch> <tib scratch>  → zh/out-lite-p2-correct.jsonl, tib/out/lite-p2-corr*.jsonl,
//        and format-compliance.json in the cwd
import fs from 'node:fs';
import { ocrReadProblem } from '../../lib/cli-chatter.mjs';

const [, , ZH, TIB] = process.argv;
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byUid = (f) => new Map(readJsonl(f).map((r) => [r.uid, r]));
const W = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

export function answerOf(text) {
  const t = String(text || '').trim().replace(/^```\w*\n?|\n?```$/g, '').trim();
  if (/^`?UNCHANGED`?\.?$/.test(t)) return { kind: 'unchanged' };
  const m = t.match(/^`?CONTAIN:\s*([\s\S]*)/);
  if (m) return { kind: 'contain', reason: m[1].trim().slice(0, 300) };
  if (!t) return { kind: 'empty' };
  return { kind: 'corrected', text: t };
}
const count = (t, re) => (String(t).match(re) || []).length;
const TAGS = ['vocab', 'gloss', 'warning', 'note'];
// format compliance of the text a writer would store, against the draft it replaced
function compliance(written, draft, { header = true } = {}) {
  const f = {
    page_type: count(written, /<page-type>/g),
    problem: ocrReadProblem(written, { header }),
    extra_headers: count(written, /<header>/g) > count(draft, /<header>/g) || count(written, /^#{1,6}\s/gm) > count(draft, /^#{1,6}\s/gm),
    added_tags: TAGS.filter((g) => count(written, new RegExp(`<${g}\\b`, 'g')) > count(draft, new RegExp(`<${g}\\b`, 'g'))),
  };
  f.ok = (!header || f.page_type === 1) && !f.problem && !f.extra_headers && !f.added_tags.length;
  // the same, ignoring <vocab> and <warning>: hidden metadata the live OCR prompt itself asks for (readers never see it)
  f.ok_reader = (!header || f.page_type === 1) && !f.problem && !f.extra_headers && !f.added_tags.some((g) => g === 'note' || g === 'gloss');
  return f;
}
const tally = (rows) => {
  const o = { n: rows.length, compliant: 0, compliant_ignoring_hidden_meta: 0, page_type_not_1: 0, problem: {}, extra_headers: 0, added: Object.fromEntries(TAGS.map((g) => [g, 0])) };
  for (const r of rows) {
    if (!r.f) continue;
    if (r.f.ok) o.compliant++;
    if (r.f.ok_reader) o.compliant_ignoring_hidden_meta++;
    if (r.f.page_type !== 1) o.page_type_not_1++;
    if (r.f.problem) o.problem[r.f.problem] = (o.problem[r.f.problem] || 0) + 1;
    if (r.f.extra_headers) o.extra_headers++;
    for (const g of r.f.added_tags) o.added[g]++;
  }
  return o;
};

const report = {};
// ── P2 ──
const runs = [
  { lang: 'zh', raw: `${ZH}/out-lite-p2-raw.jsonl`, req: `${ZH}/req-p2.jsonl`, out: `${ZH}/out-lite-p2-correct.jsonl`, wrap: (t) => `===TRANSCRIPTION===\n${t}\n===END===` },
  { lang: 'tib', raw: `${TIB}/out/lite-p2-raw.jsonl`, req: `${TIB}/req/p2-corr.jsonl`, out: `${TIB}/out/lite-p2-corr.jsonl`, wrap: (t) => `<<<BEGIN>>>\n${t}\n<<<END>>>` },
  { lang: 'tib-anchor', raw: `${TIB}/out/lite-p2-anchor-raw.jsonl`, req: `${TIB}/req/p2-corr-anchor.jsonl`, out: `${TIB}/out/lite-p2-corr-anchor.jsonl`, wrap: (t) => `<<<BEGIN>>>\n${t}\n<<<END>>>` },
];
for (const r of runs) {
  const req = byUid(r.req), raw = byUid(r.raw);
  const rows = [], comp = [], kinds = {};
  for (const [uid, q] of req) {
    const x = raw.get(uid); const a = answerOf(x?.text);
    kinds[a.kind] = (kinds[a.kind] || 0) + 1;
    const written = a.kind === 'corrected' ? a.text : a.kind === 'unchanged' ? q.draft : '';
    rows.push({ ...x, uid, answer: a.kind, contain_reason: a.reason ?? null, text: written ? r.wrap(written) : '', error: written ? null : (a.kind === 'contain' ? `CONTAIN: ${a.reason}` : 'empty') });
    // compliance only where something would be written by the corrector itself (UNCHANGED writes nothing new)
    comp.push({ uid, kind: a.kind, f: a.kind === 'corrected' ? compliance(a.text, q.draft) : null });
  }
  W(r.out, rows);
  report[`p2-${r.lang}`] = { answers: kinds, ...tally(comp), not_compliant: comp.filter((c) => c.f && !c.f.ok).map((c) => ({ uid: c.uid, ...c.f })) };
}
// ── P1 lite replies (their own reply format; Tibetan P1 asks for no tags, so its <page-type> rule does not apply) ──
const p1 = [
  { lang: 'zh', out: `${ZH}/out-lite-correct.jsonl`, req: `${ZH}/req-p2.jsonl`, body: (t) => (t.match(/===TRANSCRIPTION===[ \t]*\n?([\s\S]*?)(?:\n?===END===|$)/) || [, t])[1], header: true },
  { lang: 'tib', out: `${TIB}/out/lite-corr.jsonl`, req: `${TIB}/req/p2-corr.jsonl`, body: (t) => (t.match(/<<<BEGIN>>>([\s\S]*?)(?:<<<END>>>|$)/) || [, t])[1], header: false },
];
for (const r of p1) {
  const req = byUid(r.req);
  const comp = readJsonl(r.out).filter((x) => req.has(x.uid)).map((x) => ({ uid: x.uid, f: x.text ? compliance(r.body(x.text), req.get(x.uid).draft, { header: r.header }) : null }));
  report[`p1-${r.lang}`] = { ...tally(comp), header_rule_applies: r.header, not_compliant: comp.filter((c) => c.f && !c.f.ok).map((c) => ({ uid: c.uid, ...c.f })) };
}
fs.writeFileSync('format-compliance.json', JSON.stringify(report, null, 1));
for (const [k, v] of Object.entries(report)) { const { not_compliant, ...s } = v; console.log(k, JSON.stringify(s)); }
