/**
 * ocr-eval-licences.mjs — which OCR-Eval reference passages may ship as text, and under what licence (#7462).
 *
 * PRIOR ART: the LICENSE_MAP that lived inline in scripts/eval/export-eval-dataset.mjs (v0.1–v0.3). It is moved
 * here unchanged in shape so the exporter and scripts/eval/build-ocr-eval-deposit.mjs read ONE table; the
 * exporter cannot be imported (it connects to Mongo at module load). quality-v1 uses its own rule (the record's
 * `licence` field, build-quality-dataset.mjs OPEN()), which these older ground-truth records do not carry.
 *
 * Each entry was checked on the source's own page on 2026-10-26 (#7462). The rule when it cannot be confirmed:
 * withhold the text (keep sha256 + a pointer). Never relabel CC BY-SA text as CC BY.
 *   - DTA: "unter einer Creative Commons Lizenz (CC BY-SA 4.0)" since 2020-06-16 (deutschestextarchiv.de/doku/nutzungsbedingungen).
 *   - Sefaria "Miqra according to the Masorah": the Sefaria API states license CC-BY-SA (not CC-BY, as v0.1–v0.3 said).
 *   - Sefaria "Shaarei Orah, grimoar": Public Domain. "Sefer HaYirah, Vilna 1886": unknown, so withheld.
 *   - Living Poets (Durham): only a site-wide default ("Creative Commons Attribution or Public Domain unless
 *     otherwise noted") over a passage that follows a modern critical text (Brugnoli–Stok 1997): not confirmed, withheld.
 */

/** source name → {license, include, spdx}. Matched by substring against the ground-truth record's `source`. First match wins. */
export const LICENSE_MAP = [
  { match: /First1KGreek/i, license: 'CC-BY-SA-4.0 (OpenGreekAndLatin First1KGreek)', spdx: 'CC-BY-SA-4.0', include: true },
  { match: /Wikisource/i, license: 'CC BY-SA 4.0 (Wikisource)', spdx: 'CC-BY-SA-4.0', include: true },
  { match: /Deutsches Textarchiv/i, license: 'CC BY-SA 4.0 (Deutsches Textarchiv)', spdx: 'CC-BY-SA-4.0', include: true },
  { match: /Living Poets/i, license: 'NOT CONFIRMED (Living Poets site default "CC BY or Public Domain unless otherwise noted"; the passage follows a modern critical text, Brugnoli–Stok 1997) — text NOT included', spdx: null, include: false },
  { match: /drbo\.org|Clementine Vulgate \(drbo/i, license: 'Public Domain (Clementine Vulgate text)', spdx: 'public-domain', include: true },
  { match: /Sefaria.*Sha'arei|Sha'arei_Orah/i, license: 'Public Domain (Sefaria he-version "Shaarei Orah, grimoar")', spdx: 'public-domain', include: true },
  { match: /Sefaria.*(Masoretic|Miqra)/i, license: 'CC BY-SA (Sefaria version "Miqra according to the Masorah")', spdx: 'CC-BY-SA', include: true },
  { match: /Sefaria/i, license: 'UNKNOWN (Sefaria he-version license not stated) — text NOT included', spdx: null, include: false },
  { match: /TITUS/i, license: 'TITUS terms forbid republication — text NOT included', spdx: null, include: false },
  { match: /ctext/i, license: 'ctext.org terms restrict redistribution — text NOT included', spdx: null, include: false },
];

export const UNKNOWN_LICENSE = { license: 'UNKNOWN — text NOT included', spdx: null, include: false };

export const licenseFor = (source) => LICENSE_MAP.find((l) => l.match.test(source || '')) || UNKNOWN_LICENSE;

export const RETRIEVAL_NOTE =
  "Fetch from source_url and locate the passage; verify integrity via reference_sha256 over the exact UTF-8 string. The repository's scripts/eval/reference-works/ files document the passage boundaries.";
