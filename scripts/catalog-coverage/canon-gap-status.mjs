#!/usr/bin/env node
/**
 * Canon gap STATUS (#5513): what is done, running, next or blocked for each corpus of the canon gap
 * map, with live counts. The public page sourcelibrary.org/research/canon-gap reads the output.
 *
 * PRIOR ART: scripts/catalog-coverage/canon-gap-map.mjs (#5519) measures each corpus once (licence,
 * size, English, cost) and writes canon-gap-map-2026-10.json; it has no status, owner or next action,
 * and its holdings are a snapshot. This script keeps the map's corpus ids and its book selectors
 * (scripts/lib/canon-holdings.mjs, shared) and adds the plan, re-counted on every run.
 *
 * The STATUS table below is authored (who owns what, and what happens next); the counts are measured:
 *   held_books       books we hold for the corpus, live + hidden (the gap map's selector; `method` says how)
 *   live_books       of those, visible && pages_count > 0
 *   pipeline_held    of those, carrying a pipeline hold (pipeline-hold.mjs) — e.g. an import awaiting a decision
 *   readable_books   of those, readable_in_english (translation_state, page-counts.mjs isReadableInEnglish)
 *   pages_with_text  sum of pages_ocr over those books (stored counter, recountBook)
 *
 * Usage (Hetzner; needs MONGODB_URI + SUPABASE_DB_URL):
 *   node --env-file=.env.production.local scripts/catalog-coverage/canon-gap-status.mjs [--out=path.json]
 */
import { readFileSync, writeFileSync } from 'fs';
import { MongoClient } from 'mongodb';
import { pgClient } from '../works-catalog/lib.mjs';
import { loadHoldingCandidates, corpusBookSets, isLive, ROW_SET } from '../lib/canon-holdings.mjs';
import { isReadableInEnglish } from '../lib/page-counts.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const MAP = 'scripts/catalog-coverage/results/canon-gap-map-2026-10.json';
const OUT = args.out || 'scripts/catalog-coverage/results/canon-gap-status-2026-10.json';

// status: done | running | next | blocked. cost_usd: the next action's cost where it has one.
const STATUS = {
  'derge-tengyur': { status: 'running', owner_issue: 5497,
    done: '213 volumes imported hidden and held, 128,369 of 128,639 pages carry the Esukhia public-domain text, aligned folio by folio to the BDRC scans and verified on sampled reads.',
    next_action: 'Translation pilot on 5 volumes (one per section), ≤ $5; the draft English for the whole Tengyur waits for Derek on the pilot\'s measured $/page.',
    cost_usd: 5 },
  'derge-kangyur': { status: 'running', owner_issue: 5665,
    done: 'Import under way: BDRC W4CZ5369 (the Library of Congress copy the e-text transcribes) + the Esukhia public-domain text, aligned folio by folio; texts 84000 has published or has in progress are marked per page.',
    next_action: 'Finish the 103-volume import and archive the images ($0 model spend); then a priced decision on a draft English for the texts 84000 has not begun.',
    cost_usd: 0 },
  cbeta: { status: 'next', owner_issue: 2554,
    next_action: 'Whole-canon CBETA → facsimile reader books (#2554) after the Chan subset (#5566) proves the fit-and-translate lane. CC BY-NC-SA: each page shows its licence (#5571).',
    cost_usd: 306 },
  'cbeta-chan': { status: 'running', owner_issue: 5566,
    done: 'Chan texts fitted to our scans; 74 of 79 books visible with the CBETA text and its licence.',
    next_action: 'Translate the 19 texts listed on #5566 under envelope cbeta-chan-2026-10 (unblocked 2026-10-02 07:58Z).',
    cost_usd: 9 },
  'pali-mula': { status: 'running', owner_issue: 5668,
    done: 'Eternity A+B pass (#5513): OCR + draft English on the Pali books we hold (hidden ones stay hidden).',
    next_action: 'Fit the VRI Chaṭṭha Saṅgāyana text (non-commercial, attribution) to our Pali scans instead of relying on OCR; re-translate changed pages.',
    cost_usd: 4 },
  'pali-atthakatha': { status: 'running', owner_issue: 5668,
    done: 'Eternity A+B pass covered the commentaries we hold except five aṭṭhakathā owned by the quality-round-1 eval (#5438).',
    next_action: 'As root texts: fit the VRI text; translate the five aṭṭhakathā once the eval releases them.',
    cost_usd: 11 },
  'pali-tika': { status: 'next', owner_issue: 5668,
    next_action: 'As root texts: fit the VRI text where we hold a scan; English coverage unknown (upper bound priced).',
    cost_usd: 4 },
  'gretil-buddhist': { status: 'blocked', owner_issue: 5513,
    blocker: 'GRETIL licence, quoted from its files: "THIS GRETIL TEXT FILE IS FOR REFERENCE PURPOSES ONLY! COPYRIGHT AND TERMS OF USAGE AS FOR SOURCE FILE." Each file inherits its source edition\'s terms, so no file can be published without clearing that edition.',
    next_action: 'Clear per source edition, or OCR our own scans instead (the A+B pass did this for the Sanskrit books we hold).', cost_usd: null },
  'gretil-vedanta': { status: 'blocked', owner_issue: 5513,
    blocker: 'GRETIL "FOR REFERENCE PURPOSES ONLY! COPYRIGHT AND TERMS OF USAGE AS FOR SOURCE FILE."',
    next_action: 'As GRETIL Buddhist.', cost_usd: null },
  'gretil-gaudiya': { status: 'blocked', owner_issue: 5513,
    blocker: 'GRETIL "FOR REFERENCE PURPOSES ONLY! COPYRIGHT AND TERMS OF USAGE AS FOR SOURCE FILE."',
    next_action: 'As GRETIL Buddhist.', cost_usd: null },
  'sefaria-zohar': { status: 'blocked', owner_issue: 5560,
    blocker: 'Licence: every Sefaria Zohar Hebrew version reports its licence as `unknown` (Sefaria API, version licence field), so no Zohar text is fitted (#5560: 0 of 175 refused pages of the Bodley Zohar written).',
    next_action: 'Re-read the refused pages with the loop-guarded OCR re-read (#3878), not a Sefaria fit.', cost_usd: null },
  'sefaria-lurianic': { status: 'running', owner_issue: 5560,
    done: 'Fit lane built and run; Luria\'s Zohar commentary MS does not follow the public-domain Sha\'ar Ma\'amarei Rashbi (79 of 602 pages locate), so it is not fitted.',
    next_action: 'Loop-guarded OCR re-read of the refused pages (#3878).', cost_usd: null },
  'sefaria-cordovero': { status: 'running', owner_issue: 5560,
    done: 'Pardes Rimmonim: 12 refused pages filled with verified public-domain Sefaria text, now translating in the A+B pass.',
    next_action: '46 pages refused with reasons; loop-guarded OCR re-read (#3878).', cost_usd: null },
  'openiti-sufi': { status: 'next', owner_issue: null,
    next_action: 'No owner. CC BY-NC-SA like CBETA; the Chan lane (#5566) is the template once it publishes. Persian manuscript OCR is parked (#5559).',
    cost_usd: 29 },
  ganjoor: { status: 'blocked', owner_issue: 5513,
    blocker: 'Licence unverified: no licence statement found on ganjoor-data or ganjoor.net (gap map, licence.quote empty).',
    next_action: 'Ask Ganjoor for terms before any import.', cost_usd: null },
  'mongolian-kanjur': { status: 'running', owner_issue: 5664,
    done: 'Scans-only import of BDRC W4CZ5370 (108 volumes) under way, held and hidden.',
    next_action: 'OCR feasibility is open: flash-lite drops ~70% of columns (#5664); needs a reference text or a Mongolist first.', cost_usd: 0 },
  'tripitaka-koreana': { status: 'blocked', owner_issue: 5513,
    blocker: 'Licence unverified: the K-Tripitaka e-text was unreachable from our host and no licence was found (gap map priced it via a CBETA proxy).',
    next_action: 'Obtain the e-text and its terms from the Haeinsa / Dongguk project.', cost_usd: null },
  kanripo: { status: 'next', owner_issue: 5568,
    next_action: 'Align Kanripo text (CC BY-SA 4.0) to the held Siku Quanshu scans instead of OCR: 7,001 books have covering juan files, 36/40 pilot books align (#5568).',
    cost_usd: null },
};

const map = JSON.parse(readFileSync(MAP, 'utf8'));
const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const db = mc.db('bookstore');
const pgc = pgClient(); await pgc.connect();
const { books, whBy } = await loadHoldingCandidates(db, pgc);
await pgc.end(); await mc.close();
const sets = corpusBookSets(books, whBy);
const now = new Date().toISOString();

const corpora = map.rows.map((r) => {
  const s = STATUS[r.id];
  if (!s) throw new Error(`no STATUS entry for gap-map corpus ${r.id}`);
  const set = sets[ROW_SET[r.id]];
  const bs = set.books;
  return {
    id: r.id, corpus: r.corpus, ...s,
    held_books: bs.length,
    live_books: bs.filter(isLive).length,
    pipeline_held: bs.filter((b) => b.pipeline_auto?.hold).length,
    readable_books: bs.filter((b) => isReadableInEnglish(b.translation_state)).length,
    pages_with_text: bs.reduce((a, b) => a + (b.pages_ocr || 0), 0),
    holdings_method: set.method,
    updated_at: now,
  };
});
const missing = Object.keys(STATUS).filter((k) => !map.rows.some((r) => r.id === k));
if (missing.length) throw new Error(`STATUS has ids the gap map does not: ${missing.join(', ')}`);

writeFileSync(OUT, JSON.stringify({
  issue: 5513, generated_at: now, script: 'scripts/catalog-coverage/canon-gap-status.mjs', gap_map: MAP,
  fields: {
    status: 'done | running | next | blocked', owner_issue: 'GitHub issue that owns the next action', next_action: 'what happens next, in one sentence',
    cost_usd: 'cost of the next action where it has one (draft-English figures are the gap map\'s)', held_books: 'books we hold for the corpus, live + hidden (holdings_method)',
    live_books: 'visible && pages_count > 0', pipeline_held: 'books under a pipeline hold', readable_books: 'readable_in_english (translation_state)', pages_with_text: 'sum of pages_ocr',
  },
  corpora,
}, null, 1) + '\n');
console.log(`wrote ${OUT}: ${corpora.length} corpora`);
for (const c of corpora) console.log(`${c.id.padEnd(20)} ${c.status.padEnd(8)} #${c.owner_issue ?? '—'} held ${c.held_books} live ${c.live_books} readable ${c.readable_books} text-pages ${c.pages_with_text}`);
process.exit(0);
