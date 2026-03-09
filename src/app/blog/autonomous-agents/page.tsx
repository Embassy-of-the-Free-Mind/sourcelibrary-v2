import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'How Three AI Agents Built a Library in 12 Hours - Blog - Source Library',
  description: 'We gave three Claude agents a task: import 50 books on Arabic science, Sanskrit mathematics, and Chinese engineering. They imported 949. Here is how autonomous AI curation works — and what happens when agents exceed their instructions.',
  openGraph: {
    title: 'How Three AI Agents Built a Library in 12 Hours',
    description: 'We gave three Claude agents a task: import 50 books. They imported 949. The method, the architecture, and what went right and wrong.',
    images: [{ url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695230c6ab34727b1f044784/9.jpg', width: 1200, height: 630 }],
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
          title="How Three AI Agents Built a Library in 12 Hours"
          subtitle="Autonomous curation at scale — and what happens when agents exceed their instructions"
        >
          <p className="text-stone-400 text-sm mt-4">9 March 2026 &middot; 14 min read</p>
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
          All posts
        </Link>
      </div>

      <article className="prose-content max-w-none">

        {/* --- Lead --- */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          On March 9, 2026, we ran an experiment. We created three autonomous AI agents &mdash; Claude Opus instances running in parallel &mdash; and gave each one a narrow mandate: import 15&ndash;25 books from Internet Archive on Arabic science, Sanskrit mathematics, or Chinese engineering. Then we walked away.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Twelve hours later, the agents had collectively imported 949 books totaling 405,562 page images across eleven languages. They had expanded far beyond their mandates, acquiring the complete works of Hegel, thirteen Dostoevsky novels, Kant&apos;s <em>Critiques</em>, Montaigne&apos;s <em>Essais</em>, and lavishly illustrated natural history encyclopedias by Aldrovandi and Gesner. This was not what we asked for. Most of it was excellent.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          This post describes the method: the architecture that makes autonomous library acquisition possible, the selection rules the agents follow, the cleanup pipeline that catches their mistakes, and what we learned about letting AI systems operate with minimal supervision.
        </p>

        {/* --- The Problem --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The problem: building a library is slow
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Source Library digitizes and translates rare historical texts &mdash; books published between the 15th and 19th centuries, mostly in Latin, Greek, German, and Arabic. As of this writing, it holds 6,135 books and 2.4 million page images from fourteen digital library sources. Every book passes through an automated pipeline: archival image download, AI-powered OCR, translation to English, metadata enrichment, illustration extraction, and scholarly indexing.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The bottleneck is not processing &mdash; it is <em>finding the right books to process</em>. A human curator searching Archive.org for importable texts can evaluate perhaps 20&ndash;30 candidates per hour, rejecting modern editions, checking for duplicates, verifying that scans are readable, and writing import commands. At that rate, building a collection of thousands of books takes months. The processing pipeline can consume books far faster than a human can feed it.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We had been running curator sessions manually for months &mdash; 35 sessions documented in our curator reports, ranging from thematic batches (Rosicrucian manifestos, Pythagorean music theory, Syriac Christianity) to broad sweeps (world sacred texts, Greek manuscripts). Each session required a human to search, evaluate, and import. We wanted to know whether an AI agent could do this autonomously.
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
                <th className="text-left py-3 font-medium">What It Actually Did</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-6"><code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">arabic-science</code></td>
                <td className="py-3 pr-6">15&ndash;25 books on Arabic/Islamic science</td>
                <td className="py-3">Imported Arabic optics, but also German philosophy, Russian literature, French science</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6"><code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">sanskrit-science</code></td>
                <td className="py-3 pr-6">15&ndash;25 books on Sanskrit mathematics and engineering</td>
                <td className="py-3">Imported Brahmagupta and Ayurvedic texts, but also Kircher, Aldrovandi, Italian Renaissance science</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6"><code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">chinese-science</code></td>
                <td className="py-3 pr-6">15&ndash;25 books on Chinese engineering and technology</td>
                <td className="py-3">Imported Chinese materia medica and Yongle Dadian, but also Greek papyrology, English theology, Danish philosophy</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Each agent received the same set of instructions: a 3,000-word curator skill document specifying selection rules, edition priorities (oldest available, original language, never modern translations), scoring criteria, and API reference for all thirteen import sources. The agents could search Archive.org programmatically, verify metadata, check for duplicates against our existing collection, and call the import endpoints directly.
        </p>

        {/* --- What the agents do --- */}
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
          The agents are not doing anything a human curator cannot do. They are calling the same APIs, following the same selection rules, and producing the same database records. The difference is speed and breadth: an agent can evaluate hundreds of candidates per hour, following citation trails and related-works links that a human would not have time to explore.
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
          This rule set is what makes autonomous acquisition possible. Without it, the agents would import everything they found &mdash; modern paperbacks, dissertation abstracts, scanned catalogs. The rules act as a filter, and the agents follow them with reasonable fidelity. Not perfectly &mdash; two post-1950 books slipped through &mdash; but well enough that 97% of imports were legitimate scholarly texts.
        </p>

        {/* --- What happened --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What actually happened
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The agents ran for approximately twelve hours. The results, by language:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="min-w-full text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-6 font-medium">Language</th>
                <th className="text-right py-3 pr-6 font-medium">Books</th>
                <th className="text-right py-3 pr-6 font-medium">Pages</th>
                <th className="text-left py-3 font-medium">Notable</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Latin</td>
                <td className="text-right py-3 pr-6">414</td>
                <td className="text-right py-3 pr-6">176,127</td>
                <td className="py-3">Kircher (13 works), Copernicus, Vesalius, Harvey</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">English</td>
                <td className="text-right py-3 pr-6">174</td>
                <td className="text-right py-3 pr-6">72,147</td>
                <td className="py-3">Newton, Darwin, Boyle, Priestley, Faraday</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">German</td>
                <td className="text-right py-3 pr-6">146</td>
                <td className="text-right py-3 pr-6">55,090</td>
                <td className="py-3">Hegel (10), Nietzsche (11), Kant (8), Leibniz</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Russian</td>
                <td className="text-right py-3 pr-6">66</td>
                <td className="text-right py-3 pr-6">29,386</td>
                <td className="py-3">Dostoevsky (13), Tolstoy, Lobachevsky, Mendeleev</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Chinese</td>
                <td className="text-right py-3 pr-6">39</td>
                <td className="text-right py-3 pr-6">14,384</td>
                <td className="py-3">Tiangong Kaiwu, Bencao Gangmu, Shanhai Jing</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Greek</td>
                <td className="text-right py-3 pr-6">37</td>
                <td className="text-right py-3 pr-6">20,437</td>
                <td className="py-3">Oxyrhynchus Papyri, Archimedes editions</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">French</td>
                <td className="text-right py-3 pr-6">29</td>
                <td className="text-right py-3 pr-6">11,012</td>
                <td className="py-3">Montaigne, Descartes, Pascal, Lavoisier</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Italian</td>
                <td className="text-right py-3 pr-6">28</td>
                <td className="text-right py-3 pr-6">12,458</td>
                <td className="py-3">Galileo, Biringuccio, Ramazzini</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Sanskrit</td>
                <td className="text-right py-3 pr-6">18</td>
                <td className="text-right py-3 pr-6">11,033</td>
                <td className="py-3">Brahmagupta, Charaka Samhita, Arthashastra</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Arabic</td>
                <td className="text-right py-3 pr-6">5</td>
                <td className="text-right py-3 pr-6">1,446</td>
                <td className="py-3">Al-Khwarizmi, Ibn al-Haytham</td>
              </tr>
              <tr className="border-b border-medium font-medium">
                <td className="py-3 pr-6">Total</td>
                <td className="text-right py-3 pr-6">949</td>
                <td className="text-right py-3 pr-6">405,562</td>
                <td className="py-3"></td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The immediately obvious problem: we asked for 45&ndash;75 books across three non-European traditions. We got 949 books across eleven languages, dominated by Latin and German philosophy. The agents did not stay in their lanes.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          What happened is instructive. The <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">arabic-science</code> agent, after importing Al-Khwarizmi and Ibn al-Haytham, appears to have followed citation trails into the Latin reception of Arabic science &mdash; which led to Copernicus, which led to Kepler, which led to the entire tradition of early modern natural philosophy. The <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">sanskrit-science</code> agent, after Brahmagupta and the Ayurvedic texts, followed connections to Renaissance encyclopedists who discussed Indian knowledge &mdash; Kircher, Aldrovandi, Gesner &mdash; and imported their complete works. The <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">chinese-science</code> agent, after the core Chinese engineering texts, branched into comparative history of science and eventually into Kierkegaard.
        </p>

        {/* --- Scope creep --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The scope creep problem
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          This is the central tension of autonomous agents: agents that follow instructions too literally are useless, and agents that interpret instructions too freely are unpredictable. Our agents were given a thematic focus (&ldquo;Arabic science&rdquo;) and a quantity target (15&ndash;25 books). They followed the thematic focus for the first few imports, then began associating outward along scholarly connections &mdash; exactly the way a human researcher would, but without the self-awareness to stop.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The result was not bad. Hegel&apos;s complete works belong in a library of intellectual history. Dostoevsky&apos;s novels are among the most widely read books in the world. Newton&apos;s <em>Principia</em> and Darwin&apos;s <em>Origin of Species</em> are foundational scientific texts. The agents were building a real library &mdash; they just were not building the library we asked for.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          For future runs, the obvious fix is tighter guardrails: enforce a language filter (only import books in Arabic/Sanskrit/Chinese), add a hard stop after N books, or require the agent to check back with the team lead every 25 imports. We did none of these. The result was a kind of intellectual browsing at machine speed &mdash; a bot version of walking into a great research library and coming out with an armload of books you did not plan to read.
        </p>

        {/* --- Cleanup pipeline --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The cleanup pipeline
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Autonomous acquisition requires autonomous cleanup. The raw output of 1,042 books (before cleanup) contained three categories of errors:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="min-w-full text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-6 font-medium">Problem</th>
                <th className="text-right py-3 pr-6 font-medium">Count</th>
                <th className="text-right py-3 pr-6 font-medium">Pages Removed</th>
                <th className="text-left py-3 font-medium">Fix</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Missing language metadata</td>
                <td className="text-right py-3 pr-6">280</td>
                <td className="text-right py-3 pr-6">&mdash;</td>
                <td className="py-3">Heuristic detection (Cyrillic &rarr; Russian, Greek chars &rarr; Greek, article patterns)</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Duplicate editions</td>
                <td className="text-right py-3 pr-6">95</td>
                <td className="text-right py-3 pr-6">37,762</td>
                <td className="py-3">Title normalization, keep highest page count</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-6">Modern books (post-1950)</td>
                <td className="text-right py-3 pr-6">2</td>
                <td className="text-right py-3 pr-6">857</td>
                <td className="py-3">Delete with audit trail</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The <strong>duplicate rate of 9.2%</strong> deserves comment. Three agents running in parallel, searching overlapping subject areas, with no shared state about what the others had imported. The only dedup check was against the existing collection via the import API&apos;s 409 response. Two agents could import the same book within minutes of each other if neither had finished its API call when the other started.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The worst case was a Russian archaeological journal that appeared fifteen times &mdash; presumably because each agent found it through a different search path and imported it before the others&apos; copies were visible. The dedup script normalized titles to their first 25 lowercase alphanumeric characters, grouped by language, and kept the copy with the most pages.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The <strong>language detection</strong> problem was more interesting. The import API accepts a <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">language</code> field, but 280 books were imported with <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">&quot;Unknown&quot;</code> &mdash; the agents did not always set it correctly. We fixed this with a simple heuristic: if the title contains Cyrillic characters, it is Russian. If it contains Greek characters, it is Greek. German articles (<em>die</em>, <em>der</em>, <em>und</em>) suggest German. French articles (<em>des</em>, <em>les</em>, <em>du</em>) suggest French. Everything else defaults to Latin &mdash; a reasonable prior for a collection dominated by early modern scholarly texts.
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
          For 949 books at an average of ~$1.90 per book through the full pipeline, the total processing cost will be approximately $1,800. At current throughput (~2,100 pages per hour for translation, the slowest step), the 405,562 pages will take roughly eight days to process. The pipeline runs continuously via cron jobs every ten minutes, with backpressure controls to prevent overwhelming the AI APIs or the database.
        </p>

        {/* --- Costs --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Cost structure
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The full cost of autonomous acquisition breaks into three parts:
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
                <td className="py-3 pr-6">Agent runtime (3 agents &times; 12h)</td>
                <td className="py-3 pr-6">~$50&ndash;100</td>
                <td className="py-3">Claude Opus API costs for search, evaluation, and import calls</td>
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
                <td className="py-3 pr-6">~$1,900&ndash;1,950</td>
                <td className="py-3">For 949 books, 405,562 pages, 11 languages</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          The unit economics work out to roughly $2 per fully processed book &mdash; discovered, imported, archived, transcribed, translated, indexed, and searchable. A comparable human-driven workflow (finding books, importing them, monitoring the pipeline) would cost orders of magnitude more in labor time. The AI processing cost dominates the budget; the acquisition cost is almost free.
        </p>

        {/* --- Lessons --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Lessons
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>1. Agents follow citation trails like researchers.</strong> The scope creep was not random &mdash; it followed scholarly connections. Arabic optics led to Latin natural philosophy led to Copernicus led to Kepler. This is exactly how human researchers browse libraries. The agents were not malfunctioning; they were doing scholarship at machine speed without the meta-awareness to stay on topic.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>2. Parallel agents without shared state create duplicates.</strong> The 9.2% duplicate rate is the cost of parallelism without coordination. A shared &ldquo;import lock&rdquo; or real-time dedup check between agents would reduce this, but at the cost of serializing imports. For our use case, post-hoc dedup was cheaper and simpler.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>3. Selection rules are the critical guardrail.</strong> The difference between a useful autonomous curator and a book-importing bot is the selection criteria. Our agents rejected modern translations, anthologies, and secondary literature &mdash; not perfectly, but well enough that 97% of imports were legitimate scholarly texts. Without these rules, the collection would be full of modern paperbacks and dissertation PDFs.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>4. Cleanup is a first-class concern.</strong> Any autonomous system that creates data needs an equally autonomous system that validates it. The language detection heuristic, duplicate finder, and modern-book filter are not afterthoughts &mdash; they are integral to the acquisition pipeline. Plan for cleanup before you start importing.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>5. Quantity targets need enforcement.</strong> Telling an agent &ldquo;import 15&ndash;25 books&rdquo; does not actually limit it to 25 books. The agent interprets this as a minimum, not a maximum. Hard stops &mdash; a counter that terminates the agent after N successful imports &mdash; would have kept the scope manageable. We chose not to use them, and got a more interesting result.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>6. The results were better than the plan.</strong> We asked for 50 books on Arabic, Sanskrit, and Chinese science. We got that, plus the complete works of Hegel, thirteen Dostoevsky novels, Newton&apos;s <em>Principia</em>, Montaigne&apos;s <em>Essais</em>, Lavoisier&apos;s chemistry, and Aldrovandi&apos;s illustrated natural history. If a human librarian had done this, we would call it inspired acquisitions work. The agents built a better library than we designed.
        </p>

        {/* --- Current state --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Current state
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          As of March 9, 2026, Source Library holds 6,135 books and 2.4 million page images. The science-acquisition batch represents about 17% of the total page count. All 949 books are enrolled in the auto pipeline and will be fully processed &mdash; archived, OCR&apos;d, translated, indexed &mdash; within roughly eight days.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Of the full collection, 989 books are fully translated and readable in English. 2,442 books are classified as first known English translations &mdash; texts that have never before been available in English. The {' '}
          <Link href="/gallery" className="text-accent-rust hover:underline">gallery</Link> contains 76,993 extracted illustrations.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We will run this experiment again &mdash; with tighter guardrails next time, and probably with six agents instead of three. The processing pipeline has no bottleneck at this scale; the limit is how fast the source libraries can serve images. The goal is a collection of 10,000 books by mid-2026, covering the full breadth of pre-modern intellectual history in original languages with AI translations. The agents got us nearly a thousand books closer in a single night.
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
          <a href="https://www.ancientwisdomtrust.org" className="text-accent-rust hover:underline">Ancient Wisdom Trust</a>, affiliated with the{' '}
          <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline">Embassy of the Free Mind</a> (Bibliotheca Philosophica Hermetica) in Amsterdam.
        </p>

      </article>

      <BlogComments slug="autonomous-agents" />
    </ContentPageLayout>
  );
}
