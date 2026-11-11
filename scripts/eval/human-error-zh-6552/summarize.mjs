#!/usr/bin/env node
// PRIOR ART: score.mjs (one collection, this directory), lib/paired-stats.mjs (paired engines, no capture-recapture). This pools the collections' numbers for the report; numbers only, no text.
// #6552: node summarize.mjs   after score.mjs --json=<c>/score.json for a, b, c-f, c-o, c-t; writes results.json beside this file.
import fs from 'node:fs';
import path from 'node:path';
const S = Object.fromEntries(['a', 'b', 'c-f', 'c-o', 'c-t'].map((c) => [c, JSON.parse(fs.readFileSync(path.join(process.env.JOB_SCRATCH, c, 'score.json')))]));
const wilsonHi = (k, n) => { const z = 1.96, p = k / n; return (p + z * z / (2 * n) + z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n); };
const wilsonLo = (k, n) => { const z = 1.96, p = k / n; return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n); };
const round = (x, d = 2) => +x.toFixed(d), sum = (f) => Object.values(S).reduce((a, s) => a + f(s), 0);
// Per reader, every collection: right on each kind of control, and how often a decoy (OCR side wrong, typed right) was called a keying error.
const readers = {}; for (const s of Object.values(S)) for (const [r, t] of Object.entries(s.controls)) for (const [k, c] of Object.entries(t)) { const a = ((readers[r] ||= {})[k] ||= { right: 0, n: 0, false_alarm: 0 }); a.right += c.right; a.n += c.n; if (k === 'decoy_ocr') a.false_alarm += c.ans.ocr || 0; }
for (const t of Object.values(readers)) for (const c of Object.values(t)) { c.pct = round(100 * c.right / c.n, 1); c.lo95 = round(100 * wilsonLo(c.right, c.n), 1); }
const eye = { opened: sum((s) => s.by_eye.opened), machine: sum((s) => s.by_eye.machine), opus: sum((s) => s.by_eye.opus), gemini: sum((s) => s.by_eye.gemini), gemini_n: sum((s) => s.by_eye.gemini_n), opened_by_class: {}, three_way: Object.values(S).flatMap((s) => s.three_way) };
for (const s of Object.values(S)) for (const [k, v] of Object.entries(s.opened_by_class)) eye.opened_by_class[k] = (eye.opened_by_class[k] || 0) + v;
const gemini_value = { split: sum((s) => s.gemini_value.split), gemini_right: sum((s) => s.gemini_value.gemini_right), opus_right: sum((s) => s.gemini_value.opus_right), neither_right: sum((s) => s.gemini_value.neither_right), keying_only_gemini: sum((s) => s.gemini_value.keying_only_gemini) };
// Chapman with its variance: at m=0 this is a statement about how little two small lists overlap, and the interval says so.
const chapman = (n1, n2, m) => { const N = (n1 + 1) * (n2 + 1) / (m + 1) - 1, v = (n1 + 1) * (n2 + 1) * (n1 - m) * (n2 - m) / ((m + 1) ** 2 * (m + 2)); return { n1, n2, m, N: round(N, 1), lo95: round(Math.max(n1 + n2 - m, N - 1.96 * Math.sqrt(v)), 1), hi95: round(N + 1.96 * Math.sqrt(v), 1) }; };
const agreedRead = sum((s) => s.agreed.read), agreedWrong = sum((s) => s.agreed.both_wrong);
const results = {
  collections: Object.fromEntries(Object.entries(S).map(([c, s]) => [c, { pages: s.pages, works: s.works, compared_chars: s.compared_chars, real_items: s.real_items, classes: s.classes, keying: s.keying, keying_or_neither: s.keying_or_neither, editorial: s.editorial, reference_charge: s.reference_charge, ocr_error: s.ocr_error, ocr_variant: s.ocr_variant, cannot_tell: s.cannot_tell, declared_cbeta_changes: s.declared_cbeta_changes, undeclared_corrections: s.undeclared_corrections, agreed: s.agreed, by_eye: s.by_eye, chao_readers: s.chao_readers, agreement_opus_gemini: s.agreement_opus_gemini, agreement_opus_noimage: s.agreement_opus_noimage, gemini_value: s.gemini_value, controls: s.controls, usage: s.usage }])),
  readers_pooled: readers, by_eye_pooled: eye, gemini_value_pooled: gemini_value,
  capture_recapture: Object.fromEntries(['a', 'c-f', 'c-o'].map((c) => [c, chapman(S[c].capture_recapture.n1_typed, S[c].capture_recapture.n2_ocr, S[c].capture_recapture.m_seen)])),
  both_wrong_pooled: { read: agreedRead, both_wrong: agreedWrong, upper95_per_1000: round(1000 * wilsonHi(agreedWrong, agreedRead), 1) },
  expected_both_wrong_if_independent: Object.fromEntries(['a', 'c-f', 'c-o'].map((c) => [c, round(S[c].capture_recapture.n1_typed * S[c].capture_recapture.n2_ocr / S[c].compared_chars, 3)])),
  cbeta_keying: { b_chars: S.b.compared_chars, b_keying: S.b.classes.KEYING, b_neither: S.b.classes.NEITHER, b_upper95_per_1000: round(3000 / S.b.compared_chars, 3), b_upper95_with_plant_catch_lower: round(3000 / S.b.compared_chars / (readers.opus.plant_typed.lo95 / 100), 3), c_chars_compared: S['c-f'].compared_chars + S['c-o'].compared_chars, c_items_at_taisho: S['c-t'].real_items, c_taisho_departs: S['c-t'].classes.KEYING + S['c-t'].classes.NEITHER, c_taisho_cannot_tell: S['c-t'].classes.CANNOT_TELL, c_upper95_per_1000: round(3000 / (S['c-f'].compared_chars + S['c-o'].compared_chars), 3) },
  witness_sha256: JSON.parse(fs.readFileSync(path.join(process.env.JOB_SCRATCH, 'witness-hashes.json'))),
};
fs.writeFileSync(new URL('results.json', import.meta.url), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify({ readers, eye, gemini_value, cr: results.capture_recapture, bw: results.both_wrong_pooled, exp: results.expected_both_wrong_if_independent, cb: results.cbeta_keying }));
