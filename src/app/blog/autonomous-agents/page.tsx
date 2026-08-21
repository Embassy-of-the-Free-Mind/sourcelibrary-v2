import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'How We Added 950 Books in a Weekend - Research Notes - Source Library',
  description: 'A human curator and three autonomous AI agents working in parallel imported 950 books across 11 languages in a single weekend. How the human-AI curation pipeline works.',
  openGraph: {
    title: 'How We Added 950 Books in a Weekend',
    description: 'A human curator and three autonomous AI agents working in parallel imported 950 books in a single weekend. The architecture and the lessons.',
    images: [{ url: 'https://images.sourcelibrary.org/archived/695230c6ab34727b1f044784/9.jpg', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/695230c6ab34727b1f044784/9.jpg' }],
  },
  alternates: {
    canonical: '/blog/autonomous-agents',
  },
};

export default function AutonomousAgentsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="How We Added 950 Books in a Weekend"
          subtitle="A human curator and three AI agents, working in parallel"
        >
          <p className="text-stone-400 text-sm mt-4">9 March 2026 &middot; 12 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">

        {/* --- Lead --- */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          On the weekend of March 8&ndash;9, 2026, we added 950 books and 405,000 page images to Source Library across eleven languages. About 880 of those came from a human curator running intensive manual sessions. The remaining 69 came from an experiment: three autonomous AI agents running in parallel, each with a narrow mandate to import books on Arabic science, Sanskrit mathematics, or Chinese engineering.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          This post describes both halves of that weekend: the human-driven acquisition sessions that produced the bulk of the imports, and the agent experiment that tested whether autonomous AI curation can work at all. The answer is yes &mdash; with caveats.
        </p>

        {/* --- The Problem --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The problem: building a library is slow
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Source Library digitizes and translates rare historical texts &mdash; books published between the 15th and 19th centuries, mostly in Latin, Greek, German, and Arabic. As of this writing, it holds over 6,100 books and 2.4 million page images from fourteen digital library sources. Every book passes through an automated pipeline: archival image download, AI-powered OCR, translation to English, metadata enrichment, illustration extraction, and scholarly indexing.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The bottleneck is not processing &mdash; it is <em>finding the right books to process</em>. A human curator searching Archive.org for importable texts can evaluate perhaps 20&ndash;30 candidates per hour, rejecting modern editions, checking for duplicates, verifying that scans are readable, and writing import commands. At that rate, building a collection of thousands of books takes months. The processing pipeline can consume books far faster than a human can feed it.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We had been running curator sessions manually for months &mdash; 35 sessions documented in our curator reports, ranging from thematic batches (Rosicrucian manifestos, Pythagorean music theory, Syriac Christianity) to broad sweeps (world sacred texts, Greek manuscripts). Each session required a human to direct an AI assistant through searches, evaluation, and import. We wanted to know two things: how much could one curator accomplish in a focused weekend, and whether autonomous agents could handle parts of the work independently.
        </p>

        {/* --- The weekend --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The weekend: two tracks in parallel
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The weekend had two parallel tracks running simultaneously.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Track 1: Human-directed curation.</strong> A human curator ran intensive acquisition sessions across Saturday and Sunday, directing AI assistants through thematic searches. These sessions covered the history of science broadly: Latin natural philosophy (Kircher, Copernicus, Vesalius, Harvey), English science (Newton, Darwin, Boyle, Priestley, Faraday), German philosophy (Hegel, Nietzsche, Kant, Leibniz), Russian literature and science (Dostoevsky, Tolstoy, Mendeleev, Lobachevsky), French science (Montaigne, Descartes, Pascal, Lavoisier), Italian natural philosophy (Galileo, Biringuccio, Ramazzini), and Greek papyrology and mathematics. This produced approximately 880 books and 376,000 pages.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>Track 2: Autonomous agents.</strong> Alongside the manual sessions, we ran an experiment with three autonomous AI agents. Each had a narrow mandate and was left to work without supervision. This produced 69 books and 29,000 pages. The rest of this post focuses on this experiment.
        </p>

        {/* --- Architecture --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Architecture: teams, tasks, and tools
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Claude Code&apos;s team system allows a lead agent to spawn autonomous sub-agents that share a task list and can communicate via messages. Each agent runs as an independent process with access to the same tools: web search, shell commands, file reading, and &mdash; critically &mdash; the ability to call Source Library&apos;s import APIs.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We created a team called <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">science-acquisition</code> with three agents:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="min-w-full text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-6 font-medium">Agent</th>
                <th className="text-left py-3 pr-6 font-medium">Mandate</th>
                <th className="text-right py-3 pr-6 font-medium">Books</th>
                <th className="text-right py-3 font-medium">Pages</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-6"><code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">arabic-science</code></td>
                <td className="py-3 pr-6">15&ndash;25 books on Arabic/Islamic science</td>
                <td className="text-right py-3 pr-6">13</td>
                <td className="text-right py-3">~4,200</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6"><code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">sanskrit-science</code></td>
                <td className="py-3 pr-6">15&ndash;25 books on Sanskrit mathematics and science</td>
                <td className="text-right py-3 pr-6">18</td>
                <td className="text-right py-3">~11,000</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6"><code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">chinese-science</code></td>
                <td className="py-3 pr-6">15&ndash;25 books on Chinese engineering and technology</td>
                <td className="text-right py-3 pr-6">38</td>
                <td className="text-right py-3">~14,000</td>
              </tr>
              <tr className="border-b border-medium font-medium">
                <td className="py-3 pr-6" colSpan={2}>Total</td>
                <td className="text-right py-3 pr-6">69</td>
                <td className="text-right py-3">~29,200</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Each agent received the same set of instructions: a 3,000-word curator skill document specifying selection rules, edition priorities (oldest available, original language, never modern translations), scoring criteria, and API reference for all thirteen import sources. The agents could search Archive.org programmatically, verify metadata, check for duplicates against our existing collection, and call the import endpoints directly.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The agents ran for several hours without supervision. We checked on them periodically but did not intervene in their selections.
        </p>

        {/* --- What the agents imported --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What the agents imported
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">arabic-science</code> agent imported 13 books: 5 in Arabic or Persian (Al-Khwarizmi, Ibn al-Haytham, al-Battani) and 8 Latin editions of Arabic authors &mdash; Avicenna&apos;s <em>Canon</em>, Averroes&apos; commentaries on Aristotle, al-Kindi&apos;s optics. The agent correctly identified that many Arabic scientific works survive primarily in Latin translation, and prioritized those early printed editions.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">sanskrit-science</code> agent imported 18 books: Brahmagupta&apos;s <em>Brahmasphutasiddhanta</em>, the <em>Surya Siddhanta</em>, Bhaskara&apos;s <em>Siddhanta Shiromani</em>, the <em>Charaka Samhita</em> and <em>Sushruta Samhita</em> (Ayurvedic medical encyclopedias), the <em>Arthashastra</em>, and the <em>Rasarnava</em> (alchemical text). It focused on critical editions with original Sanskrit text, preferring 19th-century scholarly publications from Calcutta and Benares.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">chinese-science</code> agent was the most productive, importing 38 books: Chinese star charts, the <em>Bencao Gangmu</em> (materia medica), Yongle Dadian fragments, Ming-dynasty astronomy texts, technical woodblock-printed manuals, and calendar reform treatises. It found items across Internet Archive and Library of Congress, including rare illustrated editions.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Notably, the agents stayed close to their mandates. Unlike what we expected, they did not spiral outward into unrelated subjects. The <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">arabic-science</code> agent imported Latin editions of Arabic authors &mdash; which is scholarly good judgment, since that is how those texts circulated in Europe &mdash; but did not wander into Copernicus or Kepler. The 69 books are a focused, coherent set of non-European scientific texts.
        </p>

        {/* --- What an agent does --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What an agent does
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Each agent&apos;s workflow is a loop:
        </p>

        <ol className="list-decimal list-inside space-y-4 mb-8 text-secondary leading-relaxed">
          <li><strong>Search.</strong> Query Archive.org&apos;s advanced search API with author names, subject terms, and date filters. The API returns identifiers, titles, dates, and creators for matching texts.</li>
          <li><strong>Evaluate.</strong> For each candidate, fetch the IA metadata endpoint to check page count, scan quality, and file format. Score against the selection criteria: thematic fit (3x weight), edition quality (2x), historical authenticity (2x), rarity (2x), completeness (1x), image quality (1x), research value (1x). Reject modern translations, anthologies, secondary literature, and books already in the collection.</li>
          <li><strong>Import.</strong> Call <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">POST /api/import/ia</code> with the identifier, title, author, language, and year. The API fetches a IIIF manifest to count pages, creates book and page records in MongoDB, and queues the book for split detection.</li>
          <li><strong>Verify.</strong> Check the API response for success. If a 409 (duplicate) is returned, skip and continue. If metadata is missing (no IIIF manifest, no page count), try alternative endpoints or skip.</li>
          <li><strong>Report.</strong> Log what was imported and continue to the next search.</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-8">
          The agents are not doing anything a human curator cannot do. They are calling the same APIs, following the same selection rules, and producing the same database records. The difference is that they can work unsupervised while the human focuses on other areas of the collection.
        </p>

        {/* --- Selection rules --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Selection rules: what gets in
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The curator skill encodes specific selection rules that every agent follows:
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-status-success/5 border border-status-success/20 rounded-lg p-5">
            <h3 className="text-lg font-medium text-primary mb-3">Acquire</h3>
            <ul className="list-disc list-inside space-y-1.5 text-secondary">
              <li>Original historical editions (pre-1800)</li>
              <li>Early printed books in original language</li>
              <li>First editions and editiones principes</li>
              <li>Critical scholarly editions with original text (Teubner, Loeb)</li>
              <li>Contemporary translations (17th-century English of Latin)</li>
            </ul>
          </div>
          <div className="bg-status-error/5 border border-status-error/20 rounded-lg p-5">
            <h3 className="text-lg font-medium text-primary mb-3">Reject</h3>
            <ul className="list-disc list-inside space-y-1.5 text-secondary">
              <li>Modern translations (20th&ndash;21st century) without original text</li>
              <li>English-only editions when Latin/Greek available</li>
              <li>Secondary literature and commentaries</li>
              <li>Facsimile reprints when original scans exist</li>
              <li>Anthologies that excerpt rather than present complete works</li>
            </ul>
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Edition priority is strict: incunabula (pre-1501) first, then 16th-century editions, then 17th, then 18th, then 19th-century critical editions, and modern translations only as a last resort. Original language always takes precedence over English translations. A 1506 Latin edition of Pico della Mirandola&apos;s <em>Omnia opera</em> ranks higher than a 2002 English translation of the same text.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          This rule set is what makes autonomous acquisition possible. Without it, the agents would import everything they found &mdash; modern paperbacks, dissertation abstracts, scanned catalogs. The rules act as a filter, and the agents follow them with reasonable fidelity.
        </p>

        {/* --- Human sessions --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The human side: 880 books in parallel
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          While the agents worked on Arabic, Sanskrit, and Chinese texts, the human curator ran intensive directed sessions covering the history of European science and philosophy. The breakdown by language:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="min-w-full text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-6 font-medium">Language</th>
                <th className="text-right py-3 pr-6 font-medium">Books</th>
                <th className="text-left py-3 font-medium">Notable imports</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Latin</td>
                <td className="text-right py-3 pr-6">~410</td>
                <td className="py-3">Kircher (13 works), Copernicus, Vesalius, Harvey, Sacrobosco, Torricelli</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">English</td>
                <td className="text-right py-3 pr-6">~170</td>
                <td className="py-3">Newton, Darwin, Boyle, Priestley, Faraday, Grew</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">German</td>
                <td className="text-right py-3 pr-6">~145</td>
                <td className="py-3">Hegel (10), Nietzsche (11), Kant (8), Leibniz</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Russian</td>
                <td className="text-right py-3 pr-6">~65</td>
                <td className="py-3">Dostoevsky (13), Tolstoy, Lobachevsky, Mendeleev</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Greek</td>
                <td className="text-right py-3 pr-6">~35</td>
                <td className="py-3">Oxyrhynchus Papyri, Archimedes editions</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">French</td>
                <td className="text-right py-3 pr-6">~30</td>
                <td className="py-3">Montaigne, Descartes, Pascal, Lavoisier</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Italian</td>
                <td className="text-right py-3 pr-6">~25</td>
                <td className="py-3">Galileo, Biringuccio, Ramazzini, Aldrovandi</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The human sessions followed a different pattern than the agents. Where the agents executed systematic searches within narrow parameters, the human curator followed scholarly connections freely &mdash; Arabic optics leading to Copernicus, leading to Kepler, leading to the entire tradition of early modern natural philosophy. The result was broader and less predictable: the complete works of Hegel, thirteen Dostoevsky novels, Aldrovandi&apos;s illustrated natural history, and Montaigne&apos;s <em>Essais</em> all entered the collection alongside the Latin scientific corpus.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          This division of labor turned out to be effective. The agents handled areas where the curator had less domain knowledge (Sanskrit mathematical traditions, Chinese technical literature), while the human focused on the broader European intellectual history where citation trails are dense and judgment calls are frequent.
        </p>

        {/* --- Cleanup pipeline --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The cleanup pipeline
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Importing at this pace &mdash; whether by human or agent &mdash; creates predictable categories of errors:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="min-w-full text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-6 font-medium">Problem</th>
                <th className="text-right py-3 pr-6 font-medium">Count</th>
                <th className="text-left py-3 font-medium">Fix</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Missing language metadata</td>
                <td className="text-right py-3 pr-6">~280</td>
                <td className="py-3">Heuristic detection (Cyrillic &rarr; Russian, Greek chars &rarr; Greek, article patterns)</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Duplicate editions</td>
                <td className="text-right py-3 pr-6">~95</td>
                <td className="py-3">Title normalization, keep highest page count</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Modern books (post-1950)</td>
                <td className="text-right py-3 pr-6">2</td>
                <td className="py-3">Delete with audit trail</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The <strong>duplicate rate of ~9%</strong> came from both the parallel agents and the parallel human sessions. Three agents and a human curator running simultaneously, searching overlapping subject areas, with no real-time shared state. The import API returns a 409 for exact IA identifier matches, but different editions of the same work (e.g. a 1573 and a 1590 printing of the same text) pass through. Post-hoc dedup normalized titles to their first 25 lowercase alphanumeric characters, grouped by language, and kept the copy with the most pages.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The <strong>language detection</strong> problem affected both tracks. The import API accepts a <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">language</code> field, but 280 books were imported as <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">&quot;Unknown&quot;</code>. We fixed this with a heuristic: Cyrillic characters mean Russian, Greek characters mean Greek, German articles (<em>die</em>, <em>der</em>, <em>und</em>) suggest German, French articles (<em>des</em>, <em>les</em>, <em>du</em>) suggest French. Everything else defaults to Latin &mdash; a reasonable prior for a collection dominated by early modern scholarly texts. The pipeline&apos;s metadata enrichment step later confirms or corrects these via AI analysis of the OCR text.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Deleted books are preserved in a <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">deleted_books</code> collection with the reason for deletion and the ID of the copy that was kept. Nothing is permanently destroyed.
        </p>

        {/* --- Processing pipeline --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What happens next: the processing pipeline
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Importing a book creates a database record and links to the source images. The book is not yet readable. Every imported book enters an automated processing pipeline with eight stages:
        </p>

        <ol className="list-decimal list-inside space-y-3 mb-8 text-secondary leading-relaxed">
          <li><strong>Archive.</strong> Download all page images from the source library (Internet Archive, Gallica, Vatican, etc.) and re-host on our CDN. This protects against source outages and improves load times. A dedicated server processes ~20&ndash;34 pages per second.</li>
          <li><strong>Split detection.</strong> Many digitized books photograph two-page spreads as a single image. An ML model detects these and crops them into individual pages.</li>
          <li><strong>OCR.</strong> Google&apos;s Gemini reads each page image and transcribes the text, handling Latin ligatures, Fraktur blackletter, Greek polytonic, Arabic diacritics, and Chinese characters. AWS Lambda workers process pages in parallel.</li>
          <li><strong>Metadata enrichment.</strong> AI reads the first 25 OCR pages and classifies the book: language, subject categories, publication year, author, scholarly description, and whether this is the first known English translation.</li>
          <li><strong>Translation.</strong> Each page is translated to English, with the previous page&apos;s translation provided as context for continuity. Lambda workers process sequentially via a FIFO queue.</li>
          <li><strong>Enrichment.</strong> AI generates a reading summary, an index of people, places, concepts, and key terms, and extracts chapter structure.</li>
          <li><strong>Image extraction.</strong> AI scans every page for illustrations, emblems, diagrams, and maps, generating bounding boxes, quality scores, and museum-style descriptions for each detected image.</li>
          <li><strong>Finalization.</strong> Quality checks, search index updates, and sitemap generation.</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-8">
          For 950 books at an average of ~$1.90 per book through the full pipeline, the total processing cost is approximately $1,800. At current throughput (~2,100 pages per hour for translation, the slowest step), the 405,000 pages take roughly eight days to process. The pipeline runs continuously via cron jobs every ten minutes, with backpressure controls to prevent overwhelming the AI APIs or the database.
        </p>

        {/* --- Costs --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Cost structure
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The full cost of the weekend&apos;s acquisition:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="min-w-full text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-6 font-medium">Phase</th>
                <th className="text-left py-3 pr-6 font-medium">Cost</th>
                <th className="text-left py-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Agent runtime (3 agents, several hours)</td>
                <td className="py-3 pr-6">~$30&ndash;50</td>
                <td className="py-3">Claude Opus API costs for search, evaluation, and import calls</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Human-directed sessions (weekend)</td>
                <td className="py-3 pr-6">~$100&ndash;200</td>
                <td className="py-3">Claude API costs for assisted search and import</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Image archiving (405k pages)</td>
                <td className="py-3 pr-6">~$5</td>
                <td className="py-3">Bandwidth and Vercel Blob storage</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Processing pipeline (OCR + translate + enrich)</td>
                <td className="py-3 pr-6">~$1,800</td>
                <td className="py-3">Gemini API via Lambda workers, ~$0.006/page average</td>
              </tr>
              <tr className="border-b border-medium font-medium">
                <td className="py-3 pr-6">Total</td>
                <td className="py-3 pr-6">~$2,000</td>
                <td className="py-3">For 950 books, 405,000 pages, 11 languages</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          The unit economics work out to roughly $2 per fully processed book &mdash; discovered, imported, archived, transcribed, translated, indexed, and searchable. The AI processing cost dominates the budget; acquisition itself is almost free. The agent runtime for 69 books cost less than the human-directed sessions for 880, but both are negligible compared to the downstream processing.
        </p>

        {/* --- Lessons --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Lessons
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>1. Agents stayed on task better than expected.</strong> We anticipated scope creep &mdash; agents wandering from Arabic science into general European philosophy. It did not happen. The 69 agent imports are a focused, coherent set of Arabic, Sanskrit, and Chinese scientific texts. The agents followed citation trails within their domains (Arabic optics &rarr; Latin editions of Arabic authors) but did not spiral into unrelated subjects. Selection rules and clear mandates were sufficient guardrails.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>2. Humans are better at following citation trails across domains.</strong> The breadth of the weekend&apos;s imports &mdash; from Copernicus to Kierkegaard to Dostoevsky &mdash; came from the human curator, not the agents. A human researcher naturally follows scholarly connections across language and subject boundaries. The agents stayed disciplined; the human explored.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>3. The combination is more powerful than either alone.</strong> Agents handled areas where the human had less domain knowledge (which Sanskrit mathematical texts have good 19th-century critical editions? which Chinese technical manuals are on Archive.org?). The human covered the broad European intellectual history where judgment calls are frequent and connections are dense. Neither track alone would have produced the same result.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>4. Selection rules are the critical guardrail.</strong> The difference between a useful autonomous curator and a book-importing bot is the selection criteria. Both agents and human followed the same rules: prefer original language, prefer oldest editions, reject modern translations, reject secondary literature. The rules keep acquisition quality high regardless of who (or what) is doing the selecting.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>5. Cleanup is a first-class concern.</strong> Any system that creates data at this pace &mdash; human or autonomous &mdash; needs equally robust validation. The language detection heuristic, duplicate finder, and modern-book filter are not afterthoughts; they are integral to the acquisition pipeline. Plan for cleanup before you start importing.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>6. Parallel agents without shared state create duplicates.</strong> The ~9% duplicate rate came from both the three agents and the human sessions running simultaneously. A shared &ldquo;import lock&rdquo; or real-time dedup check would reduce this, but post-hoc dedup was simpler and cheaper for a weekend sprint.
        </p>

        {/* --- Current state --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Current state
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          As of March 9, 2026, Source Library holds over 6,100 books and 2.4 million page images. The weekend&apos;s 950 books represent about 17% of the total page count. All imports are enrolled in the auto pipeline and will be fully processed &mdash; archived, OCR&apos;d, translated, indexed &mdash; within roughly eight days.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Of the full collection, nearly 1,000 books are fully translated and readable in English. 2,442 books are classified as first known English translations &mdash; texts that have never before been available in English. The {' '}
          <Link href="/gallery" className="text-accent-rust hover:underline">gallery</Link> contains over 73,000 extracted illustrations.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We will run the agent experiment again &mdash; next time with more agents, different themes, and better coordination between agents and human sessions. The processing pipeline has no bottleneck at this scale; the limit is how fast the source libraries can serve images. The goal is a collection of 10,000 books by mid-2026, covering the full breadth of pre-modern intellectual history in original languages with AI translations. The weekend got us nearly a thousand books closer.
        </p>

        {/* --- Method reproducibility --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Reproducibility
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The full system is open. Source Library&apos;s codebase, including all thirteen import APIs, the curator skill document, the processing pipeline, and the cleanup scripts, is available on{' '}
          <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2" className="text-accent-rust hover:underline">GitHub</a>. The import APIs are documented in the codebase at <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">.claude/docs/import-apis.md</code>. The curator skill is at <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">.claude/skills/curator/SKILL.md</code>. The pipeline architecture is at <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">.claude/docs/pipeline.md</code>.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The approach is not specific to Source Library. Any institution with IIIF-compliant digital collections and an import API could build a similar system. The key components are: a well-specified selection policy, import endpoints that validate and deduplicate, an autonomous agent runtime (Claude Code teams, or any equivalent), and a cleanup pipeline that runs after acquisition. The AI models (Gemini for OCR/translation, Claude for curation) are commercially available. The total infrastructure cost is modest: a Vercel deployment, a MongoDB Atlas cluster, three Lambda functions, and a dedicated server for image archiving.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Source Library is a project of the{' '}
          <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline">Embassy of the Free Mind</a> (Bibliotheca Philosophica Hermetica) in Amsterdam.
        </p>

      </article>

    </ContentPageLayout>
  );
}
