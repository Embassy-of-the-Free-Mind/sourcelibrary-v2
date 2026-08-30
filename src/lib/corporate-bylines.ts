/**
 * Institutional bylines — which RELATION an organisation has to a book.
 *
 * WHY THIS EXISTS. `books.author` is one untyped slot, and it is holding at
 * least four different relations. `is_person: false` types the ENTITY ("this
 * heading is not a human"); nothing types the EDGE ("what did it do to this
 * book"). Those are independent axes: an institution can be a genuine author
 * (the Council of Trent wrote its own canons) and a person can be a non-author
 * (an editor, a printer, a dedicatee). Every attribution error found in the
 * 2026-08-18 audit lived on the edge, not the node.
 *
 * WHAT IT FIXES TODAY. `SchemaOrgMetadata` emitted `author: {'@type': 'Person'}`
 * unconditionally, so the site was telling search engines that **Thadrak Temple
 * is a human being who wrote the Tantra collection** — across 142 books — and
 * the same for the Council of Trent, the Indian Hemp Drugs Commission and the
 * Bible societies. That is #3483's defect (institutions rendered as schema.org
 * `Person`) reappearing on the book page, reached through `books.author`
 * instead of through the thesaurus.
 *
 * WHY NOT JUST CLEAR THE BYLINE. A byline is how a reader REACHES a book. The
 * ~446 Bhutanese manuscript volumes carry their monastery as the only record of
 * which collection they come from — `contributing_library` names the British
 * Library, the digitiser, not the holder. Blanking those would be more truthful
 * and strictly worse: 446 books lose their most searchable handle and their
 * cards go blank. So the fix is to say what the relation IS, not to delete it.
 *
 * WHY A HAND-TYPED TABLE AND NOT A PATTERN. A regex cannot tell `Temple
 * Stanyan` — the English historian of *The Grecian History* (1774) — from
 * `Thadrak Temple`; it matched both on the word "Temple". The 2026-08-18 pass
 * measured that at 2 wrong verdicts in 47 strings, all of them calling people
 * institutions. Pattern matching is a fine NET (it cut 1,632 strings down to 47
 * worth reading) and a bad VERDICT. Every entry below was read by a human
 * against the book's title, date and language. Add to it the same way.
 *
 * SCOPE. Deliberately small and explicit. A string that is not in this table is
 * treated exactly as before — as a personal author — so the default behaviour
 * for the other ~21,900 visible books is unchanged.
 */

/** What an organisation did to a book. */
export type InstitutionalRole =
  /** The body genuinely authored the work: a council's own canons, a
   *  commission's own report, a bureau's own compilation. Standard corporate
   *  main entry. Renders as a normal byline; typed `Organization`, not `Person`. */
  | 'corporate-author'
  /** Published, issued or translated it, but did not write it. A learned
   *  society's own Transactions are `corporate-author`; a Bible it printed is
   *  not. */
  | 'issuer'
  /** Holds or once held the manuscript. Provenance — never authorship. */
  | 'holder'
  /** A canonical or anthologised collection with no single author. The name in
   *  the field identifies the WITNESS or the tradition, not a writer. */
  | 'collective';

export interface InstitutionalByline {
  role: InstitutionalRole;
  /** Short human-readable qualifier rendered next to the name. */
  qualifier: string;
  /** Why this verdict — kept next to the data so the next reader can disagree
   *  with a specific claim rather than with a vibe. */
  note: string;
}

const norm = (s: string): string =>
  s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

const TABLE: Record<string, InstitutionalByline> = {};
function add(names: string[], entry: InstitutionalByline): void {
  for (const n of names) TABLE[norm(n)] = entry;
}

// ── Holder / manuscript witness ────────────────────────────────────────────
// The Bhutanese corpus: Kanjur volumes (the translated word of the Buddha),
// rNying rgyud (the Ancient Tantras) and `thor bu` miscellanies. The monastery
// names WHICH manuscript set this is — it is already in the title too
// ("Thadrak Kanjur rGyud 'bum Ka") — and it is the only holder we record.
add(
  ['Thadrak Temple', 'Neyphug Monastery', 'Tshamdrak Monastery',
   'Drametse Monastery Collection', 'Gangtey Monastery Collection',
   'Ogyen Choling Collection', 'Thadrak, Tshamdrak & Nyephug Collection',
   'Drametse & Ogyen Choling Collection', 'Shinhungsa temple'],
  { role: 'holder', qualifier: 'manuscript collection',
    note: 'Monastery holding the manuscript set. Named in the title as well; contributing_library records the British Library, the digitiser, not the holder.' },
);
add(
  ['Beinecke Library, Yale University', 'India Office Library', 'Library of Ashurbanipal'],
  { role: 'holder', qualifier: 'holding institution',
    note: 'Where the object is kept. The Voynich Manuscript and the Ashurbanipal tablets have no known author; a repository is not one.' },
);

// ── Corporate author: the body really did write it ─────────────────────────
add(
  ['Council of Trent (1545-1563)', 'Council of Trent; Pope Pius IV',
   'Congregation of the Index; Pope Clement VIII'],
  { role: 'corporate-author', qualifier: '',
    note: 'A council or congregation issuing its own canons, decrees and Index. Standard corporate main entry; two string forms of one body remain unmerged on purpose — heading form is a cataloguing decision.' },
);
add(
  ['Indian Hemp Drugs Commission', 'Ancient Laws Commission',
   'Dzongkha Development Commission'],
  { role: 'corporate-author', qualifier: '',
    note: 'A commission authoring its own report or edition.' },
);
add(
  ['司農司', 'Imperial Astronomical Bureau', 'Qing Imperial Astronomical Bureau'],
  { role: 'corporate-author', qualifier: '',
    note: 'A state office compiling its own work — the Yuan Office of Agriculture compiled 農桑輯要 (1273); the Bureau produced the imperial astronomical surveys.' },
);
add(
  ['Orthodox Eastern Church', 'Catholic Church',
   'Catholic Church, Assemblée générale du clergé de France.'],
  { role: 'corporate-author', qualifier: '',
    note: 'The standard corporate heading for liturgical books — a Book of Hours, a Paraklētikē, the Liturgy of St Basil have no personal author.' },
);
add(
  ['Royal Asiatic Society, Korea Branch', 'French Royal Academy',
   'Dublin Irish Texts Society', 'Esoteric School of Theosophy'],
  { role: 'corporate-author', qualifier: '',
    note: 'A learned society is the corporate author of its OWN transactions and instructions (as distinct from texts it merely printed).' },
);

// ── Issuer: printed, published or translated, but did not write ────────────
add(
  ['British and Foreign Bible Society', 'American Bible Society', 'Bible Society',
   'Hawaiian Bible Society', 'Trinitarian Bible Society',
   'London Missionary Society', 'Church Missionary Society'],
  { role: 'issuer', qualifier: 'edition issued by',
    note: 'Bible and missionary societies translated and printed scripture; scripture has no single author, so the society is the issuer of THIS edition.' },
);
add(
  ['Pali Text Society', 'The Trilingual Press'],
  { role: 'issuer', qualifier: 'edition issued by',
    note: 'Publisher of the edition. Where the underlying text has a known author the byline should name that author instead — Buddhaghosa, for one, was recovered by hand.' },
);

/**
 * Look up an author string. Returns null for anything not hand-typed, which is
 * the overwhelming majority — those keep the existing personal-author
 * behaviour untouched.
 */
export function institutionalByline(author?: string | null): InstitutionalByline | null {
  if (!author) return null;
  return TABLE[norm(author)] ?? null;
}

/** True when the byline names an organisation rather than a person. Drives
 *  schema.org `Organization` vs `Person`; see #3483 for why that matters. */
export function isInstitutionalByline(author?: string | null): boolean {
  return institutionalByline(author) !== null;
}

/** True when the named body did NOT write the book, so nothing should assert
 *  authorship for it — in prose, in a citation, or in structured data. */
export function bylineClaimsAuthorship(author?: string | null): boolean {
  const hit = institutionalByline(author);
  if (!hit) return true; // a personal author, or an untyped string: unchanged
  return hit.role === 'corporate-author';
}

/** Exposed for tests and for an audit that wants to enumerate what is typed. */
export const TYPED_INSTITUTIONAL_STRINGS: readonly string[] = Object.keys(TABLE);
