import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Developers - Source Library',
  description: 'Access Source Library via MCP Server or REST API. Search and cite rare historical texts programmatically with DOI-backed citations.',
  alternates: {
    canonical: '/developers',
  },
};

export default function DevelopersPage() {
  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-stone-700 hover:text-stone-900 transition-colors">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span className="font-medium">Source Library</span>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-16">
        <div className="max-w-5xl mx-auto px-6">
          <h1
            className="text-4xl md:text-5xl mb-4"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
          >
            For Developers & AI Systems
          </h1>
          <p className="text-xl text-stone-300 max-w-2xl">
            Access 500+ translated historical texts via MCP Server or REST API. Search, quote, and cite with DOI-backed references.
          </p>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* MCP Server Section */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-stone-900">MCP Server</h2>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">Recommended</span>
          </div>

          <p className="text-stone-600 mb-6 max-w-2xl">
            The Model Context Protocol server gives Claude Desktop and other MCP-compatible AI clients direct access to Source Library. No API keys required.
          </p>

          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden mb-6">
            <div className="bg-stone-100 px-4 py-2 border-b border-stone-200 flex items-center justify-between">
              <span className="text-sm font-medium text-stone-700">claude_desktop_config.json</span>
              <span className="text-xs text-stone-500">
                macOS: ~/Library/Application Support/Claude/ &nbsp;•&nbsp; Windows: %APPDATA%\Claude\
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

          {/* MCP Tools */}
          <h3 className="text-lg font-semibold text-stone-900 mb-4">Available Tools</h3>
          <div className="grid md:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-lg border border-stone-200 p-4">
              <code className="text-amber-700 font-mono text-sm">search_library</code>
              <p className="text-stone-600 text-sm mt-2">Search across all translated books by title, author, or content.</p>
            </div>
            <div className="bg-white rounded-lg border border-stone-200 p-4">
              <code className="text-amber-700 font-mono text-sm">get_quote</code>
              <p className="text-stone-600 text-sm mt-2">Get a passage with formatted academic citations and DOI.</p>
            </div>
            <div className="bg-white rounded-lg border border-stone-200 p-4">
              <code className="text-amber-700 font-mono text-sm">get_book</code>
              <p className="text-stone-600 text-sm mt-2">Get detailed book info including summary and edition data.</p>
            </div>
          </div>

          {/* Example Prompts */}
          <h3 className="text-lg font-semibold text-stone-900 mb-4">Example Prompts</h3>
          <div className="space-y-3 mb-8">
            {[
              "What did Paracelsus write about the quinta essentia? Give me a quote with citation.",
              "Find 16th century Latin texts about transmutation and summarize their main arguments.",
              "I need a primary source quote about Renaissance alchemy for my paper, with proper DOI citation.",
              "How did different alchemical authors describe the philosopher's stone? Compare three sources.",
            ].map((prompt, i) => (
              <div key={i} className="bg-white rounded-lg border border-stone-200 p-4">
                <p className="text-stone-700 italic">&ldquo;{prompt}&rdquo;</p>
              </div>
            ))}
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
            <h2 className="text-2xl font-semibold text-stone-900">REST API</h2>
          </div>

          <p className="text-stone-600 mb-6 max-w-2xl">
            Direct HTTP access to search, retrieve quotes, and get book metadata. No authentication required.
          </p>

          <div className="bg-stone-100 rounded-lg px-4 py-2 mb-6 inline-block">
            <code className="text-stone-700">Base URL: <span className="text-amber-700">https://sourcelibrary.org/api</span></code>
          </div>

          {/* Endpoints */}
          <div className="space-y-6">
            {/* Search */}
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <div className="bg-stone-50 px-4 py-3 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span>
                  <code className="text-stone-900">/search</code>
                </div>
                <p className="text-stone-600 text-sm mt-1">Search the library by title, author, or full text content</p>
              </div>
              <div className="p-4">
                <h4 className="text-sm font-medium text-stone-700 mb-2">Parameters</h4>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-stone-100">
                      <td className="py-2 font-mono text-amber-700">q</td>
                      <td className="py-2 text-stone-500">string</td>
                      <td className="py-2 text-stone-600">Search query (required)</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-2 font-mono text-amber-700">language</td>
                      <td className="py-2 text-stone-500">string</td>
                      <td className="py-2 text-stone-600">Filter by original language (Latin, German, etc.)</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-2 font-mono text-amber-700">has_doi</td>
                      <td className="py-2 text-stone-500">boolean</td>
                      <td className="py-2 text-stone-600">Only return books with DOIs</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-mono text-amber-700">limit</td>
                      <td className="py-2 text-stone-500">number</td>
                      <td className="py-2 text-stone-600">Max results (default 20)</td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-4 bg-stone-900 rounded-lg p-3">
                  <code className="text-stone-300 text-sm">GET /search?q=philosopher&apos;s stone&language=Latin&has_doi=true</code>
                </div>
              </div>
            </div>

            {/* Get Quote */}
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <div className="bg-stone-50 px-4 py-3 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span>
                  <code className="text-stone-900">/books/:id/quote</code>
                </div>
                <p className="text-stone-600 text-sm mt-1">Get a translated passage with formatted citations</p>
              </div>
              <div className="p-4">
                <h4 className="text-sm font-medium text-stone-700 mb-2">Parameters</h4>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-stone-100">
                      <td className="py-2 font-mono text-amber-700">page</td>
                      <td className="py-2 text-stone-500">number</td>
                      <td className="py-2 text-stone-600">Page number (required)</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-2 font-mono text-amber-700">include_original</td>
                      <td className="py-2 text-stone-500">boolean</td>
                      <td className="py-2 text-stone-600">Include original language text (default true)</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-mono text-amber-700">include_context</td>
                      <td className="py-2 text-stone-500">boolean</td>
                      <td className="py-2 text-stone-600">Include adjacent pages for context</td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-4 bg-stone-900 rounded-lg p-3">
                  <code className="text-stone-300 text-sm">GET /books/6836f8ee811c8ab472a49e36/quote?page=57</code>
                </div>
              </div>
            </div>

            {/* Get Book */}
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <div className="bg-stone-50 px-4 py-3 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span>
                  <code className="text-stone-900">/books/:id</code>
                </div>
                <p className="text-stone-600 text-sm mt-1">Get full book metadata including summary and DOI</p>
              </div>
            </div>

            {/* List Books */}
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <div className="bg-stone-50 px-4 py-3 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">GET</span>
                  <code className="text-stone-900">/books</code>
                </div>
                <p className="text-stone-600 text-sm mt-1">List all books in the library</p>
              </div>
            </div>
          </div>
        </section>

        {/* Citation Format */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-stone-900 mb-6">Citation Format</h2>
          <p className="text-stone-600 mb-6">
            All published editions have DOIs via Zenodo. When citing Source Library translations:
          </p>
          <div className="bg-white rounded-xl border border-stone-200 p-6 space-y-4">
            <div>
              <span className="text-sm font-medium text-stone-500">Inline</span>
              <p className="font-mono text-stone-700">(Author Year, p. N)</p>
            </div>
            <div>
              <span className="text-sm font-medium text-stone-500">Footnote</span>
              <p className="font-mono text-stone-700 text-sm">Author, Title, trans. Source Library (Year), Page. DOI: ...</p>
            </div>
            <div>
              <span className="text-sm font-medium text-stone-500">Bibliography</span>
              <p className="font-mono text-stone-700 text-sm">Author. Title. Translated by Source Library. Year. DOI: ...</p>
            </div>
          </div>
        </section>

        {/* LLMs.txt */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-stone-900 mb-6">For AI Systems</h2>
          <p className="text-stone-600 mb-4">
            Complete API documentation optimized for LLM consumption is available at:
          </p>
          <a
            href="/llms.txt"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-700 text-white rounded-full hover:bg-amber-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            /llms.txt
          </a>
        </section>

        {/* Links */}
        <section className="border-t border-stone-200 pt-8">
          <div className="flex flex-wrap gap-4">
            <Link
              href="/"
              className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
            >
              Browse the Library
            </Link>
            <Link
              href="/about"
              className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
            >
              About Source Library
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
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200 py-8 mt-16 bg-white">
        <div className="max-w-5xl mx-auto px-6 text-center text-gray-600">
          <p>&copy; {new Date().getFullYear()} Source Library — A project of the Ancient Wisdom Trust</p>
          <p className="mt-2 text-sm">CC0 Public Domain</p>
        </div>
      </footer>
    </div>
  );
}
