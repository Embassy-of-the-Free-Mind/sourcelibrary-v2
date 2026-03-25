import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'FAQ — Source Library',
  description: 'Common questions about AI translation quality, OCR accuracy, scholarly standards, and how Source Library handles primary source texts.',
  alternates: { canonical: '/about/faq' },
};

interface FAQItem {
  question: string;
  answer: React.ReactNode;
}

const faqs: FAQItem[] = [
  {
    question: 'Are the translations reliable?',
    answer: (
      <>
        <p>
          Our translations are AI-generated and clearly marked as such. They are
          <strong> working translations</strong>, not peer-reviewed scholarly editions.
          They exist to make texts accessible that would otherwise remain locked behind
          Latin, Greek, Arabic, or German &mdash; languages most readers cannot access.
        </p>
        <p>
          Every translation is displayed alongside the original language text and the
          scanned page image. Readers can verify any passage against the source. We do
          not present AI translations as authoritative &mdash; we present them as a bridge
          to the original.
        </p>
        <p>
          Where published human translations exist, we note them and encourage readers
          to consult them. Our goal is access, not replacement of scholarship.
        </p>
      </>
    ),
  },
  {
    question: 'How is this different from other AI translation projects?',
    answer: (
      <>
        <p>
          Most AI translation projects start from existing digital text &mdash; often
          low-quality OCR scraped from Internet Archive or similar sources. The text
          is already corrupted before translation begins. Garbage in, garbage out.
        </p>
        <p>
          We start from <strong>high-resolution page images</strong> sourced directly
          from institutional IIIF servers (Bodleian, Gallica, Vatican, BSB Munich, etc.).
          Our OCR uses Gemini vision models that read historical typefaces &mdash;
          blackletter, early Roman type, polytonic Greek &mdash; directly from the image.
          The translation model then works from this fresh transcription with full page
          context, not from noisy pre-existing OCR.
        </p>
        <p>
          The difference is substantial. A 19th-century Patrologia Graeca volume with
          polytonic Greek diacritics will produce near-random output from legacy OCR.
          Our pipeline reads the same page as a trained eye would.
        </p>
      </>
    ),
  },
  {
    question: 'Can AI hallucinate in translations?',
    answer: (
      <>
        <p>
          Yes. All large language models can produce plausible-sounding text that
          diverges from the source. This is a known limitation, and we take it seriously.
        </p>
        <p>Our mitigations:</p>
        <ul>
          <li>
            <strong>Original always visible.</strong> Every page shows the scan, the
            transcription, and the translation side by side. Hallucination is immediately
            checkable.
          </li>
          <li>
            <strong>Page-level context.</strong> We translate page by page with
            surrounding context, not sentence by sentence. This reduces the model&apos;s
            tendency to fill gaps with invention.
          </li>
          <li>
            <strong>No &ldquo;first translation&rdquo; claims.</strong> We do not claim
            our AI output constitutes a scholarly first translation. We provide access
            to texts, not definitive renderings.
          </li>
          <li>
            <strong>Revision history.</strong> All OCR and translation data is versioned.
            When models improve, we can re-process texts and track changes.
          </li>
        </ul>
        <p>
          If you spot an error, we want to know. These translations improve over time.
        </p>
      </>
    ),
  },
  {
    question: 'Why not just use human translators?',
    answer: (
      <>
        <p>
          We would love to. The problem is scale. Source Library contains thousands of books
          spanning 2,500 years, in Latin, Greek, Arabic, Hebrew, German, French, Dutch,
          Italian, and more. There are not enough translators alive to render this corpus
          into English at any price.
        </p>
        <p>
          The economics are prohibitive. Professional scholarly translation from Latin, Greek,
          or Arabic costs $0.20&ndash;$0.30 per word. An average book in the collection runs
          50,000&ndash;80,000 words. Even for the 8,000+ books currently visible, that&apos;s
          roughly <strong>$100&ndash;$200 million</strong> and over <strong>1,000 translator-years</strong> of
          full-time work &mdash; assuming you could find enough specialists in medieval Latin
          paleography, polytonic Greek, classical Arabic, and early modern German to even
          attempt it. The global pool of such translators numbers in the hundreds.
        </p>
        <p>
          Many of these texts have <em>never</em> been translated into any modern language.
          A working AI translation that gets the reader 80% of the way is better than
          no translation at all. And for scholars who do read the original languages,
          the transcription itself &mdash; searchable, citable, linked to the page
          image &mdash; is the real value.
        </p>
        <p>
          We actively support human translation efforts. When a scholar produces a critical
          translation of a text in our collection, we link to it and encourage its use.
        </p>
      </>
    ),
  },
  {
    question: 'Where do the scans come from?',
    answer: (
      <>
        <p>
          Page images are sourced from institutional digital libraries via IIIF
          (International Image Interoperability Framework), a standard used by the
          world&apos;s major research libraries. Our current sources include:
        </p>
        <ul>
          <li>Internet Archive</li>
          <li>Biblioth&egrave;que nationale de France (Gallica)</li>
          <li>Bodleian Library, University of Oxford</li>
          <li>Bayerische Staatsbibliothek (BSB Munich)</li>
          <li>Vatican Apostolic Library (DigiVatLib)</li>
          <li>Austrian National Library (ONB)</li>
          <li>Embassy of the Free Mind / Bibliotheca Philosophica Hermetica</li>
          <li>Cambridge University Library</li>
          <li>Library of Congress</li>
          <li>And others &mdash; 24 import pipelines in total</li>
        </ul>
        <p>
          Each book&apos;s source is recorded with full provenance: the institution,
          the shelfmark or identifier, the license, and the date of access. We link
          back to the original digital object at the holding institution.
        </p>
      </>
    ),
  },
  {
    question: 'What about copyright?',
    answer: (
      <>
        <p>
          The texts in our collection are primarily pre-1900 publications and manuscripts,
          well outside copyright. The scholarly editions we digitize (Migne, Teubner, MGH,
          CSEL, Loeb pre-1929) are also in the public domain.
        </p>
        <p>
          Page images are used under the terms of each source institution &mdash; typically
          Creative Commons licenses (CC BY, CC BY-NC) or public domain dedications. We
          record the license for every book and respect institutional terms of use.
        </p>
        <p>
          Our AI-generated translations and OCR transcriptions are original outputs. We
          publish scholarly editions with DOIs via Zenodo under open access terms.
        </p>
      </>
    ),
  },
  {
    question: 'How do you choose which books to include?',
    answer: (
      <>
        <p>
          Source Library&apos;s curatorial vision grows from the Bibliotheca Philosophica
          Hermetica at the Embassy of the Free Mind in Amsterdam &mdash; one of the
          world&apos;s great collections of Western esoteric literature, recognized by
          UNESCO&apos;s Memory of the World Register. Our core subject areas reflect that
          heritage: Hermetic philosophy, alchemy, Neoplatonism, Kabbalah, Rosicrucianism,
          astrology, and the broader currents of Renaissance and early modern thought.
        </p>
        <p>
          But the tradition doesn&apos;t exist in isolation. To understand Ficino you need
          Plato and Plotinus. To understand Paracelsus you need Galen and the Arabic
          alchemists. To understand the Rosicrucian manifestos you need the Reformation
          correspondence they emerged from. So the collection extends outward: classical
          philosophy, patristic theology, Byzantine manuscript culture, the scientific
          revolution, and the literary traditions of the Islamic world, India, and China.
        </p>
        <p>
          Within that scope, we prioritize <strong>original language editions</strong> over
          modern translations, and <strong>earliest available editions</strong> over later
          reprints. A 1497 Ficino is better than a 1960 reprint. A Greek Patrologia Graeca
          volume is better than a 19th-century English paraphrase.
        </p>
        <p>
          Processing priority follows the same curatorial logic. Texts closest to the
          EFM&apos;s core &mdash; Hermetica, alchemical treatises, Neoplatonist works &mdash;
          are translated first. From there, the circle expands. We are not neutral
          aggregators; we have a point of view about what matters and what connects to what.
          That said, everything in the collection is freely available regardless of
          processing status.
        </p>
      </>
    ),
  },
  {
    question: 'Can I cite Source Library in academic work?',
    answer: (
      <>
        <p>
          Yes. Each book has a stable URL and a citation-ready reference. For texts
          we have published as scholarly editions, DOIs are available via Zenodo.
        </p>
        <p>
          For AI translations, cite them as such: <em>&ldquo;AI-assisted translation,
          Source Library (sourcelibrary.org), accessed [date].&rdquo;</em> The original
          language text and page images are the primary source; the translation is an aid.
        </p>
        <p>
          Our <Link href="/developers" className="underline">API and MCP server</Link> provide
          programmatic access with per-page citation URLs, making it easy to reference
          specific passages.
        </p>
      </>
    ),
  },
  {
    question: 'Is this a commercial project?',
    answer: (
      <>
        <p>
          Source Library is a non-profit project in partnership with the Embassy of the
          Free Mind in Amsterdam. All texts, translations, and tools are freely accessible.
          There are no paywalls.
        </p>
        <p>
          The project is funded by institutional support and individual contributions.
          Processing thousands of books with AI is expensive &mdash; if you find value
          in this work, <Link href="/support" className="underline">support is welcome</Link>.
        </p>
      </>
    ),
  },
];

export default function FAQPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Frequently Asked Questions"
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-12">
          Source Library uses AI to make historical texts accessible. Here are honest
          answers to the questions scholars, students, and readers ask most.
        </p>

        <div className="space-y-12">
          {faqs.map((faq, i) => (
            <div key={i} className="border-b border-border-light pb-10 last:border-0">
              <h2 className="text-xl md:text-2xl text-primary mb-4 font-medium">
                {faq.question}
              </h2>
              <div className="text-secondary leading-relaxed space-y-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_strong]:text-stone-800">
                {faq.answer}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-16 pt-8 border-t border-border-light flex flex-wrap gap-4">
          <Link
            href="/about"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            About Source Library
          </Link>
          <Link
            href="/about/processing"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            How Processing Works
          </Link>
          <Link
            href="/about/standards"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Standards & Interoperability
          </Link>
        </div>
      </div>
    </ContentPageLayout>
  );
}
