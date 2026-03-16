# Source Library — The Case for Support

## The Claim: World's Largest Library of Translated Ancient Texts

Source Library is the world's largest library of translated premodern texts. This is a verifiable claim.

### The numbers (as of March 2026)

| Metric | Source Library |
|--------|---------------|
| **Total books** | 10,199 |
| **Books with English translation** | 4,305 |
| **Total pages** | 3,730,262 |
| **Pages with OCR** | 1,255,091 |
| **Pages translated** | 804,425 |
| **Languages represented** | 15+ (Latin, German, Greek, Chinese, Sanskrit, Sumerian, Syriac, Hebrew, French, Italian, Dutch, Russian, and more) |
| **Growth rate** | ~3,400 books/month |

### How this compares

| Platform | Translated works | Access | Scope |
|----------|-----------------|--------|-------|
| **Source Library** | **4,305 books (804K pages)** | **Free, open access** | **Ancient–early modern, all traditions** |
| Perseus Digital Library (Tufts) | 2,412 works | Free | Greek and Roman classics |
| Sacred-texts.com | ~1,700 books | Free | Religious and esoteric texts |
| Loeb Classical Library (Harvard) | 550 volumes | $195/year subscription | Greek and Roman classics |
| Internet Classics Archive (MIT) | 441 works | Free | Greek, Roman, Chinese, Persian |
| Early Modern Texts | ~100 texts | Free | Early modern philosophy |

**Source Library is larger than Perseus, Loeb, Sacred-texts, and the Internet Classics Archive combined.**

### What makes the claim precise

The claim is specifically: *world's largest library of translated ancient texts*. Clarifications:

- **"Translated"** — We don't count collections of scanned images without translation (EEBO has 146,000 scans of English books, but those aren't translations). We don't count collections of texts in their original language only. Source Library takes texts in Latin, German, Greek, Sanskrit, Sumerian, Chinese, etc. and translates them into English.
- **"Ancient"** — Premodern texts. Not a general ebook collection (Project Gutenberg has 77,000 ebooks, but mostly modern English-language works). Source Library spans from Sumerian cuneiform to 18th-century European texts.
- **"Library"** — Structured, searchable, citable. Not a PDF dump. Every book has metadata, page-level URLs, and structured translations that can be cited in scholarship.
- **Free** — No paywall, no institutional subscription. This distinguishes us from Loeb ($195/year), JSTOR (institutional), and EEBO (ProQuest subscription). But the claim doesn't depend on this qualifier — we exceed these platforms even on raw scale.

### What we don't claim

We don't claim to replace Perseus or Loeb. Those collections have hand-curated scholarly translations with extensive commentary. Source Library uses AI translation to achieve *scale* — translating thousands of texts that would otherwise never be translated at all, because no human translator would spend years on an obscure 1540 alchemical treatise in Latin.

The honest framing: **"For the first time, the long tail of historical texts — the 95% that will never get a scholarly translation — is becoming readable."**

---

## Current State: What Exists Today

### Collection breadth

| Language | Books | % of Collection |
|----------|-------|-----------------|
| Latin | 3,112 | 31% |
| English | 1,174 | 12% |
| German | 1,139 | 11% |
| Greek | 675 | 7% |
| Chinese | 578 | 6% |
| French | 411 | 4% |
| Sumerian | 376 | 4% |
| Sanskrit | 326 | 3% |
| Russian | 313 | 3% |
| Italian | 223 | 2% |
| Dutch | 159 | 2% |
| Syriac | 113 | 1% |
| Hebrew | 67 | 1% |
| Other | ~1,500 | 15% |

This is not just a collection of Renaissance European texts. It spans 5,000 years of human writing — from Sumerian tablets to Enlightenment treatises, from Sanskrit hymns to Syriac Christian manuscripts.

### Processing pipeline

The pipeline works in three stages:
1. **Import** — Book scans ingested from Internet Archive, Gallica, HathiTrust, or direct upload
2. **OCR** — AI reads every page image and produces searchable original-language text (1.25M pages done)
3. **Translation** — AI translates original text into English with context continuity across pages (804K pages done)

Current throughput: **~3,400 new books per month** (import + OCR + translation).

### Infrastructure & Costs

Validated from actual spend (gemini_usage DB + billing):

| Component | Service | Monthly Cost |
|-----------|---------|-------------|
| AI processing (OCR + translation) | Google Gemini API | **~$8,000–10,000/mo** (at current scaling pace) |
| Database | MongoDB Atlas (M40) | ~$760/mo |
| Hosting, functions, blob storage | Vercel | ~$200–400/mo |
| Worker compute | AWS Lambda | ~$10–15/mo |
| Image processing server | Hetzner (cax31) | ~$12/mo |
| **Total operating cost** | | **~$9,000–11,000/mo** |

**Actual AI spend to date:**
- January 2026: $81
- February 2026: $6,969 (scaling began)
- March 2026 (projected): ~$10,300
- **Total through March 2026: ~$17,400**

**Cost per book (validated from DB):** **$1.54** average (OCR + translation + metadata + image descriptions, across 7,560 processed books).

**Cost per translated page:** **$0.004** (less than half a cent).

This is the key insight: **AI has made translation 10,000x cheaper than human translation.** A professional Latin translator charges $0.15–0.30 per word; a 300-page book costs $15,000–$50,000 to translate by hand. Source Library does it for **$1.54**.

---

## Growth Trajectory

### Current rate projection

At ~3,400 books/month:

| Milestone | Date | Books |
|-----------|------|-------|
| Beta launch | March 2026 | 10,200 |
| 6 months | September 2026 | ~30,000 |
| 12 months | March 2027 | ~50,000 |
| 24 months | March 2028 | ~90,000 |
| 36 months | March 2029 | ~130,000 |

### The IIIF opportunity: 150,000 books

IIIF (International Image Interoperability Framework) is the open standard used by major research libraries to publish digitized books. It provides a standardized way to access high-resolution page images and metadata — exactly what Source Library's pipeline needs as input.

**IIIF collections available today:**

| Library | Digitized items | IIIF status |
|---------|----------------|-------------|
| Bayerische Staatsbibliothek (Munich) | 3.1M items | 100% IIIF |
| Bibliothèque nationale de France (Gallica) | 10M documents | Full IIIF |
| e-rara.ch (Swiss digital library) | 100,000 titles | Full IIIF |
| Bodleian Library (Oxford) | 900,000+ images | Full IIIF |
| Internet Archive | Millions | Full IIIF (2023+) |
| Biblissima aggregator | 60,000 manifests (pre-1800) | Aggregated IIIF |
| Europeana | 300,000+ IIIF records | Full IIIF |
| POLONA (Poland) | 3M+ objects | Full IIIF |
| University of Heidelberg | 6,900 manuscripts + 1,800 incunabula | Full IIIF |

**The supply of digitized historical books vastly exceeds our current capacity to process them.** There are hundreds of thousands of pre-1800 texts sitting in IIIF-enabled repositories right now, already scanned in high resolution, waiting to be OCR'd and translated.

Reaching 150,000 books requires:
1. **Building IIIF import pipelines** — automated discovery and ingestion from major IIIF collections
2. **Scaling OCR/translation compute** — more Gemini API throughput, more Lambda workers
3. **Quality assurance** — editorial review of AI translations at scale
4. **Infrastructure** — larger database, faster search, better metadata

This is primarily an engineering and compute problem, not a content acquisition problem. The books are already digitized and freely available. We just need to process them.

### Beyond IIIF: Supporting scanning of undigitized texts

IIIF gets us to 150,000, but the Bibliotheca Philosophica Hermetica alone holds 25,000+ texts, many not yet digitized. Other major collections (Warburg Institute, Wellcome Collection, university special collections) hold thousands more.

**Phase 2 fundraising** would support:
- Digitization equipment at the Embassy of the Free Mind
- Partnerships with European libraries for scanning access
- Conservation assessment before scanning fragile texts
- Professional cataloging and metadata for undigitized holdings

---

## Immediate Financial Needs

### What we've spent

Total hard costs through mid-March 2026: **~$20,000** — mostly in the past month as we've scaled translation aggressively. The bulk is Gemini API ($17K), plus infrastructure (MongoDB, Vercel, Lambda).

We are currently translating **40,000+ pages per day** and targeting **10,000 complete book translations by end of March**.

### The funding math

Donations to Source Library go through NAF (fiscal sponsor) for the Embassy of the Free Mind. **NAF and the Embassy take 35%** for overhead, fiscal sponsorship fees, and institutional support. So:

| Gross donation | Net to Source Library operations |
|---------------|--------------------------------|
| $50,000 | ~$32,500 |
| $100,000 | ~$65,000 |
| $250,000 | ~$162,500 |
| $500,000 | ~$325,000 |

### Immediate need: $50K more

We've spent ~$20K in hard costs. To sustain our current pace and reach 10,000 translations by month's end, then push toward 100K by June, we need approximately **$50,000 in the next 30 days** for:

1. **AI processing** (~$30K) — Gemini API at $8–10K/mo for the next 3 months
2. **Infrastructure** (~$5K) — MongoDB Atlas, Vercel, Lambda for 3 months
3. **Legal advice** (~$5K) — IP, licensing, nonprofit structure review
4. **PR support** (~$5K) — Press release distribution, media outreach for beta launch
5. **First hire or contractor** (~$5K) — Editorial/scholarly review, or part-time ops

### What $250K buys: 100K translated texts by June

The validated cost per book is **$1.54**. At that rate:

| Milestone | Books | AI cost | Infra cost | Total |
|-----------|-------|---------|------------|-------|
| Current (done) | 10K | $17K | $3K | $20K |
| March target | 10K translations | +$15K | +$3K | +$18K |
| By June (100K books) | +90K | +$139K | +$15K | +$154K |
| **Total to reach 100K** | **100K** | **$171K** | **$21K** | **~$192K** |

With the 35% overhead, reaching 100K texts by June requires **~$250K gross fundraising**.

### The bigger picture: Scanning the Renaissance

Source Library can translate any digitized book. But **less than 1/5 of the Renaissance has been scanned**. The digitized corpus available via IIIF is ~150K–250K books. Beyond that:

- The Bibliotheca Philosophica Hermetica (Embassy of the Free Mind) holds 25,000+ texts, many unscanned
- The Warburg Institute, Wellcome Collection, and dozens of European special collections hold thousands more
- **Scanning is 100x more expensive than translating** — requires physical access, equipment, conservation assessment

Phase 2 fundraising (post-June) shifts from translation to **digitization partnerships** — funding scanning equipment, library access agreements, and conservation work to unlock the other 80% of Renaissance texts.

### What each gift level buys

| Gift | Impact |
|------|--------|
| **$100** | Translates 65 books from Latin to English |
| **$500** | Translates an entire subject area (e.g., all available Paracelsus texts) |
| **$1,000** | Translates 650 books — more than the entire Loeb Classical Library |
| **$5,000** | Translates 3,250 books — covers all of Renaissance alchemy |
| **$10,000** | Funds one month of full-scale operations |
| **$50,000** | Funds 3 months of scaling + first hire |
| **$100,000** | Gets us from 10K to 50K books (net of overhead) |
| **$250,000** | Gets us to 100K books by June — the entire digitized Renaissance |

### What happens without funding

The library will continue to grow slowly using personal funds — perhaps 1,000 books/month instead of 10,000+. The IIIF opportunity goes unrealized. Texts that could be translated in weeks will wait years. The window to establish Source Library as the definitive platform — before a well-funded competitor builds one — narrows.

**The AI translation window is open now.** Gemini pricing has dropped 10x in 18 months and continues to fall. But someone needs to build the infrastructure, curate the collection, and establish the scholarly credibility while the window is open. That's what this funding enables.

---

## The Bottom Line

Source Library is already the world's largest library of translated ancient texts. With 10,199 books and 804,000 translated pages, it surpasses Perseus, Loeb, Sacred-texts, and the Internet Classics Archive combined.

But this is just the beginning. 150,000–250,000 digitized historical texts are sitting in IIIF-enabled repositories across Europe, already scanned, waiting to be made readable. The AI technology exists. The pipeline exists. The cost per book is $1.54.

**$250K by June translates 100,000 books — the entire digitized Renaissance.** After that, the mission shifts to scanning the other 80% that hasn't been digitized yet — a bigger, longer, and more costly effort that will require a permanent humanistic cultural organization, not just a campaign.
