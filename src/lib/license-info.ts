/**
 * Canonical machine-readable license block for content API responses.
 *
 * Embedded in JSON payloads so the license and the TDM/AI-training
 * reservation travel INSIDE the data — bulk consumers keep the payload,
 * not the HTTP headers set in next.config.ts. Companion to the site-wide
 * TDMRep declarations (/.well-known/tdmrep.json, TDM-Reservation header,
 * tdm-reservation meta tags). Full terms + rate card: /licensing.
 *
 * Keep this the single source of truth — don't re-inline the block in new
 * routes, and don't put dollar figures here (prices live on /licensing only).
 */
export const CONTENT_LICENSE = {
  spdx: 'CC-BY-NC-SA-4.0',
  url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  attribution: 'Source Library (https://sourcelibrary.org)',
  terms: 'https://sourcelibrary.org/terms',
  original_texts: 'public-domain',
  tdm_reservation: 1,
  tdm_policy: 'https://sourcelibrary.org/licensing',
  ai_training: 'commercial use needs a license, see tdm_policy',
} as const;

export type ContentLicense = typeof CONTENT_LICENSE;

/** Human-readable name of CONTENT_LICENSE, for Dublin Core and plain-text lines. */
export const CONTENT_LICENSE_NAME = 'CC BY-NC-SA 4.0';

/**
 * The Dublin Core rights statement for a book: its stored `dublin_core.dc_rights`,
 * or our own licence when there is none.
 *
 * `scripts/migration/backfill-dublin-core.mjs` wrote our licence of the day,
 * the exact string 'CC BY-SA 4.0', into dc_rights on ~9K books (7,777 visible,
 * measured 2026-11-09; their source licences live in image_source.license). That
 * value states OUR text's licence, which is CC BY-NC-SA since 2026-11-05, so it
 * is read as the current one here rather than rewritten in Mongo (#8488). Any
 * other stored value (a holding library's statement) is passed through as said.
 */
export function dcRightsForBook(stored: string | null | undefined): string {
  if (!stored || stored === 'CC BY-SA 4.0') return CONTENT_LICENSE_NAME;
  return stored;
}

/**
 * One-line form of the reservation for plain-text exports (.txt, downloads, PDF
 * colophon). A file saved to disk loses our headers, so it carries the
 * reservation next to its licence line, as the JSON payloads do.
 */
export const AI_TRAINING_NOTICE =
  'Commercial AI training and bulk text-and-data-mining are reserved (EU Directive 2019/790, Art. 4); license terms: https://sourcelibrary.org/licensing';
