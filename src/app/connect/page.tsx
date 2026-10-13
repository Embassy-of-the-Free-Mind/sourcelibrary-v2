import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { IMAGE_CORPUS_STATS } from '@/lib/public-stats';
import { jsonLdHtml } from '@/lib/json-ld';

export const revalidate = 86400;

// The one address every technical path needs. It lives in ONE constant so the copy,
// the code blocks and the structured data can never disagree. Readers coming from
// Claude never need it: the directory listing does the work.
const MCP_URL = 'https://sourcelibrary.org/api/mcp';
const DIRECTORY_URL = 'https://claude.ai/directory/connectors/source-library';
const SITE = 'https://sourcelibrary.org';

// Hero: Merian's ouroboros dragon from the Musaeum Hermeticum (1678) — the kind of
// plate the video finds. Served from our own image host (CSP-allowed).
const HERO_IMAGE = 'https://images.sourcelibrary.org/artwork/art-musaeum-hermeticum-1678-p-353-dragon.jpg';

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

const TITLE = 'Connect Source Library to Claude or ChatGPT: Free, Five Clicks';
const DESCRIPTION =
  `Let Claude or ChatGPT read 15,000+ rare historical books and ${IMAGE_CORPUS_STATS.illustrations} illustrations for you. Free, no account, about a minute. Step-by-step pictures and a two-minute video for beginners; connection details for Claude Code, Cursor and other tools at the bottom.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'connect Claude to Source Library',
    'Source Library Claude connector',
    'Claude connectors',
    'ChatGPT connector',
    'Source Library MCP',
    'MCP server',
    'Claude MCP',
    'ChatGPT MCP',
    'historical texts AI',
    'primary sources Claude',
    'alchemy Claude',
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

// Plain-language questions. Rendered as the FAQ AND emitted as FAQPage structured data
// from this one list, so the two cannot drift.
const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Is it free?',
    a: 'Yes. Connecting Source Library costs nothing and needs no account with us. You only need Claude (any plan, including the free one) or ChatGPT (a paid plan).',
  },
  {
    q: 'Do I need to install anything?',
    a: 'No. In Claude it is five clicks inside the app. Nothing is downloaded; you can disconnect it just as easily from the same Connectors page.',
  },
  {
    q: 'Does it work on the free Claude plan?',
    a: 'Yes. The Source Library listing in the Claude directory works on every plan, and free accounts can also add one connector by address.',
  },
  {
    q: 'Does it work with ChatGPT?',
    a: 'Yes, on ChatGPT Plus, Pro, Business, Enterprise and Edu. Turn on Developer mode under Settings → Apps & Connectors → Advanced settings, then create a connector with the address https://sourcelibrary.org/api/mcp and authentication set to None. The free ChatGPT tier does not support connectors.',
  },
  {
    q: 'What can Claude do once it is connected?',
    a: `Search 15,000+ historical books that we have translated into English, read whole chapters, quote exact passages with a link to the page they come from, and search ${IMAGE_CORPUS_STATS.illustrations} illustrations by subject or symbol.`,
  },
  {
    q: 'Which languages are the books in?',
    a: 'The originals are in Latin, German, French, Dutch, Greek, Hebrew, Arabic, Sanskrit, Chinese, Tibetan and more. Claude reads our English translations and gives you a link to the original page, so you can check any line against the scan.',
  },
  {
    q: 'Claude says it cannot find Source Library. What now?',
    a: 'Open the tools menu beside the message box (the + or the sliders icon) and make sure Source Library is switched on for that conversation. If you added it by address, check that the address ends in /api/mcp and the name is exactly "Source Library".',
  },
  {
    q: 'Can I cite what Claude finds?',
    a: 'Yes. Every passage comes with a permanent link to the page it was taken from (sourcelibrary.org/q/…), and many books carry a DOI. Cite the original book and page, and note that the English is an AI-assisted translation.',
  },
  {
    q: 'What do you see on your side?',
    a: 'Only the searches and page requests Claude makes on your behalf, and which tools were used. There are no user accounts and nothing is tied to your identity. See the privacy policy for details.',
  },
  {
    q: 'What is this, technically?',
    a: `Source Library runs an MCP server (Model Context Protocol, the open standard AI assistants use to reach outside tools) at ${MCP_URL}. Any MCP client can connect to it; the developer page documents the tools.`,
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

/* ── Presentational helpers ── */

function SectionTitle({ id, children, lede }: { id?: string; children: ReactNode; lede?: ReactNode }) {
  return (
    <div className="mb-8">
      <h2 id={id} className="text-3xl md:text-4xl text-primary scroll-mt-24">{children}</h2>
      {lede && <p className="text-lg text-secondary mt-3 max-w-2xl leading-relaxed">{lede}</p>}
    </div>
  );
}

/** One tutorial step: big number, short title, one sentence, then the picture at full width. */
function StepCard({
  n, title, image, alt, width, height, children,
}: {
  n: number; title: string; image?: string; alt?: string; width?: number; height?: number; children: ReactNode;
}) {
  return (
    <li className="bg-white rounded-2xl border border-border-light shadow-sm overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex items-start gap-4">
          <span className="flex-shrink-0 w-11 h-11 rounded-full bg-accent-rust text-white text-lg font-semibold flex items-center justify-center">
            {n}
          </span>
          <div>
            <h3 className="text-2xl text-primary leading-tight">{title}</h3>
            <div className="text-secondary text-lg leading-relaxed mt-2 space-y-2">{children}</div>
          </div>
        </div>
      </div>
      {image && (
        <div className="px-4 pb-4 md:px-8 md:pb-8">
          <Image
            src={image}
            alt={alt ?? ''}
            width={width ?? 1200}
            height={height ?? 584}
            sizes="(min-width: 1024px) 960px, 100vw"
            className="w-full h-auto rounded-xl border border-border-light"
          />
        </div>
      )}
    </li>
  );
}

function UrlBox() {
  return (
    <div className="bg-stone-900 rounded-lg px-4 py-3 inline-block max-w-full">
      <code className="text-stone-100 text-sm select-all break-all">{MCP_URL}</code>
    </div>
  );
}

export default function ConnectPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Let Claude read 15,000 rare books for you"
          subtitle="Connect Source Library to Claude in five clicks. Free, no account, about a minute. Then ask it anything about alchemy, Hermetica, early science, theology and the rest of pre-modern thought, and it answers from the original books, with a link to every page."
          image={HERO_IMAGE}
          imageAlt="Ouroboros dragon, engraving by Matthäus Merian from the Musaeum Hermeticum, 1678"
          heightClass="min-h-[340px] md:min-h-[460px]"
        />
      }
      bg="bg-cream"
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd()) }} />

      {/* ── What it feels like ── */}
      <section className="mb-20">
        <div className="grid md:grid-cols-[1fr_260px] gap-8 items-center">
          <div>
            <p className="text-xl text-secondary leading-relaxed">
              Once connected, Claude can search the library, read whole chapters in English, quote the exact lines,
              and show you the engravings, and every answer links back to the scanned page of the original
              book, so you can check it yourself.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                'Find alchemical emblems of the ouroboros. Which books are they from?',
                "What did Paracelsus write about the philosopher's stone? Quote him.",
                "Read me the first chapter of Robert Fludd's History of Both Worlds.",
              ].map((prompt) => (
                <li key={prompt} className="bg-white rounded-2xl rounded-tl-sm border border-border-light px-5 py-3 text-primary text-lg max-w-xl">
                  &ldquo;{prompt}&rdquo;
                </li>
              ))}
            </ul>
            <p className="text-muted mt-4">Things to try once it is connected.</p>
          </div>
          <a href="https://sourcelibrary.org/book/chrysopoea-of-cleopatra-1" className="hidden md:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/artwork/art-chrysopoea-of-cleopatra-1.jpg"
              alt="Ouroboros from the Chrysopoeia of Cleopatra, a Greek alchemical manuscript"
              className="w-full rounded-2xl border border-border-light bg-white"
              loading="lazy"
            />
            <span className="block text-xs text-muted mt-2 text-center">
              The ouroboros of Cleopatra the Alchemist, as Claude found it
            </span>
          </a>
        </div>
      </section>

      {/* ── The five clicks ── */}
      <section className="mb-20">
        <SectionTitle
          id="claude"
          lede={
            <>
              You need a Claude account. The free one at{' '}
              <a href="https://claude.ai" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">claude.ai</a>{' '}
              is enough. Do this once on the web; the connection follows your account into the desktop and phone apps.
              The two clicks people miss are circled in red.
            </>
          }
        >
          Five clicks in Claude
        </SectionTitle>

        <ol className="space-y-8 list-none">
          <StepCard
            n={1}
            title="Click Customize in the left sidebar"
            image="/connect/step-1-customize.jpg"
            alt="The Claude sidebar with the Customize item circled"
          >
            <p>It sits just below <strong>Scheduled</strong>. If the sidebar is hidden, click the small panel icon top-left to open it.</p>
          </StepCard>

          <StepCard
            n={2}
            title="Click the Connectors tab"
            image="/connect/step-2-connectors-tab.jpg"
            alt="The Customize page with the Connectors tab circled"
          >
            <p>The page opens on <strong>Skills</strong>. Connectors is the grey tab right next to it.</p>
          </StepCard>

          <StepCard
            n={3}
            title="Click the magnifying glass and type “source”"
            image="/connect/step-3-search.jpg"
            alt="The Connectors search box with 'source' typed and the Source Library row circled"
            height={766}
          >
            <p>
              The search box hides behind the little magnifier on the right, next to the black <strong>Add</strong>{' '}
              button. Type <strong>source</strong> and <strong>Source Library</strong> appears in the list. Click its row.
            </p>
          </StepCard>

          <StepCard
            n={4}
            title="Click Connect to Claude"
            image="/connect/step-4-connect.jpg"
            alt="The Source Library listing with the Connect to Claude button circled"
          >
            <p>
              The black button at the top right. A moment later a little note says <em>Connected to Source Library</em>.
              There is no sign-in and nothing to approve.
            </p>
          </StepCard>

          <StepCard
            n={5}
            title="Ask"
            image="/connect/step-5-result.jpg"
            alt="Claude showing a grid of alchemical engravings returned by the Source Library connector"
            height={1100}
          >
            <p>
              Start a new chat and ask about any old book, author or image. Claude searches the library on its own.
              Pictures come back as a grid; click one to open the page in the original book.
            </p>
          </StepCard>
        </ol>

        <div className="mt-8 bg-warm rounded-2xl p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-4">
          <p className="text-secondary text-lg flex-1">
            In a hurry? This link opens the listing from step 4 directly. Click <strong>Connect</strong> there and you are done.
          </p>
          <a
            href={DIRECTORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-6 py-3 bg-accent-rust text-white rounded-full font-medium hover:opacity-90 transition-opacity whitespace-nowrap text-center"
          >
            Open Source Library in Claude &rarr;
          </a>
        </div>
      </section>

      {/* ── Video ── */}
      <section className="mb-20">
        <SectionTitle id="video" lede="The same five clicks, then a first question about alchemical emblems. Silent, two minutes.">
          Watch it done
        </SectionTitle>
        <div className="grid md:grid-cols-[minmax(0,400px)_1fr] gap-8 items-start">
          <video
            controls
            playsInline
            preload="metadata"
            poster={VIDEO.poster}
            className="w-full rounded-2xl border border-border-light shadow-sm bg-stone-900"
            aria-label={VIDEO.name}
          >
            <source src={VIDEO.src} type="video/mp4" />
            Your browser does not support embedded video.{' '}
            <a href={VIDEO.src}>Download the recording</a>.
          </video>
          <ol className="space-y-3 text-secondary list-none">
            {[
              ['0:04', 'Find it', 'Customize page, Connectors tab, magnifier, type “source”. (The sidebar is cropped out of the recording; step 1 above shows it.)'],
              ['0:20', 'Connect', 'One click on the listing; the list of what Claude can now do appears.'],
              ['0:28', 'Ask', 'Alchemical emblems for a tattoo. Claude returns a grid of engravings, 12 of 70 found.'],
              ['0:52', 'Open the original', 'One click through to the plate on sourcelibrary.org, with its book and page. From 1:48 the same thing again from scratch, this time for the ouroboros.'],
            ].map(([t, title, text]) => (
              <li key={t} className="bg-white rounded-2xl border border-border-light p-4">
                <span className="font-semibold text-primary">{t} · {title}.</span> {text}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── ChatGPT ── */}
      <section className="mb-20">
        <SectionTitle
          id="chatgpt"
          lede="ChatGPT can use the library too, on a paid plan (Plus, Pro, Business, Enterprise or Edu). It keeps this behind a switch called Developer mode, so there is one extra step and one address to paste."
        >
          Using ChatGPT instead?
        </SectionTitle>
        <ol className="space-y-6 list-none">
          <StepCard n={1} title="Turn on Developer mode">
            <p>
              Click your profile picture &rarr; <strong>Settings</strong> &rarr; <strong>Apps &amp; Connectors</strong>{' '}
              &rarr; <strong>Advanced settings</strong> &rarr; switch on <strong>Developer mode</strong>. (Some versions
              keep the switch under <strong>Security and login</strong>.)
            </p>
          </StepCard>
          <StepCard n={2} title="Create the connector">
            <p>
              Back in <strong>Apps &amp; Connectors</strong>, click <strong>Create</strong>. Name it{' '}
              <strong>Source Library</strong>, paste this address, and set <strong>Authentication</strong> to{' '}
              <strong>None</strong>:
            </p>
            <UrlBox />
            <p>Tick the acknowledgement box and click <strong>Create</strong>.</p>
          </StepCard>
          <StepCard n={3} title="Ask">
            <p>
              In a new chat, click <strong>+</strong> beside the message box, choose <strong>Source Library</strong>, and
              ask. Naming it helps: &ldquo;Use Source Library to find what Paracelsus wrote about the philosopher&apos;s stone.&rdquo;
            </p>
          </StepCard>
        </ol>
        <p className="text-muted text-sm mt-4">
          OpenAI moves these menus around. If a label differs, look for the same words nearby, or see their{' '}
          <a href="https://developers.openai.com/api/docs/guides/developer-mode" className="underline hover:text-secondary" target="_blank" rel="noopener noreferrer">
            Developer mode guide
          </a>.
        </p>
      </section>

      {/* ── FAQ ── */}
      <section className="mb-20">
        <SectionTitle id="faq">Questions</SectionTitle>
        <div className="space-y-3">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group bg-white rounded-2xl border border-border-light overflow-hidden">
              <summary className="px-6 py-4 cursor-pointer hover:bg-stone-50 transition-colors text-lg text-primary">
                {q}
              </summary>
              <p className="px-6 pb-5 text-secondary leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Developers and other tools ── */}
      <section className="mb-16">
        <SectionTitle
          id="other-clients"
          lede="Claude Code, Cursor, Windsurf, VS Code, Codex and anything else that speaks MCP connect to the same address. The developer page has the full list of tools, the REST API and rate limits."
        >
          For developers and other tools
        </SectionTitle>
        <div className="bg-white rounded-2xl border border-border-light p-6 md:p-8 mb-4">
          <p className="text-xs uppercase tracking-wide text-muted mb-2">Server address (Streamable HTTP, no authentication)</p>
          <UrlBox />
        </div>
        <div className="space-y-3">
          <details className="group bg-white rounded-2xl border border-border-light overflow-hidden">
            <summary className="px-6 py-4 cursor-pointer hover:bg-stone-50 transition-colors">
              <strong>Claude Code</strong> <span className="text-muted">· one command</span>
            </summary>
            <pre className="mx-6 mb-5 text-sm overflow-x-auto bg-stone-900 text-stone-100 rounded-lg p-4">
{`claude mcp add --transport http source-library ${MCP_URL}`}
            </pre>
          </details>
          <details className="group bg-white rounded-2xl border border-border-light overflow-hidden">
            <summary className="px-6 py-4 cursor-pointer hover:bg-stone-50 transition-colors">
              <strong>Cursor, Windsurf, VS Code, Claude Desktop config</strong> <span className="text-muted">· JSON</span>
            </summary>
            <div className="px-6 pb-5">
              <p className="text-xs text-muted mb-2">
                Cursor: <code>.cursor/mcp.json</code> · VS Code: <code>.vscode/mcp.json</code> · Claude Desktop:{' '}
                <code>claude_desktop_config.json</code>
              </p>
              <pre className="text-sm overflow-x-auto bg-stone-900 text-stone-100 rounded-lg p-4">
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
          <details className="group bg-white rounded-2xl border border-border-light overflow-hidden">
            <summary className="px-6 py-4 cursor-pointer hover:bg-stone-50 transition-colors">
              <strong>Clients that only speak stdio</strong> <span className="text-muted">· bridge with mcp-remote</span>
            </summary>
            <pre className="mx-6 mb-5 text-sm overflow-x-auto bg-stone-900 text-stone-100 rounded-lg p-4">
{`{
  "mcpServers": {
    "source-library": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${MCP_URL}"]
    }
  }
}`}
            </pre>
          </details>
          <details className="group bg-white rounded-2xl border border-border-light overflow-hidden">
            <summary className="px-6 py-4 cursor-pointer hover:bg-stone-50 transition-colors">
              <strong>No MCP library at all</strong> <span className="text-muted">· plain JSON-RPC over HTTPS</span>
            </summary>
            <pre className="mx-6 mb-5 text-sm overflow-x-auto bg-stone-900 text-stone-100 rounded-lg p-4">
{`curl -X POST ${MCP_URL} \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"search_library","arguments":{"query":"ouroboros"}}}'`}
            </pre>
          </details>
        </div>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link href="/developers" className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors text-sm">
            Developer docs &amp; API
          </Link>
          <Link href="/blog/mcp-server" className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors text-sm">
            Why we built it
          </Link>
          <Link href="/" className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors text-sm">
            Browse the library
          </Link>
        </div>
      </section>
    </ContentPageLayout>
  );
}
