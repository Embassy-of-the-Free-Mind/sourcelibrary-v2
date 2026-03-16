import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Claude Can Now Read Thousands of Rare Books - Research Notes - Source Library',
  description: 'We shipped an MCP server that gives Claude direct access to Source Library — thousands of historical texts with translations, a cross-book entity graph, and 50,000+ illustrations. One command to install.',
  openGraph: {
    title: 'Claude Can Now Read Thousands of Rare Books',
    description: 'An MCP server that gives Claude direct access to Source Library — thousands of historical texts with translations, a cross-book entity graph, and 50,000+ illustrations.',
    images: [{ url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699065973dc2ed39a49f1e71/4.jpg', width: 1200, height: 630 }],
  },
  alternates: {
    canonical: '/blog/mcp-server',
  },
};

export default function McpServerPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Claude Can Now Read Thousands of Rare Books"
          subtitle="An MCP server for primary source research in alchemy, Hermeticism, Renaissance philosophy, and early modern science"
        >
          <p className="text-stone-400 text-sm mt-4">18 February 2026 &middot; 8 min read</p>
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
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Today we&apos;re releasing an{' '}
          <a href="https://www.npmjs.com/package/@source-library/mcp-server" className="text-accent-rust hover:text-accent-rust underline" target="_blank" rel="noopener noreferrer">MCP server</a>
          {' '}that gives Claude direct access to Source Library. One command, no API key, and Claude can search, read, and cite thousands of historical texts &mdash; with full English translations, a cross-book entity knowledge graph, and 50,000+ extracted illustrations.
        </p>

        <div className="bg-stone-900 rounded-xl p-4 mb-8 overflow-x-auto">
          <code className="text-stone-100 text-sm">claude mcp add source-library -- npx -y @source-library/mcp-server</code>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          <a href="https://modelcontextprotocol.io/" className="text-accent-rust hover:text-accent-rust underline" target="_blank" rel="noopener noreferrer">MCP</a>
          {' '}(Model Context Protocol) is an open standard that lets AI assistants connect to external data sources. Instead of pasting text into a chat window, you give Claude a set of tools &mdash; and it decides when and how to use them. Our server provides 11 tools covering search, full-text reading, entity lookup, academic citation, and image retrieval.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What you can do with it
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The point isn&apos;t to query a database. It&apos;s to do research. Here are some things that now work naturally in a conversation with Claude:
        </p>

        {/* Example 1 */}
        <h3 className="text-xl font-semibold text-primary mt-10 mb-4">Trace a concept across centuries</h3>

        <div className="bg-white rounded-xl border border-border-light p-6 mb-4">
          <p className="text-stone-700 italic mb-2">&ldquo;Search for references to &lsquo;prima materia&rsquo; across the collection. How do different alchemical authors describe it?&rdquo;</p>
          <p className="text-xs text-muted">Tools used: <code className="text-accent-rust">search_library</code> &rarr; <code className="text-accent-rust">get_book_text</code></p>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Claude searches the full text of every translated book, finds passages discussing prima materia in works spanning the 15th to 17th centuries, reads the relevant pages, and synthesizes a comparative analysis. It can pull the original Latin alongside the translation, showing you exactly what Sendivogius wrote versus what Basil Valentine wrote &mdash; with page numbers and links back to the source.
        </p>

        {/* Example 2 */}
        <h3 className="text-xl font-semibold text-primary mt-10 mb-4">Follow a figure through the tradition</h3>

        <div className="bg-white rounded-xl border border-border-light p-6 mb-4">
          <p className="text-stone-700 italic mb-2">&ldquo;Find everything about Hermes Trismegistus in the collection. What books mention him, and how does his treatment change across traditions?&rdquo;</p>
          <p className="text-xs text-muted">Tools used: <code className="text-accent-rust">search_entities</code> &rarr; <code className="text-accent-rust">get_entity</code> &rarr; <code className="text-accent-rust">get_book_text</code></p>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Source Library maintains a knowledge graph of entities &mdash; people, places, and concepts &mdash; linked across books. Hermes Trismegistus, for example, appears in 18 books with 441 total mentions, connecting:
        </p>

        <ul className="space-y-2 mb-8 ml-4">
          <li className="text-secondary flex items-start gap-2">
            <span className="text-accent-rust mt-1.5 text-xs">&#9679;</span>
            <span>Ficino&apos;s <Link href="/book/690989d5cf28baa1b4cae1c9" className="text-accent-rust hover:text-accent-rust underline"><em>Pymander</em></Link> &mdash; the 1471 translation that launched the Hermetic revival</span>
          </li>
          <li className="text-secondary flex items-start gap-2">
            <span className="text-accent-rust mt-1.5 text-xs">&#9679;</span>
            <span>Copernicus&apos;s <Link href="/book/694f49d3f9b1ecc07965e424" className="text-accent-rust hover:text-accent-rust underline"><em>De Revolutionibus</em></Link> &mdash; which quotes Hermes on the Sun&apos;s centrality</span>
          </li>
          <li className="text-secondary flex items-start gap-2">
            <span className="text-accent-rust mt-1.5 text-xs">&#9679;</span>
            <span>The <Link href="/book/695203a5ab34727b1f041c53" className="text-accent-rust hover:text-accent-rust underline"><em>Musaeum Hermeticum</em></Link> &mdash; 543 pages of alchemical texts under his name</span>
          </li>
          <li className="text-secondary flex items-start gap-2">
            <span className="text-accent-rust mt-1.5 text-xs">&#9679;</span>
            <span>Kepler&apos;s <Link href="/book/6fc11c7d-782a-47c3-a855-f3b4415e797b" className="text-accent-rust hover:text-accent-rust underline"><em>Harmonices Mundi</em></Link>, the <Link href="/book/6da19aeb-aec0-411c-b890-73035c92273d" className="text-accent-rust hover:text-accent-rust underline"><em>Fama Fraternitatis</em></Link>, Kircher&apos;s <Link href="/book/6952050fab34727b1f04216b" className="text-accent-rust hover:text-accent-rust underline"><em>Musurgia Universalis</em></Link>, and more</span>
          </li>
        </ul>

        <p className="text-secondary leading-relaxed mb-8">
          Claude can follow these connections, read the relevant passages in each book, and show you how the figure of Hermes shifts from Ficino&apos;s prisca theologia to the Rosicrucian manifestos to Kircher&apos;s baroque syncretism &mdash; all grounded in the primary sources.
        </p>

        {/* Example 3 */}
        <h3 className="text-xl font-semibold text-primary mt-10 mb-4">Read a book and ask questions</h3>

        <div className="bg-white rounded-xl border border-border-light p-6 mb-4">
          <p className="text-stone-700 italic mb-2">&ldquo;Read the first 50 pages of Galileo&apos;s Sidereus Nuncius and summarize what he observed through the telescope.&rdquo;</p>
          <p className="text-xs text-muted">Tools used: <code className="text-accent-rust">search_library</code> &rarr; <code className="text-accent-rust">get_book_text</code></p>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          The <code className="text-accent-rust text-sm">get_book_text</code> tool returns the complete text of a book &mdash; or a page range &mdash; in a single call. Claude can read 50 pages of the 1610 <em>Sidereus Nuncius</em> in both the original Latin and translation, then discuss the content as a reading partner who has actually read the text. This is the difference between searching <em>about</em> a book and reading <em>the book</em>.
        </p>

        {/* Example 4 */}
        <h3 className="text-xl font-semibold text-primary mt-10 mb-4">Get a citation for your paper</h3>

        <div className="bg-white rounded-xl border border-border-light p-6 mb-4">
          <p className="text-stone-700 italic mb-2">&ldquo;I need a quote from Copernicus about the Sun&apos;s centrality in the universe, with a proper citation I can use in my paper.&rdquo;</p>
          <p className="text-xs text-muted">Tools used: <code className="text-accent-rust">search_library</code> &rarr; <code className="text-accent-rust">get_quote</code></p>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          The <code className="text-accent-rust text-sm">get_quote</code> tool returns the passage alongside pre-formatted citations &mdash; inline, footnote, and bibliography formats &mdash; with DOI when available. Claude finds the relevant passage, gives you the Latin and English, and hands you a citation ready to paste into your paper.
        </p>

        {/* Example 5 */}
        <h3 className="text-xl font-semibold text-primary mt-10 mb-4">Explore historical illustrations</h3>

        <div className="bg-white rounded-xl border border-border-light p-6 mb-4">
          <p className="text-stone-700 italic mb-2">&ldquo;Find alchemical emblems depicting the ouroboros. What texts are they from, and what do they symbolize?&rdquo;</p>
          <p className="text-xs text-muted">Tools used: <code className="text-accent-rust">search_images</code> &rarr; <code className="text-accent-rust">get_image</code> &rarr; <code className="text-accent-rust">get_book_text</code></p>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Source Library has extracted and catalogued 50,000+ illustrations from its books &mdash; woodcuts, engravings, emblems, frontispieces, diagrams &mdash; each with AI-generated metadata including subject tags, depicted figures, symbols, and museum-style descriptions. Claude can search this gallery, find the images, identify which books they come from, and read the surrounding text to explain their context.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The collection
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Source Library holds over 4,000 books digitized from 13 archives worldwide &mdash; the Internet Archive, Gallica, the Bodleian, the Vatican Library, the Bavarian State Library, and others. The collection focuses on the Western esoteric tradition broadly defined:
        </p>

        <ul className="space-y-2 mb-8 ml-4">
          <li className="text-secondary flex items-start gap-2">
            <span className="text-accent-rust mt-1.5 text-xs">&#9679;</span>
            <span>Latin alchemical and Hermetic manuscripts (1450&ndash;1700)</span>
          </li>
          <li className="text-secondary flex items-start gap-2">
            <span className="text-accent-rust mt-1.5 text-xs">&#9679;</span>
            <span>German mystical and Paracelsian works</span>
          </li>
          <li className="text-secondary flex items-start gap-2">
            <span className="text-accent-rust mt-1.5 text-xs">&#9679;</span>
            <span>Renaissance philosophy &mdash; Ficino, Bruno, Pico, Agrippa</span>
          </li>
          <li className="text-secondary flex items-start gap-2">
            <span className="text-accent-rust mt-1.5 text-xs">&#9679;</span>
            <span>Rosicrucian manifestos and related texts</span>
          </li>
          <li className="text-secondary flex items-start gap-2">
            <span className="text-accent-rust mt-1.5 text-xs">&#9679;</span>
            <span>Early modern science &mdash; Copernicus, Galileo, Kepler</span>
          </li>
          <li className="text-secondary flex items-start gap-2">
            <span className="text-accent-rust mt-1.5 text-xs">&#9679;</span>
            <span>Sanskrit, Chinese, Greek, Arabic, and Hebrew philosophical texts</span>
          </li>
        </ul>

        <p className="text-secondary leading-relaxed mb-8">
          Every book has been OCR&apos;d from the original page images and translated to English by AI, with the original language always preserved alongside for verification. Published editions carry DOIs via Zenodo. Everything is CC0 public domain.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          How it works
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The MCP server runs locally on your machine and calls Source Library&apos;s public API. It doesn&apos;t need database credentials, API keys, or any configuration. When Claude needs to search for a book or read a passage, it calls the appropriate tool, the server makes an HTTP request to <code className="text-accent-rust text-sm">sourcelibrary.org/api</code>, and the result comes back into the conversation.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The 11 tools are organized into four groups:
        </p>

        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <div className="bg-white rounded-lg border border-border-light p-5">
            <h4 className="font-semibold text-primary mb-2">Discovery</h4>
            <p className="text-secondary text-sm">
              <code className="text-accent-rust">search_library</code> for full-text search across all books and pages.{' '}
              <code className="text-accent-rust">list_books</code> for browsing with filters (language, category, sort).
            </p>
          </div>
          <div className="bg-white rounded-lg border border-border-light p-5">
            <h4 className="font-semibold text-primary mb-2">Reading</h4>
            <p className="text-secondary text-sm">
              <code className="text-accent-rust">get_book_text</code> for bulk reading (whole books or page ranges).{' '}
              <code className="text-accent-rust">get_book</code> for metadata.{' '}
              <code className="text-accent-rust">get_quote</code> for cited passages.
            </p>
          </div>
          <div className="bg-white rounded-lg border border-border-light p-5">
            <h4 className="font-semibold text-primary mb-2">Knowledge Graph</h4>
            <p className="text-secondary text-sm">
              <code className="text-accent-rust">search_index</code> for concepts, people, and places in book indexes.{' '}
              <code className="text-accent-rust">search_entities</code> and <code className="text-accent-rust">get_entity</code> for the cross-book entity network.
            </p>
          </div>
          <div className="bg-white rounded-lg border border-border-light p-5">
            <h4 className="font-semibold text-primary mb-2">Gallery</h4>
            <p className="text-secondary text-sm">
              <code className="text-accent-rust">search_images</code> across 50,000+ illustrations by subject, symbol, figure, or type.{' '}
              <code className="text-accent-rust">get_image</code> and <code className="text-accent-rust">get_book_images</code> for details.
            </p>
          </div>
        </div>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Install
        </h2>

        <p className="text-secondary leading-relaxed mb-4">
          For Claude Code:
        </p>

        <div className="bg-stone-900 rounded-xl p-4 mb-6 overflow-x-auto">
          <code className="text-stone-100 text-sm">claude mcp add source-library -- npx -y @source-library/mcp-server</code>
        </div>

        <p className="text-secondary leading-relaxed mb-4">
          For Claude Desktop, add this to your config file (<code className="text-accent-rust text-sm">claude_desktop_config.json</code>):
        </p>

        <div className="bg-stone-900 rounded-xl p-4 mb-8 overflow-x-auto">
          <pre className="text-stone-100 text-sm">{`{
  "mcpServers": {
    "source-library": {
      "command": "npx",
      "args": ["-y", "@source-library/mcp-server"]
    }
  }
}`}</pre>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          The server is{' '}
          <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/tree/main/mcp-server" className="text-accent-rust hover:text-accent-rust underline" target="_blank" rel="noopener noreferrer">open source</a>
          {' '}and published on{' '}
          <a href="https://www.npmjs.com/package/@source-library/mcp-server" className="text-accent-rust hover:text-accent-rust underline" target="_blank" rel="noopener noreferrer">npm</a>. Full documentation is on the{' '}
          <Link href="/developers" className="text-accent-rust hover:text-accent-rust underline">developers page</Link>.
        </p>

        <div className="border-t border-border-light pt-8 mt-16">
          <p className="text-secondary text-sm leading-relaxed">
            Source Library is a project of the Embassy of the Free Mind. Everything in the collection is CC0 public domain. If you use it for research, we&apos;d love to hear about it &mdash;{' '}
            <a href="mailto:derek@ancientwisdomtrust.org" className="text-accent-rust hover:text-accent-rust underline">derek@ancientwisdomtrust.org</a>.
          </p>
        </div>
      </article>

      <BlogComments slug="mcp-server" />
    </ContentPageLayout>
  );
}
