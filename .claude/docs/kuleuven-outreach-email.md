# KU Leuven Libraries — outreach email (draft)

**To:** KU Leuven Libraries — Digitisation / Heritage Collections (LIBIS)
Suggested recipients: the Maurits Sabbe Library / Special Collections heritage team, or
the LIBIS digitisation contact (e.g. via `bibliotheek@kuleuven.be` / the "Enriching
Heritage" group — Nele Gabriels has been the public voice of their open-reuse policy).

**Subject:** Re-hosting & AI-translating your public-domain digitised collections on Source Library

---

Dear KU Leuven Libraries team,

I'm writing from **Source Library** (sourcelibrary.org), a non-profit digital library that
re-hosts historical primary sources — alchemy, Hermetica, early-modern science, theology and
adjacent traditions — and makes them *readable and quotable* with AI-assisted OCR and
translation. We credit every contributing institution with its own page and link back to the
original record; readers discover the holding library rather than leaving it behind.

We've been admiring your digitised heritage — the incunabula, the 17th-century Flanders
*Jesuitica*, the books of hours and the Maurits Sabbe collections — and your public open-reuse
policy on the ~42,000 public-domain images. Your IIIF setup (Rosetta / `lib.is` manifests and
the bespoke `sharedcanvas.be` collections) is exactly the kind of clean, standards-based
infrastructure we can ingest directly.

We'd love to re-host a curated subset of your public-domain digitisations and add AI English
translation on top — turning facsimiles into texts a wider public can actually read — always
with clear KU Leuven attribution and a link back to your records. Two small asks that would let
us do this well:

1. **A list of your digitised public-domain items** — ideally an OAI-PMH set, a CSV of
   IE/PIDs, or a IIIF Collection manifest. We can harvest item-by-item from Primo, but an
   authoritative export means we credit and link everything correctly and avoid duplicating
   what you'd rather we didn't.
2. **A quick confirmation of the licence/attribution wording** you'd like us to display
   (e.g. "Digitised by KU Leuven Libraries, CC BY-NC 4.0 / public domain").

If it's useful, we're also happy to share back our OCR/translation output for any items we
process, so the enriched text can flow into your own systems.

Could we set up a short call? I'd be glad to walk you through how we present partner
collections and how attribution works.

With appreciation for the open stance you've taken on heritage reuse,

Derek Lomas
Source Library — sourcelibrary.org
[role / affiliation]

---

## Internal notes (not part of the email)

- **Why partnership beats scraping:** their digitisation is split across two platforms
  (Rosetta/Teneo → `lib.is/IE…/manifest`, and bespoke `sharedcanvas.be`), and Primo has **no
  clean "digitised by us" facet** — the only per-record signal is an `edelivery` POST returning
  a `resolver.libis.be/IE…` link. A direct export removes that fragility and gives us an
  authoritative attribution list.
- **Import path is ready:** `lib.is/IE…/manifest` is IIIF v3 and parses with our existing
  `/api/import/iiif` handler — no new connector needed, just a `LIBRARY_PARTNERS` entry
  (`src/lib/library-partners.ts`).
- **Licence:** sampled manifests are CC BY-NC 4.0 / public-domain; confirm per-item before
  re-hosting (BY-NC is fine for our non-profit re-host with attribution).
- **The automated gap census** (`scripts/research/kuleuven-gap-harvest.mjs`) gives us the
  what-they-have-that-we-don't list in the meantime, so we can lead the conversation with a
  concrete first batch we'd like to import.
