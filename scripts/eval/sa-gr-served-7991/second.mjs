#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-strata-7947/build-second.mjs (one packet per ~12 pages of every serious first call,
// for spot-check/SECOND-READER.md, run by latin-strata-7947/run-reviews.sh). That builder reads REVIEWER.md's schema
// (ocr_errors / tr_errors, serious); #7991's first reader is #7866's judge (defects {class, quote, severity, what},
// misleads | wrong_text), so the claims are built here from that schema. The packet's page shape is the same.
/**
 * #7991 stage 3: the second reader's packets. A claim is every `misleads` or `wrong_text` defect either judge raised,
 * plus a page-level claim when a judge gave fidelity ≤ 2. The packet carries the judge's quote and its reason, never
 * the stratum or the engine.
 *
 *   node scripts/eval/sa-gr-served-7991/second.mjs build     → OUT/second/packets/packet-N.json
 *   then: scripts/eval/latin-strata-7947/run-reviews.sh scripts/eval/spot-check/SECOND-READER.md OUT/second/packets OUT/second 3
 */
import fs from 'node:fs';
import path from 'node:path';
import { OUT, claimId } from './lib.mjs';

const PER = 5;
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
// The FIRST parsed verdict a page got, as analyze.mjs reads it, so claim ids index the same defect list.
const last = (f) => { const m = new Map(); for (const r of jsonl(path.join(OUT, f))) if (r.verdict && !m.has(r.page_id)) m.set(r.page_id, r.verdict); return m; };

/** The serious claims of one page, both lanes, with stable ids. */
export function claimsOf(pageId, vOcr, vTr) {
  const out = [];
  for (const [lane, v] of [['ocr', vOcr], ['tr', vTr]]) {
    if (!v) continue;
    (v.defects || []).forEach((d, i) => {
      if (d.severity === 'misleads' || d.severity === 'wrong_text') out.push({ claim_id: claimId(pageId, lane, i), lane, class: d.class ?? null, severity: d.severity, stored: d.quote ?? null, problem: d.what ?? null });
    });
    if (Number(v.fidelity) <= 2) out.push({ claim_id: claimId(pageId, lane, 'fidelity'), lane, class: null, severity: 'wrong_text',
      stored: null, problem: `The ${lane === 'ocr' ? 'transcription' : 'English translation'} as a whole: fidelity ${v.fidelity} of 5 (${Number(v.fidelity) === 1 ? "not this page's text at all" : 'substantially wrong or incomplete'}). ${v.reader_note ?? ''}` });
  }
  return out;
}

if (process.argv[2] === 'build') {
  const sample = JSON.parse(fs.readFileSync(path.join(OUT, 'sample.json'), 'utf8'));
  const O = last('verdicts-ocr.jsonl'), T = last('verdicts-tr.jsonl');
  const pages = [];
  for (const s of sample) {
    const claims = claimsOf(s.page_id, O.get(s.page_id), T.get(s.page_id));
    if (!claims.length) continue;
    pages.push({ book_id: s.book_id, title: s.title, published: s.year, page_number: s.page_number, image_url: s.image,
      image_file: path.join(OUT, 'img', `${s.page_id}.jpg`), crop: null, ocr: s.ocr, translation: s.translation,
      claims: claims.map((c) => ({ claim_id: c.claim_id, lane: c.lane, class: c.class, claimed_severity: c.severity, stored: c.stored, source: null, image: null, problem: c.problem })) });
  }
  const dir = path.join(OUT, 'second/packets');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
  for (let k = 0; k * PER < pages.length; k++) fs.writeFileSync(path.join(dir, `packet-${k + 1}.json`), JSON.stringify(pages.slice(k * PER, (k + 1) * PER), null, 1));
  console.log(`second reader: ${pages.reduce((a, p) => a + p.claims.length, 0)} claims on ${pages.length} pages → ${Math.ceil(pages.length / PER)} packets in ${dir}`);
}
