# Source Library: A Program of the Embassy of the Free Mind

**Strategic Plan 2026-2029**
**Draft: February 25, 2026**

---

## What Source Library Is

Source Library is the Embassy of the Free Mind's program to make humanity's pre-modern intellectual heritage accessible — translated, searchable, and readable — for the first time in history.

The Bibliotheca Philosophica Hermetica, housed at the Embassy of the Free Mind in Amsterdam, is one of the world's most important collections of rare Hermetic, alchemical, Kabbalistic, and Rosicrucian works. But the problem Source Library addresses is far larger than any single collection. Across the world's libraries and archives, hundreds of thousands of pre-modern texts sit digitized but unread — photographed but never transcribed, never translated, invisible to scholars and the public alike. Written in Latin, Greek, Arabic, Sanskrit, Classical Chinese, Early Modern German, and Hebrew, they represent the accumulated intellectual output of every major civilization before the modern era.

Until recently, translating this material was impossibly expensive. A professional Latin translator charges $15,000-50,000 per book and takes months. AI has collapsed that cost by four orders of magnitude. But cost was never the only barrier. The deeper challenge is curation — knowing what exists, what matters, how texts relate to each other, and how to make them useful to researchers. That's the work Source Library does: it combines AI processing with scholarly judgment to build the first comprehensive, translated, machine-readable library of pre-modern thought.

---

## What We've Built (Dec 2025 - Feb 2026)

In three months, with two people, we built the infrastructure and proved the model:

**The collection:** 4,430 books from 15 institutional archives (Internet Archive, Gallica, Bavarian State Library, Vatican Library, Bodleian, Cambridge, Library of Congress, and others). 1.67 million page images. 30+ languages. Texts spanning the 1st through 18th centuries.

**The processing pipeline:** A fully autonomous system that takes a raw book scan and produces: OCR transcription, English translation, reading summary, structured index (people, places, concepts, key passages), chapter structure, and illustration catalog with museum-quality metadata. 1,077 books have been processed end-to-end. 467,000 pages transcribed. 285,000 pages translated. 71,000 illustrations catalogued with AI-generated descriptions. 130,000 cross-referenced entities extracted.

**The platform:** A reader with side-by-side original/translation view. Full-text search across all translations. An illustration gallery. An encyclopedia of cross-referenced people, places, and concepts. Curated thematic collections. A timeline view. Scholarly editions with DOI minting.

**The API layer:** An MCP server (published on npm) that lets any AI system search the library, retrieve translated text, find quotes, and browse illustrations. 14 tools for programmatic access. Source Library is not just a website — it's a knowledge layer that other systems can query.

**Total AI processing cost to date: ~$3,400.** Two million Gemini API calls. The technology works.

---

## Why This Matters

### The knowledge gap is real and growing

The intellectual traditions that shaped the modern world — Greek philosophy, Roman law, Islamic science, Chinese statecraft, Indian mathematics, Renaissance Hermeticism, Reformation theology — were written in languages that fewer people read every year. University departments in classics, theology, medieval studies, and Oriental languages are contracting globally. The scholars who can read Neo-Latin or Syriac or Classical Chinese are retiring, and they are not being replaced at the same rate.

At the same time, these texts are more relevant than ever. The history of science, the origins of religious thought, the development of political philosophy, the roots of modern medicine — all of it lives in primary sources that most researchers can only access through fragments and secondary accounts. AI systems being trained today have essentially zero access to pre-modern primary sources. Their understanding of intellectual history comes from Wikipedia summaries and modern textbooks, not from the texts themselves.

### The EFM's unique position

The Embassy of the Free Mind sits at the intersection of the two things this project requires: world-class collections and a mission to make them accessible. The Bibliotheca Philosophica Hermetica is unmatched in its holdings of Western esoteric tradition texts. But Source Library's ambition extends beyond esotericism — it encompasses the full breadth of pre-modern thought across civilizations. The EFM provides the institutional home, the curatorial expertise, the physical collections, and the scholarly network. Source Library provides the technology and the scale.

### The AI moment

We are in a narrow window where three things are simultaneously true:

1. **AI translation is good enough to be useful** — not publication-grade, but accurate enough for research, discovery, and first-pass reading. This was not true two years ago.
2. **The source material is digitized** — hundreds of thousands of texts have been photographed by archives worldwide over the past two decades. The raw material exists.
3. **The scholars who can validate and improve the work are still active** — but this window is closing as specialists retire without replacement.

In five years, the AI will be better but the human expertise will be scarcer. The time to build the bridge is now, while both exist.

---

## The Program: $1M/Year

### Year 1 (2026): Build the Institution

**Goal:** Transform Source Library from a two-person project into a staffed program with scholarly credibility, institutional partnerships, and public visibility. Complete and quality-assure the existing 4,430-book collection. Begin systematic expansion.

#### Team ($220K)

Source Library's core strength is that the AI pipeline runs autonomously — the team is lean by design. Most of the budget goes to the work, not to salaries.

| Role | Focus | Cost |
|---|---|---|
| **Program Director** (Derek Lomas) | Strategy, fundraising, AI pipeline, technology, partnerships | $100K |
| **Head of Collections** | Curation, metadata, QA, archive relationships, import prioritization, scholarly liaison | $80K |
| **Operations / Communications** (part-time) | Newsletter, social media, press, donor relations, event coordination | $40K |

Development and infrastructure maintenance is handled by the Program Director. Additional technical capacity is contracted as needed.

#### Scanning & Digitization ($250K)

The most irreplaceable thing money can buy. AI can translate a scan; it cannot create one. Every book we scan is a primary source that may exist in only 1-3 copies worldwide, made permanently accessible for the first time.

The EFM's Bibliotheca Philosophica Hermetica holds ~25,000 volumes — one of the world's most important collections of Hermetic, alchemical, and esoteric works. Much of it has never been digitized. Beyond the EFM, thousands of significant texts sit in European rare book rooms, never photographed.

| Program | Scope | Cost |
|---|---|---|
| **EFM collection digitization** | 800 priority titles from the Bibliotheca Philosophica Hermetica not available online. Hire a dedicated scanner/photographer for the EFM reading room. | $80K |
| **Partner library scanning** | 500 titles at 5 European institutions (HAB Wolfenbuttel, BSB Munich, Warburg Institute, Wellcome, Leiden). Negotiate access agreements, fund on-site scanning. | $80K |
| **Commissioned scanning** | 200 high-priority manuscripts and rare printings identified by advisory board scholars — texts they know exist but can't access digitally. | $60K |
| **Equipment & conservation** | Professional book cradle, overhead camera systems, portable scanning kit for travel. Conservation supplies for fragile bindings. | $20K |
| **Travel** | Staff and equipment travel to partner libraries across Europe. | $10K |

This produces **~1,500 newly digitized titles/year** — texts that have *never been available online before*. Each one goes through the full Source Library pipeline. Over 3 years, that's 4,500 new primary sources added to the world's digital commons.

#### AI Processing & Infrastructure ($80K)

| Item | Cost |
|---|---|
| Gemini API (OCR, translation, indexing, image analysis) | $40K |
| AWS Lambda workers, SQS queues | $10K |
| MongoDB Atlas, Vercel hosting, Vercel Blob storage | $15K |
| Image archiving and CDN | $5K |
| Development tools, monitoring, backups | $5K |
| Contingency (model price changes, scale-up) | $5K |

$40K in Gemini API at current rates processes roughly 40,000 books through the full pipeline — more than enough for the entire existing collection plus all new imports and rescans. AI processing is the cheapest part of this program.

#### Scholarly Program ($250K)

This is where Source Library earns legitimacy. The AI produces first drafts; scholars produce scholarship.

| Program | Description | Cost |
|---|---|---|
| **Advisory Board** | 10-12 scholars across fields (Renaissance studies, Islamic philosophy, Sinology, Indology, history of science, digital humanities, Kabbalah, early modern science). Meet quarterly. Review collection priorities, validate translation quality, co-sign editions. Annual in-person meeting at EFM Amsterdam. | $40K (honoraria + travel) |
| **Visiting Scholars** (6/year) | 3-month residencies at EFM or virtual. Scholar works intensively with a subset of the collection — annotating, correcting translations, writing contextual introductions, identifying cross-references. Co-authorship on resulting editions. Priority: scholars who bring expertise in underrepresented traditions (Arabic, Chinese, Sanskrit, Hebrew). | $90K (stipends + housing) |
| **Edition Publishing** | 30 peer-reviewed scholarly editions with DOIs, front matter, critical apparatus. Each reviewed by an advisory board member or visiting scholar. Priority: first-ever English translations of significant works from the EFM collection. | $30K |
| **Conference Presence** | RSA, ADHO, History of Science Society, ESSWE, IACR, relevant area studies conferences. Not just presentations — host workshops and panels. "Translating the Archive: AI and Pre-Modern Texts" as a recurring workshop series. | $30K |
| **Research Commissions** | Commission 5 original research essays using Source Library data — computational analysis, cross-tradition comparison, network mapping. Publish on the platform and in journals. Pay scholars to do real work with the collection, not just advise. | $30K |
| **Methodology Publications** | 2-3 peer-reviewed papers documenting the AI translation pipeline, quality assessment, and implications for digital humanities. Target: Digital Humanities Quarterly, Digital Scholarship in the Humanities, JOCCH. | $10K |
| **Course Materials** | Curated "teaching collections" for 15 university courses (Renaissance Philosophy, History of Alchemy, Islamic Golden Age, Chinese Classics, Reformation Theology, etc.). Free to educators. Partner with 5 universities to pilot in real courses. | $20K |

#### Marketing & Public Engagement ($180K)

Source Library has a story that the public cares about: ancient texts, AI translation, hidden knowledge made accessible. Most academic projects fail at storytelling. This one shouldn't.

| Channel | Activity | Cost |
|---|---|---|
| **Press & PR** | Dedicated press officer (part-time, 9 months). Target: Guardian, NYT culture, Wired, Nature, Chronicle of Higher Education, De Volkskrant, NRC. Lead with "first-ever translations" — every significant first translation is a press story. Monthly press releases. | $40K |
| **Documentary series** | Commission 6-8 short films (5-10 min each): the EFM collection and its history, the AI translation process, a scholar reading a text for the first time, the illustrations and what they reveal, the scanning process at a partner library. Professional production. Distribute on YouTube, social media, and at events. | $50K |
| **Website & brand** | Redesign for institutional credibility. Donor recognition. Impact dashboard (live stats). Case studies showing what scholars have found. Mobile experience. | $20K |
| **Events at EFM** | 4 public events/year at EFM Amsterdam: launch, annual lecture, 2 salon-style evenings pairing scholars with the public. Livestreamed. | $20K |
| **Newsletter & social** | Monthly newsletter: newly translated texts, discoveries, featured illustrations, scholar profiles, scanning updates. AI-powered social media pipeline (already built) + Instagram + academic Bluesky. | $10K |
| **Patron program** | "The Ficino Circle" — donors who fund specific books. Each patron acknowledged in the scholarly edition of the book they funded. Quarterly updates showing their book's progress through the pipeline. Annual patron gathering at EFM. | $15K |
| **Exhibition** | One traveling exhibition: "Hidden in Plain Sight — AI Reveals 500 Years of Lost Knowledge." 20 large-format prints of illustrations with translations. Show at EFM, then 2-3 partner institutions. | $25K |

#### Contingency & Legal ($20K)

Copyright review for pre-1928 texts (most are public domain). Legal structure for data licensing agreements. Insurance.

---

### Year 1 Milestones

| Quarter | Milestone |
|---|---|
| **Q2 2026** | All 4,430 existing books fully processed. Advisory board of 10-12 scholars convened. Dedicated EFM scanner hired and producing. First 3 visiting scholars in residence. Launch event at EFM Amsterdam. |
| **Q3 2026** | 15,000 books in collection (imports from digital archives). 800+ EFM titles newly scanned. First 15 scholarly editions published with DOIs. First press coverage (3+ outlets). Documentary series filming underway. Methodology paper submitted. |
| **Q4 2026** | 25,000 books. 6 visiting scholars completed. 30 scholarly editions. 5 research commissions published. First university courses piloting Source Library materials. "Hidden in Plain Sight" exhibition opens at EFM. Patron program launched with first 50 Ficino Circle members. |
| **Q1 2027** | 30,000+ books. 1,500 newly scanned titles (EFM + partners). Conference workshop series established. 3+ academic citations. Revenue conversations with AI labs. Year 2 plan funded. |

---

### Year 2 (2027): Scale and Specialize

**Goal:** 50,000 books. Deep coverage of major intellectual traditions. First revenue. Recognized as essential research infrastructure.

**Budget: $1M** (same structure, expanded scope)

**Key additions:**
- **Scanning at scale:** 2,000 newly digitized titles (EFM + 8 partner libraries). Begin scanning Arabic and Hebrew manuscripts at partner collections in Israel, Egypt, and Turkey.
- **Tradition-specific visiting scholar tracks:** Dedicated residencies for Islamic philosophy, Chinese thought, Sanskrit, Kabbalah — each scholar curates and validates a sub-collection of 500+ texts in their tradition.
- **"Translating the Past" annual conference:** 2-day event at EFM Amsterdam bringing together digital humanists, AI researchers, and textual scholars. 100-150 attendees. Proceedings published.
- **Institutional subscriptions:** University libraries and digital humanities centers pay for premium API access, bulk export, custom collections.
- **AI lab partnerships:** Structured data licensing agreements with 1-2 major AI companies.
- **Exhibition touring:** "Hidden in Plain Sight" travels to 3-4 venues (British Library, Warburg Institute, Getty, university galleries).
- **Patron program at scale:** 200+ Ficino Circle members. Annual patron gathering at EFM with scholars presenting discoveries from the collection.

### Year 3 (2028-29): The Universal Library

**Goal:** 100,000 books. Global scanning partnerships. Standard citation in scholarship. Revenue covering 30-50% of costs.

**Key additions:**
- **Regional scanning programs** with partner institutions (Middle East, India, East Asia). Fund on-site digitization of manuscripts that have never left their home institutions.
- **Human-AI collaborative translation:** Scholars refine AI translations in a structured workflow, producing publication-grade editions at 10x the speed of traditional methods. 100+ editions/year.
- **Curriculum integration:** Source Library materials used in 50+ university courses across 10 countries.
- **Research grants:** Fund original scholarship using Source Library data — computational analysis of intellectual traditions, cross-cultural comparison, network analysis of knowledge transmission. $100K/year in commissioned research.
- **Open data:** Full corpus available for download. Structured data (entities, indexes, cross-references) freely accessible via API. Translations under Creative Commons.
- **Physical exhibitions program:** Rotating exhibitions at EFM + traveling shows. Pair physical rare books from the BPH with AI-translated text and catalogued illustrations.

---

## What Success Looks Like

### In 1 year
- 30,000 books from 20+ archives, 30+ languages, 18 centuries
- 1,500 newly scanned titles never before available online (800 from EFM alone)
- 30 peer-reviewed scholarly editions with DOIs
- 6 visiting scholars completed, 5 research commissions published
- Advisory board of 10-12 leading scholars, meeting quarterly
- Cited in academic publications, used in 5+ university courses
- Covered in major press (5+ outlets), documentary series released
- "Hidden in Plain Sight" exhibition shown at EFM
- 50+ Ficino Circle patrons
- Core team of 3 + scholar network of 20+

### In 3 years
- 100,000 books — the most comprehensive translated pre-modern library ever assembled
- 5,500+ newly scanned titles from EFM and partner collections across Europe, Middle East, and Asia
- 200+ scholarly editions, 50+ first-ever English translations
- 18 visiting scholars, 15 research commissions — a body of original scholarship built on the collection
- "Translating the Past" conference established as an annual event
- Standard reference in digital humanities and intellectual history
- Revenue from data licensing and institutional subscriptions covering 30-50% of operating costs
- Exhibition program touring internationally
- 500+ Ficino Circle patrons
- Source Library materials in 50+ university courses across 10 countries
- Integration with major AI systems as a primary knowledge source for pre-modern thought

### In 10 years
- Every significant pre-modern text in every major language, translated, indexed, and freely accessible
- A new kind of institution: part library, part research lab, part publisher, enabled by AI but governed by scholars
- The intellectual heritage of humanity — previously locked in dead languages and rare book rooms — open to everyone

---

## Revenue & Sustainability

Source Library is a public good, but it generates valuable assets:

| Revenue stream | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| **AI data licensing** | $0 | $100-200K | $200-400K |
| **Institutional subscriptions** | $0 | $50-100K | $100-200K |
| **Scholarly edition sales** | $5K | $20-50K | $50-100K |
| **Processing-as-a-service** | $0 | $25-50K | $50-100K |
| **Grants** | ~$1M | ~$700K | ~$500K |
| **Total** | ~$1M | ~$1M | ~$1M |

The trajectory: grants provide 100% of Year 1 funding, declining to ~50% by Year 3 as earned revenue grows. Full sustainability (grant-independent) is a 5-year goal, not a 3-year one — this is honest. Cultural heritage infrastructure doesn't become self-sustaining overnight, but Source Library has a clearer revenue path than most projects in this space because the data it produces is uniquely valuable to the AI industry.

**AI data licensing** is the biggest opportunity. Source Library is building the only large-scale, structured, translated corpus of pre-modern text. AI companies training models on historical and philosophical content will pay for clean data rather than scraping Wikipedia. This is not speculative — the market for high-quality training data is already established and growing.

---

## Why the EFM

The Embassy of the Free Mind is the right institutional home for this project because:

1. **Collections.** The Bibliotheca Philosophica Hermetica is a world-class collection with deep holdings in exactly the traditions that Source Library prioritizes. Many of these texts exist in no other collection.

2. **Mission alignment.** The EFM exists to make esoteric and philosophical texts accessible. Source Library is the technological expression of that mission.

3. **Network.** The EFM has relationships with scholars, collectors, and institutions worldwide. Source Library needs those relationships to curate effectively and to build scholarly credibility.

4. **Physical space.** The EFM building in Amsterdam is a venue for events, visiting scholars, and the kind of in-person collaboration that builds intellectual community.

5. **Brand.** The Embassy of the Free Mind is a distinctive, recognizable name. "A program of the Embassy of the Free Mind" carries weight in both academic and cultural contexts.

---

## The Ask

**$1M/year for 3 years**, supporting the program described above.

Year 1 builds the team, completes the collection, establishes scholarly credibility, and launches publicly. Year 2 scales to 50,000 books, begins scanning programs, and generates first revenue. Year 3 reaches 100,000 books and moves toward sustainability.

The first year is the most important. It determines whether Source Library becomes a real institution or remains a promising prototype.

---

## Appendix: Current Collection Statistics

| | |
|---|---|
| Total books | 4,430 |
| Total page images | 1,674,978 |
| Pages transcribed (OCR) | 467,201 (28%) |
| Pages translated | 284,875 (17%) |
| Books fully processed | 1,077 |
| Illustrations catalogued | 71,154 |
| Cross-referenced entities | 129,539 |
| Books with chapters | 1,628 |
| Source archives | 15 |
| Languages | 30+ |

**Top languages:** Latin (975), English (828), Chinese (533), German (524), Greek (428), Sanskrit (311), French (237), Italian (104), Dutch (74)

**Source archives:** Internet Archive (2,900), Embassy of the Free Mind (993), Gallica (138), MDZ/BSB (83), Cambridge (52), Vatican (51), Google Books (44), Bodleian (39), Library of Congress (22), and others

**AI processing cost to date:** ~$3,400 (2M+ API calls)

**Live at:** [sourcelibrary.org](https://sourcelibrary.org)
