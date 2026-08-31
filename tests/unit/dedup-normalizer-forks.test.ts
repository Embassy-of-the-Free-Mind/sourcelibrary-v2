import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { normalizeTitle as tsTitle, normalizeAuthor as tsAuthor } from '@/lib/dedup';
import { normalizeTitle as mjsTitle, normalizeAuthor as mjsAuthor } from '../../scripts/lib/dedup-normalize.mjs';

/**
 * #4444. `normalizeTitle` / `normalizeAuthor` compute DEDUP KEYS. A fork means
 * import-time and detector-time hash the same book differently, and it enters
 * the corpus twice — silently, no error, no skip row.
 *
 * Two guards here, and the second is the one that matters over time:
 *
 *  1. PARITY — the scripts-side twin must agree with `src/lib/dedup.ts`
 *     character-for-character over a corpus that exercises every branch.
 *  2. CENSUS — the set of files that define their own normalizer is pinned.
 *     A new local definition fails this test; so does removing one without
 *     updating the list (which is how a consolidation gets credited). This is
 *     the "a check beats a sentence" half: doc prose did not stop the count
 *     reaching 25 + 25.
 *
 * This suite must NOT be used to improve normalisation. Behaviour changes to
 * these two functions are #4270, and land with their own before/after replay.
 */

// ---------------------------------------------------------------- 1. parity

const TITLES = [
  // leading articles, every language in the alternation
  'The Chymical Wedding', 'A Vindication of the Rights of Woman', 'An Essay on Man',
  'Der Weg zu Christo', 'Die Fama Fraternitatis', 'Das Kapital',
  'De Mysteriis Aegyptiorum', 'Le Comte de Gabalis', 'La Somme théologique',
  'Les Misérables', 'Il Principe', 'Lo Cunto de li Cunti', 'Gli Asolani',
  'I Discorsi', 'El Criticón', 'Los Rios Profundos', 'Las Casas',
  // volume markers, arabic / latin / abbreviated, bracketed and parenthesised
  'Theatrum chemicum, Vol. 3', 'Opera omnia, Tomus II', 'Aristotelis Opera, Tomus primus',
  'A Treatise of Human Nature (Vol. 1)', 'Böhmes Werke, Band 2',
  'La Somme théologique, tome 3', 'Ars Magna, part 4', 'Anatomy [Vol 2]',
  // diacritics, ligatures, punctuation, whitespace
  "L'Alchimie et les alchimistes", 'De re metallica — libri XII',
  'Chymische Hochzeit: Christiani Rosencreutz. Anno 1459',
  'The  Works   of Plato', '   leading and trailing   ',
  // non-Latin — ASCII normalizer yields '' here, deliberately (#4270)
  '營造法式 (Yingzao Fashi) · 卷一~卷四', '營造法式', 'བཀའ་འགྱུར', 'كتاب الشفاء',
  'Ἰλιάς', 'Тайная доктрина', 'حي بن يقظان / Philosophus Autodidactus',
  // degenerate
  'MS', 'untitled', '', '   ', '1776',
];

const AUTHORS = [
  // honorifics — every token in the alternation
  'Dr. John Dee', 'Prof. Isaac Newton', 'Rev. Robert Burton', 'Saint Augustine',
  'St. Thomas Aquinas', 'Sir Francis Bacon', 'Fr. Marin Mersenne', 'Bp. Berkeley',
  // life dates: parens, trailing comma, born/died/fl/circa/ca
  'Andreae, Johann Valentin (1586-1654)', 'Newton, Isaac, 1642-1727',
  'Kircher, Athanasius, 1602–1680', 'Dee, John, 1527-1608?',
  'Paracelsus, born 1493', 'Agrippa, died 1535', 'Hermes Trismegistus, fl. 200',
  'Boehme, Jacob, circa 1600', 'Bruno, ca. 1548', 'Ficino, c. 1433',
  // bracketed annotations, word-order variants, diacritics
  '[Meyer, Lodewijk]', 'Zetzner, Lazarus', 'Lazarus Zetzner',
  'Thomas à Kempis', 'van Helmont, Jean Baptiste', 'Jakob Böhme',
  // non-Latin and degenerate
  'Li Jie (李誡)', '李誡', 'Ibn Sina', 'Blavatsky, Helena', 'Anon', '', '   ',
];

describe('dedup normalizers: scripts twin vs src/lib/dedup.ts', () => {
  it('normalizeTitle agrees on every fixture', () => {
    for (const t of TITLES) expect(mjsTitle(t), JSON.stringify(t)).toBe(tsTitle(t));
  });

  it('normalizeAuthor agrees on every fixture', () => {
    for (const a of AUTHORS) expect(mjsAuthor(a), JSON.stringify(a)).toBe(tsAuthor(a));
  });

  it('the fixture corpus actually exercises the interesting branches', () => {
    // A parity suite over inputs that all normalize to themselves proves
    // nothing. Assert the corpus moves the needle before trusting it.
    expect(TITLES.filter((t) => tsTitle(t) !== t.toLowerCase().trim()).length).toBeGreaterThan(25);
    expect(AUTHORS.filter((a) => tsAuthor(a) !== a.toLowerCase().trim()).length).toBeGreaterThan(20);
    // the deliberate ASCII wart (#4270) — pinned so a silent fix is visible
    expect(tsTitle('營造法式')).toBe('');
  });

  it('the twin accepts nullish where the TS signature forbids it', () => {
    expect(mjsTitle(null as unknown as string)).toBe('');
    expect(mjsAuthor(undefined as unknown as string)).toBe('');
  });
});

// ---------------------------------------------------------------- 2. census

/**
 * Files that still define a local `normalizeTitle` / `normalizeAuthor` instead
 * of importing the shared one. Every entry is a KNOWN divergence documented in
 * #4444 — none is byte-identical to `src/lib/dedup.ts`, so none can be swapped
 * without changing that script's dedup keys.
 *
 * Shrinking this list is the work. GROWING it is the bug: a new local
 * definition is a new dedup-key fork, and this test is where it gets caught.
 *
 * Note `git grep` sees TRACKED files only, so a brand-new clone is caught on
 * the commit that adds it, not while it is still untracked on disk.
 */
const KNOWN_LOCAL_DEFINITIONS: Record<string, string> = {
  // canonical + its parity-pinned twin
  'src/lib/dedup.ts': 'canonical',
  'scripts/lib/dedup-normalize.mjs': 'the scripts-side twin, pinned by this file',

  // deliberately different jobs, not dedup keys
  'scripts/lib/artwork-work-resolver.mjs':
    'citation matcher: transliterates ligatures, punctuation -> space; own tests',
  'scripts/import/kloss-enrich.mjs':
    'normalizeAuthorString: a canonical-name LOOKUP, not a key normalizer',
  'scripts/maintenance/hide-efm-duplicates.mjs':
    'normalizeAuthor extracts a SURNAME, not a sorted full-name key',
  'scripts/tmp-cluster-editions.mjs': 'scratch clustering script (tmp-)',

  // drifted — swap one at a time, each with its own before/after replay
  'scripts/catalog-coverage/build.mjs': 'ASCII-only; no article or volume strip',
  'scripts/enrichment/backfill-work-ids.mjs': 'Unicode-aware, returns null, no word sort',
  'scripts/enrichment/wikidata-books.mjs': 'punctuation -> space; no article or volume strip',
  'scripts/iiif-discovery/dedupe-candidates.mjs': 'HTML entities, extra articles, D.O.M. prefix, length cap',
  'scripts/iiif-discovery/import-leiden-artworks.mjs': 'bare lowercase+strip',
  'scripts/iiif-discovery/import-leiden-books.mjs': 'bare lowercase+strip',
  'scripts/import/bncf-aldine-direct.mjs': 'bare [^a-z0-9 ] strip',
  'scripts/import/ccag-vii-pdf-direct.mjs': 'bare [^a-z0-9 ] strip',
  'scripts/import/ia-bundle-import.mjs': 'bare [^a-z0-9 ] strip',
  'scripts/import/shwep-curator-pass-import.mjs': 'bare [^a-z0-9 ] strip',
  'scripts/import/import-artwork.mjs': 'bare lowercase+strip',
  'scripts/import/import-met-egyptian.mjs': 'bare lowercase+strip',
  'scripts/import/import-oraec.mjs': 'bare lowercase+strip',
  'scripts/import/founders-collected-direct.mjs': 'normalizeAuthor: no born/died/fl/circa strip',
  'scripts/import/founding-enrich-direct.mjs': 'normalizeAuthor: no born/died/fl/circa strip',
  'scripts/import/founding-influences2-direct.mjs': 'normalizeAuthor: no born/died/fl/circa strip',
  'scripts/import/founding-tail-direct.mjs': 'normalizeAuthor: no born/died/fl/circa strip',
  'scripts/import/jefferson-canon-direct.mjs': 'normalizeAuthor: no born/died/fl/circa strip',
  'scripts/import/founding-chase.mjs': 'normalizeAuthor: no honorific and no date strip at all',
};

describe('dedup normalizer fork census (#4444)', () => {
  it('no undocumented local normalizeTitle/normalizeAuthor definition exists', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    let out = '';
    try {
      out = execFileSync(
        'git',
        [
          // POSIX ERE — git's regex engine does NOT understand `\s`, and a
          // pattern it silently fails to match makes this whole guard inert.
          'grep', '-l', '-E',
          '(function|const)[[:space:]]+normalize(Title|Author)',
          '--', '*.ts', '*.tsx', '*.mjs', '*.js',
        ],
        { cwd: repoRoot, encoding: 'utf8' },
      );
    } catch (e: unknown) {
      // git grep exits 1 on no matches; anything else is a real failure
      const err = e as { status?: number; stdout?: string };
      if (err.status !== 1) throw e;
      out = err.stdout || '';
    }
    const found = out.split('\n').map((s) => s.trim()).filter(Boolean)
      .filter((f) => !f.startsWith('tests/'));

    // Positive control: an empty result means the probe is broken, not that
    // the repo is clean. It must at minimum find the canonical definition.
    expect(found, 'git grep returned nothing — the census probe is broken')
      .toContain('src/lib/dedup.ts');

    const unexpected = found.filter((f) => !(f in KNOWN_LOCAL_DEFINITIONS));
    expect(
      unexpected,
      'New local dedup-key normalizer(s). Import from scripts/lib/dedup-normalize.mjs '
        + '(or src/lib/dedup.ts) instead — a fork means the same book gets two keys. '
        + 'If the divergence is deliberate, add it to KNOWN_LOCAL_DEFINITIONS with a reason.',
    ).toEqual([]);

    const stale = Object.keys(KNOWN_LOCAL_DEFINITIONS).filter((f) => !found.includes(f));
    expect(
      stale,
      'These files no longer define a local normalizer — remove them from '
        + 'KNOWN_LOCAL_DEFINITIONS so the list keeps meaning what it says.',
    ).toEqual([]);
  });
});
