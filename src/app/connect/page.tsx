import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Connect Source Library to Claude',
  description: 'Give Claude access to 15,000+ rare pre-modern texts in 30 seconds — theology, philosophy, history, science, mysticism, literature. Search, read, and cite primary sources directly in your conversation.',
  alternates: { canonical: '/connect' },
};

export default function ConnectPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Connect Source Library to Claude"
          subtitle="Search, read, and cite 15,000+ rare pre-modern texts in English — directly in your conversation."
        />
      }
    >
      {/* Setup steps */}
      <section className="mb-16">
        <div className="space-y-10">

          {/* Step 1 */}
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-rust text-white text-sm font-bold flex items-center justify-center">1</span>
                <h2 className="text-lg font-semibold text-primary">Open Connectors</h2>
              </div>
              <p className="text-secondary ml-11">
                In Claude, click your <strong>profile icon</strong> (bottom-left),
                then <strong>Customize</strong>, then go to <strong>Connectors</strong>.
              </p>
              <p className="text-muted text-sm ml-11 mt-2">
                Requires a Claude Pro, Team, or Enterprise plan.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-rust text-white text-sm font-bold flex items-center justify-center">2</span>
                <h2 className="text-lg font-semibold text-primary">Add custom connector</h2>
              </div>
              <p className="text-secondary ml-11">
                Click the <strong>+</strong> button, then <strong>Add custom connector</strong>.
              </p>
            </div>
            <div className="md:w-80 flex-shrink-0">
              <Image
                src="/connect/step-add-dialog.png"
                alt="The Add custom connector dialog in Claude, showing empty Name and URL fields"
                width={560}
                height={500}
                className="rounded-xl border border-border-light shadow-sm"
              />
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-rust text-white text-sm font-bold flex items-center justify-center">3</span>
                <h2 className="text-lg font-semibold text-primary">Enter the details</h2>
              </div>
              <div className="ml-11 space-y-3">
                <p className="text-secondary">
                  Enter <strong>Source Library</strong> as the name, and paste this URL:
                </p>
                <div className="bg-stone-900 rounded-lg px-4 py-3 inline-block">
                  <code className="text-stone-100 text-sm select-all">https://sourcelibrary.org/api/mcp</code>
                </div>
                <p className="text-secondary">
                  Leave <strong>Advanced Settings</strong> closed. Click <strong>Add</strong>.
                </p>
              </div>
            </div>
            <div className="md:w-80 flex-shrink-0">
              <Image
                src="/connect/step-add-filled.png"
                alt="The Add custom connector dialog filled in with Source Library and the MCP URL"
                width={560}
                height={500}
                className="rounded-xl border border-border-light shadow-sm"
              />
            </div>
          </div>

          {/* Step 4 */}
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-rust text-white text-sm font-bold flex items-center justify-center">4</span>
                <h2 className="text-lg font-semibold text-primary">Start asking questions</h2>
              </div>
              <p className="text-secondary ml-11">
                Open a new conversation and ask Claude about any historical text.
                It will automatically search, read, and cite from the collection.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Example prompts */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-6">Try these prompts</h2>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-border-light p-5">
            <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-3 mb-3">
              &ldquo;Search for what Paracelsus wrote about the philosopher&apos;s stone. Give me the key passages with citations.&rdquo;
            </p>
            <p className="text-muted text-xs">Searches translations, finds exact passages, provides page-level citation URLs</p>
          </div>

          <div className="bg-white rounded-xl border border-border-light p-5">
            <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-3 mb-3">
              &ldquo;Read chapter 1 of Robert Fludd&apos;s History of Both Worlds. What is his cosmological framework?&rdquo;
            </p>
            <p className="text-muted text-xs">Reads full chapters of Latin texts in English, with page markers for citation</p>
          </div>

          <div className="bg-white rounded-xl border border-border-light p-5">
            <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-3 mb-3">
              &ldquo;Find all alchemical emblems depicting the ouroboros. What texts are they from?&rdquo;
            </p>
            <p className="text-muted text-xs">Searches 110,000+ cataloged historical illustrations by symbol, subject, or figure</p>
          </div>

          <div className="bg-white rounded-xl border border-border-light p-5">
            <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-3 mb-3">
              &ldquo;Compare how Ficino, Agrippa, and Dee discuss the concept of &lsquo;spiritus mundi.&rsquo; Cite your sources.&rdquo;
            </p>
            <p className="text-muted text-xs">Cross-references multiple authors, traces ideas across centuries with exact quotes</p>
          </div>
        </div>
      </section>

      {/* What's in the collection */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-4">What&apos;s in the collection?</h2>
        <p className="text-secondary mb-6 max-w-2xl">
          Theology, philosophy, history, literature, natural philosophy, mysticism, alchemy, Hermetica,
          medicine, mathematics, astronomy — the full breadth of pre-modern intellectual history,
          mostly translated into English for the first time.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div className="bg-white rounded-xl border border-border-light p-5">
            <p className="text-2xl font-bold text-accent-rust">15,000+</p>
            <p className="text-sm text-muted mt-1">translated books</p>
          </div>
          <div className="bg-white rounded-xl border border-border-light p-5">
            <p className="text-2xl font-bold text-accent-rust">4M</p>
            <p className="text-sm text-muted mt-1">page embeddings</p>
          </div>
          <div className="bg-white rounded-xl border border-border-light p-5">
            <p className="text-2xl font-bold text-accent-rust">15+</p>
            <p className="text-sm text-muted mt-1">source languages</p>
          </div>
          <div className="bg-white rounded-xl border border-border-light p-5">
            <p className="text-2xl font-bold text-accent-rust">Sumerian&ndash;1900</p>
            <p className="text-sm text-muted mt-1">date range</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {['Alchemy', 'Hermeticism', 'Kabbalah', 'Rosicrucianism', 'Natural Philosophy',
            'Astronomy', 'Medicine', 'Theology', 'Magic', 'Emblems'].map((topic) => (
            <span key={topic} className="px-3 py-1 bg-warm text-secondary text-sm rounded-full">
              {topic}
            </span>
          ))}
        </div>
      </section>

      {/* Other ways to connect */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-4">Other ways to connect</h2>
        <div className="space-y-3">
          <details className="group bg-white rounded-xl border border-border-light overflow-hidden">
            <summary className="px-5 py-3 cursor-pointer hover:bg-stone-50 transition-colors text-sm">
              <strong>Claude Code</strong> <span className="text-muted">&mdash; one command</span>
            </summary>
            <pre className="px-5 pb-4 text-sm overflow-x-auto bg-stone-900 text-stone-100 mx-5 mb-4 rounded-lg p-3">
{`claude mcp add source-library -- npx -y @source-library/mcp-server`}
            </pre>
          </details>

          <details className="group bg-white rounded-xl border border-border-light overflow-hidden">
            <summary className="px-5 py-3 cursor-pointer hover:bg-stone-50 transition-colors text-sm">
              <strong>Claude Desktop</strong> <span className="text-muted">&mdash; config file</span>
            </summary>
            <div className="px-5 pb-4">
              <p className="text-xs text-muted mb-2">
                Add to <code>claude_desktop_config.json</code> &mdash;
                macOS: ~/Library/Application Support/Claude/ &bull; Windows: %APPDATA%\Claude\
              </p>
              <pre className="text-sm overflow-x-auto bg-stone-900 text-stone-100 rounded-lg p-3">
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
          </details>

          <details className="group bg-white rounded-xl border border-border-light overflow-hidden">
            <summary className="px-5 py-3 cursor-pointer hover:bg-stone-50 transition-colors text-sm">
              <strong>Any MCP client</strong> <span className="text-muted">&mdash; Streamable HTTP</span>
            </summary>
            <div className="px-5 pb-4">
              <p className="text-sm text-secondary mb-2">
                Connect to the remote endpoint with any client that supports Streamable HTTP transport:
              </p>
              <div className="bg-stone-900 rounded-lg px-4 py-3">
                <code className="text-stone-100 text-sm select-all">https://sourcelibrary.org/api/mcp</code>
              </div>
            </div>
          </details>
        </div>
      </section>

      {/* Footer links */}
      <section className="border-t border-border-light pt-8">
        <div className="flex flex-wrap gap-4">
          <Link
            href="/"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors text-sm"
          >
            Browse the Library
          </Link>
          <Link
            href="/developers"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors text-sm"
          >
            Developer Docs
          </Link>
          <a
            href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors text-sm"
          >
            GitHub
          </a>
        </div>
      </section>
    </ContentPageLayout>
  );
}
