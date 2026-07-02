/**
 * Client-safe constants + types for the Marcianus 299 ↔ Berthelot reading
 * overlay. Kept separate from `marcianus-overlay.ts` so client components can
 * import the book id / response shape WITHOUT pulling the ~20 KB concordance
 * JSON (server-only) into the browser bundle.
 *
 * Design + rationale: .claude/docs/edition-facsimile-pairing.md
 */

/** Marcianus graecus Z. 299 — the manuscript this overlay applies to. */
export const MARCIANUS_BOOK_ID = '6a45298cc6d95bc278fbc8c3';

/** Berthelot & Ruelle, Collection des anciens alchimistes grecs (Greek text vol). */
export const BERTHELOT_BOOK_ID = '6994383a6879ff0184cb803a';

/** Verbatim heading over the promoted critical-edition reading text. */
export const BERTHELOT_LAYER_LABEL = 'Critical edition · Berthelot & Ruelle 1887–88';

/**
 * Short flag + tooltip for the demoted manuscript-OCR body. Shared so the
 * reader panel header (client) and the API payload (server) stay in sync.
 */
export const MANUSCRIPT_OCR_FLAG = {
  label: 'Rough AI transcription — flagged',
  tooltip:
    'Unverified — this folio’s OCR may contain fabricated wording; check the critical edition or facsimile before quoting.',
};

/** One confidence chip: label + honest tooltip + a design-token colour class. */
export interface OverlayBadge {
  label: string;
  tooltip: string;
  /** Existing status-token classes only — no new design primitives. */
  className: string;
}

/** Payload returned by GET /api/books/[id]/paired-edition. */
export interface PairedEditionResponse {
  paired: {
    folio: string;
    bertPage: number;
    citation: string;
    /** Berthelot's Greek transcription, editorial wrappers stripped. */
    transcription: string;
    /** Berthelot's English translation, editorial wrappers stripped. */
    translation: string;
    badges: OverlayBadge[];
    /** Provenance/quality note for this folio (record-level honesty). */
    provenanceNote: string;
    /** Short flag + tooltip for the demoted manuscript-OCR body. */
    ocrFlag: { label: string; tooltip: string };
  } | null;
}
