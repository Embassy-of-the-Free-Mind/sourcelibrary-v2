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
  spdx: 'CC-BY-SA-4.0',
  url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  attribution: 'Source Library (https://sourcelibrary.org)',
  terms: 'https://sourcelibrary.org/terms',
  original_texts: 'public-domain',
  tdm_reservation: 1,
  tdm_policy: 'https://sourcelibrary.org/licensing',
  ai_training: 'reserved — standard license available, see tdm_policy',
} as const;

export type ContentLicense = typeof CONTENT_LICENSE;
