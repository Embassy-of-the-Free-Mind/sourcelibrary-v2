import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ApiKeyRequestForm from '@/components/developers/ApiKeyRequestForm';

export const metadata: Metadata = {
  title: 'Connect to Source Library - Source Library',
  description: 'Give Claude access to 5,000+ rare historical texts. Connect in 30 seconds — search, read, and cite with page-level precision.',
  alternates: {
    canonical: '/developers',
  },
};

export default function DevelopersPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Connect to Source Library"
          subtitle="Give Claude direct access to 5,000+ rare historical texts — translated into English for the first time."
        />
      }
    >
      {/* Quick connect */}
      <section className="mb-16">
        <div className="bg-white rounded-xl border-2 border-accent-rust/20 p-6 md:p-8">
          <h2 className="text-xl font-semibold text-primary mb-1">Connect in 30 seconds</h2>
          <p className="text-secondary mb-6">No API key, no install, no account needed.</p>

          <div className="space-y-6">
            {/* Claude Chat */}
            <div>
              <h3 className="text-sm font-semibold text-stone-700 mb-3">Claude Chat &amp; Cowork</h3>
              <ol className="space-y-2 text-sm text-secondary">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-rust/10 text-accent-rust text-xs font-bold flex items-center justify-center">1</span>
                  <span>Open <strong>Customize</strong> (click your profile icon in Claude)</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-rust/10 text-accent-rust text-xs font-bold flex items-center justify-center">2</span>
                  <span>Go to <strong>Connectors</strong>, click <strong>+</strong>, then <strong>Add custom connector</strong></span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-rust/10 text-accent-rust text-xs font-bold flex items-center justify-center">3</span>
                  <span>Paste the URL below and click <strong>Add</strong></span>
                </li>
              </ol>
              <div className="mt-3 bg-stone-900 rounded-lg p-4">
                <code className="text-stone-100 text-sm select-all">https://sourcelibrary.org/api/mcp</code>
              </div>
            </div>

            {/* Claude Code */}
            <div>
              <h3 className="text-sm font-semibold text-stone-700 mb-2">Claude Code</h3>
              <pre className="p-3 text-sm overflow-x-auto bg-stone-900 text-stone-100 rounded-lg">
{`claude mcp add source-library -- npx -y @source-library/mcp-server`}
              </pre>
            </div>

            {/* Claude Desktop */}
            <details className="group">
              <summary className="text-sm font-semibold text-stone-700 cursor-pointer hover:text-accent-rust">
                Claude Desktop &mdash; click to expand
              </summary>
              <div className="mt-2 text-xs text-muted mb-2">
                Add to <code>claude_desktop_config.json</code> &mdash;
                macOS: ~/Library/Application Support/Claude/ &nbsp;&bull;&nbsp; Windows: %APPDATA%\Claude\
              </div>
              <pre className="p-3 text-sm overflow-x-auto bg-stone-900 text-stone-100 rounded-lg">
{`{
  "mcpServers": {
    "source-library": {
      "command": "npx",
      "args": ["-y", "@source-library/mcp-server"]
    }
  }
}`}
              </pre>
            </details>
          </div>
        </div>
      </section>

      {/* What can you do */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-6">What can you do with it?</h2>

        <div className="grid md:grid-cols-2 gap-5">
          <div className="bg-white rounded-xl border border-border-light p-6">
            <h3 className="font-semibold text-primary mb-2">Trace ideas across centuries</h3>
            <p className="text-secondary text-sm mb-4">
              Search for a concept like &ldquo;prima materia&rdquo; or &ldquo;harmony of the spheres&rdquo;
              and find every author who discussed it &mdash; with exact page citations.
            </p>
            <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-3">
              &ldquo;Search for references to the philosopher&apos;s stone across the collection. How does the concept change from the 15th to 17th century?&rdquo;
            </p>
          </div>

          <div className="bg-white rounded-xl border border-border-light p-6">
            <h3 className="font-semibold text-primary mb-2">Read rare books in English</h3>
            <p className="text-secondary text-sm mb-4">
              Read full chapters of Latin, German, and Greek texts in English translation.
              Every passage includes a citation URL linking back to the original facsimile page.
            </p>
            <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-3">
              &ldquo;Read chapter 1 of Fludd&apos;s History of Both Worlds. What is his cosmological framework?&rdquo;
            </p>
          </div>

          <div className="bg-white rounded-xl border border-border-light p-6">
            <h3 className="font-semibold text-primary mb-2">Browse historical illustrations</h3>
            <p className="text-secondary text-sm mb-4">
              Search 50,000+ cataloged images &mdash; alchemical emblems, astronomical diagrams,
              anatomical woodcuts, Kabbalistic trees &mdash; by subject, symbol, or figure.
            </p>
            <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-3">
              &ldquo;Find all alchemical emblems depicting the ouroboros. What texts are they from?&rdquo;
            </p>
          </div>

          <div className="bg-white rounded-xl border border-border-light p-6">
            <h3 className="font-semibold text-primary mb-2">Quote with precision</h3>
            <p className="text-secondary text-sm mb-4">
              Get exact text for any page with a citation URL and DOI.
              Claude will copy text verbatim &mdash; no paraphrasing, no hallucination.
            </p>
            <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-3">
              &ldquo;What does Copernicus say about the Sun&apos;s centrality in De Revolutionibus? Give me the exact passage with citation.&rdquo;
            </p>
          </div>
        </div>
      </section>

      {/* Tools reference */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-2">9 research tools</h2>
        <p className="text-secondary mb-6 max-w-2xl">
          All tools work automatically &mdash; just ask Claude a question and it picks the right ones.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-stone-100">
              <tr>
                <td className="py-2.5 pr-4 font-mono text-accent-rust whitespace-nowrap">search_library</td>
                <td className="py-2.5 text-secondary">Full-text search across books and page content</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono text-accent-rust whitespace-nowrap">search_translations</td>
                <td className="py-2.5 text-secondary">Search inside translated text across the whole library</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono text-accent-rust whitespace-nowrap">search_within_book</td>
                <td className="py-2.5 text-secondary">Search inside a specific book&apos;s pages</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono text-accent-rust whitespace-nowrap">list_books</td>
                <td className="py-2.5 text-secondary">Browse with filters &mdash; language, year, category, translation status</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono text-accent-rust whitespace-nowrap">get_book</td>
                <td className="py-2.5 text-secondary">Book metadata: summary, chapters, edition info, DOI</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono text-accent-rust whitespace-nowrap">get_book_text</td>
                <td className="py-2.5 text-secondary">Read 50+ pages in one call &mdash; OCR, translation, or both</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono text-accent-rust whitespace-nowrap">get_quote</td>
                <td className="py-2.5 text-secondary">Exact text of a single page with citation URL</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono text-accent-rust whitespace-nowrap">search_images</td>
                <td className="py-2.5 text-secondary">Search 50,000+ historical illustrations by subject, symbol, type</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono text-accent-rust whitespace-nowrap">submit_feedback</td>
                <td className="py-2.5 text-secondary">Send feedback or bug reports to the Source Library team</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* For developers - collapsed technical details */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-6">For developers</h2>

        <div className="space-y-4">
          {/* REST API */}
          <details className="group bg-white rounded-xl border border-border-light overflow-hidden">
            <summary className="px-6 py-4 cursor-pointer hover:bg-stone-50 transition-colors">
              <span className="font-semibold text-primary">REST API</span>
              <span className="text-secondary text-sm ml-2">&mdash; direct HTTP access, no authentication</span>
            </summary>
            <div className="px-6 pb-6 border-t border-border-light pt-4">
              <div className="bg-stone-100 rounded-lg px-4 py-2 mb-4 inline-block">
                <code className="text-stone-700">Base URL: <span className="text-accent-rust">https://sourcelibrary.org/api</span></code>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-stone-100">
                    <tr>
                      <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                      <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/search?q=...</td>
                      <td className="py-2.5 text-secondary">Full-text search</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                      <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/books/:id</td>
                      <td className="py-2.5 text-secondary">Book metadata, summary, DOI</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                      <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/books/:id/text</td>
                      <td className="py-2.5 text-secondary">Read pages (OCR, translation, or both)</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                      <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/books/:id/quote?page=N</td>
                      <td className="py-2.5 text-secondary">Single-page text for verbatim quoting</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                      <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/books/:id/search?q=...</td>
                      <td className="py-2.5 text-secondary">Search within a book</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                      <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/books/library</td>
                      <td className="py-2.5 text-secondary">Browse with filters</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                      <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/gallery</td>
                      <td className="py-2.5 text-secondary">Search 50,000+ illustrations</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                      <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/catalog/csv</td>
                      <td className="py-2.5 text-secondary">Full catalog download</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </details>

          {/* CLI */}
          <details className="group bg-white rounded-xl border border-border-light overflow-hidden">
            <summary className="px-6 py-4 cursor-pointer hover:bg-stone-50 transition-colors">
              <span className="font-semibold text-primary">Command Line</span>
              <span className="text-secondary text-sm ml-2">&mdash; standalone terminal tool with colored output</span>
            </summary>
            <div className="px-6 pb-6 border-t border-border-light pt-4">
              <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100 rounded-lg">
{`# Install
npm install -g @source-library/mcp-server

# Search the collection
source-library search "Paracelsus" --language=German

# Search inside translations
source-library translations "harmony of the spheres"

# Read a book
source-library text fludd-utriusque --from=1 --to=50

# JSON output for piping
source-library search "alchemy" --json | jq .results`}
              </pre>
            </div>
          </details>

          {/* Scholarly Standards */}
          <details className="group bg-white rounded-xl border border-border-light overflow-hidden">
            <summary className="px-6 py-4 cursor-pointer hover:bg-stone-50 transition-colors">
              <span className="font-semibold text-primary">Scholarly Standards</span>
              <span className="text-secondary text-sm ml-2">&mdash; IIIF, DTS, DOI citations</span>
            </summary>
            <div className="px-6 pb-6 border-t border-border-light pt-4">
              <p className="text-secondary text-sm mb-4">
                Every book is available through IIIF (page images) and DTS (structured text).
                Published editions have DOIs via Zenodo.
              </p>
              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-xs font-medium text-muted">Page citation</span>
                  <p className="font-mono text-stone-700 text-xs break-all">sourcelibrary.org/book/fludd-utriusque?page=57</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-muted">IIIF manifest</span>
                  <p className="font-mono text-stone-700 text-xs break-all">sourcelibrary.org/api/iiif/:id/manifest</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-muted">DTS entry point</span>
                  <p className="font-mono text-stone-700 text-xs break-all">sourcelibrary.org/api/dts</p>
                </div>
              </div>
            </div>
          </details>

          {/* LLMs.txt */}
          <a
            href="/llms.txt"
            className="block bg-white rounded-xl border border-border-light px-6 py-4 hover:border-accent-rust/30 hover:shadow-sm transition-all"
          >
            <span className="font-semibold text-primary">/llms.txt</span>
            <span className="text-secondary text-sm ml-2">&mdash; full API docs formatted for LLM consumption</span>
          </a>
        </div>
      </section>

      {/* Dataset API */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-2">Dataset API</h2>
        <p className="text-secondary mb-6 max-w-2xl">
          Need bulk access to the full corpus for research or integration?
          Request an API key and we&apos;ll review it within 24 hours.
          Everything above doesn&apos;t require a key.
        </p>
        <div className="bg-white rounded-xl border border-border-light p-6 md:p-8">
          <ApiKeyRequestForm />
        </div>
      </section>

      {/* Links */}
      <section className="border-t border-border-light pt-8">
        <div className="flex flex-wrap gap-4">
          <Link
            href="/"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Browse the Library
          </Link>
          <a
            href="https://www.npmjs.com/package/@source-library/mcp-server"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            npm package
          </a>
          <a
            href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            GitHub
          </a>
        </div>
      </section>
    </ContentPageLayout>
  );
}
