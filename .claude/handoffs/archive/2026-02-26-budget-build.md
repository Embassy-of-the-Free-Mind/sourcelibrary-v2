# Source Library Budget — Built from Activities

The question isn't "what's the right number." It's: what does Source Library need to do, and what does each thing cost?

---

## The Activities

### 1. Run the Program

Someone has to run the pipeline, make technology decisions, manage the collection, write grants, talk to partners, and set direction. Today that's Derek, full-time.

| Item | Cost | Notes |
|---|---|---|
| Program Director (Derek) | $130K | Salary + benefits. This is non-negotiable. |
| Head of Collections | $90K | Curation, metadata QA, archive relationships, scholarly liaison. This is the second most important hire — the person who decides what goes in and validates what comes out. Without this, Derek is doing everything. |
| Operations coordinator (part-time) | $40K | Donor relations, newsletter, event logistics, admin. Could be a contractor or 0.5 FTE in Amsterdam. |

**Subtotal: $260K**

Why not less? Derek alone is $130K and he's already stretched. The Head of Collections is the key hire that makes this a program rather than a one-person project. The ops person keeps everything else from landing on Derek.

Why not more? The AI pipeline runs autonomously. You don't need a large engineering team. Additional capacity (design, development, language expertise) can be contracted as needed.

---

### 2. Scan Books

This is the single highest-value thing money buys. AI can translate a scan; nothing can replace creating one. Every book scanned is a primary source — often existing in 1-3 copies worldwide — made permanently accessible.

**The EFM collection alone justifies this.** The Bibliotheca Philosophica Hermetica holds ~25,000 volumes, many unscanned. These are the crown jewels — Hermetic, alchemical, Kabbalistic, Rosicrucian works that exist in no other collection. Scanning them is not optional; it's the core institutional mission.

| Item | Cost | Output | Cost/book |
|---|---|---|---|
| **Dedicated EFM scanner** (full-time, Amsterdam) | $65K | 600-800 books/year | ~$85 |
| **Equipment** (book cradle, overhead camera, lighting) | $25K yr1, $5K ongoing | One-time setup + maintenance | — |
| **Partner library scanning** (travel + on-site work) | $80K | 300-500 books at 3-5 European institutions | ~$200 |
| **Commissioned scans** (scholar-nominated priority texts) | $50K | 100-200 manuscripts from smaller collections | ~$350 |
| **Conservation supplies** | $10K | Handling materials for fragile bindings | — |

| Scenario | Cost | Books/year |
|---|---|---|
| **EFM only** | $100K | 600-800 |
| **EFM + 3 partners** | $200K | 1,000-1,300 |
| **EFM + 5 partners + commissions** | $300K | 1,200-1,500 |

Over 3 years, even the modest scenario produces 2,000+ newly digitized primary sources. The ambitious one produces 4,000+. These are texts that may *never* be scanned by anyone else.

---

### 3. Engage Scholars

The AI produces first drafts. Scholars produce knowledge. Without scholarly engagement, Source Library is a tech demo. With it, it's a research institution.

| Program | What it is | Cost | Output |
|---|---|---|---|
| **Advisory Board** (10-12 members) | Senior scholars across 6-8 fields. Meet quarterly. Set collection priorities, validate quality, co-sign editions. Annual in-person meeting at EFM. | $40K | Legitimacy, direction, peer network |
| **Visiting Scholars** (4-6/year) | 3-month residencies. Scholar works with a sub-collection: annotating, correcting translations, writing introductions, identifying cross-references. In-person at EFM or virtual. | $60-90K | 4-6 validated sub-collections per year, contextual essays, corrected translations, scholarly editions |
| **Research Commissions** (5/year) | Pay scholars $5-10K each to write original research using Source Library data. Computational analysis, cross-tradition comparisons, network mapping. Published on the platform and in journals. | $40-50K | Original scholarship that *uses* the collection — proof of value |
| **Scholarly Editions** (20-30/year) | Peer-reviewed, DOI-minted translations with critical introductions. Each reviewed by an advisory board member or visiting scholar. | $25-30K | Citable publications, the permanent scholarly record |
| **Conference Presence** | RSA, ADHO, ESSWE, History of Science Society. Not just talks — host workshops: "AI and Pre-Modern Texts." | $25-30K | Visibility in the fields that matter |
| **Course Materials** (10-15 courses) | Curated teaching collections for university courses. Free. Partner with 5 universities to pilot. | $15K | Pipeline of student users and future scholars |

| Scenario | Cost | What you get |
|---|---|---|
| **Minimal** (board + 4 scholars + 10 editions) | $120K | Basic credibility |
| **Strong** (board + 6 scholars + commissions + 25 editions + conferences) | $220K | Active scholarly community |
| **Deep** (all of the above + funded PhD positions + annual conference) | $350K+ | Research institution |

---

### 4. Tell the Story

Source Library has a story the public cares about: hidden ancient texts, AI translation, lost knowledge recovered. Most academic projects waste this. The "first-ever translation" angle alone generates press.

| Program | What it is | Cost | Impact |
|---|---|---|---|
| **Press/PR** (part-time officer, 9 months) | Monthly press releases. "First-ever translation of X." Target: Guardian, Wired, Nature, NYT Culture, Chronicle of Higher Ed, Dutch press. | $40K | 10-15 press hits/year |
| **Documentary series** (6-8 short films) | Professional 5-10 min films: the EFM collection, the AI pipeline, a scholar's first encounter with a text, the scanning process, the illustrations. YouTube + events. | $50K | Permanent storytelling asset. Conference screenings. Social media content for years. |
| **Events at EFM** (4/year) | Launch event, annual lecture, 2 salons pairing scholars with public. Livestreamed. | $20K | Community building, donor cultivation, press hooks |
| **Patron program** ("The Ficino Circle") | Donors fund specific books. Name in the scholarly edition. Quarterly progress updates. Annual patron gathering at EFM. | $15K (setup) | Recurring small donations. Engagement. Story amplification. |
| **Exhibition** ("Hidden in Plain Sight") | 20 large-format illustration prints with translations. Opens at EFM, tours 2-3 venues. | $30K | Physical presence. Press. Institutional partnerships. |
| **Newsletter + social** | Monthly newsletter. AI-powered social posting (built). Instagram. Academic Bluesky. | $10K | Ongoing visibility |
| **Website improvements** | Impact dashboard, donor recognition, mobile, case studies | $15K | Credibility for funders |

| Scenario | Cost | What you get |
|---|---|---|
| **Basic** (newsletter + social + 2 events + website) | $45K | Lights on |
| **Visible** (+ press officer + events + patron program) | $120K | People know you exist |
| **Ambitious** (+ documentary + exhibition + full PR) | $200K | Cultural institution with public presence |

---

### 5. AI Processing & Infrastructure

The cheapest part. This is the whole point — the technology cost is trivial.

| Item | Cost | Notes |
|---|---|---|
| Gemini API | $40-60K | Processes 40,000-60,000 books through full pipeline (OCR + translation + index + chapters + images) |
| AWS Lambda workers | $10K | SQS queues, compute |
| MongoDB Atlas | $10K | Database |
| Vercel hosting + Blob storage | $10K | Web app, image hosting |
| Image archiving + CDN | $5K | Long-term storage |
| Dev tools, monitoring | $5K | |

**Subtotal: $80-100K**

This doesn't change much with scale. Going from 30,000 books to 100,000 adds maybe $20-30K in Gemini costs. The infrastructure is already built.

---

## Three Scenarios

### Lean ($600K/year)

*"Make this real with the minimum credible team and program."*

| Category | Cost |
|---|---|
| Team (Derek + Head of Collections + part-time ops) | $260K |
| Scanning (EFM only, 600-800 books/year) | $100K |
| Scholars (board + 4 visiting + 10 editions + 2 conferences) | $120K |
| Marketing (newsletter + social + 2 events + website) | $45K |
| AI + infrastructure | $80K |
| **Total** | **$605K** |

**What this gets you:** A 3-person team. 600-800 newly scanned books/year from EFM. 10 scholarly editions. An advisory board. Basic public presence. 30,000+ books processed through the pipeline. It works, but it's modest and it's fragile — if one person leaves, the program is at risk.

---

### Strong ($1M/year)

*"A real program with scholarly depth, scanning at scale, and public visibility."*

| Category | Cost |
|---|---|
| Team (Derek + Head of Collections + part-time ops) | $260K |
| Scanning (EFM + 3-5 partner libraries, 1,000-1,300 books/year) | $230K |
| Scholars (board + 6 visiting + 5 commissions + 25 editions + conferences + courses) | $220K |
| Marketing (press + events + patron program + documentary + newsletter) | $170K |
| AI + infrastructure | $100K |
| Contingency | $20K |
| **Total** | **$1M** |

**What this gets you:** 1,000-1,300 newly scanned books/year (including partner libraries across Europe). 6 visiting scholars per year. 25 scholarly editions. 5 original research commissions. A press officer getting regular coverage. A documentary series. A patron program. 50,000+ books processed. This is a credible institution.

---

### Ambitious ($1.5M/year)

*"Build the leading institution for AI-assisted cultural heritage."*

| Category | Cost |
|---|---|
| Team (Derek + Head of Collections + ops + collections assistant) | $330K |
| Scanning (EFM + 5 partners + commissions, 1,500+ books/year) | $300K |
| Scholars (board + 6 visiting + commissions + 30 editions + conference + courses + 2 funded PhDs) | $350K |
| Marketing (full PR + documentary + exhibition + events + patron program) | $200K |
| AI + infrastructure | $100K |
| Research fund (original scholarship using the collection) | $100K |
| Annual conference ("Translating the Past") | $50K |
| Contingency + legal | $70K |
| **Total** | **$1.5M** |

**What this gets you:** Everything in the Strong scenario plus: a traveling exhibition, an annual conference, funded PhD positions, a dedicated research fund, scanning commissions for scholar-nominated manuscripts, and the team depth to survive someone being unavailable.

---

## What I'd Recommend

**Pitch $1.2M/year for 3 years ($3.6M total).** Here's why:

- $600K is too lean. It's basically paying Derek and one other person, scanning at EFM, and hoping for the best. No resilience, no real scholarly program, no public presence. Hard to fundraise *more* later because you haven't built visibility.

- $1M works. It funds everything that matters at a credible scale. But it's tight — there's no room for the unexpected, and the team is still just 3 people.

- $1.5M is genuinely ambitious and would make Source Library the clear leader in this space within a year. But it's a bigger ask and requires a funder who sees the full vision.

- **$1.2M splits the difference.** It's the Strong scenario with some of the Ambitious elements — the exhibition, a small research fund, slightly bigger scanning program. It rounds to a clean "$3.6M over 3 years" or "$1.2M/year" which is a standard Mellon or Arcadia grant size.

The pitch is: **$1.2M/year makes Source Library the world's leading translated primary source library within 3 years.** That's not hyperbole — no one else is doing this at any budget.

---

## How This Compares

| | Source Library ($1.2M) | Perseus ($1-2M est.) | Endangered Archives Programme ($2M/yr from Arcadia) | A single Mellon DH grant |
|---|---|---|---|---|
| Books processed | 50,000+/year | ~25,000 total (38 years) | 16M images (no translation) | Usually 1 project |
| Languages | 30+ | 2 (Greek, Latin) | All | Usually 1-2 |
| Translation | Yes (all books) | Some | No | Sometimes |
| Scholarly editions | 25-30/year | — | — | Usually 0-5 |
| Scanning new material | 1,000+/year | No | Yes (their whole mission) | Sometimes |
| AI-native | Yes | No | No | Sometimes |
| Cost per fully processed book | ~$24 all-in | ~$50-100 (estimated) | N/A (no processing) | N/A |

---

## Funding Sources to Approach

| Funder | Why they'd fund this | Likely grant size | Fit |
|---|---|---|---|
| **Arcadia Fund** | Their Archives and Manuscripts programme is *exactly* this — digitize endangered sources, make them freely available. $386M given to culture. | $500K-$2M | Perfect fit |
| **Mellon Foundation** | $540M awarded in 2024. Digital humanities is core. Recent grants: $500K (Arkansas digital history), $984K (Rochester DH fellowship). | $500K-$1.5M | Strong fit |
| **NEH** | Multiple programs (DHAG, Preservation & Access, Scholarly Editions). Cap is lower but stackable. | $150K-$350K | Supplement |
| **Patrick Collison / Stripe** | Progress studies. Knowledge access. AI + humanities. Personal interest. | $100K-$500K | Catalyst / first money in |
| **Google.org** | Source Library is one of their biggest Gemini Batch API users. Showcase for AI + cultural heritage. | Compute credits + $200-500K | Good story for them |
| **Sloan Foundation** | Public understanding of science. History of ideas. Digital infrastructure. | $200K-$500K | Decent fit |
| **Individual donors** | The Ficino Circle patron program. "$200 translates a book from the EFM collection." | $50-$10K per donor | Recurring, community-building |

**Strategy:** Get one large anchor funder (Arcadia or Mellon at $500K-$1M), supplement with NEH ($150-350K), and use personal/tech philanthropy (Collison, Google) to fill the gap. The Ficino Circle builds a base of small recurring donors.

Patrick Collison is most valuable as a *catalyst* — not the primary funder, but the person whose early commitment gives Arcadia or Mellon confidence. "Patrick Collison is supporting this" is a signal.
