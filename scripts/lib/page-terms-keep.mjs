// PRIOR ART: scripts/maintenance/aggregate-page-terms.mjs — held the pilot keep rule inline;
// the rule now lives here so the typer, the aggregator and the unit tests apply ONE definition.
// None of scripts/lib/* selects page-term rows by evidence strength.
/**
 * Keep rules for the global page-terms table (#4695): which term_keys become rows in Mongo
 * `page_terms`. A rule is a pure function of ONE global row (as written by
 * aggregate-page-terms.mjs) and returns the reason it keeps the row, or null.
 *
 * `pilot` — the original rule. Any gloss, any non-Latin term, <term>-tagged in ≥2 books,
 *   verified original in ≥2 books, <vocab> in ≥3 books. Measured on the full corpus
 *   (2026-09-11, 63,709 books): keeps 5.18M of 11.6M groups — it grows linearly with the
 *   corpus because "has a gloss" and "non-Latin" are absolute filters, and most of what it
 *   keeps is one-off names, mottoes and OCR fragments.
 *
 * `bridge` — the proposed rule, sized by /root/keep-rule-sweep.mjs on Hetzner over the same
 *   table: 1,205,633 rows (281,682 non-Latin, 866,124 glossed). Keeps a row when ANY of:
 *     - script bridge: non-Latin term with a Latin-script gloss, in ≥2 books
 *     - synonym ring: ≥2 distinct glosses, in ≥3 books
 *     - <term>-tagged in ≥3 books
 *     - verified <note original> in ≥3 books
 *     - any term in ≥10 books
 *   The book floors are what stops the linear growth; samples confirmed it drops one-off
 *   names and mottoes while keeping recurring terms (names included — typing is a
 *   separate pass, scripts/lib/page-terms-type.mjs).
 *
 * The per-kind book counts the pilot rule needs (`term_books`, `orig_books`, `vocab_books`)
 * exist only in the SQLite group path; a caller that has only the global row passes the
 * total `books`, which is what the pilot rule always fell back to for glossed rows anyway.
 */
import { isLatinScript } from './page-terms-parse.mjs';

/** A gloss written in Latin script (the bridge condition). Empty/absent gloss → false. */
export const isLatinGloss = (g) => !!g && isLatinScript(g);

export const KEEP_RULES = {
  pilot(r, t = {}) {
    const books = r.books || 0;
    const glossed = (r.glosses?.length || 0) > 0;
    const nonLatin = r.non_latin ?? !isLatinScript(r.term_key);
    if (glossed) return 'gloss';
    if (nonLatin && books >= (t.minNonLatinBooks ?? 1)) return 'nonLatin';
    if ((r.kinds?.term || 0) > 0 && (r.term_books ?? books) >= (t.minTermBooks ?? 2)) return 'term2';
    if ((r.original_verified || 0) > 0 && (r.orig_books ?? books) >= (t.minOrigBooks ?? 2)) return 'orig2';
    if ((r.kinds?.vocab || 0) > 0 && (r.vocab_books ?? books) >= (t.minVocabBooks ?? 3)) return 'vocab3';
    return null;
  },
  bridge(r) {
    const books = r.books || 0;
    const glosses = r.glosses || [];
    const nonLatin = r.non_latin ?? !isLatinScript(r.term_key);
    if (books >= 10) return 'books10';
    if ((r.kinds?.term || 0) > 0 && books >= 3) return 'term3';
    if ((r.original_verified || 0) > 0 && books >= 3) return 'orig3';
    if (glosses.length >= 2 && books >= 3) return 'glosses2';
    if (nonLatin && books >= 2 && glosses.some((g) => isLatinGloss(g.gloss))) return 'bridge';
    return null;
  },
};

export const RULE_NAMES = Object.keys(KEEP_RULES);
