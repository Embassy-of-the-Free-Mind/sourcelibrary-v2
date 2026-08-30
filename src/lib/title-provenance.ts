/**
 * Where a record's displayed title CAME FROM — and therefore whether it may be
 * cited as a published title.
 *
 * WHY (issue #4288 item 1): `scripts/artwork-enrichment.mjs` asks a vision model
 * for "a clean, concise English title for this artwork … If the existing title
 * is a messy filename, catalog number, or foreign language, rewrite it", and
 * promotes the answer onto the top-level `display_title`. That answer is
 * written by LOOKING AT THE PICTURE, so on an artwork it is a *descriptive
 * label*, not a title anyone ever printed:
 *
 *   /artwork/el-cerebro-segn-fludd
 *     title         "El cerebro según Fludd"                 ← the Commons record's title
 *     display_title "The Macrocosm and the Human Intellect"  ← invented from the image
 *     author        "Robert Fludd"   year 1619
 *
 * Every surface then renders `display_title || title`, so the invented label
 * reaches the <h1>, the share/citation string, the OG tags and the MCP tool
 * results wearing a real author and a real year. A scholar — or an agent —
 * citing that record cites a work that does not exist. Measured 2026-08-28:
 * 12,245 artwork records carry such a label, 7,523 of them public.
 *
 * THE MARKER ALREADY EXISTS. The enrichment script stamps
 * `field_provenance.display_title = { source: 'ai_enrichment', model, script }`
 * on every row it rewrites — and nothing in `src/` has ever read it. So this
 * module is a READ-side resolver over data we already hold, deliberately NOT a
 * new `books` column: a `title_is_descriptive` boolean would assert a second
 * time what the provenance stamp already says, and would be free to drift from
 * it (see `.claude/docs/invariants/field-sprawl.md` — 477 fields, ~140 of them
 * a single sweep's abandoned verdict).
 *
 * The distinction is specific to ARTWORK records. On a textual book the same
 * field holds a translation of a real printed title ("Dialogues des morts
 * anciens et modernes" → "Dialogues of the Dead"), which is a normal English
 * rendering of a title that exists, not an invention — so books keep their
 * current behaviour and this module reports `source` for them.
 */

/** The minimum shape this module needs. Deliberately structural, not `Book`. */
export interface TitleProvenanceInput {
  title?: string | null;
  display_title?: string | null;
  content_type?: string | null;
  resource_type?: string | null;
  field_provenance?: Record<string, unknown> | null;
}

/**
 * - `source`      — the displayed title is the one on the source record (museum
 *                   catalogue, Commons file, title page). Safe to cite.
 * - `descriptive` — an AI wrote it by looking at the image. It describes the
 *                   picture; nobody published it. NOT a bibliographic title.
 * - `derived`     — the displayed title was mechanically cleaned from the source
 *                   record's title (catalogue apparatus stripped, etc.) but
 *                   carries no provenance stamp saying so. Truthful in
 *                   substance, unverified in provenance; cite the source title.
 */
export type TitleProvenance = 'source' | 'descriptive' | 'derived';

export interface ResolvedTitle {
  /** What to show a reader. Unchanged from today: `display_title || title`. */
  display: string;
  /** The title on the source record — what a citation must use. */
  citation: string;
  provenance: TitleProvenance;
  /** True when `display` is an AI description of the image, not a title. */
  isDescriptive: boolean;
  /** The generating model, when the provenance stamp names one. */
  model: string | null;
}

/**
 * Artwork records live in `books` with `resource_type` set (any value routes to
 * /artwork/) or `content_type: 'artwork'` — but an explicit `content_type` of
 * 'book'/'text' wins, mirroring `artworkRedirectSlug()` in src/lib/artwork-slug.ts
 * and `isArtworkRecord()` in src/app/author/[name]/page.tsx. A digitized papyrus
 * tagged `resource_type: 'papyrus_fragment'` is a text, and its display_title is
 * a translated title, not a description of a picture.
 */
export function isArtworkRecord(book: TitleProvenanceInput): boolean {
  if (book.content_type === 'book' || book.content_type === 'text') return false;
  return book.content_type === 'artwork' || Boolean(book.resource_type);
}

function provenanceStamp(book: TitleProvenanceInput): { source?: string; model?: string } | null {
  const fp = book.field_provenance;
  if (!fp || typeof fp !== 'object') return null;
  const stamp = (fp as Record<string, unknown>).display_title;
  if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)) return null;
  return stamp as { source?: string; model?: string };
}

/**
 * Resolve a record's title into what to SHOW and what may be CITED.
 *
 * Reading is never suppressed — the descriptive label is genuinely the most
 * legible thing on a record whose real title is `RobertFuddBewusstsein17Jh-hc`.
 * What changes is that callers can now tell the two apart, and the citation
 * apparatus takes the source record's title instead.
 */
export function resolveTitle(book: TitleProvenanceInput): ResolvedTitle {
  const sourceTitle = typeof book.title === 'string' ? book.title : '';
  const displayTitle = typeof book.display_title === 'string' ? book.display_title : '';
  const display = displayTitle || sourceTitle;
  const plain: ResolvedTitle = {
    display,
    citation: sourceTitle || display,
    provenance: 'source',
    isDescriptive: false,
    model: null,
  };

  // No rewrite happened: display_title is absent, empty, or a copy of `title`.
  // 11,124 artwork records are exactly this — the importers set both fields to
  // the museum's own title, so there is nothing to distinguish.
  if (!displayTitle || displayTitle === sourceTitle) return plain;

  // On a textual book display_title is a translated real title (#4288 scope).
  if (!isArtworkRecord(book)) return { ...plain, citation: display };

  const stamp = provenanceStamp(book);
  if (stamp?.source === 'ai_enrichment') {
    return {
      display,
      // A record whose only title is invented has nothing citable; fall back to
      // the label rather than emitting an empty string, and let `isDescriptive`
      // carry the warning.
      citation: sourceTitle || display,
      provenance: 'descriptive',
      isDescriptive: true,
      model: typeof stamp.model === 'string' ? stamp.model : null,
    };
  }
  // A stamp naming a real catalogue (e.g. 'wellcome_collection') means the
  // display title came from a source record, not from a model.
  if (stamp?.source) return plain;

  // Unstamped rewrite. `scripts/clean-artwork-metadata.mjs` strips catalogue
  // apparatus deterministically ("… : estampe (3e état) / F. Rops" → the bare
  // title) and does not record provenance, which is where nearly all 1,455 of
  // these come from. Truthful, but we cannot prove it from the record, so a
  // citation takes the source title.
  return { ...plain, provenance: 'derived' };
}

/** The title a citation may assert. Never an AI description of an image. */
export function citationTitle(book: TitleProvenanceInput): string {
  return resolveTitle(book).citation;
}

/** True when the displayed title is an AI description of the image. */
export function hasDescriptiveTitle(book: TitleProvenanceInput): boolean {
  return resolveTitle(book).isDescriptive;
}

/**
 * One sentence naming what the displayed title is, for surfaces that hand text
 * to a person or a model. Null when the title is the source record's own.
 *
 * The wording matters for the MCP lane: a tool result is the only thing the
 * model sees, and a field it cannot interpret it will paper over (see
 * `.claude/docs/invariants/agent-tool-results.md`). Say it in prose.
 */
export function titleProvenanceNote(book: TitleProvenanceInput): string | null {
  const { provenance, model, citation, display } = resolveTitle(book);
  if (provenance === 'descriptive') {
    const by = model ? ` (${model})` : '';
    return citation && citation !== display
      ? `Descriptive label generated by AI from the image${by} — not a published title. The title on the source record is "${citation}".`
      : `Descriptive label generated by AI from the image${by} — not a published title.`;
  }
  if (provenance === 'derived') {
    return citation && citation !== display
      ? `Shortened from the source record's title for display. The full title on the source record is "${citation}".`
      : null;
  }
  return null;
}
