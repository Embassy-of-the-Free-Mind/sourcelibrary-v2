import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { IMAGE_CORPUS_STATS } from '@/lib/public-stats';
import { jsonLdHtml } from '@/lib/json-ld';

export const revalidate = 86400;

// The one thing every path on this page needs. Keep it in one place so the
// copy, the code blocks and the structured data can never disagree.
const MCP_URL = 'https://sourcelibrary.org/api/mcp';
const DIRECTORY_URL = 'https://claude.ai/directory/connectors/source-library';
const SITE = 'https://sourcelibrary.org';

// Screen recording of the directory flow in Claude, then an image search.
// Silent, 2 min 14 s, 1280x1516. The master's first 36 s (idle chat window) are cut,
// and the Claude sidebar + browser toolbar are cropped out (private). Re-encode from the master with:
//   ffmpeg -ss 36 -i in.mov -vf "crop=1438:1704:628:82,scale=1280:-2" -c:v libx264 -crf 26 \
//     -pix_fmt yuv420p -movflags +faststart -an out.mp4
const VIDEO = {
  src: '/connect/connect-claude-2026-09.mp4',
  poster: '/connect/connect-claude-poster.jpg',
  og: '/connect/connect-og.jpg',
  uploadDate: '2026-09-29',
  duration: 'PT2M14S',
  name: 'How to connect Source Library to Claude and search 200,000 historical illustrations',
  description:
    'Screen recording: adding the Source Library connector from the Claude directory, then asking Claude for alchemical emblems of the ouroboros and getting images from the original books with page-level citations.',
};

const TITLE = 'Connect Source Library to Claude or ChatGPT — MCP Server Setup';
const DESCRIPTION =
  `Step-by-step guide (with video) to connecting the Source Library MCP server to Claude, ChatGPT, Claude Code, Cursor and other AI assistants. One URL, no account, about a minute — then search, read and cite 15,000+ rare historical books and ${IMAGE_CORPUS_STATS.illustrations} illustrations in your chat.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'Source Library MCP',
    'MCP server',
    'connect Claude to a library',
    'Claude connector',
    'ChatGPT connector',
    'ChatGPT MCP',
    'Claude MCP',
    'Model Context Protocol',
    'historical texts AI',
    'primary sources Claude',
    'alchemy MCP server',
    'rare books ChatGPT',
  ],
  alternates: { canonical: '/connect' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE}/connect`,
    type: 'website',
    images: [{ url: `${SITE}${VIDEO.og}`, width: 1200, height: 630, alt: 'Claude showing ouroboros emblems found through the Source Library connector' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [`${SITE}${VIDEO.og}`],
  },
};

// The questions people actually type into Google before they find this page.
// Rendered as the FAQ section AND emitted as FAQPage structured data, from one
// list, so the two cannot drift.
const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Is the Source Library connector free?',
    a: 'Yes. The MCP server is free and needs no account, API key or sign-in. You only need an AI assistant that supports connectors (Claude on any plan; ChatGPT on a paid plan).',
  },
  {
    q: 'What is the Source Library MCP server URL?',
    a: `${MCP_URL} — paste it wherever your assistant asks for an MCP server or connector URL. It uses the Streamable HTTP transport and no authentication.`,
  },
  {
    q: 'Does it work with the free Claude plan?',
    a: 'Yes. Custom connectors work on every Claude plan, including Free (Free accounts can add one custom connector). The one-click listing in the Claude connector directory works on all plans too.',
  },
  {
    q: 'Does it work with ChatGPT?',
    a: 'Yes, on ChatGPT Plus, Pro, Business, Enterprise and Edu. Turn on Developer mode under Settings → Apps & Connectors → Advanced settings, then create a connector with the URL above and authentication set to None. The free ChatGPT tier does not support custom connectors.',
  },
  {
    q: 'What can Claude or ChatGPT do once connected?',
    a: `Search 15,000+ historical books translated into English, read full chapters, pull exact quotations with stable page-level citation URLs, and search ${IMAGE_CORPUS_STATS.illustrations} illustrations by subject or symbol. Every answer links back to the scanned page of the original book.`,
  },
  {
    q: 'Which languages are the books in?',
    a: 'The originals are in Latin, German, French, Dutch, Greek, Hebrew, Arabic, Sanskrit, Chinese, Tibetan and more. The connector returns English translations alongside links to the original page, so you can check any line against the source.',
  },
  {
    q: 'My assistant says it cannot find Source Library. What is wrong?',
    a: 'In Claude, open the tools menu (the + or sliders icon beside the message box) and make sure the Source Library connector is switched on for that conversation. In ChatGPT, pick the connector from the + menu before you ask. If you added it as a custom connector, check the URL ends in /api/mcp and the name is exactly "Source Library".',
  },
  {
    q: 'Can I cite what the assistant finds?',
    a: 'Yes. Every passage comes with a permanent link to the page it was taken from (sourcelibrary.org/q/…), and many books carry a DOI. Cite the original book and page, and note that the English is an AI-assisted translation.',
  },
  {
    q: 'What data does the connector collect?',
    a: 'The server receives the search queries and page requests your assistant makes and logs which tools were called. There are no user accounts and nothing is tied to your identity. See the privacy policy for details.',
  },
];

function jsonLd() {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: VIDEO.name,
      description: VIDEO.description,
      thumbnailUrl: [`${SITE}${VIDEO.poster}`],
      uploadDate: VIDEO.uploadDate,
      duration: VIDEO.duration,
      contentUrl: `${SITE}${VIDEO.src}`,
      embedUrl: `${SITE}/connect`,
      publisher: { '@type': 'Organization', name: 'Source Library', url: SITE },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Source Library', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Connect to Claude or ChatGPT', item: `${SITE}/connect` },
      ],
    },
  ];
}

/* ── Small presentational helpers ── */

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-rust text-white text-sm font-bold flex items-center justify-center">
      {n}
    </span>
  );
}

function UrlBox({ label }: { label?: string }) {
  return (
    <div>
      {label && <p className="text-xs uppercase tracking-wide text-muted mb-1.5">{label}</p>}
      <div className="bg-stone-900 rounded-lg px-4 py-3 inline-block max-w-full">
        <code className="text-stone-100 text-sm select-all break-all">{MCP_URL}</code>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <StepNumber n={n} />
        <h3 className="text-lg font-semibold text-primary">{title}</h3>
      </div>
      <div className="text-secondary ml-11 space-y-2">{children}</div>
    </div>
  );
}

function ClientHeading({ id, title, tag }: { id: string; title: string; tag: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-5">
      <h2 id={id} className="text-2xl font-semibold text-primary scroll-mt-24">{title}</h2>
      <span className="text-sm text-muted">{tag}</span>
    </div>
  );
}

export default function ConnectPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Connect Source Library to Claude or ChatGPT"
          subtitle={`Give your AI assistant a library of 15,000+ rare historical books and ${IMAGE_CORPUS_STATS.illustrations} illustrations. One URL, no account, about a minute.`}
        />
      }
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd()) }}
      />

      {/* ── The answer, above the fold ── */}
      <section className="mb-12">
        <div className="bg-white rounded-2xl border border-border-light p-6 md:p-8">
          <p className="text-secondary mb-4">
            Source Library is an <strong>MCP server</strong> (Model Context Protocol &mdash; the open standard AI
            assistants use to reach outside tools). Any assistant that supports MCP can connect with this one address:
          </p>
          <UrlBox label="MCP server URL" />
          <p className="text-muted text-sm mt-4">
            No API key. No sign-up. Works with Claude (all plans), ChatGPT (paid plans), Claude Code, Cursor,
            Windsurf, VS Code and any other MCP client.
          </p>
          <nav aria-label="Jump to instructions" className="mt-5 flex flex-wrap gap-2">
            {[
              ['#claude', 'Claude'],
              ['#chatgpt', 'ChatGPT'],
              ['#claude-code', 'Claude Code'],
              ['#other-clients', 'Cursor, VS Code & others'],
              ['#faq', 'FAQ'],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="px-4 py-1.5 rounded-full border border-stone-300 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </section>

      {/* ── Video ── */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-2">Watch it happen (2 min 14 s)</h2>
        <p className="text-secondary mb-4 max-w-2xl">
          Adding the connector from the Claude directory, then asking Claude for alchemical emblems of the
          ouroboros. It searches the library, returns the engravings, and links every one to the page of the
          original book. Silent screen recording.
        </p>
        <video
          controls
          playsInline
          preload="metadata"
          poster={VIDEO.poster}
          className="w-full rounded-xl border border-border-light shadow-sm bg-stone-900"
          aria-label={VIDEO.name}
        >
          <source src={VIDEO.src} type="video/mp4" />
          Your browser does not support embedded video.{' '}
          <a href={VIDEO.src}>Download the recording</a>.
        </video>
        <ol className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm text-secondary list-none">
          <li className="bg-white rounded-xl border border-border-light p-4">
            <span className="font-semibold text-primary">0:04 &mdash; Find it.</span> Customize page &rarr;{' '}
            <strong>Connectors</strong> tab &rarr; magnifier &rarr; type &ldquo;source&rdquo;. (The sidebar is cropped out
            of the recording; the stills below show it.)
          </li>
          <li className="bg-white rounded-xl border border-border-light p-4">
            <span className="font-semibold text-primary">0:20 &mdash; Connect.</span> One click on the listing; the
            tool list appears (search, read, quote, images).
          </li>
          <li className="bg-white rounded-xl border border-border-light p-4">
            <span className="font-semibold text-primary">0:28 &mdash; Ask.</span> Alchemical emblems for a tattoo:
            Claude returns a grid of engravings, 12 of 70 hits.
          </li>
          <li className="bg-white rounded-xl border border-border-light p-4">
            <span className="font-semibold text-primary">0:52 &mdash; Open the original.</span> Click through to the
            plate on sourcelibrary.org, with its book and page. From 1:48, the same thing again from scratch, this
            time for the ouroboros.
          </li>
        </ol>
      </section>

      {/* ── Claude ── */}
      <section className="mb-16">
        <ClientHeading id="claude" title="Claude" tag="claude.ai, Claude Desktop and the mobile apps · every plan" />
        <p className="text-secondary mb-8 max-w-2xl">
          Source Library is listed in Claude&apos;s connector directory, so there is nothing to type except the word
          &ldquo;source&rdquo;. Two of the five clicks are easy to miss, so they are circled.
        </p>

        <div className="space-y-10">
          <div className="grid md:grid-cols-[1fr_minmax(0,420px)] gap-6 items-start">
            <Step n={1} title="Click Customize in the left sidebar">
              <p>
                It sits below <strong>Scheduled</strong>, above <strong>More</strong>. Do this once on the web; the
                connector follows your account into the desktop and mobile apps.
              </p>
            </Step>
            <Image
              src="/connect/step-1-customize.jpg"
              alt="The Claude sidebar with the Customize item circled"
              width={1200}
              height={626}
              className="rounded-xl border border-border-light shadow-sm"
            />
          </div>

          <div className="grid md:grid-cols-[1fr_minmax(0,420px)] gap-6 items-start">
            <Step n={2} title="Click the Connectors tab">
              <p>
                The Customize page opens on <strong>Skills</strong>. Connectors is the second tab, in grey, next to it.
              </p>
            </Step>
            <Image
              src="/connect/step-2-connectors-tab.jpg"
              alt="The Customize page with the Connectors tab circled"
              width={1200}
              height={584}
              className="rounded-xl border border-border-light shadow-sm"
            />
          </div>

          <div className="grid md:grid-cols-[1fr_minmax(0,420px)] gap-6 items-start">
            <Step n={3} title="Click the magnifying glass and type “source”">
              <p>
                The search box is hidden behind the small <strong>magnifier icon</strong> on the right, next to the
                black <strong>Add</strong> button. Type <strong>source</strong> and <strong>Source Library</strong>{' '}
                (marked Community) appears in the list. Click its row.
              </p>
            </Step>
            <Image
              src="/connect/step-3-search.jpg"
              alt="The Connectors search box with 'source' typed and the Source Library row circled"
              width={1200}
              height={766}
              className="rounded-xl border border-border-light shadow-sm"
            />
          </div>

          <div className="grid md:grid-cols-[1fr_minmax(0,420px)] gap-6 items-start">
            <Step n={4} title="Click Connect to Claude">
              <p>
                The black button at the top right of the listing. A moment later the tool list appears below it
                (search, read, quote, images) and a toast says <em>Connected to Source Library</em>. No sign-in.
              </p>
              <p className="text-sm text-muted">
                Shortcut for steps 1&ndash;4:{' '}
                <a href={DIRECTORY_URL} className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
                  open the listing directly
                </a>{' '}
                and click Connect.
              </p>
            </Step>
            <Image
              src="/connect/step-4-connect.jpg"
              alt="The Source Library listing in the Claude directory with the Connect to Claude button circled"
              width={1200}
              height={584}
              className="rounded-xl border border-border-light shadow-sm"
            />
          </div>

          <div className="grid md:grid-cols-[1fr_minmax(0,420px)] gap-6 items-start">
            <Step n={5} title="Ask">
              <p>
                Start a new conversation and ask about any historical text or image. Claude searches, reads and cites
                the library on its own; image results come back as a grid, each linked to its page in the original
                book. If Claude doesn&apos;t use it, open the tools menu beside the message box and switch Source
                Library on.
              </p>
            </Step>
            <Image
              src="/connect/step-5-result.jpg"
              alt="Claude showing a grid of alchemical engravings returned by the Source Library connector"
              width={1200}
              height={1100}
              className="rounded-xl border border-border-light shadow-sm"
            />
          </div>
        </div>

        <details className="group bg-white rounded-xl border border-border-light overflow-hidden mt-10">
          <summary className="px-5 py-3 cursor-pointer hover:bg-stone-50 transition-colors text-sm">
            <strong>Can&apos;t find it in the directory?</strong>{' '}
            <span className="text-muted">&mdash; add it by URL as a custom connector</span>
          </summary>
          <div className="px-5 pb-5 pt-2 space-y-6">
            <p className="text-sm text-secondary">
              Same result, and it works on workspaces where the directory is switched off. On the Connectors tab
              click the black <strong>+ Add</strong> button, then <strong>Add custom connector</strong>.
            </p>
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="flex-1 text-sm text-secondary space-y-3">
                <p>
                  Name: <strong>Source Library</strong> (keep this exact name &mdash; shared pages that call the
                  library look it up by name). URL:
                </p>
                <UrlBox />
                <p>
                  Leave <strong>Advanced settings</strong> closed. Click <strong>Add</strong>.
                </p>
              </div>
              <div className="md:w-72 flex-shrink-0">
                <Image
                  src="/connect/step-add-filled.png"
                  alt="The Add custom connector dialog filled in with Source Library and the MCP URL"
                  width={560}
                  height={500}
                  className="rounded-xl border border-border-light shadow-sm"
                />
              </div>
            </div>
          </div>
        </details>
      </section>

      {/* ── ChatGPT ── */}
      <section className="mb-16">
        <ClientHeading id="chatgpt" title="ChatGPT" tag="Plus, Pro, Business, Enterprise, Edu · web" />
        <p className="text-secondary mb-6 max-w-2xl">
          ChatGPT calls custom MCP servers &ldquo;connectors&rdquo; and keeps them behind a Developer mode
          switch. It takes two minutes. (OpenAI moves these menus around; if a label differs, look for the same
          words nearby.)
        </p>
        <div className="space-y-8">
          <Step n={1} title="Turn on Developer mode">
            <p>
              Click your profile &rarr; <strong>Settings</strong> &rarr; <strong>Apps &amp; Connectors</strong> &rarr;{' '}
              <strong>Advanced settings</strong> &rarr; switch on <strong>Developer mode</strong>. (In some builds the
              toggle sits under <strong>Security and login</strong> instead.)
            </p>
          </Step>
          <Step n={2} title="Create the connector">
            <p>
              Back in <strong>Apps &amp; Connectors</strong>, click <strong>Create</strong> (or the <strong>+</strong>{' '}
              button). Name it <strong>Source Library</strong>, paste the URL, and set <strong>Authentication</strong>{' '}
              to <strong>None</strong> (&ldquo;No authentication&rdquo;):
            </p>
            <UrlBox />
            <p>Tick the acknowledgement box and click <strong>Create</strong>.</p>
          </Step>
          <Step n={3} title="Use it in a chat">
            <p>
              In a new chat, click <strong>+</strong> beside the message box, choose <strong>Source Library</strong>{' '}
              (under Developer mode or Apps), and ask. Name the tool if you want to be explicit: &ldquo;Use Source
              Library to find what Paracelsus wrote about the philosopher&apos;s stone.&rdquo;
            </p>
          </Step>
        </div>
        <p className="text-muted text-sm mt-6">
          Official reference:{' '}
          <a
            href="https://developers.openai.com/api/docs/guides/developer-mode"
            className="underline hover:text-secondary"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenAI &mdash; Developer mode
          </a>
          .
        </p>
      </section>

      {/* ── Claude Code ── */}
      <section className="mb-16">
        <ClientHeading id="claude-code" title="Claude Code" tag="one command in the terminal" />
        <pre className="text-sm overflow-x-auto bg-stone-900 text-stone-100 rounded-lg p-4">
{`claude mcp add --transport http source-library ${MCP_URL}`}
        </pre>
        <p className="text-muted text-sm mt-3">
          Then <code className="text-stone-700">/mcp</code> inside Claude Code shows the server and its tools. Add{' '}
          <code className="text-stone-700">--scope user</code> to make it available in every project.
        </p>
      </section>

      {/* ── Other clients ── */}
      <section className="mb-16">
        <ClientHeading id="other-clients" title="Cursor, Windsurf, VS Code, Codex and others" tag="any MCP client" />
        <div className="space-y-3">
          <details className="group bg-white rounded-xl border border-border-light overflow-hidden" open>
            <summary className="px-5 py-3 cursor-pointer hover:bg-stone-50 transition-colors text-sm">
              <strong>Clients with a JSON config</strong>{' '}
              <span className="text-muted">&mdash; Cursor, Windsurf, VS Code, Claude Desktop config file</span>
            </summary>
            <div className="px-5 pb-4">
              <p className="text-xs text-muted mb-2">
                Add to the client&apos;s MCP settings (Cursor: <code>.cursor/mcp.json</code> · VS Code:{' '}
                <code>.vscode/mcp.json</code> · Claude Desktop: <code>claude_desktop_config.json</code>):
              </p>
              <pre className="text-sm overflow-x-auto bg-stone-900 text-stone-100 rounded-lg p-3">
{`{
  "mcpServers": {
    "source-library": {
      "url": "${MCP_URL}"
    }
  }
}`}
              </pre>
            </div>
          </details>

          <details className="group bg-white rounded-xl border border-border-light overflow-hidden">
            <summary className="px-5 py-3 cursor-pointer hover:bg-stone-50 transition-colors text-sm">
              <strong>Clients that only speak stdio</strong>{' '}
              <span className="text-muted">&mdash; bridge with mcp-remote</span>
            </summary>
            <div className="px-5 pb-4">
              <pre className="text-sm overflow-x-auto bg-stone-900 text-stone-100 rounded-lg p-3">
{`{
  "mcpServers": {
    "source-library": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${MCP_URL}"]
    }
  }
}`}
              </pre>
            </div>
          </details>

          <details className="group bg-white rounded-xl border border-border-light overflow-hidden">
            <summary className="px-5 py-3 cursor-pointer hover:bg-stone-50 transition-colors text-sm">
              <strong>No MCP library at all</strong> <span className="text-muted">&mdash; it is plain JSON-RPC over HTTPS</span>
            </summary>
            <div className="px-5 pb-4">
              <pre className="text-sm overflow-x-auto bg-stone-900 text-stone-100 rounded-lg p-3">
{`curl -X POST ${MCP_URL} \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"search_library","arguments":{"query":"ouroboros"}}}'`}
              </pre>
              <p className="text-sm text-secondary mt-2">
                The full tool list, REST endpoints and rate limits are on the{' '}
                <Link href="/developers" className="text-accent-rust hover:underline">developer page</Link>.
              </p>
            </div>
          </details>
        </div>
      </section>

      {/* ── Example prompts ── */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-6">Try these prompts</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            [
              'Find alchemical emblems depicting the ouroboros. Which books are they from?',
              `Searches ${IMAGE_CORPUS_STATS.illustrations} catalogued illustrations by symbol, subject or figure — the search in the video`,
            ],
            [
              "Search for what Paracelsus wrote about the philosopher's stone. Give me the key passages with citations.",
              'Searches translations, finds exact passages, returns page-level citation URLs',
            ],
            [
              "Read chapter 1 of Robert Fludd's History of Both Worlds. What is his cosmological framework?",
              'Reads full chapters of Latin texts in English, with page markers for citation',
            ],
            [
              "Compare how Ficino, Agrippa and Dee discuss 'spiritus mundi'. Cite your sources.",
              'Cross-references several authors and traces an idea across centuries with exact quotes',
            ],
          ].map(([prompt, note]) => (
            <div key={prompt} className="bg-white rounded-xl border border-border-light p-5">
              <p className="text-stone-700 text-sm italic border-l-2 border-accent-rust/30 pl-3 mb-3">
                &ldquo;{prompt}&rdquo;
              </p>
              <p className="text-muted text-xs">{note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── What's inside ── */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold text-primary mb-4">What your assistant gets access to</h2>
        <p className="text-secondary mb-6 max-w-2xl">
          Theology, philosophy, history, literature, natural philosophy, mysticism, alchemy, Hermetica, medicine,
          mathematics, astronomy &mdash; the breadth of pre-modern intellectual history, much of it in English for
          the first time, every line linked to the scanned page it came from.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          {[
            ['15,000+', 'translated books'],
            [IMAGE_CORPUS_STATS.illustrations, 'illustrations'],
            ['15+', 'source languages'],
            ['Sumerian–1900', 'date range'],
          ].map(([n, label]) => (
            <div key={label} className="bg-white rounded-xl border border-border-light p-5">
              <p className="text-2xl font-bold text-accent-rust">{n}</p>
              <p className="text-sm text-muted mt-1">{label}</p>
            </div>
          ))}
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

      {/* ── FAQ ── */}
      <section className="mb-16">
        <h2 id="faq" className="text-2xl font-semibold text-primary mb-6 scroll-mt-24">Frequently asked questions</h2>
        <div className="space-y-3">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group bg-white rounded-xl border border-border-light overflow-hidden">
              <summary className="px-5 py-3 cursor-pointer hover:bg-stone-50 transition-colors text-sm font-medium text-primary">
                {q}
              </summary>
              <p className="px-5 pb-4 text-sm text-secondary">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Footer links ── */}
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
            Developer Docs &amp; API
          </Link>
          <Link
            href="/blog/mcp-server"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors text-sm"
          >
            Why we built it
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
