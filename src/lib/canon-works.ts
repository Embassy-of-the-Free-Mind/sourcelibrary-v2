/**
 * Canon works registry — hand-curated landing slugs for major ancient works.
 *
 * Why this exists: the same work is fragmented across several `books.work_id`
 * values (Wikidata QIDs, minted `local:…` ids, legacy clean slugs — the Iliad
 * alone spans four). A canon slug aggregates those verified clusters into one
 * stable reading address: /work/iliad. See issue #3736.
 *
 * Rules for adding an entry:
 * - Every id in `workIds`/`collectedWorkIds` must be VERIFIED against
 *   production (cluster the author's live books by work_id and read the
 *   titles) — never guessed from memory. A wrong id silently pulls another
 *   work's editions onto the page.
 * - Slugs are permanent once published (they become citation URLs). Prefer the
 *   common English short title; qualify only to break a real ambiguity
 *   (`laws-plato`, `herodotus-histories`).
 * - `collectedWorkIds` are Opera/collected editions that CONTAIN the work.
 *   They render in a separate section, never mixed into the editions list —
 *   a reader looking for the Republic should see the Stephanus Opera, but not
 *   counted as "an edition of the Republic".
 */

export interface CanonWork {
  slug: string;
  /** English display title, e.g. "Republic" */
  title: string;
  /** Title in the original language/script, e.g. "Πολιτεία" */
  originalTitle: string;
  author: string;
  /** Approximate composition date, reader-facing, e.g. "c. 375 BCE" */
  era: string;
  /** Language the work was composed in ("Greek" | "Latin") */
  originalLanguage: string;
  /** Verified work_id / work_slug values whose books ARE editions of this work */
  workIds: string[];
  /** Verified work_id values of collected editions containing this work */
  collectedWorkIds?: string[];
  /**
   * Canonical citation config (enables /work/[slug]/at/[ref] and the jump
   * box). `workSlug` must be a slug from src/lib/locus-works.ts — it filters
   * anchors by running head, which is how a Stephanus number is disambiguated
   * between dialogues. `example` is a reader-facing reference inside the
   * work's real range.
   */
  locus?: { system: 'bekker' | 'stephanus'; workSlug: string; example: string };
}

const PLATO_COLLECTED = ['Q139619812', 'plato-opera-ficino']; // Stephanus 1578; Ficino's Latin Opera
const HOMER_COLLECTED = ['Q106691509']; // Homeri Opera (multi-volume)

export const CANON_WORKS: CanonWork[] = [
  {
    slug: 'iliad',
    title: 'Iliad',
    originalTitle: 'Ἰλιάς',
    author: 'Homer',
    era: 'c. 8th century BCE',
    originalLanguage: 'Greek',
    workIds: ['Q125518202', 'Q16547641', 'homer-homer-iliad-odyssey', 'Q19090449'],
    collectedWorkIds: HOMER_COLLECTED,
  },
  {
    slug: 'odyssey',
    title: 'Odyssey',
    originalTitle: 'Ὀδύσσεια',
    author: 'Homer',
    era: 'c. 8th century BCE',
    originalLanguage: 'Greek',
    workIds: ['local:a:homer:dolinghe-odyssea-ulysse-van', 'Q19090449', 'homer-homer-iliad-odyssey'],
    collectedWorkIds: HOMER_COLLECTED,
  },
  {
    slug: 'homeric-hymns',
    title: 'Homeric Hymns',
    originalTitle: 'Ὕμνοι Ὁμηρικοί',
    author: 'Homer',
    era: '7th–6th century BCE',
    originalLanguage: 'Greek',
    workIds: ['Q329342'],
    collectedWorkIds: HOMER_COLLECTED,
  },
  {
    slug: 'republic',
    title: 'Republic',
    originalTitle: 'Πολιτεία',
    author: 'Plato',
    era: 'c. 375 BCE',
    originalLanguage: 'Greek',
    workIds: ['plato-republic'],
    collectedWorkIds: PLATO_COLLECTED,
    locus: { system: 'stephanus', workSlug: 'republic', example: '328b' },
  },
  {
    slug: 'timaeus',
    title: 'Timaeus',
    originalTitle: 'Τίμαιος',
    author: 'Plato',
    era: 'c. 360 BCE',
    originalLanguage: 'Greek',
    workIds: ['Q371884', 'plato-timaeus'],
    collectedWorkIds: PLATO_COLLECTED,
    locus: { system: 'stephanus', workSlug: 'timaeus', example: '29d' },
  },
  {
    slug: 'phaedo',
    title: 'Phaedo',
    originalTitle: 'Φαίδων',
    author: 'Plato',
    era: 'c. 380 BCE',
    originalLanguage: 'Greek',
    workIds: ['Q244161'],
    collectedWorkIds: PLATO_COLLECTED,
    locus: { system: 'stephanus', workSlug: 'phaedo', example: '64a' },
  },
  {
    slug: 'laws-plato',
    title: 'Laws',
    originalTitle: 'Νόμοι',
    author: 'Plato',
    era: 'c. 350 BCE',
    originalLanguage: 'Greek',
    workIds: ['Q752285'],
    collectedWorkIds: PLATO_COLLECTED,
    locus: { system: 'stephanus', workSlug: 'laws', example: '624a' },
  },
  {
    slug: 'nicomachean-ethics',
    title: 'Nicomachean Ethics',
    originalTitle: 'Ἠθικὰ Νικομάχεια',
    author: 'Aristotle',
    era: '4th century BCE',
    originalLanguage: 'Greek',
    workIds: ['aristotle-nicomachean-ethics'],
    locus: { system: 'bekker', workSlug: 'nicomachean-ethics', example: '1094a' },
  },
  {
    slug: 'metaphysics',
    title: 'Metaphysics',
    originalTitle: 'Τὰ μετὰ τὰ φυσικά',
    author: 'Aristotle',
    era: '4th century BCE',
    originalLanguage: 'Greek',
    workIds: ['aristotle-metaphysics'],
    locus: { system: 'bekker', workSlug: 'metaphysics', example: '980a' },
  },
  {
    slug: 'organon',
    title: 'Organon',
    originalTitle: 'Ὄργανον',
    author: 'Aristotle',
    era: '4th century BCE',
    originalLanguage: 'Greek',
    workIds: ['Q500930'],
  },
  {
    slug: 'on-the-soul',
    title: 'On the Soul',
    originalTitle: 'Περὶ ψυχῆς',
    author: 'Aristotle',
    era: '4th century BCE',
    originalLanguage: 'Greek',
    workIds: ['local:a:aristotle:soul'],
    locus: { system: 'bekker', workSlug: 'de-anima', example: '402a' },
  },
  {
    slug: 'herodotus-histories',
    title: 'Histories',
    originalTitle: 'Ἱστορίαι',
    author: 'Herodotus',
    era: 'c. 430 BCE',
    originalLanguage: 'Greek',
    workIds: [
      'Q746583',
      'local:n:herodotus:histories',
      'local:a:herodotus:1-2-persian-wars',
      'local:a:herodotus:historiae',
      'local:a:herodotus:histories-works',
    ],
  },
  {
    slug: 'meditations',
    title: 'Meditations',
    originalTitle: 'Τὰ εἰς ἑαυτόν',
    author: 'Marcus Aurelius',
    era: '170–180 CE',
    originalLanguage: 'Greek',
    workIds: ['Q136035389'],
  },
  {
    slug: 'elements',
    title: 'Elements',
    originalTitle: 'Στοιχεῖα',
    author: 'Euclid',
    era: 'c. 300 BCE',
    originalLanguage: 'Greek',
    workIds: ['Q172891', 'local:a:euclid:elements'],
  },
  {
    slug: 'aeneid',
    title: 'Aeneid',
    originalTitle: 'Aeneis',
    author: 'Virgil',
    era: '29–19 BCE',
    originalLanguage: 'Latin',
    workIds: ['Q60220'],
    collectedWorkIds: ['Q21205467'], // Opera (Bucolica, Georgica, Aeneis)
  },
  {
    slug: 'metamorphoses',
    title: 'Metamorphoses',
    originalTitle: 'Metamorphoseon libri XV',
    author: 'Ovid',
    era: '8 CE',
    originalLanguage: 'Latin',
    workIds: ['Q106595694'],
  },
  {
    slug: 'de-rerum-natura',
    title: 'On the Nature of Things',
    originalTitle: 'De rerum natura',
    author: 'Lucretius',
    era: 'c. 55 BCE',
    originalLanguage: 'Latin',
    workIds: ['Q137592632', 'local:a:titus-lucretius:natura-rerum'],
  },
  {
    slug: 'consolation-of-philosophy',
    title: 'The Consolation of Philosophy',
    originalTitle: 'De consolatione philosophiae',
    author: 'Boethius',
    era: '524 CE',
    originalLanguage: 'Latin',
    workIds: ['Q138752489', 'local:n:boethius:consolation-philosophy'],
  },
  {
    slug: 'epistulae-morales',
    title: 'Moral Letters to Lucilius',
    originalTitle: 'Epistulae morales ad Lucilium',
    author: 'Seneca',
    era: 'c. 65 CE',
    originalLanguage: 'Latin',
    workIds: [
      'seneca-epistulae-morales',
      'local:a:seneca:ad-add-buschius-epistolae-hermannus-lucilium-senecae-vita',
    ],
  },
];

const bySlug = new Map(CANON_WORKS.map((w) => [w.slug, w]));
const byWorkId = new Map<string, CanonWork>();
for (const w of CANON_WORKS) {
  for (const id of w.workIds) {
    // First entry wins for shared ids (combined Iliad+Odyssey volumes appear in
    // both entries; redirects should land somewhere stable, not flip-flop).
    if (!byWorkId.has(id)) byWorkId.set(id, w);
  }
}

export function canonWork(slug: string): CanonWork | undefined {
  return bySlug.get(slug);
}

/** The canon entry whose editions list includes this work_id, if any. */
export function canonWorkForWorkId(workId: string): CanonWork | undefined {
  return byWorkId.get(workId);
}

/**
 * Mongo filter matching the editions of a /work/[id] route param: canon slugs
 * expand to their verified work_id set; anything else matches work_slug or
 * work_id directly (back-compat). Shared by the work page and its compare page
 * so a canon slug resolves identically on both.
 */
export function workEditionsFilter(idOrSlug: string): Record<string, unknown> {
  const canon = bySlug.get(idOrSlug);
  if (canon) {
    return {
      $or: [{ work_id: { $in: canon.workIds } }, { work_slug: { $in: canon.workIds } }],
      visible: true,
    };
  }
  return { $or: [{ work_slug: idOrSlug }, { work_id: idOrSlug }], visible: true };
}
