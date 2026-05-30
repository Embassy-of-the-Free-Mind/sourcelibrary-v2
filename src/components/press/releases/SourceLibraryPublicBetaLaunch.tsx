/**
 * Press release body — "Most of the Renaissance Was Never Translated" (June 2026 launch).
 * Straight prose, no stat boxes/tables/callouts. Mission-led: the public narrative is the
 * untranslated-Renaissance idea and open access; fundraising lives only in private donor materials.
 * Figures verified against the live Source Library database on 30 May 2026.
 * Header/dateline and back-link are supplied by the /press-releases/[slug] route.
 */

export default function SourceLibraryPublicBetaLaunch() {
  return (
    <article className="prose-content max-w-none">
      <p className="text-2xl text-accent-rust font-serif leading-snug mb-8">
        To create the next Renaissance, translate the first.
      </p>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        <strong className="text-stone-800">AMSTERDAM</strong> &mdash; &ldquo;Ninety percent of the Latin
        texts from the Renaissance have never been available in translation.&rdquo; That estimate comes
        from Debora Shuger, a Renaissance scholar at UCLA. Far more Latin was written after 1500 than
        survives from all of ancient Rome, and almost none of it has ever been read in a modern language.
        The same is true of much of what was written in China, India, and the Islamic world.
      </p>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        Today the Embassy of the Free Mind opens Source Library, which has used AI to translate more than
        13,000 historical books into English. Close to 7,000 of them had never appeared in any modern
        language before. Each translation sits next to a scan of the original page, and all of it is free
        to read.
      </p>

      <blockquote className="border-l-4 border-accent-rust pl-6 my-8">
        <p className="text-lg text-secondary italic font-body leading-relaxed mb-2">
          &ldquo;Most of what the Renaissance wrote has never been read in English: the science, the
          medicine, the philosophy that made the modern world. We&rsquo;re translating it so anyone can
          read it, free.&rdquo;
        </p>
        <p className="text-sm text-muted">&mdash; Derek Lomas, founder of Source Library, researcher at TU Delft</p>
      </blockquote>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        The collection dwarfs every comparable effort. The Loeb Classical Library has produced about 540
        translated volumes since 1911; Harvard&rsquo;s I Tatti Renaissance Library about 100 since 2001.
        Source Library holds more than 13,000, and unlike those series it translates works that were never
        available in English at all. Counted together, the original texts and their translations come to
        more than four billion words, roughly 90 percent of the entire English Wikipedia.
      </p>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        The gap is not only a human one. A{' '}
        <a href="https://sourcelibrary.org/blog/did-the-ai-read-this" className="text-accent-rust hover:underline">
          Source Library study
        </a>{' '}
        found that about 7,000 of its books are missing from the data used to train today&rsquo;s leading
        AI models. They were never translated or summarized, so the machines never saw them either.
      </p>

      <p className="text-secondary leading-relaxed mb-6 font-body">
        Source Library draws scanned pages from major research libraries, including the Internet Archive,
        the Vatican Library, and the Bodleian at Oxford. AI reads each page in its original language and
        writes an English translation, shown beside the original so a scholar can check it. The work is
        not meant to replace scholars. It does the part no one ever had time for: making millions of
        unread pages legible for the first time.
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

      <p className="text-secondary leading-relaxed mb-6 font-body">
        The project grows out of the{' '}
        <a href="https://embassyofthefreemind.com/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
          Bibliotheca Philosophica Hermetica
        </a>
        , the Embassy&rsquo;s 25,000-volume collection of works on Hermeticism, alchemy, and mysticism,
        inscribed on UNESCO&rsquo;s Memory of the World Register.
      </p>

      <blockquote className="border-l-4 border-accent-rust pl-6 my-8">
        <p className="text-lg text-secondary italic font-body leading-relaxed mb-2">
          &ldquo;We always say here, <em>ad fontes</em> &mdash; go back to the source. When you go back
          deeper and further, you become part of the source. Then you can be the source. That&rsquo;s
          where the magic happens.&rdquo;
        </p>
        <p className="text-sm text-muted">&mdash; Joost Ritman, founder, Bibliotheca Philosophica Hermetica</p>
      </blockquote>

      <p className="text-secondary leading-relaxed mb-10 font-body">
        Source Library is online now at{' '}
        <a href="https://sourcelibrary.org" className="text-accent-rust hover:underline">sourcelibrary.org</a>,
        and launches with an evening event at the Embassy of the Free Mind on 4 June 2026.
      </p>

      <hr className="border-border-light my-10" />

      <p className="text-sm text-secondary leading-relaxed mb-4 font-body">
        <strong className="text-stone-800">About the Embassy of the Free Mind.</strong> The Embassy of the
        Free Mind is a museum and library in Amsterdam, in the historic Huis met de Hoofden on the
        Keizersgracht. It holds the Bibliotheca Philosophica Hermetica, founded by Joost R. Ritman: about
        25,000 volumes on Hermetica, alchemy, mysticism, Rosicrucianism, Kabbalah, and gnosis, inscribed
        on the UNESCO Memory of the World Register.{' '}
        <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">embassyofthefreemind.com</a>
      </p>

      <p className="text-sm text-secondary leading-relaxed mb-4 font-body">
        <strong className="text-stone-800">About Source Library.</strong> Source Library is a free,
        open-access library of translated historical sources, founded by Derek Lomas in 2022 after he
        found Marsilio Ficino&rsquo;s <em>Liber de Voluptate</em> at the Embassy of the Free Mind. Its
        translations are open and published under a Creative Commons licence. It is an initiative of the
        Embassy of the Free Mind.{' '}
        <a href="https://sourcelibrary.org" className="text-accent-rust hover:underline">sourcelibrary.org</a>
      </p>

      <p className="text-sm text-secondary leading-relaxed font-body">
        <strong className="text-stone-800">Media contact:</strong> Derek Lomas &mdash;{' '}
        <a href="mailto:derek@sourcelibrary.org" className="text-accent-rust hover:underline">derek@sourcelibrary.org</a>{' '}
        &mdash; Embassy of the Free Mind, Keizersgracht 123, Amsterdam
      </p>

      <p className="text-xs text-muted leading-relaxed mt-6 font-body">
        Source for the translation estimate: D. Shuger, UCLA. Library figures verified against the Source
        Library database, 30 May 2026.
      </p>
    </article>
  );
}
