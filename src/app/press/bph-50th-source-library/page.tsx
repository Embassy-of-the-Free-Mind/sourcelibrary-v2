import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Embassy of the Free Mind Launches Source Library — Press Release',
  description:
    'Marking a milestone for the Bibliotheca Philosophica Hermetica, the Embassy of the Free Mind announces Source Library: a free digital library of over 10,000 ancient and early modern texts translated into English.',
  openGraph: {
    title: 'Embassy of the Free Mind Launches the World\'s Largest Free Collection of Translated Ancient Texts',
    description:
      'Source Library: 10,000+ books in 100+ languages, 800,000+ pages translated into English. Free and open to all.',
    images: [{ url: 'https://sourcelibrary.org/og-image.png', width: 1200, height: 630 }],
  },
  alternates: { canonical: '/press/bph-50th-source-library' },
};

const BLOB = 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com';

export default function PressReleasePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Press Release"
          subtitle="Embassy of the Free Mind &middot; Amsterdam"
          image={`${BLOB}/archived/6952dac677f38f6761bc683a/13.jpg`}
          imageAlt="Robert Fludd, Integra Naturae — the mirror of all nature and the image of art"
        />
      }
      bg="bg-cream"
    >
      <div className="max-w-none">

        <p className="text-muted text-sm mb-2">FOR IMMEDIATE RELEASE</p>
        <p className="text-muted text-sm mb-12">[Date] March 2026 &middot; Amsterdam, the Netherlands</p>

        {/* ── Headline ── */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary leading-snug mb-4">
          Embassy of the Free Mind Launches Source Library: the World&rsquo;s Largest
          Free Collection of Translated Ancient and Early Modern Texts
        </h2>

        <p className="font-body text-xl text-secondary leading-relaxed mb-12 italic">
          Marking [50 years] of the Bibliotheca Philosophica Hermetica, the Embassy
          announces a public beta of a digital library containing over 10,000 books in
          100+ languages &mdash; with more than 4,000 translated into English, many for the first time.
        </p>

        {/* ── Body ── */}
        <div className="space-y-5 font-body text-lg text-secondary leading-relaxed">
          <p>
            <strong>AMSTERDAM</strong> &mdash; The Embassy of the Free Mind today announces the
            public beta of{' '}
            <a href="https://sourcelibrary.org" className="text-accent-rust hover:underline">Source Library</a>,
            a free, open-access digital library that makes thousands of ancient and early modern
            texts readable in English for the first time. With over 10,000 books spanning more
            than 100 languages and 3.7&nbsp;million page images, Source Library is the largest
            freely available collection of translated historical primary sources ever assembled.
          </p>

          <p>
            The launch coincides with [the 50th anniversary] of the{' '}
            <strong>Bibliotheca Philosophica Hermetica</strong> (BPH), the Amsterdam-based
            collection founded by Joost&nbsp;R.&nbsp;Ritman that holds the Guinness World Record
            as the world&rsquo;s largest library dedicated to magic and mysticism. Source Library
            extends the BPH&rsquo;s founding mission &mdash; preserving and opening access to
            humanity&rsquo;s esoteric, philosophical, and scientific heritage &mdash; into the
            digital age.
          </p>

          <h3 className="font-serif text-2xl text-primary pt-6">A new scale of access</h3>

          <p>
            Source Library draws on digitised books from more than a dozen partner institutions,
            including the Internet Archive, the Biblioth&egrave;que nationale de France (Gallica),
            the Bavarian State Library, the Bodleian Library at Oxford, e-rara, and others.
            Using AI-powered translation, texts that have sat unread in Latin, German, Arabic,
            Sanskrit, and dozens of other languages &mdash; many since they were first printed
            centuries ago &mdash; are now available to anyone with a browser, free of charge.
          </p>

          <p>
            The collection spans the intellectual traditions at the heart of the BPH: alchemy,
            Hermetica, Kabbalah, Rosicrucianism, natural philosophy, and the pre-modern roots
            of modern science. It includes works by figures such as Paracelsus, Robert Fludd,
            Marsilio Ficino, Heinrich Cornelius Agrippa, and Giordano Bruno, alongside thousands
            of lesser-known texts that have never before appeared in English.
          </p>

          <h3 className="font-serif text-2xl text-primary pt-6">By the numbers</h3>

          <ul className="list-none space-y-2 pl-0">
            <li><strong>10,000+</strong> books from 100+ languages</li>
            <li><strong>4,000+</strong> books with English translation (1,300+ fully translated)</li>
            <li><strong>800,000+</strong> pages translated into English</li>
            <li><strong>2,400+</strong> first-ever English translations</li>
            <li><strong>3.7&nbsp;million</strong> digitised page images</li>
            <li><strong>13+</strong> digital library partners worldwide</li>
          </ul>

          <p>
            At roughly 4,000 translated volumes, Source Library surpasses every comparable
            collection by an order of magnitude. The Loeb Classical Library, the gold standard
            of bilingual scholarly editions since 1911, contains approximately 540 volumes.
            The Perseus Digital Library at Tufts hosts around 1,000 public-domain Victorian-era
            translations. The Sacred Texts Archive offers approximately 1,700 reprints. The
            I&nbsp;Tatti Renaissance Library has published roughly 100 volumes since 2001.
          </p>

          <p>
            Unlike these collections, Source Library produces <em>new</em> translations of texts
            that have never been available in English, and provides them without a paywall or
            institutional subscription.
          </p>

          <h3 className="font-serif text-2xl text-primary pt-6">AI translation as a tool for access</h3>

          <p>
            Source Library&rsquo;s translations are generated using artificial intelligence
            (Google Gemini), not traditional scholarly editing. Each translated page is presented
            alongside the original-language text, enabling scholars to consult the source directly.
          </p>

          <p>
            The Embassy views AI translation as a complement to, not a replacement for, expert
            human scholarship. The goal is to make vast bodies of untranslated material{' '}
            <em>discoverable</em> and <em>navigable</em> for the first time &mdash; lowering the
            barrier that has kept these texts confined to specialists for centuries.
          </p>

          <blockquote className="border-l-4 border-accent-rust/40 pl-6 py-4 my-8 bg-accent-rust/[0.03] rounded-r-lg">
            <p className="font-body text-xl text-primary leading-relaxed italic">
              &ldquo;[Quote from EFM director about the anniversary, the BPH&rsquo;s mission of
              making knowledge accessible, and what Source Library represents for the
              collection&rsquo;s next chapter.]&rdquo;
            </p>
            <p className="text-muted text-sm mt-3">
              &mdash; <strong>[Name, Title]</strong>, Embassy of the Free Mind
            </p>
          </blockquote>

          <blockquote className="border-l-4 border-accent-rust/40 pl-6 py-4 my-8 bg-accent-rust/[0.03] rounded-r-lg">
            <p className="font-body text-xl text-primary leading-relaxed italic">
              &ldquo;[Quote from Derek Lomas about the vision, the scale of what has been
              achieved in three months, and the invitation to scholars and the public.]&rdquo;
            </p>
            <p className="text-muted text-sm mt-3">
              &mdash; <strong>Derek Lomas</strong>, Program Director, Source Library
            </p>
          </blockquote>

          <h3 className="font-serif text-2xl text-primary pt-6">About the public beta</h3>

          <p>
            Source Library is available now at{' '}
            <a href="https://sourcelibrary.org" className="text-accent-rust hover:underline font-semibold">sourcelibrary.org</a>.
            As a beta release, the collection and its features will continue to expand.
            Feedback from scholars, librarians, and the public is welcome
            at{' '}
            <a href="mailto:derek@sourcelibrary.org" className="text-accent-rust hover:underline">derek@sourcelibrary.org</a>.
          </p>
        </div>

        {/* ── Boilerplate ── */}
        <hr className="my-12 border-primary/10" />

        <div className="space-y-6 font-body text-base text-muted leading-relaxed">
          <div>
            <h4 className="font-serif text-lg text-primary mb-2">About the Embassy of the Free Mind</h4>
            <p>
              The Embassy of the Free Mind is a museum, library, and cultural centre in Amsterdam,
              housed in the historic Huis met de Hoofden on the Keizersgracht. It is home to the
              Bibliotheca Philosophica Hermetica (BPH), founded by Joost&nbsp;R.&nbsp;Ritman &mdash;
              a collection of approximately 25,000 volumes on Hermetica, alchemy, mysticism,
              Rosicrucianism, Kabbalah, and gnosis. The BPH has been recognised by UNESCO as
              a &ldquo;Memory of the World&rdquo; (2022) and by Guinness World Records as the
              world&rsquo;s largest library dedicated to magic and mysticism (2024). The
              Embassy&rsquo;s mission is to inspire free thinking and make the wisdom traditions
              of the past accessible to all.{' '}
              <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline">embassyofthefreemind.com</a>
            </p>
          </div>

          <div>
            <h4 className="font-serif text-lg text-primary mb-2">About Source Library</h4>
            <p>
              Source Library is a free, open-access digital library of translated ancient and
              early modern primary sources. Using AI-powered translation, it makes previously
              inaccessible texts available in English alongside their original languages.
              The collection spans 10,000+ books in 100+ languages from 13+ digital library
              partners. Source Library is [an initiative of / developed in partnership with]
              the Embassy of the Free Mind.{' '}
              <a href="https://sourcelibrary.org" className="text-accent-rust hover:underline">sourcelibrary.org</a>
            </p>
          </div>

          <div>
            <h4 className="font-serif text-lg text-primary mb-2">Media contact</h4>
            <p>
              Derek Lomas, Program Director<br />
              <a href="mailto:derek@sourcelibrary.org" className="text-accent-rust hover:underline">derek@sourcelibrary.org</a><br />
              Embassy of the Free Mind, Keizersgracht 123, Amsterdam
            </p>
          </div>
        </div>

      </div>
    </ContentPageLayout>
  );
}
