import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Developers - Source Library',
  description: 'Search, read, and cite 1,200+ rare historical texts from the terminal or via MCP. 8 research tools, CLI + MCP server, no API key needed.',
  alternates: {
    canonical: '/developers',
  },
};

const tools = [
  {
    category: 'Search & Discovery',
    items: [
      { name: 'search_library', desc: 'Full-text search across books and page content. Returns matching books and pages with citation URLs.' },
      { name: 'search_translations', desc: 'Search inside translated text across the whole library. Find what historical authors wrote about any topic.' },
      { name: 'search_within_book', desc: 'Search inside a specific book\'s pages. Returns matching pages with snippets and citation URLs.' },
      { name: 'list_books', desc: 'Browse the collection with filters. Returns title, author, language, year, and translation progress.' },
    ],
  },
  {
    category: 'Reading',
    items: [
      { name: 'get_book', desc: 'Detailed book metadata: summary, index stats, chapters, edition info, DOI.' },
      { name: 'get_book_text', desc: 'Read a book. Returns 50+ pages of text in one call, each with a citation URL. OCR, translation, or both.' },
      { name: 'get_quote', desc: 'Get exact text of a single page for quoting. Returns translation, OCR, and citation. Always use before putting text in quotation marks.' },
    ],
  },
  {
    category: 'Gallery',
    items: [
      { name: 'search_images', desc: 'Search 50,000+ historical illustrations by subject, figure, symbol, type, or date.' },
    ],
  },
];

const examplePrompts = [
  {
    prompt: 'Search for references to "prima materia" across the collection. Which authors discuss it, and how do their treatments differ?',
    tools: 'search_translations + get_book_text',
  },
  {
    prompt: 'Read the full translation of Fludd\'s History of Both Worlds, pages 1-50. Summarize the cosmological framework.',
    tools: 'get_book_text',
  },
  {
    prompt: 'Find all alchemical emblems depicting the ouroboros. What texts are they from?',
    tools: 'search_images',
  },
  {
    prompt: 'What does Copernicus say about the Sun\'s centrality in De Revolutionibus? Find the key passages with citation URLs.',
    tools: 'search_within_book + get_book_text',
  },
  {
    prompt: 'Compare how Ficino, Bruno, and Pico della Mirandola discuss the relationship between the soul and the cosmos.',
    tools: 'search_translations + get_book_text',
  },
];

export default function DevelopersPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="For Developers & AI"
          subtitle="Search, read, and cite 1,200+ rare historical texts. CLI + MCP server, 8 research tools, no API key needed."
        />
      }
    >
      {/* MCP Server Section */}
      <section className="mb-16">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-accent-gold/15 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-accent-rust" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-primary">MCP Server</h2>
          <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">v4.1</span>
        </div>

        <p className="text-secondary mb-6 max-w-2xl">
          The Model Context Protocol server gives Claude and other MCP-compatible AI clients direct access to Source Library&apos;s full collection &mdash; search, full-text reading with citation URLs, and 50,000+ historical illustrations. No API keys, no authentication.
        </p>

        {/* Install commands */}
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

        <div className="flex flex-wrap gap-3 mb-8">
          <a
            href="https://www.npmjs.com/package/@source-library/mcp-server"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors text-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331z"/>
            </svg>
            npm package
          </a>
          <a
            href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/tree/main/mcp-server"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors text-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            View source
          </a>
        </div>

        {/* Tools grid */}
        <h3 className="text-lg font-semibold text-primary mb-4">8 Tools</h3>
        <div className="space-y-6 mb-10">
          {tools.map((group) => (
            <div key={group.category}>
              <h4 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">{group.category}</h4>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.items.map((tool) => (
                  <div key={tool.name} className="bg-white rounded-lg border border-border-light p-4">
                    <code className="text-accent-rust font-mono text-sm">{tool.name}</code>
                    <p className="text-secondary text-sm mt-2">{tool.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Example Prompts */}
        <h3 className="text-lg font-semibold text-primary mb-4">Example Research Prompts</h3>
        <div className="space-y-3 mb-8">
          {examplePrompts.map((ex, i) => (
            <div key={i} className="bg-white rounded-lg border border-border-light p-4">
              <p className="text-stone-700 italic">&ldquo;{ex.prompt}&rdquo;</p>
              <p className="text-xs text-muted mt-2">Uses: <code className="text-accent-rust">{ex.tools}</code></p>
            </div>
          ))}
        </div>
      </section>

      {/* CLI Section */}
      <section className="mb-16">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-accent-sage/15 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-accent-sage-dark" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-primary">Command Line</h2>
        </div>

        <p className="text-secondary mb-6 max-w-2xl">
          Same 8 tools as the MCP server, but as a standalone CLI with human-friendly colored output.
          Pipe with <code className="text-accent-rust">--json</code> for scripts.
        </p>

        <div className="space-y-4 mb-8">
          <div className="bg-white rounded-xl border border-border-light overflow-hidden">
            <div className="bg-stone-100 px-4 py-2 border-b border-border-light">
              <span className="text-sm font-medium text-stone-700">Install globally</span>
            </div>
            <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`npm install -g @source-library/mcp-server
source-library search "philosopher's stone"`}
            </pre>
          </div>

          <div className="bg-white rounded-xl border border-border-light overflow-hidden">
            <div className="bg-stone-100 px-4 py-2 border-b border-border-light">
              <span className="text-sm font-medium text-stone-700">Or use directly with npx</span>
            </div>
            <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`npx @source-library/mcp-server search "prima materia" --language=Latin`}
            </pre>
          </div>
        </div>

        <h3 className="text-lg font-semibold text-primary mb-4">Examples</h3>
        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-8">
          <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`# Search the collection
source-library search "Paracelsus" --language=German

# Search inside translations
source-library translations "harmony of the spheres"

# Read a book
source-library text fludd-utriusque --from=1 --to=50

# Get exact text for quoting
source-library quote fludd-utriusque 57

# Browse the gallery
source-library images --subject=alchemy --type=emblem

# JSON output for piping
source-library search "alchemy" --json | jq .results`}
          </pre>
        </div>
      </section>

      {/* REST API Section */}
      <section className="mb-16">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-stone-100 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-stone-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-primary">REST API</h2>
        </div>

        <p className="text-secondary mb-6 max-w-2xl">
          Direct HTTP access. No authentication required. The MCP server uses these same endpoints.
        </p>

        <div className="bg-stone-100 rounded-lg px-4 py-2 mb-6 inline-block">
          <code className="text-stone-700">Base URL: <span className="text-accent-rust">https://sourcelibrary.org/api</span></code>
        </div>

        {/* Endpoints */}
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
                  <tr className="border-b border-stone-100">
                    <td className="py-2 font-mono text-accent-rust">has_doi</td>
                    <td className="py-2 text-muted">boolean</td>
                    <td className="py-2 text-secondary">Only books with DOIs</td>
                  </tr>
                  <tr>
                    <td className="py-2 font-mono text-accent-rust">sort</td>
                    <td className="py-2 text-muted">string</td>
                    <td className="py-2 text-secondary">relevance, date_asc, date_desc, title</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-4 bg-stone-900 rounded-lg p-3">
                <code className="text-stone-300 text-sm">GET /search?q=philosopher&apos;s stone&amp;language=Latin&amp;has_doi=true</code>
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
                <code className="text-stone-300 text-sm">GET /books/694f49d3.../text?content=translation&amp;from=1&amp;to=50&amp;format=plain</code>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-border-light overflow-hidden">
              <div className="bg-stone-50 px-4 py-3 border-b border-border-light">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span>
                  <code className="text-primary">/books/:id</code>
                </div>
                <p className="text-secondary text-sm mt-1">Full book metadata, summary, and DOI</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-border-light overflow-hidden">
              <div className="bg-stone-50 px-4 py-3 border-b border-border-light">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span>
                  <code className="text-primary">/books/library</code>
                </div>
                <p className="text-secondary text-sm mt-1">Browse collection with language/category filters</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-border-light overflow-hidden">
              <div className="bg-stone-50 px-4 py-3 border-b border-border-light">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span>
                  <code className="text-primary">/books/:id/search</code>
                </div>
                <p className="text-secondary text-sm mt-1">Search within a specific book&apos;s pages</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-border-light overflow-hidden">
              <div className="bg-stone-50 px-4 py-3 border-b border-border-light">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span>
                  <code className="text-primary">/books/:id/quote</code>
                </div>
                <p className="text-secondary text-sm mt-1">Single-page text for verbatim quoting with citation</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-border-light overflow-hidden">
              <div className="bg-stone-50 px-4 py-3 border-b border-border-light">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span>
                  <code className="text-primary">/gallery</code>
                </div>
                <p className="text-secondary text-sm mt-1">Search 50,000+ historical illustrations</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Citation URLs */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-6">Citation URLs</h2>
        <p className="text-secondary mb-6">
          Every page returned by the MCP tools and CLI includes a citation URL that links directly to the source. Published editions include DOIs via Zenodo.
        </p>
        <div className="bg-white rounded-xl border border-border-light p-6 space-y-4">
          <div>
            <span className="text-sm font-medium text-muted">Page citation</span>
            <p className="font-mono text-stone-700 text-sm">https://sourcelibrary.org/book/fludd-utriusque?page=57</p>
          </div>
          <div>
            <span className="text-sm font-medium text-muted">Book citation</span>
            <p className="font-mono text-stone-700 text-sm">https://sourcelibrary.org/book/fludd-utriusque</p>
          </div>
          <div>
            <span className="text-sm font-medium text-muted">With DOI</span>
            <p className="font-mono text-stone-700 text-sm">Author, Title, trans. Source Library (Year), p. N. DOI: 10.5281/zenodo.xxxxx</p>
          </div>
        </div>
      </section>

      {/* LLMs.txt */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-6">For AI Systems</h2>
        <p className="text-secondary mb-4">
          Complete API documentation optimized for LLM consumption:
        </p>
        <a
          href="/llms.txt"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent-rust text-white rounded-full hover:bg-accent-rust transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          /llms.txt
        </a>
      </section>

      {/* Pipeline Architecture */}
      <section className="mb-16">
        <Link
          href="/developers/pipeline"
          className="block bg-white rounded-xl border border-border-light p-6 hover:border-accent-rust/30 hover:shadow-sm transition-all group"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-accent-rust/10 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-accent-rust" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-primary group-hover:text-accent-rust transition-colors">Pipeline Architecture</h2>
          </div>
          <p className="text-secondary max-w-2xl">
            How 4,800+ books flow through 10 processing stages — Lambda workers, SQS queues, Gemini AI,
            backpressure controls, and safety mechanisms. Live pipeline counts, infrastructure diagrams, and cost breakdowns.
          </p>
        </Link>
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
            GitHub Repository
          </a>
        </div>
      </section>
    </ContentPageLayout>
  );
}
