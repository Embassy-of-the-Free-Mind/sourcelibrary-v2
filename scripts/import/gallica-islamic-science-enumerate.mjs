#!/usr/bin/env node
/**
 * Gallica — Islamic scientific & Graeco-Arabic manuscripts.
 *
 * The mission case: Latin Europe received Aristotle, Galen, Ptolemy and Euclid
 * THROUGH Arabic. We hold the Greek end and the Latin end; the Arabic middle is
 * the transmission link that makes both legible as one story. BnF's oriental
 * manuscript department is the largest openly-IIIF collection of it.
 *
 * Two Gallica gotchas this script handles, both already documented in
 * .claude/docs/chinese-iiif-sources.md and sanskrit-sources.md:
 *  - **`cc…` arks are finding aids with NO manifest.** Only `btv1b…` arks are
 *    digitised objects. A candidate list that ignores this is ~half unusable.
 *  - **SRU 403s a bare client.** A browser User-Agent is required; without one
 *    every request fails, which reads like "the source has nothing".
 * And a third found here: a free-text `gallica all "arabe"` match returns any
 * record whose description merely MENTIONS Arabic — the first hit was a Hebrew
 * prayer book. Queries are therefore scoped by `dc.language`.
 *
 * It does NOT import. Output is a curated candidate list for human review.
 *
 * Usage:
 *   node scripts/import/gallica-islamic-science-enumerate.mjs --out ./cands.json
 */

import { writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const OUT = arg('--out', './gallica-islamic-candidates.json');
const PER = parseInt(arg('--per-query', '50'), 10);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

// Graeco-Arabic transmission: the Greek authors as they travelled in Arabic,
// plus the commentators through whom Latin Europe read them.
const GREEK_TRANSMISSION = {
  'Aristotle (Arisṭū)': 'Aristote',
  'Galen (Jālīnūs)': 'Galien',
  'Ptolemy (Baṭlamyūs)': 'Ptolémée',
  'Euclid (Uqlīdis)': 'Euclide',
  'Hippocrates (Buqrāṭ)': 'Hippocrate',
  'Dioscorides': 'Dioscoride',
  'Plato (Aflāṭūn)': 'Platon',
  'Averroes (Ibn Rushd)': 'Averroès',
  'Avicenna (Ibn Sīnā)': 'Avicenne',
  'al-Fārābī': 'Farabi',
  'Archimedes': 'Archimède',
};

// Early science by discipline.
const SCIENCES = {
  'astronomy': 'astronomie',
  'astrology': 'astrologie',
  'medicine': 'médecine',
  'alchemy': 'alchimie',
  'mathematics': 'mathématiques',
  'optics': 'optique',
  'pharmacology': 'pharmacopée',
  'astrolabe': 'astrolabe',
};

async function sru(query, max) {
  const url = `https://gallica.bnf.fr/SRU?operation=searchRetrieve&version=1.2`
    + `&query=${encodeURIComponent(query)}&maximumRecords=${max}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml' }, signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();
  const total = parseInt((xml.match(/<srw:numberOfRecords>(\d+)</) || [])[1] || '0', 10);
  const recs = xml.split('<srw:record>').slice(1).map(chunk => {
    const one = (tag) => ((chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || '').trim();
    const all = (tag) => [...chunk.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1].trim());
    const ident = all('dc:identifier').find(v => /ark:/.test(v)) || '';
    const ark = (ident.match(/ark:\/12148\/([a-z0-9]+)/) || [])[1] || null;
    return { ark, title: one('dc:title'), date: one('dc:date'), languages: all('dc:language'), types: all('dc:type') };
  });
  return { total, recs };
}

async function main() {
  const found = new Map();
  const runs = [];

  const record = async (label, query) => {
    try {
      const { total, recs } = await sru(query, PER);
      let kept = 0;
      for (const r of recs) {
        // Only btv1b arks are digitised objects; cc arks are finding aids.
        if (!r.ark || !/^btv1b/.test(r.ark)) continue;
        if (!found.has(r.ark)) { found.set(r.ark, { ...r, why: [] }); kept++; }
        found.get(r.ark).why.push(label);
      }
      runs.push({ label, total, sampled: recs.length, digitised: kept });
      console.log(`${String(total).padStart(6)} total, ${String(kept).padStart(3)} new digitised  ←  ${label}`);
    } catch (e) {
      runs.push({ label, error: e.message });
      console.log(`${'ERR'.padStart(6)}  ${label}  (${e.message})`);
    }
    // Gallica throttles hard. Single-threaded with a real pause between calls.
    await new Promise(r => setTimeout(r, 2500));
  };

  console.log('== Graeco-Arabic transmission ==');
  for (const [label, term] of Object.entries(GREEK_TRANSMISSION)) {
    await record(`greek:${label}`, `(gallica all "${term}") and (dc.language all "ara") and (dc.type all "manuscrit")`);
  }

  console.log('\n== Islamic early science ==');
  for (const [label, term] of Object.entries(SCIENCES)) {
    await record(`science:${label}`, `(gallica all "${term}") and (dc.language all "ara") and (dc.type all "manuscrit")`);
  }

  console.log('\n== Persian & Ottoman scientific ==');
  for (const [lang, code] of Object.entries({ persian: 'per', ottoman: 'ota' })) {
    for (const [label, term] of Object.entries({ astronomy: 'astronomie', medicine: 'médecine', alchemy: 'alchimie' })) {
      await record(`${lang}:${label}`, `(gallica all "${term}") and (dc.language all "${code}") and (dc.type all "manuscrit")`);
    }
  }

  const list = [...found.values()];
  console.log(`\nunique digitised candidates: ${list.length}`);
  writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), runs, candidates: list }, null, 1));
  console.log(`wrote → ${OUT}`);
  console.log('NEXT: dedupe against holdings, subject-filter by hand, import hidden via /api/import/gallica.');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('FATAL', e); process.exit(1); });
}
