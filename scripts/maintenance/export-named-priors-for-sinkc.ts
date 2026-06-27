/**
 * Sink C (#2804): export named priors from the attempt log into the enum shape
 * the harvester (`harvest-ft-into-translation-catalogs.mjs --from-enum`) consumes,
 * so found translations land in the durable `translation_catalogs` registry.
 *
 * Two sources in first_translation_attempts:
 *  - legacy_rp: priors[] are ALREADY structured (english_title/translator/year) → pass through.
 *  - legacy_tc: priors[].english_title is a PROSE string
 *      ("Anna M. Frey (translator), 'Astrology Theologized', Kessinger, 2004.")
 *    → parse conservatively (quoted title + 4-digit year + translator-before-"(translator)").
 *    Skip anything we can't cleanly parse — do NOT write prose into the registry
 *    (the #2804 pollution rule). The harvester's own guards are a second net.
 *
 *   npx tsx scripts/maintenance/export-named-priors-for-sinkc.ts   # writes the enum JSON
 *   then: node scripts/enrichment/harvest-ft-into-translation-catalogs.mjs --from-enum <out> [--apply]
 */
import { getDb } from '@/lib/mongodb';
import { ATTEMPTS_COLLECTION, type FirstTranslationAttempt } from '@/lib/first-translation/attempt-log';
import { writeFileSync } from 'node:fs';

const OUT = process.env.SINKC_OUT || 'scripts/output/ft-evidence-2026-06-26/sinkc-named-priors.json';

/** Parse a prose known_translation string into a structured prior, or null. */
function parseProse(s: string): { english_title: string; translator?: string; pub_year?: string } | null {
  if (!s) return null;
  const title = (s.match(/['"“]([^'"”]{4,150})['"”]/) || [])[1]; // first quoted run
  if (!title) return null; // no clean title → skip (don't pollute)
  const year = (s.match(/\b(1[5-9]\d\d|20\d\d)\b/) || [])[1];
  const translator = (s.match(/^([^,(]{2,60})\s*\((?:translator|trans\.?)\)/i) || [])[1]?.trim();
  return { english_title: title.trim(), translator, pub_year: year };
}

async function main() {
  const db = await getDb();
  const c = db.collection<FirstTranslationAttempt>(ATTEMPTS_COLLECTION);
  const byBook = new Map<string, any[]>();
  const add = (bookId: string, p: any) => {
    if (!p?.english_title) return;
    const list = byBook.get(bookId) || [];
    list.push(p);
    byBook.set(bookId, list);
  };

  // legacy_rp — already structured
  for await (const a of c.find({ notes: { $regex: '\\[legacy_rp\\]' }, result: 'found', 'priors.0': { $exists: true } }) as any) {
    for (const p of a.priors || []) {
      if (p.english_title && !/^[A-Z][a-z]+ \(translator\)/.test(p.english_title)) {
        add(a.book_id, { english_title: p.english_title, translator: p.translator, pub_year: p.pub_year, publisher: p.publisher, completeness: p.completeness, source_url: p.source_url });
      }
    }
  }
  // legacy_tc — parse prose
  let tcParsed = 0, tcSkipped = 0;
  for await (const a of c.find({ notes: { $regex: '\\[legacy_tc\\]' }, result: 'found', 'priors.0': { $exists: true } }) as any) {
    for (const p of a.priors || []) {
      const parsed = parseProse(String(p.english_title || ''));
      if (parsed) { add(a.book_id, parsed); tcParsed++; } else tcSkipped++;
    }
  }

  const out = [...byBook.entries()].map(([book_id, priors]) => {
    const seen = new Set<string>(), uniq: any[] = [];
    for (const p of priors) { const k = p.english_title.toLowerCase().trim(); if (seen.has(k)) continue; seen.add(k); uniq.push(p); }
    return { book_id, prior_translations_found: uniq };
  });
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`books: ${out.length} | prior rows: ${out.reduce((a, b) => a + b.prior_translations_found.length, 0)}`);
  console.log(`legacy_tc prose: parsed ${tcParsed}, skipped(no clean title) ${tcSkipped}`);
  console.log(`written: ${OUT}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
