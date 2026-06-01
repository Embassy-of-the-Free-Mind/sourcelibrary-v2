/**
 * Press release body — official EFM beta-launch release (4 June 2026).
 * This is the Embassy of the Free Mind's authoritative press text; keep it in sync
 * with the EFM-approved release rather than rewriting it editorially. Launch stats
 * (15,000+ books, 15,000+ translated, ~7B words, etc.) verified against the live
 * Source Library database on 1 June 2026. The "~7B words ≈ English Wikipedia" figure
 * is the corpus re-measurement behind /blog/how-big-is-the-library (winsorised mean
 * 7.07B; median floor ~4.9B) — NOT the old 1.7B Supabase-snippet undercount.
 * Header/dateline ("FOR IMMEDIATE RELEASE · …") and back-link are supplied by the
 * /press-releases/[slug] route. Press contact is EFM (Maria Marqués), not Source Library.
 */

export default function SourceLibraryPublicBetaLaunch() {
  return (
    <article className="prose-content max-w-none">
      <p className="text-2xl text-accent-rust font-serif leading-snug mb-8">
        To create the next Renaissance, translate the first.
      </p>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        The{' '}
        <a href="https://embassyofthefreemind.com/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
          Embassy of the Free Mind
        </a>{' '}
        (EFM) announces the public beta of Source Library &mdash; an open-access digital library set to
        become the largest available collection of translated historical primary sources ever assembled.
        Its Beta Launch takes place on 4 June 2026 at the Embassy of the Free Mind, in Amsterdam.
      </p>

      <h2 className="text-xl font-serif text-stone-800 mt-10 mb-4">Born from a world-record collection</h2>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        Source Library is rooted in the Bibliotheca Philosophica Hermetica (BPH), home to 25,000+ volumes
        on alchemy, Hermetica, Kabbalah, Rosicrucianism, astrology, natural philosophy, and the pre-modern
        roots of modern science. The BPH holds UNESCO&rsquo;s Memory of the World designation (2022) and a
        Guinness World Record as the world&rsquo;s largest library dedicated to magic and mysticism (2024).
        Source Library carries this founding mission into the digital age.
      </p>

      <h2 className="text-xl font-serif text-stone-800 mt-10 mb-4">A new scale of access</h2>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        Powered by frontier AI translation, Source Library draws on digitised collections from the
        world&rsquo;s foremost research libraries &mdash; including the Bavarian State Library, the
        Biblioth&egrave;que nationale de France, the Vatican Library, and the Bodleian Library at Oxford,
        among more &mdash; with the Bibliotheca Philosophica Hermetica being the first set to become fully
        digitised.
      </p>

      <p className="text-secondary leading-relaxed mb-4 font-body">At launch, the full collection spans:</p>

      <ul className="list-disc pl-6 mb-6 space-y-1 text-secondary font-body">
        <li>15,000+ books in 55+ languages</li>
        <li>15,000+ books with English translation</li>
        <li>4.2 million+ pages translated into English</li>
        <li>6,000+ first-ever English translations</li>
        <li>
          roughly 7 billion words of original text and translation &mdash; about the size of the entire{' '}
          <a href="https://sourcelibrary.org/blog/how-big-is-the-library" className="text-accent-rust hover:underline">
            English Wikipedia
          </a>
        </li>
        <li>4.5 million+ digitised page images with 142,000+ extracted illustrations</li>
      </ul>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        Books being digitised centre on the intellectual traditions at the heart of the Bibliotheca
        Philosophica Hermetica (BPH) collection. Works by Paracelsus, Robert Fludd, Marsilio Ficino,
        Heinrich Cornelius Agrippa, and Giordano Bruno sit alongside thousands of lesser-known texts
        &mdash; many appearing in English for the very first time.
      </p>

      <h2 className="text-xl font-serif text-stone-800 mt-10 mb-4">Why it matters</h2>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        By a widely cited estimate, ninety percent of Latin texts from the Renaissance have never been
        translated into a modern language. Far more Latin was written after 1500 than survives from all of
        ancient Rome, and almost none of it has ever been read outside a library.
      </p>

      <blockquote className="border-l-4 border-accent-rust pl-6 my-8">
        <p className="text-lg text-secondary italic font-body leading-relaxed mb-2">
          &ldquo;During the Renaissance, the translation of ancient Greek texts into Latin had an enormous
          impact on the flourishing of European society. Yet very little of the Renaissance itself has been
          translated. Source Library changes that.&rdquo;
        </p>
        <p className="text-sm text-muted">&mdash; Dr. Derek Lomas, Source Library Programme Director</p>
      </blockquote>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        AI-powered translations are presented alongside images of the original source pages, allowing
        scholars to consult the original at any point. The goal is not to replace expert scholarship, but
        to make vast bodies of untranslated material discoverable for the first time.
      </p>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        Among the works now readable in English are Robert Fludd&rsquo;s{' '}
        <a href="https://sourcelibrary.org/book/history-of-both-worlds-macrocosm-fludd" className="text-accent-rust hover:underline">
          <em>History of Both Worlds</em>
        </a>{' '}
        (1617), the complete works of Marsilio Ficino (1561) and Pico della Mirandola (1557), Athanasius
        Kircher&rsquo;s <em>Musurgia Universalis</em> (1650), and the{' '}
        <a href="https://sourcelibrary.org/book/the-zohar-book-of-genesis-attributed" className="text-accent-rust hover:underline">
          <em>Zohar</em>
        </a>
        , the central text of Kabbalah. Thousands more come from outside the Western canon, in Chinese,
        Sanskrit, Tibetan, Arabic, and Hebrew.
      </p>

      <p className="text-secondary leading-relaxed mb-10 font-body">
        It is fitting that the work begins here. The Embassy of the Free Mind keeps the library of the
        first Renaissance, the books Ficino and his circle translated to set it in motion. Five centuries
        on, the same impulse of <em>ad fontes</em> is opening those sources to everyone.
      </p>

      <h2 className="text-xl font-serif text-stone-800 mt-10 mb-4">Beta Launch on 4 June 2026</h2>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        Source Library will be unveiled at a Beta Launch Party on 4 June 2026 at the Embassy of the Free
        Mind, Amsterdam (18:00&ndash;20:30 CET). The evening will feature an introduction and panel
        discussion led by PhD researcher Corey Andrews, as well as a live demonstration by Dr. Derek Lomas
        and a live Q&amp;A.
      </p>

      <p className="text-secondary leading-relaxed mb-10 font-body">
        The event is available via livestream for international audiences. RSVP and access the livestream
        here:{' '}
        <a href="https://lnkd.in/erXEsdv5" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
          lnkd.in/erXEsdv5
        </a>
      </p>

      <blockquote className="border-l-4 border-accent-rust pl-6 my-8">
        <p className="text-lg text-secondary italic font-body leading-relaxed mb-2">
          &ldquo;Source Library is an essential infrastructure: open, verifiable access to primary sources,
          where wisdom is made accessible. Direct access to sources enables independent interpretation,
          academic integrity, and the sustainable transmission of cultural memory &ndash; all of which the
          Bibliotheca Philosophica Hermetica sets out to do.&rdquo;
        </p>
        <p className="text-sm text-muted">&mdash; Jozef Ritman, Museum Director at the Embassy of the Free Mind</p>
      </blockquote>

      <hr className="border-border-light my-10" />

      <p className="text-sm text-secondary leading-relaxed mb-2 font-body">
        <strong className="text-stone-800">Press and Partnerships Contact</strong>
      </p>
      <p className="text-sm text-secondary leading-relaxed font-body">
        Maria Marqu&eacute;s &mdash; Venue &amp; Creative Partnerships &mdash;{' '}
        <a href="mailto:mmarques@efm.amsterdam" className="text-accent-rust hover:underline">mmarques@efm.amsterdam</a>
        <br />
        Embassy of the Free Mind, Keizersgracht 123, Amsterdam
      </p>
    </article>
  );
}
