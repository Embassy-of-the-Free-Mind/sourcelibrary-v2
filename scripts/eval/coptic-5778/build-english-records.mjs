#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/translation-vs-reference/from-ab-sample.mjs (converts a #5606-style sample
 * whose references are already cut per page). Ours are cut per VERSE by SCRIPTORIUM's alignment, and
 * the verses on each page come from score.mjs — so this only joins the two into harness records.
 *
 * coptic-5778/build-english-records — records.jsonl for scripts/eval/translation-vs-reference (#5778).
 *   node scripts/eval/coptic-5778/build-english-records.mjs --out scripts/eval/results/coptic-5778
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[process.argv.indexOf('--out') + 1];
const jsonl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const sample = jsonl(path.join(OUT, 'sample.jsonl'));
const scores = JSON.parse(fs.readFileSync(path.join(OUT, 'scores.json'), 'utf8'));
const label = (id) => id.replace(/^\d+_/, '').replace(/#.*? (\d+:\d+)$/, ' $1').replace(/_0*(\d+)#(\d+)$/, ' $1:$2').replace(/_0*\d+ /, ' ');

const recs = [];
for (const s of sample) {
  const p = scores.pages.find((x) => x.id === s.id);
  if (!p?.verses || s.reference.private || !s.served_english) continue;
  const units = s.reference.units; const i0 = units.findIndex((u) => u.id === p.verses[0]); const i1 = units.findIndex((u) => u.id === p.verses.at(-1));
  if (units.slice(i0, i1 + 1).some((u) => !u.english)) { console.error('skip (reference English missing for a verse)', s.id); continue; }
  const line = (u, ctx) => `${ctx ? '[context] ' : ''}${label(u.id)} ${u.english}`;
  const ref = [units[i0 - 1]?.english && line(units[i0 - 1], true), ...units.slice(i0, i1 + 1).map((u) => line(u)), units[i1 + 1]?.english && line(units[i1 + 1], true)].filter(Boolean).join('\n');
  const nt = /World English Bible/.test(s.reference.english_source);
  recs.push({
    track: 'coptic-5778', lang: 'Coptic', book_id: s.book_id, page_number: s.page_number,
    reference_text: ref,
    reference_meta: {
      title: nt ? 'World English Bible' : 'The Septuagint Version of the Old Testament', translator: nt ? 'WEB (ebible.org)' : 'L. C. L. Brenton', year: nt ? 2000 : 1851,
      licence: 'public domain', private: false, style: 'literal', canonical: true, located: `${label(p.verses[0])} – ${label(p.verses.at(-1))}`,
      url: 'https://github.com/CopticScriptorium/corpora', coverage_note: `Verse-aligned to the Coptic by Coptic SCRIPTORIUM (${s.reference.corpus}). It translates the GREEK text, not this Coptic version: small differences of wording between the Coptic and the reference are expected and are not errors. The page also carries apparatus or notes that the reference does not cover.`,
    },
    candidates: [],
  });
}
fs.writeFileSync(path.join(OUT, 'english-records.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
for (const r of recs) console.log(r.book_id.slice(0, 8), r.page_number, r.reference_meta.located, r.reference_text.length);
