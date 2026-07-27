import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'How IIIF Helped Us Translate the Renaissance - Research Notes - Source Library',
  description:
    'IIIF turned thirteen institutional image archives into a single input layer for an AI translation pipeline. We consume IIIF to import rare books, and we serve IIIF so any viewer can read our OCR and translation laid over the original page. A behind-the-scenes look, with diagrams.',
  openGraph: {
    title: 'How IIIF Helped Us Translate the Renaissance',
    description:
      'IIIF as a universal input layer for an AI pipeline: import rare books from thirteen institutions through one importer, then serve them back as IIIF with machine OCR and translation overlaid on the original page.',
    images: [
      {
        url: 'https://images.sourcelibrary.org/pages/69bd9e336120d54bd037bf37/0010.jpg',
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/pages/69bd9e336120d54bd037bf37/0010.jpg' }],
  },
  alternates: {
    canonical: '/blog/iiif',
  },
};

/* ── Brand palette for the diagrams ── */
const INK = '#231a12';
const RUST = '#a83c1d';
const GOLD = '#7c5212';
const SAGE = '#465738';
const STONE = '#4f4537'; // darkened: used for connectors + small captions — now reads with strong contrast
const PAPER = '#ece0c8'; // distinct cream fill so source boxes stand out from the white card
const LINE = '#b6a47e'; // darker border

/* ── Transcript of the lightning talk (Scheltema, Leiden, 2 June 2026) ── */
const TALK_TRANSCRIPT: string[] = [
  `Hello, I'm Derek Lomas, Director of the Digital Collection at the Embassy of the Free Mind in Amsterdam. This is our brand new website; it launched last week. This library is special; it has a Guinness record for the largest library devoted to magic and mysticism. It is a really, really special place, and I've been going there for the past few years. I'm a design professor at TU Delft, and much of my work focuses on design philosophy. So, looking at topics like harmony and resonance, which are esoteric topics, I found this library to be incredible. The problem is that it's all in Latin, or most of it. I have a couple years of Latin, but it's really not good enough. So I started working with them to translate their Latin works, which you can find in their digitized catalog.`,
  `Now, there are probably on the order of 300,000 Latin works from the Renaissance, and about 3% of them have been translated. Many people don't know that; they think that with Latin, we've kind of covered that. The Loeb Classical Library is incredible, but very, very little of it has anything to do with the neo-Latin works of the medieval and Renaissance. I think Marx even published in Latin. I also don't read German — I know I'm married to a German, but I don't read German. I don't read French. There are a lot of languages I don't read. Actually, I only read English.`,
  `So, the thing was that we were working with the Embassy of the Free Mind, and it was taking a long time to get their digitized works. Dan Brown, the author of the Da Vinci Code, donated to scan these books, because he wrote much of the Da Vinci Code based on the works in the collection — also known as the Bibliotheca Philosophica Hermetica. These books were kind of locked away in an outdated database system, and so we were waiting. I was busy trying to build a pipeline to translate these books with the new Gemini 3 models, which we heard earlier today are just incredible for transcription and translation. I was impatient, and I was also trying to do my research on metadata standards for libraries. I knew some of the standards, but then I stumbled across IIIF, and I had no idea — and it was so magical. Because of that, we created this organization called SourceLibrary.org.`,
  `This is where we are trying to translate the Renaissance, and because of IIIF, we've now done 15,000 books. It's not so easy to prove a negative, but it seems that about 8,000 or so of these books have never been translated before. And not just the back catalog; some really incredible books, like Robert Fludd's "The Greater and Lesser of Two Worlds," where there are selected translations here and there, but no one took the time to translate a thousand-page Latin tome that has beautiful imagery. A lot of these books have really incredible illustrations. Here's Jacob Böhme, and they have little bits of Latin in there.`,
  `So this is what we've got: a facing-page system where you can see the original text, and you can see the OCR — if it's still appropriate to call it OCR these days — and you can see the language models that were used. So here it's the 3 Flash model, and then you have the English over here. Now, when you throw these things into search — if you use Claude, we've got an MCP, you can connect to this, this is all free, this is all AGPL, open source, Creative Commons — and if you connect to the MCP, it is just incredible. Because not only are there the Latin works that I don't read, there are also the Chinese works and the Sanskrit works, the Armenian works. There's so much that I can't read, and now Claude is able to do these cross-cutting investigations. The Embassy of the Free Mind focuses on things like alchemy. Well, there's a huge Sanskrit alchemy tradition; there's a huge Chinese alchemy tradition, and no one is an expert in all three. Being able to find these links, to put all of these books in one place so you can search through it all — and to search by images too — is really, really fun.`,
  `So this whole talk is basically a love letter to IIIF. Really, what you all have done is remarkable; it's magical. I didn't know it existed, and I felt like I was just able to take advantage of this. So I want to buy you all drinks, and I really encourage you to check out SourceLibrary.org. I also encourage you to visit the Embassy of the Free Mind — that's embassyofthefreemind.com. It's in Amsterdam, on Keizersgracht 123. Source Library is on the fourth floor, so 1-2-3-4. I'm really into Pythagoreanism. And on Thursday evening we're having an official beta launch of Source Library. I just hope to be in touch with all of you, and I thank you for the work that you do.`,
];

export default function IIIFPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="How IIIF Helped Us Translate the Renaissance"
          subtitle="One image standard turned thirteen institutional archives into a single input layer for an AI pipeline — and let us hand the results back to the whole IIIF world."
          image="https://images.sourcelibrary.org/pages/69bd9e336120d54bd037bf37/0010.jpg"
          imageAlt="Engraved frontispiece of Michael Maier's Atalanta Fugiens (Oppenheim, 1617), an alchemical emblem book digitized by e-rara and re-hosted on Source Library"
        >
          <p className="text-stone-400 text-sm mt-4">
            2 June 2026 &middot; 14 min read &middot; Notes accompanying a lightning talk at the IIIF
            2026 Annual Conference, Leiden &amp; The Hague
          </p>
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
          The hero image above is the engraved frontispiece of Michael Maier&rsquo;s{' '}
          <Link href="/book/atalanta-fugiens-hoc-est-emblemata-nova-de-secretis-naturae-maier-3" className="text-accent-rust hover:text-accent-rust underline">
            <em>Atalanta Fugiens</em>
          </Link>{' '}
          (Oppenheim, 1617), an alchemical book of fifty emblems set to music. It reached Source Library
          as a single line in a manifest published by{' '}
          <Link href="/libraries/e-rara" className="text-accent-rust hover:text-accent-rust underline">
            e-rara
          </Link>
          , the Swiss rare-books platform run from the ETH Library in Zurich &mdash; the same kind of
          manifest published by the{' '}
          <Link href="/libraries/bodleian" className="text-accent-rust hover:text-accent-rust underline">Bodleian</Link>, by{' '}
          <Link href="/libraries/gallica" className="text-accent-rust hover:text-accent-rust underline">Gallica</Link>, by the{' '}
          <Link href="/libraries/vatican" className="text-accent-rust hover:text-accent-rust underline">Vatican</Link>, by the{' '}
          <Link href="/libraries/bavarian-state-library" className="text-accent-rust hover:text-accent-rust underline">Bavarian State Library</Link>.
          That shared format is <strong>IIIF</strong>, the International Image Interoperability Framework,
          and it is the reason a small team could take rare books from a dozen of the world&rsquo;s great{' '}
          <Link href="/libraries" className="text-accent-rust hover:text-accent-rust underline">libraries</Link>{' '}
          and turn them into <strong>readable, translated, citable English editions</strong> at a scale
          that would otherwise be impossible.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Source Library is on a mission to translate the Renaissance. We started inside the{' '}
          <Link href="/libraries/bph" className="text-accent-rust hover:text-accent-rust underline">
            Bibliotheca Philosophica Hermetica
          </Link>{' '}
          (the Embassy of the Free Mind) in Amsterdam, and we now hold roughly{' '}
          <Link href="/library" className="text-accent-rust hover:text-accent-rust underline"><strong>30,000 publicly visible works</strong></Link>{' '}
          in Latin, German, Hebrew, Arabic, Sanskrit, Chinese and more &mdash; with over{' '}
          <Link href="/search?first_translation=true" className="text-accent-rust hover:text-accent-rust underline"><strong>6,000</strong> first-ever English translations</Link>{' '}
          you can read today and nearly{' '}
          <Link href="/gallery" className="text-accent-rust hover:text-accent-rust underline"><strong>143,000</strong> illustrations</Link>{' '}
          extracted from their pages. This is the story of how IIIF made that possible, told from both
          sides of the standard: as a consumer, and as a publisher.
        </p>

        <div className="bg-accent-gold/5 rounded-lg p-6 border border-accent-gold/15 mb-12">
          <p className="text-stone-700 leading-relaxed text-sm">
            <strong>What IIIF is, in one breath.</strong> A set of open APIs that let any library
            describe a digitized object &mdash; its pages, their pixel dimensions, the order they go in,
            who holds it, what you&rsquo;re allowed to do with it &mdash; in a <em>manifest</em> that
            any compliant viewer can open. The companion Image API lets you ask for any region of a
            page at any size with one predictable URL. Adopted by hundreds of institutions, it is the
            closest thing the cultural-heritage world has to a universal plug.
          </p>
        </div>

        {/* ── The talk itself ── */}
        <div className="bg-white rounded-xl border border-border-light p-5 md:p-6 mb-12">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-accent-rust shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v3m-4 0h8M12 4a3 3 0 00-3 3v4a3 3 0 006 0V7a3 3 0 00-3-3z" />
            </svg>
            <h2 className="text-lg md:text-xl text-primary font-semibold m-0">Listen to the talk</h2>
          </div>
          <p className="text-sm text-muted leading-relaxed mb-4">
            The five-minute lightning talk as delivered at the Scheltema in Leiden, 2 June 2026 (lightly
            trimmed). It is, in Derek&rsquo;s own words, &ldquo;a love letter to IIIF.&rdquo;
          </p>
          <audio
            className="w-full"
            controls
            preload="metadata"
            src="https://images.sourcelibrary.org/blog/iiif/iiif-2026-talk.mp3"
            aria-label="Audio recording of the IIIF 2026 lightning talk"
          />
          <details className="mt-4 group">
            <summary className="cursor-pointer text-sm text-accent-rust hover:text-accent-rust font-medium select-none">
              Read the transcript
            </summary>
            <div className="mt-4 space-y-4 text-secondary leading-relaxed text-[15px] border-l-2 border-border-light pl-4">
              {TALK_TRANSCRIPT.map((para, i) => (
                <p key={i} className="m-0">{para}</p>
              ))}
            </div>
          </details>
        </div>

        {/* ── Section 1: IIIF as a universal input layer ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">A universal input layer</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Before IIIF, ingesting a book from each new institution meant writing a new scraper against a
          new bespoke viewer, with its own URL scheme, its own tiling quirks, its own login walls. The
          promise of IIIF is that the <em>shape</em> of the data is the same everywhere. Point the same
          importer at a Gallica manifest or a Bodleian manifest and the page images come out the same
          way. The institution changes; the code does not.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          That uniformity is what let us treat thirteen-plus archives as a single faucet feeding one
          downstream pipeline. Everything past the manifest &mdash; OCR, translation, illustration
          detection, scholarly publishing &mdash; is identical regardless of who digitized the book.
        </p>

        <Figure caption="IIIF as a fan-in. Many institutions, one manifest shape, one importer, one pipeline. The interoperability promise is most powerful when the consumer on the right is not a human viewer but a machine.">
          <svg viewBox="0 0 720 360" className="w-full h-auto" role="img" aria-label="Diagram: many institutional IIIF manifests converge into a single importer and pipeline">
            <defs>
              <marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L7,3 L0,6 Z" fill={STONE} />
              </marker>
            </defs>
            {[
              ['Gallica / BnF', 28],
              ['Bodleian', 70],
              ['Vatican', 112],
              ['MDZ Munich', 154],
              ['e-rara', 196],
              ['Wellcome', 238],
              ['Cambridge', 280],
              ['Internet Archive', 322],
            ].map(([label, y]) => (
              <g key={label as string}>
                <rect x="14" y={(y as number) - 14} width="150" height="28" rx="6" fill={PAPER} stroke={LINE} strokeWidth="1.5" />
                <text x="89" y={(y as number) + 4} textAnchor="middle" fontSize="12" fill={INK} fontFamily="ui-sans-serif, system-ui">
                  {label}
                </text>
                <path d={`M164 ${y} C 220 ${y}, 240 175, 300 175`} fill="none" stroke={STONE} strokeWidth="1.8" opacity="1" markerEnd="url(#arrow)" />
              </g>
            ))}
            <rect x="300" y="150" width="120" height="52" rx="8" fill="#fff" stroke={GOLD} strokeWidth="1.5" />
            <text x="360" y="171" textAnchor="middle" fontSize="12.5" fill={INK} fontWeight="600" fontFamily="ui-sans-serif, system-ui">One importer</text>
            <text x="360" y="189" textAnchor="middle" fontSize="11" fill={STONE} fontFamily="ui-sans-serif, system-ui">parses v2 &amp; v3</text>
            <path d="M420 176 L470 176" fill="none" stroke={STONE} strokeWidth="2" markerEnd="url(#arrow)" />
            <rect x="470" y="150" width="118" height="52" rx="8" fill="#fff" stroke={SAGE} strokeWidth="1.5" />
            <text x="529" y="171" textAnchor="middle" fontSize="12.5" fill={INK} fontWeight="600" fontFamily="ui-sans-serif, system-ui">One pipeline</text>
            <text x="529" y="189" textAnchor="middle" fontSize="11" fill={STONE} fontFamily="ui-sans-serif, system-ui">OCR &middot; translate</text>
            <path d="M588 176 L632 176" fill="none" stroke={STONE} strokeWidth="2" markerEnd="url(#arrow)" />
            <rect x="614" y="146" width="96" height="60" rx="8" fill={RUST} />
            <text x="662" y="170" textAnchor="middle" fontSize="12" fill="#fff" fontWeight="600" fontFamily="ui-sans-serif, system-ui">Readable</text>
            <text x="662" y="186" textAnchor="middle" fontSize="11" fill="#fff" opacity="0.92" fontFamily="ui-sans-serif, system-ui">English book</text>
          </svg>
        </Figure>

        <p className="text-secondary leading-relaxed mb-6">
          Here is what that machine consumer actually looks like. Asked to explore the historical
          libraries discussed in the collection, Claude works through Source Library, surfaces the
          relevant works, and &mdash; on a follow-up to find quotes &mdash; returns exact passages from
          Gabriel Naud&eacute;&rsquo;s{' '}
          <em>Advice on Establishing a Library</em> (1627), each with a page number and a citation link
          back to the original:
        </p>

        <figure className="my-10">
          <div className="bg-white rounded-xl border border-border-light p-2 md:p-3 overflow-hidden">
            <video
              className="w-full h-auto rounded-lg block"
              src="https://images.sourcelibrary.org/blog/iiif/claude-reading-sourcelibrary-30s.mp4"
              poster="https://images.sourcelibrary.org/blog/iiif/claude-reading-sourcelibrary-poster.jpg"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              controls
              aria-label="Screen recording: Claude exploring Source Library and returning page-cited quotes from Naudé's Advice on Establishing a Library"
            />
          </div>
          <figcaption className="text-sm text-muted leading-relaxed mt-3 px-1">
            An AI reading the library (sped up). Claude reaches Source Library through its connector,
            works the collection, and returns grounded quotes with page numbers and citation URLs back to
            the original folios &mdash; the interoperability promise, with a machine on the other end. The
            same content is exposed as IIIF for any viewer.
          </figcaption>
        </figure>

        {/* ── Section 2: the import pipeline ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">From manifest to readable book</h2>

        <p className="text-secondary leading-relaxed mb-6">
          When a book enters the library, its IIIF manifest is the seed. Our importer detects the
          version &mdash; IIIF Presentation 2.x stores canvases under{' '}
          <code className="text-sm bg-stone-100 px-1.5 py-0.5 rounded">sequences[0].canvases[]</code>,
          while 3.0 puts them under{' '}
          <code className="text-sm bg-stone-100 px-1.5 py-0.5 rounded">items[]</code> &mdash; walks every
          canvas, and resolves each page to a canonical Image API URL. From there a single pipeline
          carries the book the rest of the way.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          A principle we hold firmly: <strong>every page image is mirrored to our own storage</strong>{' '}
          (Cloudflare R2) as soon as the book is imported. About 99.8% of pages now serve from our
          mirror. We credit and link the source institution on every book, but a reader who lands here
          never depends on an upstream endpoint that might rate-limit, move, or disappear.
        </p>

        <PipelineFlow />

        <p className="text-secondary leading-relaxed mt-10 mb-8">
          The books arrive <em>hidden</em>. Nothing becomes publicly visible until it has been through
          OCR, translation, and a{' '}
          <Link href="/blog/what-makes-a-good-scan" className="text-accent-rust hover:text-accent-rust underline">quality pass</Link>{' '}
          &mdash; the <code className="text-sm bg-stone-100 px-1.5 py-0.5 rounded">visible</code> flag
          flips only at the end. The whole sequence, from a Gallica manifest to a readable, translated
          English edition, runs unattended; minting a citable DOI through Zenodo is a separate, deliberate
          publishing step on top.
        </p>

        {/* ── Section 3: the IIIF Image API URL ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The line that does the work</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The quiet hero of the whole arrangement is the{' '}
          <a href="https://iiif.io/api/image/3.0/" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-rust underline">IIIF Image API</a>{' '}
          URL. It is a small grammar that lets you request any region of any page at any size, by rotation
          and quality, just by editing the path. Here is a real one &mdash; how a viewer asks the Wellcome
          Collection&rsquo;s image server for a full page at 1600 pixels wide:
        </p>

        <ImageApiAnatomy />

        <p className="text-secondary leading-relaxed mt-8 mb-8">
          That grammar is why thumbnails, reading-size pages, and the multi-thousand-pixel crops our
          illustration detector needs are all the <em>same</em> request with three characters changed.
          It is also why, for the small tail of books we still serve from an upstream IIIF server,
          external viewers get true deep-zoom for free: we hand the viewer the provider&rsquo;s image
          service and it tiles on demand.
        </p>

        {/* ── Section 3.5: the parts that are hard ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The parts that are hard</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The clean story above hides a lot of friction. IIIF standardizes the <em>shape</em> of the
          data, but not the politics of getting it &mdash; and a project that fetches millions of images
          has to be a good citizen or it gets (rightly) blocked.
        </p>

        <h3 className="text-xl md:text-2xl text-primary font-semibold mt-10 mb-3">Rate limits, and being polite</h3>
        <p className="text-secondary leading-relaxed mb-6">
          Library and museum image servers throttle aggressively, and they should. We keep a per-host
          token bucket with deliberately conservative limits and exponential backoff on every fetch.
          These are real numbers from our fetcher &mdash; requests per second, per host:
        </p>

        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-stone-50">
                <th className="text-left px-4 py-3 text-primary font-semibold">Host</th>
                <th className="text-left px-4 py-3 text-primary font-semibold">Limit (req/s)</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Internet Archive', '10'],
                ['British Library / EAP (CloudFront)', '15'],
                ['MDZ Munich · Wellcome', '5'],
                ['Gallica · Vatican · Bodleian · Cambridge · Manchester · NDL · Allard Pierson', '3'],
                ['e-rara', '2'],
                ['anything else (default)', '5'],
              ].map(([host, lim]) => (
                <tr key={host} className="border-b border-border-light last:border-0">
                  <td className="px-4 py-3 text-secondary">{host}</td>
                  <td className="px-4 py-3 text-secondary font-mono">{lim}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Those small numbers add up. A single corpus-wide re-archive job to pull full-resolution
          illustrations from the British Library&rsquo;s Endangered Archives meant roughly{' '}
          <strong>240,000 pages &times; 9 image tiles each &mdash; about 2.16 million requests</strong>.
          Done impatiently, that&rsquo;s an accidental denial-of-service against a cultural institution.
          Done at fifteen requests a second behind their cache, it&rsquo;s invisible. The rate limit
          isn&rsquo;t a nuisance to route around; it&rsquo;s the terms of the relationship.
        </p>

        <h3 className="text-xl md:text-2xl text-primary font-semibold mt-10 mb-3">
          The datacenter problem (and an accidental gift from IIIF)
        </h3>
        <p className="text-secondary leading-relaxed mb-6">
          Some institutions &mdash; Harvard, and apparently Gallica &mdash; serve <em>residential</em> IP
          addresses happily but rate-limit <em>datacenter</em> IPs hard. Our import server runs on
          Vercel, in a datacenter, so its requests get 429&rsquo;d while the same manifest opens fine in a
          browser at home. The workaround is to fetch the manifest from a residential connection and
          insert the book directly.
        </p>
        <p className="text-secondary leading-relaxed mb-8">
          Here IIIF&rsquo;s architecture quietly saves us. Because the manifest is separate from the
          images &mdash; it merely <em>references</em> image URLs that are then served straight to the
          reader&rsquo;s browser &mdash; we only need to fetch the manifest <strong>once</strong>. The
          facsimile renders for every reader afterwards even if our own servers never successfully fetch
          those images datacenter-side. Separating presentation metadata from pixels turns a hard block
          into a one-time, low-volume fetch.
        </p>

        <h3 className="text-xl md:text-2xl text-primary font-semibold mt-10 mb-3">
          Browser gates, version drift, and the things we won&rsquo;t do
        </h3>
        <ul className="space-y-3 mb-8 text-secondary leading-relaxed">
          <li className="flex gap-3">
            <span className="text-accent-gold-dark mt-1 shrink-0">&bull;</span>
            <span>
              <strong>Browser gates.</strong> Some viewers hide the manifest behind a JavaScript or
              Cloudflare challenge (the International Dunhuang Programme is one). There is no clean API
              call; you have to drive a real browser to get the manifest at all.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-accent-gold-dark mt-1 shrink-0">&bull;</span>
            <span>
              <strong>Version drift.</strong> Presentation 2.x and 3.0 nest their canvases differently,
              and plenty of &ldquo;IIIF&rdquo; endpoints are partial &mdash; a valid manifest with no
              Image API service (so no deep zoom), metadata in a dozen idiosyncratic shapes, the
              occasional canvas pointing at a missing image.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-accent-gold-dark mt-1 shrink-0">&bull;</span>
            <span>
              <strong>Terms we honor.</strong> Some sources prohibit automated download outright
              (ctext.org, the National Library of China). We don&rsquo;t ingest them, even where it would
              be technically trivial. &ldquo;Can&rdquo; is not &ldquo;may,&rdquo; and a library that
              didn&rsquo;t respect that wouldn&rsquo;t deserve the name.
            </span>
          </li>
        </ul>

        {/* ── Section 3.7: when there is no manifest ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">When there is no manifest</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Not everything publishes IIIF. A great many digitized books live behind a bespoke viewer, an
          OAI-PMH feed, a discovery layer, or nothing more than a download link. IIIF is our preferred
          on-ramp, not our only one &mdash; so when there&rsquo;s no manifest, we fall back, roughly in
          this order:
        </p>

        <ol className="space-y-4 mb-8 text-secondary leading-relaxed">
          <li className="flex gap-3">
            <span className="font-mono text-sm text-accent-gold-dark mt-0.5 shrink-0">1.</span>
            <span>
              <strong>Another catalog API.</strong> OAI-PMH, SRU, or a discovery API like Primo VE (which
              we sometimes drive through a real browser session) gives us a candidate list and enough
              metadata to dedupe and locate the page images, which we then assemble ourselves. This is
              how we harvested KU Leuven&rsquo;s digitized holdings, where there is no clean IIIF-only
              facet.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-sm text-accent-gold-dark mt-0.5 shrink-0">2.</span>
            <span>
              <strong>The fallback chain.</strong> To find a digitized copy at all, we try Internet
              Archive &rarr; Gallica &rarr; HathiTrust &rarr; Project Gutenberg in turn. If one source
              blocks or 403s, we move on rather than fight it.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-sm text-accent-gold-dark mt-0.5 shrink-0">3.</span>
            <span>
              <strong>Direct partner ingest.</strong> The founding collection &mdash; the Embassy of the
              Free Mind&rsquo;s own rare books &mdash; comes straight off the institution&rsquo;s scanning
              archive, never via IIIF. (Those scans bring their own puzzles: many are two-page spreads
              that have to be detected and split before the pipeline can read a single page.)
            </span>
          </li>
        </ol>

        <p className="text-secondary leading-relaxed mb-6">
          The design choice that makes this manageable: <strong>every path normalizes into the same book
          and page document shape</strong> &mdash; same fields, same content fingerprint for dedup, same
          provenance record &mdash; before anything downstream runs. So the pipeline neither knows nor
          cares whether a book arrived as a pristine IIIF v3 manifest or was hand-assembled from a browser
          session. IIIF is the widest, cleanest door into one shared room.
        </p>

        <Figure caption="Every on-ramp converges. IIIF is the best entry point, but a browser-driven viewer, a catalog API, the fallback chain, or a partner's own scans all normalize into the same document shape — so one downstream pipeline serves them all.">
          <svg viewBox="0 0 720 260" className="w-full h-auto" role="img" aria-label="Diagram: four ingest paths — IIIF manifest, browser-driven viewer, catalog API, partner scans — converge into one normalized document shape and one pipeline">
            <defs>
              <marker id="arrow3" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L7,3 L0,6 Z" fill={STONE} />
              </marker>
            </defs>
            {([
              ['IIIF manifest', 38, GOLD],
              ['Browser-driven viewer', 88, STONE],
              ['Catalog API (OAI / SRU)', 138, STONE],
              ["Partner's own scans", 188, STONE],
            ] as [string, number, string][]).map(([label, y, c]) => (
              <g key={label}>
                <rect x="14" y={y - 16} width="196" height="32" rx="6" fill={PAPER} stroke={c} strokeWidth={c === GOLD ? 1.6 : 1} />
                <text x="112" y={y + 4} textAnchor="middle" fontSize="12" fill={INK} fontFamily="ui-sans-serif, system-ui">
                  {label}
                </text>
                <path d={`M210 ${y} C 274 ${y}, 300 113, 350 113`} fill="none" stroke={STONE} strokeWidth="1.8" opacity="1" markerEnd="url(#arrow3)" />
              </g>
            ))}
            <rect x="352" y="85" width="156" height="56" rx="9" fill="#fff" stroke={SAGE} strokeWidth="1.6" />
            <text x="430" y="107" textAnchor="middle" fontSize="12.5" fontWeight="700" fill={INK} fontFamily="ui-sans-serif, system-ui">Normalized doc</text>
            <text x="430" y="125" textAnchor="middle" fontSize="10.5" fill={STONE} fontFamily="ui-sans-serif, system-ui">+ fingerprint + provenance</text>
            <path d="M508 113 L556 113" fill="none" stroke={STONE} strokeWidth="2" markerEnd="url(#arrow3)" />
            <rect x="558" y="86" width="148" height="54" rx="9" fill={RUST} />
            <text x="632" y="108" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#fff" fontFamily="ui-sans-serif, system-ui">One pipeline</text>
            <text x="632" y="126" textAnchor="middle" fontSize="10.5" fill="#fff" opacity="0.92" fontFamily="ui-sans-serif, system-ui">OCR &middot; translate &middot; publish</text>
          </svg>
        </Figure>

        {/* ── Section 4: we serve IIIF too ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">We give it back</h2>

        <p className="text-secondary leading-relaxed mb-6">
          IIIF is not just how books come in. It is also how they go back out. Every book in the library
          publishes its own{' '}
          <a href="https://iiif.io/api/presentation/3.0/" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-rust underline">Presentation 3.0</a>{' '}
          manifest:
        </p>

        <div className="bg-stone-900 rounded-lg p-4 mb-4 overflow-x-auto">
          <code className="text-sm text-stone-200 whitespace-nowrap">
            https://sourcelibrary.org/api/iiif/<span style={{ color: '#e0a96d' }}>{'{bookId}'}</span>/manifest
          </code>
        </div>
        <p className="text-sm text-muted mb-8">
          Live example: the{' '}
          <a href="https://sourcelibrary.org/api/iiif/69bd9e336120d54bd037bf37/manifest" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-rust underline">manifest for <em>Atalanta Fugiens</em></a>{' '}
          &mdash; load it in a viewer and you can search and read its translation.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Point{' '}
          <a href="https://projectmirador.org/" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-rust underline">Mirador</a>,{' '}
          <a href="https://universalviewer.io/" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-rust underline">Universal Viewer</a>,{' '}
          <a href="https://samvera-labs.github.io/clover-iiif/" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-rust underline">Clover</a>, or{' '}
          <a href="https://theseusviewer.org/" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-rust underline">Theseus</a>{' '}
          at that URL and you get the page images &mdash; but also something the original manifest never
          had:{' '}
          <strong>our AI-generated OCR and English translation, delivered as Web Annotations that overlay
          the original folio</strong>. The transcription and the translation sit on the very pixels they
          describe, so you can read the Latin and the English against the page itself, in a viewer the
          institution already trusts.
        </p>

        <Figure caption="The round trip. We take a provider's images-only manifest, add OCR and translation as annotations, and republish a richer manifest that any IIIF viewer can open. The digitizing institution is credited first; we are the re-hosting, enriching aggregator second.">
          <svg viewBox="0 0 720 300" className="w-full h-auto" role="img" aria-label="Diagram: a provider manifest gains OCR and translation annotations and is republished as a Source Library manifest for any IIIF viewer">
            <defs>
              <marker id="arrow2" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L7,3 L0,6 Z" fill={STONE} />
              </marker>
            </defs>
            {/* provider manifest */}
            <rect x="20" y="100" width="150" height="100" rx="8" fill={PAPER} stroke={LINE} strokeWidth="1.5" />
            <text x="95" y="128" textAnchor="middle" fontSize="12.5" fontWeight="600" fill={INK} fontFamily="ui-sans-serif, system-ui">Provider manifest</text>
            <text x="95" y="150" textAnchor="middle" fontSize="11" fill={STONE} fontFamily="ui-sans-serif, system-ui">page images</text>
            <text x="95" y="167" textAnchor="middle" fontSize="11" fill={STONE} fontFamily="ui-sans-serif, system-ui">order, rights</text>
            <text x="95" y="184" textAnchor="middle" fontSize="11" fill={STONE} fontFamily="ui-sans-serif, system-ui">institution</text>
            {/* arrow into SL */}
            <path d="M170 150 L232 150" fill="none" stroke={STONE} strokeWidth="2" markerEnd="url(#arrow2)" />
            {/* Source Library enriches */}
            <rect x="234" y="78" width="186" height="144" rx="10" fill="#fff" stroke={GOLD} strokeWidth="1.6" />
            <text x="327" y="104" textAnchor="middle" fontSize="13" fontWeight="700" fill={INK} fontFamily="ui-sans-serif, system-ui">Source Library</text>
            <rect x="252" y="118" width="150" height="26" rx="5" fill="#f3e3c0" stroke={GOLD} strokeOpacity="0.9" />
            <text x="327" y="135" textAnchor="middle" fontSize="11" fill={INK} fontFamily="ui-sans-serif, system-ui">+ OCR annotations</text>
            <rect x="252" y="150" width="150" height="26" rx="5" fill="#f3e3c0" stroke={GOLD} strokeOpacity="0.9" />
            <text x="327" y="167" textAnchor="middle" fontSize="11" fill={INK} fontFamily="ui-sans-serif, system-ui">+ translation</text>
            <rect x="252" y="182" width="150" height="26" rx="5" fill="#dbe5cc" stroke={SAGE} strokeOpacity="0.9" />
            <text x="327" y="199" textAnchor="middle" fontSize="11" fill={INK} fontFamily="ui-sans-serif, system-ui">credits provider first</text>
            {/* arrow out */}
            <path d="M420 150 L482 150" fill="none" stroke={STONE} strokeWidth="2" markerEnd="url(#arrow2)" />
            {/* viewers */}
            <rect x="484" y="100" width="216" height="100" rx="8" fill={RUST} />
            <text x="592" y="128" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#fff" fontFamily="ui-sans-serif, system-ui">Any IIIF viewer</text>
            <text x="592" y="150" textAnchor="middle" fontSize="11" fill="#fff" opacity="0.92" fontFamily="ui-sans-serif, system-ui">Mirador &middot; Universal Viewer</text>
            <text x="592" y="167" textAnchor="middle" fontSize="11" fill="#fff" opacity="0.92" fontFamily="ui-sans-serif, system-ui">Clover &middot; Theseus</text>
            <text x="592" y="184" textAnchor="middle" fontSize="11" fill="#fff" opacity="0.92" fontFamily="ui-sans-serif, system-ui">reads text on the folio</text>
          </svg>
        </Figure>

        <p className="text-secondary leading-relaxed mt-2 mb-6">
          Serving annotations from a machine carries an obligation, and we treat it as a hard
          invariant. AI text is never presented as a faithful human transcription: every annotation
          carries a Web-Annotation <code className="text-sm bg-stone-100 px-1.5 py-0.5 rounded">generator</code>{' '}
          labeled &ldquo;machine-generated, not human-verified,&rdquo; with the model name attached. And
          we are scrupulous never to leak the AI&rsquo;s <em>editorial</em> notes &mdash; the little
          summaries and keyword blocks our pipeline writes <em>about</em> a page &mdash; into the
          transcription, because those describe the page rather than quote it. The whole point of a
          source library is that what you quote is really on the leaf in front of you.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Two more disciplines that matter to a IIIF audience: the digitizing institution is always
          listed <strong>first</strong> in the manifest&rsquo;s provider array and named in a
          required-statement (&ldquo;Digitized by {'{'}institution{'}'}. Re-hosted with AI-generated OCR
          and translation by Source Library&rdquo;); and canvas dimensions use the <em>real</em>{' '}
          digitized pixel size whenever the archiving step recorded it, so a region citation lands on the
          words it claims. There is also a{' '}
          <a href="https://iiif.io/api/search/2.0/" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-rust underline">Content Search 2.0</a>{' '}
          endpoint, so a viewer can search across a book&rsquo;s OCR and translation and get back
          highlighted hits as annotations &mdash; a single book&rsquo;s manifest can return dozens of
          matches with the exact phrase highlighted on each folio.
        </p>

        {/* ── Section 4.5: provenance ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Provenance is the whole point</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Everything above is in service of one idea, and it is worth saying plainly. We take a book, run
          it through machine OCR, run that through machine translation, and add machine-written editorial
          notes. By the time a reader sees an English sentence, it has passed through three layers of
          automation. The single thing that keeps this honest &mdash; that makes it a <em>library</em>{' '}
          rather than a content farm &mdash; is an unbroken chain of provenance back to the original leaf.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          IIIF is unusually good at carrying that chain, and we lean on it at both ends:
        </p>

        <ul className="space-y-3 mb-8 text-secondary leading-relaxed">
          <li className="flex gap-3">
            <span className="text-accent-gold-dark mt-1 shrink-0">&bull;</span>
            <span>
              <strong>On the way in,</strong> every book records who digitized it, the URL of the original
              catalog record, the institution&rsquo;s own attribution and rights statement, and a content
              fingerprint (often the IIIF identifier itself) used for deduplication. We mirror the page
              images to our own storage for speed and reliability &mdash; but we never sever the link
              back. Every book page keeps a live link to the source record <em>and</em> to the upstream
              IIIF manifest, so a skeptical reader can go check the original for themselves. <em>Ad
              fontes.</em>
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-accent-gold-dark mt-1 shrink-0">&bull;</span>
            <span>
              <strong>On the way out,</strong> our manifest credits the digitizing institution first;
              every AI annotation carries a machine-generated marker with the model&rsquo;s name; canvas
              dimensions are the real digitized pixel sizes (when known) so a region citation lands on the
              words it claims; and we rigorously strip the AI&rsquo;s editorial <em>descriptions</em> of a
              page so they can never be quoted as if they were the text on it.
            </span>
          </li>
        </ul>

        <p className="text-secondary leading-relaxed mb-8">
          That last point is not theoretical. Early on, a page-description note our pipeline had written{' '}
          <em>about</em> a page &mdash; mentioning mercury discussed on a neighboring leaf &mdash; leaked
          into a search snippet and produced a confident citation to words that were not on the page. The
          fix was to treat the boundary between the author&rsquo;s words and the machine&rsquo;s words as
          sacred, everywhere those words are served. For a human reader that boundary is a matter of
          trust; for an AI consuming the library through these same manifests, it is the difference
          between grounded scholarship and{' '}
          <Link href="/blog/confident-hallucinator" className="text-accent-rust hover:text-accent-rust underline">fluent invention</Link>.
          Provenance is what lets either one tell the two apart.
        </p>

        {/* ── Section 5: ideas ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Where this could go next</h2>

        <p className="text-secondary leading-relaxed mb-6">
          A few directions we&rsquo;re thinking about &mdash; some prompted by the question that started
          this post: <em>do we really have to hit an endpoint for every single book?</em>
        </p>

        <div className="space-y-5 mb-8">
          <IdeaCard
            n="01"
            title="Harvest collections, not books — via IIIF Collection documents"
            body={
              <>
                Today we mostly enumerate candidates one institution at a time, then fetch each
                manifest at import. But IIIF already has the right primitive for bulk: the{' '}
                <a href="https://iiif.io/api/presentation/3.0/#51-collection" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-rust underline"><strong>Collection</strong></a>{' '}
                document &mdash; a manifest of manifests. A single
                Collection URL can list thousands of objects with their manifest links and enough
                metadata to dedupe and subject-filter <em>before</em> we ever fetch a page. Walking
                published Collections (and the top-level &ldquo;collection of collections&rdquo; some
                institutions expose) would let us snapshot an entire archive&rsquo;s catalog in a few
                polite requests, diff it against what we hold, and queue only the genuinely new works.
                It turns &ldquo;crawl and hope&rdquo; into &ldquo;subscribe and diff.&rdquo;
              </>
            }
          />
          <IdeaCard
            n="02"
            title="A local manifest cache + change detection"
            body={
              <>
                Even without Collections everywhere, we can store each manifest we fetch with its{' '}
                <code className="text-xs bg-stone-100 px-1 py-0.5 rounded">ETag</code> /{' '}
                <code className="text-xs bg-stone-100 px-1 py-0.5 rounded">Last-Modified</code> and a
                content hash. Re-imports and re-checks then become conditional requests that mostly
                return <code className="text-xs bg-stone-100 px-1 py-0.5 rounded">304 Not Modified</code>{' '}
                &mdash; near-zero load on the institution, and we notice when a manifest genuinely
                changes (a new page, corrected rights, an added DOI). It also makes our imports
                reproducible: the manifest we built from is on disk, not re-fetched from a moving target.
              </>
            }
          />
          <IdeaCard
            n="03"
            title="Run a IIIF Image API over our own mirror"
            body={
              <>
                Because ~99.8% of our pages live as flat JPEGs on R2, our own hosted books are{' '}
                <em>not</em> currently deep-zoomable in external viewers &mdash; only the upstream tail
                is. The clean convergence is to serve a Level 1/2 Image API over the R2 derivatives:
                then every page is simultaneously <em>ours</em>, reliable, <em>and</em> zoomable, with no
                dependency on any upstream server. The most promising path extends our existing image
                proxy to honor Image API URL syntax and emit{' '}
                <code className="text-xs bg-stone-100 px-1 py-0.5 rounded">info.json</code>, then attaches{' '}
                <em>our</em> image service to the manifest.
              </>
            }
          />
          <IdeaCard
            n="04"
            title="Publish our own Collections — and a Change Discovery feed"
            body={
              <>
                If Collections are good for ingesting, they&rsquo;re good for sharing. We could expose
                our holdings as IIIF Collections (by language, by tradition, by source institution) and
                a{' '}
                <a href="https://iiif.io/api/discovery/1.0/" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-rust underline">IIIF Change Discovery</a>{' '}
                activity stream, so other projects can harvest <em>us</em> the same efficient way &mdash;
                including the first-translation editions that don&rsquo;t exist anywhere else.
              </>
            }
          />
        </div>

        {/* ── Section 6: appreciations ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Appreciations</h2>

        <p className="text-secondary leading-relaxed mb-6">
          None of this exists without the institutions that did the patient, expensive work of
          digitizing these books and &mdash; crucially &mdash; <em>chose to publish them as IIIF</em>{' '}
          rather than locking them behind a bespoke viewer. Every English translation we&rsquo;ve made
          rests on their decision to be interoperable. A standard is only as generous as the people who
          adopt it, and these libraries have been generous.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          First among them is the <Link href="/libraries/bph" className="text-accent-rust hover:text-accent-rust underline">Bibliotheca Philosophica Hermetica</Link>{' '}
          / Embassy of the Free Mind in Amsterdam, where this project began and whose collection
          remains its heart. And then, in gratitude, the archives whose IIIF manifests have become books
          you can now read in English:
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
          {([
            ['Internet Archive', '8,360', 'internet-archive'],
            ['Bavarian State Library (MDZ)', '2,383', 'bavarian-state-library'],
            ['British Library (incl. EAP)', '1,538', 'british-library'],
            ['e-rara (ETH Zürich et al.)', '1,149', 'e-rara'],
            ['Harvard Library', '827', 'harvard'],
            ['Allard Pierson, Amsterdam', '489', 'allard-pierson'],
            ['Gallica / BnF', '251', 'gallica'],
            ['John Rylands, Manchester', '214', 'manchester'],
            ['Bodleian Libraries, Oxford', '210', 'bodleian'],
            ['Biblioteca Medicea Laurenziana', '130', 'laurenziana'],
            ['Vatican Apostolic Library', '111', 'vatican'],
            ['Cambridge Digital Library', '63', 'cambridge'],
            ['Leiden University Libraries', '53', 'leiden'],
            ['Library of Congress', '50', 'library-of-congress'],
            ['National Diet Library, Japan', '41', 'national-diet-library'],
          ] as [string, string, string][]).map(([name, count, slug]) => (
            <Link key={name} href={`/libraries/${slug}`} className="block bg-white rounded-lg border border-border-light px-4 py-3 hover:border-accent-gold/40 hover:shadow-sm transition-all group">
              <div className="text-sm text-primary font-medium leading-snug group-hover:text-accent-gold-dark transition-colors">{name}</div>
              <div className="text-xs text-muted mt-1">{count} works</div>
            </Link>
          ))}
        </div>

        <p className="text-secondary leading-relaxed mb-8 text-sm">
          Counts are of imported works by source; many more institutions contribute manuscripts,
          artworks, and open-access images through IIIF and adjacent APIs (the Rijksmuseum, the Met, the
          National Gallery, Wikimedia Commons, e-codices, Chester Beatty, and others). To every
          digitization team, cataloguer, and standards contributor behind these manifests:{' '}
          <em>thank you.</em> You built the rails. We just ran a train on them.
        </p>

        <div className="bg-accent-gold/5 rounded-lg p-6 border border-accent-gold/15 mb-8">
          <p className="text-stone-700 leading-relaxed">
            <strong>Try it:</strong> open the{' '}
            <a href="https://sourcelibrary.org/api/iiif/69bd9e336120d54bd037bf37/manifest" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-rust underline">
              <em>Atalanta Fugiens</em> manifest
            </a>{' '}
            (or any book&rsquo;s <code className="text-sm bg-white/70 px-1.5 py-0.5 rounded">/api/iiif/{'{bookId}'}/manifest</code>)
            in your viewer of choice, browse the{' '}
            <Link href="/library" className="text-accent-rust hover:text-accent-rust underline">library</Link>,{' '}
            search{' '}
            <Link href="/search" className="text-accent-rust hover:text-accent-rust underline">the full text</Link>, or
            wander the{' '}
            <Link href="/gallery" className="text-accent-rust hover:text-accent-rust underline">gallery</Link>{' '}
            of extracted illustrations. Every book keeps the source text next to the English, and credits
            the library that digitized it.
          </p>
        </div>

        <div className="border-t border-border-light pt-8 mt-16">
          <p className="text-secondary text-sm leading-relaxed">
            Source Library is a project of the Embassy of the Free Mind. These notes accompany a
            lightning talk at the{' '}
            <a href="https://iiif.io/event/2026/leiden/" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-rust underline">IIIF 2026 Annual Conference &amp; Showcase</a>{' '}
            in Leiden and The Hague. Corrections and feedback are welcome &mdash;{' '}
            <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:text-accent-rust underline">
              team@sourcelibrary.org
            </a>
            .
          </p>
        </div>
      </article>

    </ContentPageLayout>
  );
}

/* ── Reusable figure wrapper ── */
function Figure({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <figure className="my-10">
      <div className="bg-white rounded-xl border border-border-light p-4 md:p-6">{children}</div>
      <figcaption className="text-sm text-muted leading-relaxed mt-3 px-1">{caption}</figcaption>
    </figure>
  );
}

/* ── The import pipeline, as responsive steps ── */
function PipelineFlow() {
  const steps: { n: string; title: string; sub: string; tone: 'in' | 'mid' | 'out' }[] = [
    { n: '1', title: 'IIIF manifest', sub: 'fetch v2 or v3', tone: 'in' },
    { n: '2', title: 'Parse canvases', sub: 'walk to page image URLs', tone: 'in' },
    { n: '3', title: 'Mirror to R2', sub: 'copy every page to our storage', tone: 'in' },
    { n: '4', title: 'Gemini OCR', sub: 'read each page', tone: 'mid' },
    { n: '5', title: 'Translate', sub: 'render English', tone: 'mid' },
    { n: '6', title: 'Enrich', sub: 'summary, index, chapters', tone: 'mid' },
    { n: '7', title: 'Detect images', sub: 'find & crop illustrations', tone: 'mid' },
    { n: '8', title: 'Publish', sub: 'readable & citable /book', tone: 'out' },
  ];
  const tones: Record<string, string> = {
    in: 'border-stone-400 bg-stone-100',
    mid: 'border-accent-gold/70 bg-accent-gold/15',
    out: 'border-accent-rust/70 bg-accent-rust/15',
  };
  return (
    <div className="bg-white rounded-xl border border-border-light p-4 md:p-6">
      <div className="flex flex-wrap items-stretch gap-2">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-stretch gap-2 grow">
            <div className={`flex-1 min-w-[120px] rounded-lg border px-3 py-3 ${tones[s.tone]}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-mono text-muted">{s.n}</span>
                <span className="text-sm font-medium text-primary leading-tight">{s.title}</span>
              </div>
              <div className="text-xs text-muted leading-snug">{s.sub}</div>
            </div>
            {i < steps.length - 1 && (
              <div className="flex items-center text-stone-500 shrink-0" aria-hidden>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border border-stone-400 bg-stone-100" /> ingest</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border border-accent-gold/70 bg-accent-gold/15" /> AI processing</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border border-accent-rust/70 bg-accent-rust/15" /> published</span>
      </div>
    </div>
  );
}

/* ── IIIF Image API URL anatomy ── */
function ImageApiAnatomy() {
  const parts: { text: string; label: string; color: string }[] = [
    { text: 'https://iiif.wellcomecollection.org/image/b33599051_0001.jp2', label: 'identifier', color: '#6b7d5a' },
    { text: '/full', label: 'region', color: '#9a6f2e' },
    { text: '/1600,', label: 'size', color: '#b5482a' },
    { text: '/0', label: 'rotation', color: '#3f6f8f' },
    { text: '/default.jpg', label: 'quality.format', color: '#7a5a8f' },
  ];
  return (
    <div className="bg-white rounded-xl border border-border-light p-5 md:p-6">
      <div className="font-mono text-sm md:text-base break-all leading-relaxed">
        {parts.map((p) => (
          <span key={p.label} style={{ color: p.color, borderBottom: `2px solid ${p.color}` }}>
            {p.text}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-5">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5 text-xs text-secondary">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted mt-4 leading-relaxed">
        Change <span className="font-mono">/full</span> to a pixel box and you get a crop; change{' '}
        <span className="font-mono">/1600,</span> to <span className="font-mono">/200,</span> and you get
        a thumbnail. Same page, same grammar, three characters apart.
      </p>
    </div>
  );
}

/* ── Idea cards for the roadmap section ── */
function IdeaCard({ n, title, body }: { n: string; title: string; body: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-5 md:p-6 flex gap-4">
      <div className="font-mono text-accent-gold-dark text-sm pt-0.5 shrink-0">{n}</div>
      <div>
        <h3 className="text-lg text-primary font-medium mb-2 leading-snug">{title}</h3>
        <p className="text-secondary leading-relaxed text-[15px]">{body}</p>
      </div>
    </div>
  );
}
