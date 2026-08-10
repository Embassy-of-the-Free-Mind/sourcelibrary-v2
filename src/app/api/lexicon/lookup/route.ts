/**
 * GET /api/lexicon/lookup?word=cœlum — dictionary lookup for the parsing
 * reader (issue #3823, Phase 1).
 *
 * Resolves a (possibly early modern, possibly OCR-noisy) Latin word to Lewis
 * & Short entries via the tiered chain in src/lib/lexicon/lookup.ts:
 * exact → variant → irregular → generated paradigm → suffix heuristic →
 * loose orthography. Uncertain tiers return `confident: false`; a miss is a
 * structured `found: false`, never a wrong entry dressed up as an answer.
 *
 * &lang=la is accepted and required to be Latin for now — the parameter
 * exists so Greek (LSJ) can slot in later without a URL change.
 *
 * Anonymous, read-only, aggressively CDN-cached: word → entry is immutable
 * short of a re-import, so cache hard and let deploys purge.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { lookupLatinWord } from '@/lib/lexicon/lookup';
import { lookupGreekWord } from '@/lib/lexicon/lookup-grc';

export const dynamic = 'force-dynamic';

const CACHE_HEADERS = {
  // Browser max-age is deliberately SHORT: the lexicon dataset is young and
  // improving, and a long browser cache pins stale misses on readers after a
  // re-import (an hour-old miss survived the sigma-fix rejoin in testing).
  // The CDN keeps the long TTL — deploys purge it. max-age must be present:
  // a Cache-Control without it survives CDN purges in browser caches.
  'Cache-Control': 'public, max-age=60, s-maxage=86400, stale-while-revalidate=604800',
  'CDN-Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
} as const;

export async function GET(request: NextRequest) {
  const word = request.nextUrl.searchParams.get('word') ?? '';
  const lang = request.nextUrl.searchParams.get('lang') ?? 'la';

  if (lang !== 'la' && lang !== 'grc') {
    return NextResponse.json(
      { error: `Unsupported lang "${lang}" — "la" (Latin) and "grc" (Ancient Greek) are available.` },
      { status: 400 }
    );
  }
  if (!word.trim() || word.length > 80) {
    return NextResponse.json({ error: 'Provide ?word= (1–80 chars).' }, { status: 400 });
  }

  try {
    const db = await getReadDb();
    // Greek matches are reshaped to the Latin match schema so the popover
    // renders both without branching (shortDef plays the first-sense role).
    const result =
      lang === 'grc'
        ? await lookupGreekWord(db, word).then((r) => ({
            query: r.query,
            normalized: r.normalized,
            found: r.found,
            matches: r.matches.map((m) => ({
              key: m.key,
              headword: m.headword,
              matchType: m.matchType,
              confident: m.confident,
              entryType: 'main',
              partOfSpeech: m.grammar,
              orthography: m.headword,
              genitive: null,
              gender: null,
              declension: null,
              mainNotes: m.etymology,
              senses: m.shortDef ? [m.shortDef] : [],
              sensesTruncated: false,
            })),
          }))
        : await lookupLatinWord(db, word);
    if (!result.found && result.normalized.length >= 3) {
      // Miss telemetry: aggregated per normalized form (bounded by vocabulary,
      // no PII, nothing automated reads it). This is the Phase-2.5 worklist —
      // the most-tapped missing words are the next tier to build.
      db.collection('lexicon_misses')
        .updateOne(
          { form: result.normalized },
          { $inc: { count: 1 }, $set: { last_seen: new Date(), sample_query: result.query, lang } },
          { upsert: true }
        )
        .catch(() => {});
    }
    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error('[lexicon/lookup] failed:', err);
    // Same store the client-side reporter uses (application_errors), so
    // lookup failures surface in the admin errors view instead of only in
    // function logs. Fire-and-forget: logging must never fail the response.
    try {
      const db = await getReadDb();
      db.collection('application_errors')
        .insertOne({
          message: `lexicon lookup failed: ${err instanceof Error ? err.message : String(err)}`,
          source: 'api/lexicon/lookup',
          url: request.nextUrl.pathname + '?word=' + encodeURIComponent(word),
          stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
          timestamp: new Date(),
        })
        .catch(() => {});
    } catch {
      /* logging is best-effort */
    }
    return NextResponse.json({ error: 'Lookup failed.' }, { status: 500 });
  }
}
