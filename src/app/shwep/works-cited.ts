import { getReadDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { SHWEP_CITED_WORKS } from '@/data/shwep-cited-works';
import { SHWEP_WORK_LANGUAGES } from '@/data/shwep-work-languages';
import { SHWEP_WORK_NOTES } from '@/data/shwep-work-notes';

/**
 * Works cited in a SHWEP episode, rendered as a bibliography rather than as the
 * podcast's own prose.
 *
 * Each entry is one WORK (Iamblichus, De mysteriis) carrying the EDITIONS of it we
 * hold. Showing the stack matters: for De mysteriis we hold Parthey's Greek critical
 * text, Gale's Greek-Latin, the 1497 Aldine editio princeps and two English
 * translations, and picking a single "best" one silently told the reader that
 * Ficino's loose 1570 Latin rendering *was* the work. 74% of the works cited across
 * the podcast have more than one edition here, so one link per work throws away most
 * of what we can actually offer a scholar.
 */

export type EditionRole =
  | 'critical'
  | 'princeps'
  | 'manuscript'
  | 'edition'
  | 'translation';

export interface EditionRef {
  id: string;
  title: string;
  author?: string;
  year?: number;
  language: string;
  role: EditionRole;
  /** Human label for the role, e.g. "Greek critical edition", "English translation". */
  roleLabel: string;
  /** Readable end-to-end in English here. */
  translated: boolean;
  pagesCount?: number;
  url: string;
  /** >0 when near-identical copies of this edition were folded into this row. */
  alsoCopies: number;
}

export interface CitedWorkEntry {
  work: string;
  author: string;
  era: string;
  /** Language the work was composed in, where known. */
  workLanguage?: string;
  /** What this episode cites the work for, compressed from the episode's own works-cited prose. */
  note?: string;
  held: boolean;
  /** The editions worth showing up front, already ordered. */
  editions: EditionRef[];
  /** Editions held beyond `editions`, available behind a disclosure. */
  moreEditions: EditionRef[];
}

/**
 * Reference works that name a text without being an edition of it. A bookseller's
 * catalogue listing De mysteriis is not a copy of De mysteriis — shown in an edition
 * stack it reads as carelessness, which is exactly the impression this page has to
 * avoid. Narrow on purpose: only drop what is unambiguously a catalogue.
 */
const NOT_AN_EDITION =
  /catalogus librorum|catalogue of (the )?(books|library)|bibliotheca \w+(iana|ana) sive|sale catalog|auction catalog/i;

const MANUSCRIPT =
  /\bms\.?\b|\bmss\b|\bcod(ex|\.)|\bpal\.\s?gr|\bvat\.\s?gr|manuscript|palimpsest|bodmer|houghton library|\bor\.\s?\d|\bfolios?\b/i;
const CRITICAL = /critical[- ]edition|kritische|teubner|oxford classical text/i;
const PRINCEPS = /editio[- ]princeps|aldine|incunabul/i;

/**
 * Is this edition in the language the work was composed in? A book record cannot say —
 * `text_role` is 'original' on Latin renderings of Greek works and `original_language`
 * is absent or wrong (a Greek De mysteriis records original_language: Latin), so the
 * work's composition language comes from SHWEP_WORK_LANGUAGES instead.
 *
 * Bilingual editions ("Greek-Latin", "Arabic-Latin") count as source-language witnesses:
 * the source text is present, facing the translation.
 */
function isSourceLanguage(editionLanguage: string, workLanguage?: string): boolean {
  if (!workLanguage || workLanguage === 'Unknown') return false;
  const parts = (editionLanguage || '').split(/[-/,]| and /i).map(s => s.trim().toLowerCase());
  return parts.includes(workLanguage.toLowerCase());
}

/**
 * The slug is matched alongside the title because an edition's scholarly character often
 * survives only there — Parthey's critical text is titled just "On the Mysteries", and
 * ranked below three later Latin printings until we looked here.
 *
 * A form badge (critical / princeps / manuscript) is only allowed to raise an edition
 * that is IN THE SOURCE LANGUAGE. The 1497 Aldine De mysteriis is the editio princeps of
 * *Ficino's Latin*, not of Iamblichus' Greek; badging it "editio princeps" lent a
 * paraphrase the authority of the text, which is the error this page exists to avoid.
 */
function classify(
  title: string,
  slug: string | null,
  language: string,
  workLanguage?: string
): { role: EditionRole; roleLabel: string } {
  const hay = `${title} ${slug || ''}`;
  const lang = (language || '').trim();
  const langWord = lang && lang !== 'Unknown' ? lang : '';
  const source = isSourceLanguage(lang, workLanguage);

  if (source) {
    if (CRITICAL.test(hay)) return { role: 'critical', roleLabel: `${langWord} critical edition` };
    if (MANUSCRIPT.test(hay)) return { role: 'manuscript', roleLabel: `${langWord} manuscript` };
    if (PRINCEPS.test(hay)) return { role: 'princeps', roleLabel: `${langWord} editio princeps` };
    return { role: 'edition', roleLabel: `${langWord} text` };
  }

  // Not the source language: this is a rendering, whatever its typographic pedigree.
  if (MANUSCRIPT.test(hay) && langWord) return { role: 'translation', roleLabel: `${langWord} manuscript translation` };
  if (langWord) return { role: 'translation', roleLabel: `${langWord} translation` };
  return { role: 'translation', roleLabel: 'Translation' };
}

/**
 * Ad fontes: the text as written outranks any rendering of it, and among source-language
 * witnesses an edited or hand-written one outranks a plain reprint. The reader still
 * needs something they can actually read, so `pickForDisplay` re-admits a translation.
 */
const ROLE_RANK: Record<EditionRole, number> = {
  critical: 100,
  manuscript: 90,
  princeps: 85,
  edition: 70,
  translation: 30,
};

function normalizeTitle(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
}

/** Fold near-identical rows (six incunable copies of one Traversarius printing) into one. */
function foldCopies(editions: EditionRef[]): EditionRef[] {
  const byKey = new Map<string, EditionRef>();
  for (const e of editions) {
    const key = `${normalizeTitle(e.title)}|${e.year ?? ''}`;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { ...e });
      continue;
    }
    seen.alsoCopies += 1;
    // Prefer the copy a reader can actually read.
    if (!seen.translated && e.translated) {
      byKey.set(key, { ...e, alsoCopies: seen.alsoCopies });
    }
  }
  return [...byKey.values()];
}

const MAX_SHOWN = 3;

function pickForDisplay(editions: EditionRef[]): { editions: EditionRef[]; moreEditions: EditionRef[] } {
  const ordered = [...editions].sort((a, b) => {
    const rank = ROLE_RANK[b.role] - ROLE_RANK[a.role];
    if (rank !== 0) return rank;
    if (a.translated !== b.translated) return a.translated ? -1 : 1;
    return (a.year ?? 9999) - (b.year ?? 9999);
  });

  const shown = ordered.slice(0, MAX_SHOWN);
  // Always leave the reader a way in: if nothing shown is readable in English, promote
  // the best edition that is.
  if (!shown.some(e => e.translated || e.role === 'translation')) {
    const readable = ordered.find(e => e.translated || e.role === 'translation');
    if (readable) shown.splice(MAX_SHOWN - 1, 1, readable);
  }
  const shownIds = new Set(shown.map(e => e.id));
  return { editions: shown, moreEditions: ordered.filter(e => !shownIds.has(e.id)) };
}

export async function getWorksCitedForEpisode(episodeNumber: number): Promise<CitedWorkEntry[]> {
  const works = SHWEP_CITED_WORKS.filter(w => w.episodes.includes(episodeNumber));
  if (works.length === 0) return [];

  const allIds = [...new Set(works.flatMap(w => w.held.map(h => h.id)))];
  const meta = new Map<string, any>();
  if (allIds.length > 0) {
    const db = await getReadDb();
    const objectIds = allIds
      .map(id => { try { return new ObjectId(id); } catch { return null; } })
      .filter((id): id is ObjectId => id !== null);
    const rows = await db.collection('books').find(
      { _id: { $in: objectIds }, deleted: { $ne: true } },
      {
        projection: {
          _id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1,
          language: 1, pages_count: 1, pages_translated: 1, pages_blank: 1,
        },
        maxTimeMS: 20000,
      }
    ).toArray();
    for (const r of rows) meta.set(r._id.toString(), r);
  }

  const entries: CitedWorkEntry[] = [];
  for (const w of works) {
    const workLanguage = SHWEP_WORK_LANGUAGES[`${w.author}|${w.work}`];
    const note = SHWEP_WORK_NOTES[`${episodeNumber}|${w.author}|${w.work}`];
    const refs: EditionRef[] = [];
    for (const h of w.held) {
      const m = meta.get(h.id);
      if (!m) continue;
      const title = m.display_title || m.title || h.title;
      if (NOT_AN_EDITION.test(title)) continue;
      const language = m.language || h.language || 'Unknown';
      const { role, roleLabel } = classify(title, h.slug, language, workLanguage);
      refs.push({
        id: h.id,
        title,
        author: m.author,
        year: m.year || (m.published ? parseInt(m.published) : undefined) || undefined,
        language,
        role,
        roleLabel,
        translated: (m.pages_translated || 0) > 0,
        pagesCount: m.pages_count,
        url: `/book/${h.slug || h.id}`,
        alsoCopies: 0,
      });
    }

    const folded = foldCopies(refs);
    const { editions, moreEditions } = pickForDisplay(folded);
    entries.push({
      work: w.work,
      author: w.author,
      era: w.era,
      workLanguage: workLanguage && workLanguage !== 'Unknown' ? workLanguage : undefined,
      note: note || undefined,
      held: editions.length > 0,
      editions,
      moreEditions,
    });
  }

  // Held works first (they are the point of the page), then alphabetically by author.
  return entries.sort((a, b) => {
    if (a.held !== b.held) return a.held ? -1 : 1;
    return (a.author || '').localeCompare(b.author || '');
  });
}
