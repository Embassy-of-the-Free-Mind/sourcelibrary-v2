import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/mongodb', () => ({ getReadDb: vi.fn() }));

import {
  HOMEPAGE_STATS_MAX_AGE_DAYS,
  homepageStatsAgeDays,
  isHomepageStatsStale,
  libraryStatsFromCache,
} from '@/lib/library-stats';
import {
  scanText,
  scanRepo,
  readBaseline,
  compareWithBaseline,
  parseConstants,
  checkLive,
  parseCount,
  findingKey,
} from '../../scripts/audit/corpus-number-consistency.mjs';
import fs from 'node:fs';
import path from 'node:path';

// v2#3647: three pages gave three counts for "books", and a paused pipeline once
// left the shared count frozen for seven weeks. Two guards: the cache is not
// quoted past a week, and a count typed into served copy fails here.

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-18T08:00:00Z');
// The cache document as production held it on 2026-11-18.
const CACHE = { totalBooks: 71337, languageCount: 136, illustrationCount: 237359, readableInEnglish: 25449, firstTranslationCount: 14245, artworkCount: 18606 };

describe('homepage stats freshness guard', () => {
  it('serves a cache written today', () => {
    const s = libraryStatsFromCache({ ...CACHE, updatedAt: new Date(NOW - 2 * 3_600_000) }, NOW);
    expect(s).toMatchObject({ books: 71337, readableInEnglish: 25449, languages: 136 });
  });

  it('withholds the counts once the cache is older than the limit', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const old = new Date(NOW - (HOMEPAGE_STATS_MAX_AGE_DAYS + 1) * DAY);
    expect(libraryStatsFromCache({ ...CACHE, updatedAt: old }, NOW)).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
    // The same document one day inside the limit is served: the date decides, nothing else.
    expect(libraryStatsFromCache({ ...CACHE, updatedAt: new Date(NOW - (HOMEPAGE_STATS_MAX_AGE_DAYS - 1) * DAY) }, NOW)).not.toBeNull();
    spy.mockRestore();
  });

  it('reads a Date, an ISO string and a millisecond stamp alike', () => {
    const at = NOW - 10 * DAY;
    for (const v of [new Date(at), new Date(at).toISOString(), at]) {
      expect(homepageStatsAgeDays(v, NOW)).toBeCloseTo(10, 5);
      expect(isHomepageStatsStale(v, NOW)).toBe(true);
    }
  });

  it('does not call an undated cache stale (the audit reports it instead)', () => {
    expect(homepageStatsAgeDays(undefined, NOW)).toBeNull();
    expect(isHomepageStatsStale(undefined, NOW)).toBe(false);
    expect(isHomepageStatsStale('not a date', NOW)).toBe(false);
    expect(libraryStatsFromCache({ ...CACHE }, NOW)).not.toBeNull();
  });
});

describe('corpus-number scan', () => {
  // Lines copied from the repo on 2026-11-13, one per idiom the scan must see.
  const cases: [string, string, string, number][] = [
    ['src/app/search/layout.tsx', "    description: 'Search over 10,000 translated primary sources: alchemy, Hermetica, Kabbalah.',", '10,000 translated primary sources', 10000],
    ['src/app/timeline/page.tsx', '          subtitle="10,000+ texts from antiquity to the Enlightenment. Browse the tradition by era"', '10,000+ texts', 10000],
    ['src/app/for-researchers/page.tsx', '          Source Library holds over 17,000 digitized books spanning the 15th&ndash;19th centuries,', '17,000 digitized books', 17000],
    ['src/lib/site-features.json', '    "description": "Structured parallel-text training data from 19,000+ historical texts in 200+ languages.",', '19,000+ historical texts', 19000],
    ['public/llms.txt', '> Historical primary sources, from Sumerian tablets to the 19th century: 70,000+ books with transcriptions', '70,000+ books', 70000],
    ['src/app/upload/page.tsx', '                  <p className="text-sm text-stone-500">~37k books from Internet Archive and BPH</p>', '37k books', 37000],
  ];
  it.each(cases)('finds the typed-in count in %s', (file, line, text, value) => {
    const hits = scanText(file, line).filter((f) => f.kind === 'hardcoded' && f.class === 'books');
    expect(hits.map((f) => [f.text, f.value])).toContainEqual([text, value]);
  });

  it('sees a languages count beside a books count', () => {
    const hits = scanText('src/lib/site-features.json', cases[3][1]);
    expect(hits.map((f) => f.text)).toEqual(expect.arrayContaining(['19,000+ historical texts', '200+ languages']));
  });

  it('passes copy that reads the shared constant', () => {
    const line = '    `How Source Library processes ${BOOK_CORPUS_STATS.books} historical books: Lambda workers, SQS queues.`,';
    expect(scanText('src/app/developers/pipeline/page.tsx', line)).toEqual([]);
  });

  it('ignores comments, years and spans of years', () => {
    const src = [
      '// 81,838 visible non-English books in the dry run',
      '/* the old page said 13,713 rare books */',
      "const a = 'Printed in 1570 editions vary'; // 19,420 books on the homepage",
      '{/* 34,040 books are visible */}',
      "const b = '2,500 years of primary sources';",
    ].join('\n');
    expect(scanText('src/app/x/page.tsx', src)).toEqual([]);
    // The same text in a file with no comment syntax is copy, and is reported.
    expect(scanText('public/llms.txt', '// 81,838 visible non-English books')).toHaveLength(1);
  });

  it('keeps a URL in a string from hiding the rest of the line', () => {
    const line = "const c = 'See https://sourcelibrary.org for 15,000+ rare texts';";
    expect(scanText('src/app/x/page.tsx', line).map((f) => f.text)).toEqual(['15,000+ rare texts']);
  });

  it('honours a waiver on the line or just above it, and nowhere else', () => {
    const waived = "// corpus-number-ok: books placed on the map, 47,615 measured 2026-11-13\nconst d = 'Interactive map of 45,000+ books';";
    expect(scanText('src/app/explore/map/page.tsx', waived).map((f) => f.waived)).toEqual([true]);
    const far = `// corpus-number-ok: something else\n\n\n\n\nconst d = 'Interactive map of 45,000+ books';`;
    expect(scanText('src/app/explore/map/page.tsx', far).map((f) => f.waived)).toEqual([false]);
  });

  it('reports a page that counts for itself, inline or through a hoisted handle', () => {
    const inline = "  const n = await db.collection('books').countDocuments({ visible: true, pages_count: { $gt: 0 } });";
    const hoisted = "const books = db.collection('books');\n\n\n\n\n\n\n\nconst n = await books.countDocuments(visible, { maxTimeMS });";
    expect(scanText('src/app/contribute/page.tsx', inline)).toMatchObject([{ kind: 'local-count', class: 'books' }]);
    // The handle is out of reach, so the collection is unknown: still reported.
    expect(scanText('src/app/dataset/page.tsx', hoisted)).toMatchObject([{ kind: 'local-count', class: '?' }]);
    // An API route or a lib helper is not copy.
    expect(scanText('src/app/api/books/library/route.ts', inline)).toEqual([]);
    expect(scanText('src/lib/home-data.ts', inline)).toEqual([]);
  });

  it('keys a local count by file and collection, so reformatting the query is not a new finding', () => {
    const one = scanText('src/app/contribute/page.tsx', "  const n = await db.collection('books').countDocuments({ visible: true });");
    const two = scanText('src/app/contribute/page.tsx', "  const total = await db.collection('books').countDocuments(LIVE, { maxTimeMS: 5000 });");
    expect(findingKey(one[0])).toBe(findingKey(two[0]));
    expect(findingKey(one[0])).not.toBe(findingKey(scanText('src/app/other/page.tsx', "  await db.collection('books').countDocuments({});")[0]));
  });

  it('parses the forms a count is written in', () => {
    expect([parseCount('17,000+'), parseCount('37k'), parseCount('1.2 million'), parseCount('200+')]).toEqual([17000, 37000, 1200000, 200]);
  });
});

describe('corpus-number baseline (the ratchet)', () => {
  const { files, findings } = scanRepo();
  const baseline = readBaseline();

  it('scans the repo and finds what it is known to hold', () => {
    // An empty scan is a broken instrument, not a clean library.
    expect(files).toBeGreaterThan(500);
    expect(findings.length).toBeGreaterThan(20);
    expect(baseline.accepted.length).toBeGreaterThan(20);
  });

  it('finds no typed-in count or page-local count that is not on the accepted list', () => {
    const { fresh } = compareWithBaseline(findings, baseline);
    // Read the count from getLibraryStats() or BOOK_CORPUS_STATS (src/lib/public-stats.ts).
    // A measured subset gets `corpus-number-ok: <what, measured when>` in a comment beside it.
    expect(fresh.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });

  it('fails on a finding the list does not hold', () => {
    const added = scanText('src/app/new-page/page.tsx', "export const metadata = { description: 'Read 99,000+ rare books online.' };");
    const { fresh } = compareWithBaseline([...findings, ...added], baseline);
    expect(fresh.map(findingKey)).toEqual(['hardcoded|src/app/new-page/page.tsx|99,000+ rare books']);
  });
});

describe('corpus-number live checks', () => {
  const root = path.join(__dirname, '..', '..');
  const constants = parseConstants(
    fs.readFileSync(path.join(root, 'src/lib/public-stats.ts'), 'utf8'),
    fs.readFileSync(path.join(root, 'src/lib/site-stats.ts'), 'utf8'),
  );
  const live = { ...CACHE, artworksByResourceType: 18614, updatedAt: new Date(NOW - 2 * 3_600_000) };
  const run = (over: Record<string, unknown> = {}, c = constants) => checkLive({ live: { ...live, ...over }, constants: c, hardcoded: [], now: NOW });

  it('reads the floors and the fallback out of the real files', () => {
    expect(constants.floors.books.value).toBeGreaterThanOrEqual(70000);
    expect(constants.fallback.totalBooks).toBeGreaterThan(1000);
    expect(() => parseConstants('export const X = {}', 'SITE_STATS_FALLBACK = {}')).toThrow();
  });

  it('passes the constants as committed against the 2026-11-18 cache', () => {
    expect(run().problems).toEqual([]);
  });

  it('fails a cache that has stopped being written', () => {
    const p = run({ updatedAt: new Date(NOW - 3 * DAY) }).problems;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/72\.0 h old/);
    expect(run({ updatedAt: undefined }).problems[0]).toMatch(/no readable updatedAt/);
    expect(checkLive({ live: null, constants, hardcoded: [], now: NOW }).problems[0]).toMatch(/missing/);
  });

  it('fails a floor that overstates, and one that trails too far', () => {
    expect(run({ totalBooks: 69000 }).problems.join('\n')).toMatch(/BOOK_CORPUS_STATS\.books '70,000\+' OVERSTATES/);
    expect(run({ totalBooks: 120000 }).problems.join('\n')).toMatch(/BOOK_CORPUS_STATS\.books '70,000\+' trails/);
  });

  it('fails the fallback the homepage carried until 2026-11-13', () => {
    const old = { ...constants, fallback: { ...constants.fallback, totalBooks: 42192, readableInEnglish: 15101 } };
    const p = run({}, old).problems;
    expect(p).toHaveLength(2);
    expect(p[0]).toMatch(/SITE_STATS_FALLBACK\.totalBooks = 42,192 is 41% off/);
  });

  it('grades each hardcoded number against the live value of its class', () => {
    const hardcoded = [
      ...scanText('a.txt', '10,000 books'), ...scanText('b.txt', '70,000+ books'), ...scanText('c.txt', '110,000 books'), ...scanText('d.txt', '200+ languages'),
    ];
    const rows = checkLive({ live, constants, hardcoded, now: NOW }).rows;
    expect(rows.map((r: { verdict: string }) => r.verdict)).toEqual(['low', 'ok', 'over', 'over']);
  });
});
