/**
 * Server-side accessor for the Marcianus 299 ↔ Berthelot reading overlay.
 *
 * NON-DESTRUCTIVE read-time join: for a Marcianus folio, look up the aligned
 * Berthelot page (via the bundled concordance) and surface Berthelot's critical
 * Greek + English as the reading text of record, while the manuscript's own OCR
 * is demoted to a flagged aid. Nothing in `pages.ocr.data` / `translation.data`
 * is ever mutated. See .claude/docs/edition-facsimile-pairing.md.
 *
 * The concordance JSON is imported here (server-only). Client components should
 * import from `./marcianus-overlay.shared` to avoid bundling it.
 */
import type { Db } from 'mongodb';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import overlay from '@/data/marcianus-berthelot-overlay.json';
import {
  MARCIANUS_BOOK_ID,
  BERTHELOT_BOOK_ID,
  BERTHELOT_LAYER_LABEL,
  MANUSCRIPT_OCR_FLAG,
  type OverlayBadge,
  type PairedEditionResponse,
} from './marcianus-overlay.shared';

export { MARCIANUS_BOOK_ID, BERTHELOT_BOOK_ID, BERTHELOT_LAYER_LABEL };

interface OverlayEntry {
  folio: string;
  marc_id: string;
  bert_page: number;
  bert_pages: number[];
  self: number | null; // pass1-vs-pass2 OCR Dice (stability)
  cover: number | null; // OCR-in-Berthelot coverage — LOWER BOUND, never shown as a number
}

const byMarcPage = overlay.by_marc_page as Record<string, OverlayEntry>;
// Secondary index on the Marcianus page id (marc_id === pages.id).
const byMarcId = new Map<string, OverlayEntry>();
for (const e of Object.values(byMarcPage)) byMarcId.set(e.marc_id, e);

/**
 * Stability threshold: dice ≥ 0.55 reads as "Stable". 0.55 sits just under the
 * empirical p25 (0.571), so it flags the genuine dense-narrative tail without
 * over-flagging the median folio. See the doc's confidence-layer section.
 */
const STABLE_DICE = 0.55;

/** Look up the overlay entry for a Marcianus folio by page id or page number. */
export function getMarcianusOverlayEntry(opts: {
  pageId?: string | null;
  pageNumber?: number | null;
}): OverlayEntry | null {
  if (opts.pageId && byMarcId.has(opts.pageId)) return byMarcId.get(opts.pageId)!;
  if (opts.pageNumber != null && byMarcPage[String(opts.pageNumber)]) {
    return byMarcPage[String(opts.pageNumber)];
  }
  return null;
}

/** Build the honest per-folio confidence chips (two additive signals). */
function buildBadges(entry: OverlayEntry): OverlayBadge[] {
  const badges: OverlayBadge[] = [];

  // (1) Stability — self-agreement of two independent OCR passes.
  if (entry.self != null) {
    if (entry.self >= STABLE_DICE) {
      badges.push({
        label: 'Stable',
        className: 'bg-status-success/10 text-status-success',
        tooltip:
          "Two independent AI passes agree on most of this folio's word-tokens — one of the more consistent folios in this manuscript. This is a relative stability signal, not a verified-accurate rating; the transcription is still unverified against the facsimile.",
      });
    } else {
      badges.push({
        label: 'Unstable',
        className: 'bg-status-warning/10 border border-status-warning/20 text-status-warning',
        tooltip:
          "Two independent AI passes disagree on much of this folio's wording — one of the least stable folios in this manuscript, a sign the model may be interpolating (inventing plausible-looking text) rather than reading it. Treat this folio's transcription with extra caution.",
      });
    }
  }

  // (2) Critical-edition availability — a boolean fact (never the coverage number).
  badges.push({
    label: 'Critical edition available',
    className: 'bg-status-info/10 border border-status-info/20 text-status-info',
    tooltip:
      "This folio is matched, page for page, to Berthelot & Ruelle's 1887–88 critical edition of the Greek text. Read their transcription as the text of record; our AI transcription is a rough, unverified aid.",
  });

  return badges;
}

const PROVENANCE_NOTE =
  "This manuscript's Greek transcription is AI-assisted and unverified. Where a critical edition is aligned, read that as the text of record — verify any quotation against it or the facsimile before citing the Greek.";

const OCR_FLAG = MANUSCRIPT_OCR_FLAG;

/**
 * Fetch + assemble the full paired-edition payload for a Marcianus folio.
 * Returns `{ paired: null }` when the folio has no aligned Berthelot page or the
 * Berthelot page carries no usable text.
 */
export async function getPairedEdition(
  db: Db,
  opts: { pageId?: string | null; pageNumber?: number | null },
): Promise<PairedEditionResponse> {
  const entry = getMarcianusOverlayEntry(opts);
  if (!entry) return { paired: null };

  const bertPage = (await db.collection('pages').findOne(
    { book_id: BERTHELOT_BOOK_ID, page_number: entry.bert_page },
    { projection: { _id: 0, 'ocr.data': 1, 'translation.data': 1 }, maxTimeMS: 5000 },
  ).catch(() => null)) as { ocr?: { data?: string }; translation?: { data?: string } } | null;

  // Editorial-wrapper stripping BEFORE the text leaves the server (quote-safety
  // per CLAUDE.md). NotesRenderer on the client then handles the remaining real
  // page-marks / <note> apparatus + any markdown.
  const transcription = stripEditorialWrappers(bertPage?.ocr?.data || '').trim();
  const translation = stripEditorialWrappers(bertPage?.translation?.data || '').trim();
  if (!transcription && !translation) return { paired: null };

  return {
    paired: {
      folio: entry.folio,
      bertPage: entry.bert_page,
      citation: overlay.berthelot_citation,
      transcription,
      translation,
      badges: buildBadges(entry),
      provenanceNote: PROVENANCE_NOTE,
      ocrFlag: OCR_FLAG,
    },
  };
}
