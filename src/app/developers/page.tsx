import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ApiKeyRequestForm from '@/components/developers/ApiKeyRequestForm';

export const metadata: Metadata = {
  title: 'Developers - Source Library',
  description: 'Search, read, and cite 1,200+ rare historical texts from the terminal or via MCP. 8 research tools, CLI + MCP server, no API key needed.',
  alternates: {
    canonical: '/developers',
  },
};

export default function DevelopersPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="For Developers & AI"
          subtitle="Search, read, and cite rare historical texts via MCP, CLI, or REST. No API key needed."
        />
      }
    >
      {/* Use case */}
      <section className="mb-16">
        <div className="bg-white rounded-xl border border-border-light p-6 md:p-8">
          <h2 className="text-lg font-semibold text-primary mb-3">What you can build</h2>
          <p className="text-secondary mb-4">
            A researcher studying Renaissance natural philosophy wants to trace how the concept of
            &ldquo;spiritus mundi&rdquo; evolves from Ficino through Agrippa to Fludd. With the MCP server
            connected to Claude, they search across all three authors&apos; translated works in a single
            conversation, pull exact passages with page citations, and compile a comparative analysis
            with DOI-backed references &mdash; work that would take days in a physical archive.
          </p>
          <p className="text-secondary">
            The same tools work for building research apps, enriching datasets with primary source
            references, or giving AI systems grounded access to pre-modern texts that aren&apos;t in
            their training data.
          </p>
        </div>
      </section>

      {/* MCP Server */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-2">MCP Server</h2>
        <p className="text-secondary mb-6 max-w-2xl">
          Gives Claude (and any MCP client) direct access to the full collection &mdash;
          search, read, quote, and browse 50,000+ illustrations. One command to install.
        </p>

        <div className="space-y-4 mb-8">
          <div className="bg-white rounded-xl border border-border-light overflow-hidden">
            <div className="bg-stone-100 px-4 py-2 border-b border-border-light">
              <span className="text-sm font-medium text-stone-700">Claude Code</span>
            </div>
            <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`claude mcp add source-library -- npx -y @source-library/mcp-server`}
            </pre>
          </div>

          <div className="bg-white rounded-xl border border-border-light overflow-hidden">
            <div className="bg-stone-100 px-4 py-2 border-b border-border-light flex items-center justify-between">
              <span className="text-sm font-medium text-stone-700">Claude Desktop</span>
              <span className="text-xs text-muted">
                macOS: ~/Library/Application Support/Claude/ &nbsp;&bull;&nbsp; Windows: %APPDATA%\Claude\
              </span>
            </div>
            <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`{
  "mcpServers": {
    "source-library": {
      "command": "npx",
      "args": ["-y", "@source-library/mcp-server"]
    }
  }
}`}
            </pre>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-10">
          <a
            href="https://www.npmjs.com/package/@source-library/mcp-server"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors text-sm"
          >
            npm package
          </a>
          <a
            href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/tree/main/mcp-server"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors text-sm"
          >
            View source
          </a>
        </div>

        {/* Tools */}
        <h3 className="text-lg font-semibold text-primary mb-4">Tools</h3>
        <div className="overflow-x-auto mb-10">
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
            </tbody>
          </table>
        </div>

        {/* Try it */}
        <h3 className="text-lg font-semibold text-primary mb-4">Try asking Claude</h3>
        <div className="space-y-2 mb-8">
          <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-4">
            &ldquo;Search for references to &lsquo;prima materia&rsquo; across the collection. Which authors discuss it, and how do their treatments differ?&rdquo;
          </p>
          <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-4">
            &ldquo;Read the full translation of Fludd&apos;s History of Both Worlds, pages 1&ndash;50. Summarize the cosmological framework.&rdquo;
          </p>
          <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-4">
            &ldquo;What does Copernicus say about the Sun&apos;s centrality in De Revolutionibus? Find the key passages with citation URLs.&rdquo;
          </p>
          <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-4">
            &ldquo;Find all alchemical emblems depicting the ouroboros. What texts are they from?&rdquo;
          </p>
        </div>
      </section>

      {/* CLI */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-2">Command Line</h2>
        <p className="text-secondary mb-6 max-w-2xl">
          Same tools as the MCP server, but standalone with colored terminal output.
          Add <code className="text-accent-rust">--json</code> for scripts.
        </p>

        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-8">
          <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`# Install
npm install -g @source-library/mcp-server

# Search the collection
source-library search "Paracelsus" --language=German

# Search inside translations
source-library translations "harmony of the spheres"

# Read a book
source-library text fludd-utriusque --from=1 --to=50

# Get exact text for quoting
source-library quote fludd-utriusque 57

# Browse illustrations
source-library images --subject=alchemy --type=emblem

# JSON output for piping
source-library search "alchemy" --json | jq .results`}
          </pre>
        </div>
      </section>

      {/* REST API */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-2">REST API</h2>
        <p className="text-secondary mb-4 max-w-2xl">
          Direct HTTP access, no authentication. The MCP server and CLI use these same endpoints.
        </p>

        <div className="bg-stone-100 rounded-lg px-4 py-2 mb-6 inline-block">
          <code className="text-stone-700">Base URL: <span className="text-accent-rust">https://sourcelibrary.org/api</span></code>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-border-light overflow-hidden">
            <div className="bg-stone-50 px-4 py-3 border-b border-border-light">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span>
                <code className="text-primary">/search</code>
              </div>
              <p className="text-secondary text-sm mt-1">Full-text search across books and page content</p>
            </div>
            <div className="p-4">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-stone-100">
                    <td className="py-2 font-mono text-accent-rust">q</td>
                    <td className="py-2 text-muted">string</td>
                    <td className="py-2 text-secondary">Search query (required)</td>
                  </tr>
                  <tr className="border-b border-stone-100">
                    <td className="py-2 font-mono text-accent-rust">language</td>
                    <td className="py-2 text-muted">string</td>
                    <td className="py-2 text-secondary">Filter by language</td>
                  </tr>
                  <tr className="border-b border-stone-100">
                    <td className="py-2 font-mono text-accent-rust">year_from / year_to</td>
                    <td className="py-2 text-muted">number</td>
                    <td className="py-2 text-secondary">Publication year range</td>
                  </tr>
                  <tr>
                    <td className="py-2 font-mono text-accent-rust">sort</td>
                    <td className="py-2 text-muted">string</td>
                    <td className="py-2 text-secondary">relevance, date_asc, date_desc, title</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-4 bg-stone-900 rounded-lg p-3">
                <code className="text-stone-300 text-sm">GET /search?q=philosopher&apos;s stone&amp;language=Latin</code>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border-light overflow-hidden">
            <div className="bg-stone-50 px-4 py-3 border-b border-border-light">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span>
                <code className="text-primary">/books/:id/text</code>
              </div>
              <p className="text-secondary text-sm mt-1">Get full book text (OCR, translation, or both) in a single call</p>
            </div>
            <div className="p-4">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-stone-100">
                    <td className="py-2 font-mono text-accent-rust">content</td>
                    <td className="py-2 text-muted">string</td>
                    <td className="py-2 text-secondary">ocr, translation, or both (default)</td>
                  </tr>
                  <tr className="border-b border-stone-100">
                    <td className="py-2 font-mono text-accent-rust">from / to</td>
                    <td className="py-2 text-muted">number</td>
                    <td className="py-2 text-secondary">Page range (inclusive)</td>
                  </tr>
                  <tr>
                    <td className="py-2 font-mono text-accent-rust">format</td>
                    <td className="py-2 text-muted">string</td>
                    <td className="py-2 text-secondary">json (structured) or plain (concatenated text)</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-4 bg-stone-900 rounded-lg p-3">
                <code className="text-stone-300 text-sm">GET /books/fludd-utriusque/text?content=translation&amp;from=1&amp;to=50</code>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                <tr>
                  <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                  <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/books/:id</td>
                  <td className="py-2.5 text-secondary">Book metadata, summary, DOI</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                  <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/books/library</td>
                  <td className="py-2.5 text-secondary">Browse with language/category/collection filters</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                  <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/books/:id/search</td>
                  <td className="py-2.5 text-secondary">Search within a book&apos;s pages</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                  <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/books/:id/quote</td>
                  <td className="py-2.5 text-secondary">Single-page text for verbatim quoting</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                  <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/gallery</td>
                  <td className="py-2.5 text-secondary">Search 50,000+ historical illustrations</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3"><span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span></td>
                  <td className="py-2.5 pr-4 font-mono text-primary whitespace-nowrap">/catalog/csv</td>
                  <td className="py-2.5 text-secondary">Download the full catalog as CSV</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Citations */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-4">Citation URLs</h2>
        <p className="text-secondary mb-6">
          Every page includes a citation URL linking directly to the source. Published editions have DOIs via Zenodo.
        </p>
        <div className="bg-white rounded-xl border border-border-light p-6 space-y-4">
          <div>
            <span className="text-sm font-medium text-muted">Page</span>
            <p className="font-mono text-stone-700 text-sm">https://sourcelibrary.org/book/fludd-utriusque?page=57</p>
          </div>
          <div>
            <span className="text-sm font-medium text-muted">Book</span>
            <p className="font-mono text-stone-700 text-sm">https://sourcelibrary.org/book/fludd-utriusque</p>
          </div>
          <div>
            <span className="text-sm font-medium text-muted">With DOI</span>
            <p className="font-mono text-stone-700 text-sm">Author, Title, trans. Source Library (Year), p. N. DOI: 10.5281/zenodo.xxxxx</p>
          </div>
        </div>
      </section>

      {/* LLMs.txt + Pipeline */}
      <section className="mb-16 space-y-4">
        <a
          href="/llms.txt"
          className="block bg-white rounded-xl border border-border-light p-6 hover:border-accent-rust/30 hover:shadow-sm transition-all"
        >
          <h3 className="text-lg font-semibold text-primary mb-1">/llms.txt</h3>
          <p className="text-secondary text-sm">
            Complete API documentation formatted for LLM consumption.
          </p>
        </a>

        <Link
          href="/developers/pipeline"
          className="block bg-white rounded-xl border border-border-light p-6 hover:border-accent-rust/30 hover:shadow-sm transition-all"
        >
          <h3 className="text-lg font-semibold text-primary mb-1">Pipeline Architecture</h3>
          <p className="text-secondary text-sm">
            How books flow through 10 processing stages: Lambda workers, SQS queues, Gemini AI,
            backpressure controls. Live counts, diagrams, cost breakdowns.
          </p>
        </Link>
      </section>

      {/* API Key Request */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-2">Dataset API</h2>
        <p className="text-secondary mb-6 max-w-2xl">
          Need bulk access to the full corpus for research or integration?
          Request an API key and we&apos;ll review it within 24 hours.
          The MCP server above doesn&apos;t require a key.
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
          <Link
            href="/blog/mcp-server"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Read the announcement
          </Link>
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
