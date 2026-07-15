import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogPostSchema from '@/components/seo/BlogPostSchema';

const HERO = 'https://images.sourcelibrary.org/archived/6992c88d4f3a879124230200/346.jpg';

export const metadata: Metadata = {
  title: 'Can AI Read Classical Chinese? An OCR and Translation Benchmark - Source Library',
  description: 'We hold ~1,600 Chinese works, most never translated into English. Measured against ctext.org, our OCR reads canonical printed text at ~98.5% character accuracy; our translations match or beat the standard scholarly editions on clean text.',
  openGraph: {
    title: 'Can AI Read Classical Chinese? An OCR and Translation Benchmark',
    description: 'Measuring AI OCR and translation on the Chinese classics — against ctext.org for the characters, and against James Legge for the English.',
    images: [{ url: HERO, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: HERO }],
  },
  alternates: { canonical: '/blog/reading-classical-chinese' },
};

export default function ReadingClassicalChinesePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Can AI Read Classical Chinese?"
          subtitle="An OCR and translation benchmark, measured against ctext.org and James Legge"
          image={HERO}
          imageAlt="Woodcut of an iron forge from the Tiangong Kaiwu (1637)"
        >
          <p className="text-stone-400 text-sm mt-4">25 June 2026 &middot; 13 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <BlogPostSchema
        slug="reading-classical-chinese"
        title="Can AI Read Classical Chinese? An OCR and Translation Benchmark"
        description="Measuring AI OCR (against ctext.org) and translation (against James Legge) on ~1,600 classical Chinese works in Source Library."
        datePublished="2026-06-25"
        image={HERO}
      />

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

        {/* --- Lead --- */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library holds about <strong>1,600 Chinese-language works</strong> &mdash; pharmacology, mathematics, agriculture, military technology, natural history, the Confucian and Daoist classics. Most of them have never been translated into English. The obvious question is whether today&rsquo;s AI can actually <em>read</em> and <em>translate</em> them. So we measured &mdash; not with a vibe check, but against external ground truth.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Two findings, up front. On clean printed text, our OCR reproduces the canonical characters at about <strong>98.5% accuracy</strong>, measured against <a href="https://ctext.org" className="text-accent-rust hover:underline">ctext.org</a>, the leading digital library of classical Chinese. And on the same texts, our translations <strong>match or beat the standard scholarly English editions</strong>. The honest catch &mdash; the part a partner is needed for &mdash; comes later.
        </p>

        {/* --- Hero figure --- */}
        <figure className="my-12">
          <img src={HERO} alt="Woodcut of laborers forging a large iron anchor, from the Tiangong Kaiwu" className="w-full rounded-lg" />
          <figcaption className="text-sm text-muted mt-2 text-center">
            Forging iron, from Song Yingxing&rsquo;s <em>Tiangong Kaiwu</em> (&ldquo;The Exploitation of the Works of Nature,&rdquo; 1637) &mdash; an encyclopedia of pre-modern Chinese technology. <a href="/book/tiangong-kaiwu-exploitation-of-the-works-of-nature" className="text-accent-rust hover:underline">View this book</a>.
          </figcaption>
        </figure>

        {/* --- The Corpus --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The collection</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The ~1,600 Chinese works include <strong>448 first English translations</strong> and about 105,000 translated pages. The center of gravity isn&rsquo;t literature &mdash; it&rsquo;s the <strong>history of Chinese science, technology, and medicine</strong>, with a Ming&ndash;Qing core and a Song&ndash;Yuan manuscript tail. A few of the marquee texts:
        </p>

        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-2">
          <li>Li Shizhen&rsquo;s <a href="/book/ben-cao-gang-mu-compendium-of-materia-medica-vol-7-shizhen" className="text-accent-rust hover:underline"><em>Bencao Gangmu</em></a> (Compendium of Materia Medica, 1596) &mdash; the great pharmacopoeia of the Ming.</li>
          <li>Mao Yuanyi&rsquo;s <a href="/book/wubei-zhi-treatise-on-armament-technology" className="text-accent-rust hover:underline"><em>Wubei Zhi</em></a> (Treatise on Armament Technology, 1621) &mdash; a vast military-technology compendium.</li>
          <li>Song Yingxing&rsquo;s <a href="/book/tiangong-kaiwu-exploitation-of-the-works-of-nature" className="text-accent-rust hover:underline"><em>Tiangong Kaiwu</em></a> (1637) &mdash; the encyclopedia of crafts and industry pictured above.</li>
          <li>The <a href="/book/sancai-tuhui-illustrated-encyclopedia-of-the-three-realms" className="text-accent-rust hover:underline"><em>Sancai Tuhui</em></a> (Illustrated Encyclopedia of the Three Realms, 1609).</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-12">
          You can browse the whole set in the <a href="/collections/chinese-classics" className="text-accent-rust hover:underline">Chinese Classics collection</a>. Every work is a full facsimile with source provenance &mdash; which is what makes it possible to grade ourselves honestly.
        </p>

        {/* --- OCR --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Reading the page: OCR vs. ctext</h2>

        <p className="text-secondary leading-relaxed mb-6">
          To measure OCR you need a known-correct transcription to compare against. For classical Chinese, that exists: <a href="https://ctext.org" className="text-accent-rust hover:underline">ctext.org</a> has scholar-verified digital editions of the canon. So for a sample of canonical works, we compared our OCR of a real woodblock page against ctext&rsquo;s text of the same passage, and counted character errors.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The first attempt produced nonsense &mdash; it scored the <em>Book of Odes</em> at 6% accuracy, which is obviously wrong. The reason is a feature of the corpus: most of our editions are <strong>commentary editions</strong>, where the canonical main text is printed interleaved with small-character annotation. ctext stores only the main text, so a naive character-by-character comparison treats every (correctly-read) commentary character as an error and reports a catastrophe where there isn&rsquo;t one.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The fix is to match the canonical text as an in-order <em>subsequence</em> of our OCR, skipping the extra commentary characters for free &mdash; so the metric scores OCR error on the canonical text only. With that, the picture clears:
        </p>

        {/* --- OCR results table --- */}
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-border-medium">
                <th className="py-3 pr-6 text-primary font-semibold">Work</th>
                <th className="py-3 pr-6 text-primary font-semibold">Character accuracy</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light"><td className="py-2 pr-6"><em>Daodejing</em>, ch. 1</td><td className="py-2 pr-6">100%</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-6"><em>Analects</em>, 1.1</td><td className="py-2 pr-6">100%</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-6"><em>Doctrine of the Mean</em></td><td className="py-2 pr-6">100%</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-6"><em>Zhuangzi</em>, ch. 1</td><td className="py-2 pr-6">100%</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-6"><em>Xunzi</em> (Quan Xue)</td><td className="py-2 pr-6">100%</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-6"><em>Book of Odes</em> (Guan Ju)</td><td className="py-2 pr-6">98.8%</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-6"><em>Han Feizi</em> (Nan Yan)</td><td className="py-2 pr-6">91.8%</td></tr>
              <tr className="border-b-2 border-border-medium font-semibold text-primary"><td className="py-2 pr-6">Character-weighted average</td><td className="py-2 pr-6">98.5%</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted mb-10">
          Character accuracy of our OCR vs. ctext.org canonical text, by subsequence alignment. Seven cleanly-aligned canonical works.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Chapter 1 of the <em>Daodejing</em> is a clean illustration. Our OCR of the woodblock page reads:
        </p>

        <blockquote className="border-l-4 border-accent-gold/40 pl-6 my-6 text-lg text-secondary not-italic" lang="zh-Hant">
          道可道，非常道。名可名，非常名。無名天地之始；有名萬物之母。故常無欲，以觀其妙；常有欲，以觀其徼。此兩者，同出而異名，同謂之玄。玄之又玄，衆妙之門。
        </blockquote>

        <p className="text-secondary leading-relaxed mb-10">
          That is character-for-character identical to ctext&rsquo;s text of the chapter. The <em>Book of Odes</em> opening (Guan Ju) was the same but for a single character &mdash; our edition prints 鐘 (&ldquo;bell&rdquo;) where ctext&rsquo;s base text has the variant 鍾, which is a legitimate textual variant, not a misread. The errors that remain cluster on a handful of harder characters; nothing approaching a failure mode.
        </p>

        {/* --- Translation --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Translating the page: vs. James Legge</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Reading the characters is half the job. How good is the <em>translation</em>? The fair test is to compare against a published human translation. For the Chinese classics, the standard reference &mdash; and conveniently public domain &mdash; is <a href="https://ctext.org" className="text-accent-rust hover:underline">James Legge&rsquo;s</a> 19th-century corpus. So we put them side by side.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          Take the closing lines of <em>Guan Ju</em>, the first poem in the <em>Book of Odes</em>. Legge (1871):
        </p>
        <blockquote className="border-l-4 border-border-medium pl-6 my-4 text-secondary italic">
          &ldquo;The modest, retiring, virtuous, young lady: With lutes, small and large, let us give her friendly welcome.&rdquo;
        </blockquote>
        <p className="text-secondary leading-relaxed mb-4">
          Our translation of the <a href="/book/69d5ae594dc55b8478de1380/page/69d5ae594dc55b8478de13a2" className="text-accent-rust hover:underline">same page</a>:
        </p>
        <blockquote className="border-l-4 border-accent-gold/40 pl-6 my-4 text-secondary italic">
          &ldquo;The modest, retiring, virtuous young lady; With lutes and zithers, we befriend her.&rdquo;
        </blockquote>
        <p className="text-secondary leading-relaxed mb-10">
          The phrase is 琴瑟 &mdash; the <em>qin</em> and the <em>se</em>, two different zithers. Legge&rsquo;s &ldquo;lutes, small and large&rdquo; blurs them into one instrument; &ldquo;lutes and zithers&rdquo; is the more accurate reading. It is a small thing, but it is the kind of small thing that tells you the model is construing the text, not paraphrasing a memory of it.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          The opening of the <em>Daodejing</em> is sharper still. Legge:
        </p>
        <blockquote className="border-l-4 border-border-medium pl-6 my-4 text-secondary italic">
          &ldquo;The Dao that can be trodden is not the enduring and unchanging Dao.&rdquo;
        </blockquote>
        <p className="text-secondary leading-relaxed mb-4">
          Our translation of <a href="/book/69935b692c63944063133f67/page/69935b6a2c63944063133f74" className="text-accent-rust hover:underline">the page</a>:
        </p>
        <blockquote className="border-l-4 border-accent-gold/40 pl-6 my-4 text-secondary italic">
          &ldquo;The Way that can be spoken of is not the constant Way; the name that can be named is not the constant name. The nameless is the beginning of Heaven and Earth; the named is the mother of the ten thousand things.&rdquo;
        </blockquote>
        <p className="text-secondary leading-relaxed mb-10">
          This isn&rsquo;t Legge at all. 道可道 as &ldquo;can be spoken of&rdquo; (not Legge&rsquo;s idiosyncratic &ldquo;trodden&rdquo;), 常 as &ldquo;constant,&rdquo; 萬物 as &ldquo;the ten thousand things&rdquo; &mdash; it tracks the modern scholarly idiom rather than the dated 1891 reading. And it did something Legge&rsquo;s bare-text edition never attempted: it also translated the surrounding Heshang Gong commentary printed on the same page.
        </p>

        <p className="text-secondary leading-relaxed mb-10">
          A note on method: the instinct is to score translation with BLEU or other n-gram overlap metrics. For literary translation that is actively misleading &mdash; Legge and Arthur Waley render the same poem with almost no shared phrasing, and both are correct. Two good translations can look maximally different to an n-gram metric. The honest test is a blind comparison: show a reader both renderings, unlabeled, and ask which is better. On clean canonical text, ours holds its own against the standard scholar.
        </p>

        {/* --- Where it fails --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Where it still fails</h2>

        <p className="text-secondary leading-relaxed mb-6">
          None of this means the corpus is finished and citable. Two failure modes are real, and worth naming plainly.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Complex layouts.</strong> On dense interlinear commentary and on multi-column tables, the model tends to translate the main text well and then quietly <em>omit</em> the rest. On a <em>Bencao Gangmu</em> page laid out as a grid of drug formulas, most of the prescriptions &mdash; ingredients, doses, indications &mdash; can simply be dropped, sometimes replaced with an editorial placeholder rather than a translation. The same is true of the OCR: the clean numbers above are for canonical printed pages, which is the <em>easy</em> case. Manuscripts, tables, and rare regional editions &mdash; the actual frontier &mdash; aren&rsquo;t in ctext at all, and need different tooling (self-consistency, cross-model agreement, and human review) to measure.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          <strong>First translations.</strong> The 448 works being rendered into English for the first time are, by definition, the ones with no published translation to check against. They are where the value is highest and the certainty is lowest &mdash; and where a human scholar&rsquo;s eye is indispensable.
        </p>

        {/* --- What it means --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">What this means</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The pattern is the same one we found <a href="/blog/tibetan-ocr" className="text-accent-rust hover:underline">benchmarking AI OCR on Bhutanese manuscripts</a>: the hard part is the <em>page</em>, not the language. On clean printed text the model reads classical Chinese at ~99% and translates it as well as the standard scholarly edition. What it struggles with is messy layout &mdash; commentary woven through the main text, formulas laid out as tables &mdash; and the works for which no reference exists to anchor it.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          That is an encouraging place to be. It means the core capability is in hand, and the remaining work is the kind scholars are uniquely good at: catching the dropped formula, the commentary the model skipped, the term it construed a little too cleverly. These books &mdash; the roots of Chinese pharmacology, mathematics, and engineering &mdash; have sat unread outside China for centuries. The reading is now tractable. The careful finishing is what comes next, and it is work we would like to do with partners who know these texts.
        </p>

        <p className="text-secondary leading-relaxed mb-12 text-muted text-sm">
          The OCR benchmark is reproducible from the open evaluation framework in the Source Library repository (<code>scripts/eval</code>): ground truth is built from ctext, and scored with the subsequence aligner described above. Translation comparisons quote the exact page text, linked above.
        </p>

        {/* --- Related notes --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Related notes</h2>
        <p className="text-secondary leading-relaxed mb-4">
          This is part of a running series on whether AI can read historical scripts:
        </p>
        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-2">
          <li><Link href="/blog/tibetan-ocr" className="text-accent-rust hover:underline">Benchmarking AI OCR on 232,000 Pages of Bhutanese Manuscripts</Link> &mdash; the same question for handwritten Tibetan.</li>
          <li><Link href="/blog/cuneiform-ocr" className="text-accent-rust hover:underline">Can AI Read Cuneiform?</Link></li>
          <li><Link href="/blog/hieroglyph-ocr" className="text-accent-rust hover:underline">Can AI Read Hieroglyphs? (No.)</Link></li>
          <li><Link href="/blog/rashi-ocr" className="text-accent-rust hover:underline">The Rashi Problem: When AI OCR Hallucinates in Hebrew</Link></li>
          <li><Link href="/blog/ocr-consistency" className="text-accent-rust hover:underline">How Consistent Is AI OCR?</Link> &mdash; the consistency metric, in depth.</li>
          <li><Link href="/blog/confident-hallucinator" className="text-accent-rust hover:underline">The Confident Hallucinator</Link> &mdash; how AI translation fails, and how to catch it.</li>
        </ul>

      </article>

    </ContentPageLayout>
  );
}
