import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'The Year of the Fire Horse - Blog - Source Library',
  description: 'Chinese New Year 2026 marks the Year of the Fire Horse — the only year in the 60-year cycle where both heavenly stem and earthly branch carry yang fire. Source Library holds the original Chinese texts that define this system, from Tang dynasty astrology manuals to the Five Elements classic.',
  alternates: {
    canonical: '/blog/fire-horse',
  },
};

export default function FireHorsePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Year of the Fire Horse"
          subtitle="Double Yang Fire, a 17th-Century Arsonist, and the Original Texts Behind Chinese Astrology"
        >
          <p className="text-stone-400 text-sm mt-4">17 February 2026 &middot; 16 min read</p>
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
          All posts
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Today is Chinese New Year, and 2026 is the Year of the Fire Horse &mdash; 丙午, <em>Bing Wu</em>. It is the 43rd combination in the sexagenary cycle, a calendrical system that has been in continuous use since the Shang Dynasty, around 1000 BCE. Oracle bones from that era carry the complete cycle carved into tortoise shell.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The Fire Horse is unique. It is the only year in the entire 60-year cycle where both the Heavenly Stem and the Earthly Branch carry the same element in the same polarity: yang fire on yang fire. No water to cool, no earth to ground, no metal to contain. In 1966, the last Fire Horse year, Japan&apos;s birth rate dropped by 25% because parents feared having a daughter born under its sign. The superstition traces back to a 17th-century arsonist named Yaoya Oshichi, a girl who burned down her neighbourhood for love. Source Library holds the original Chinese texts that define this system &mdash; texts that most discussions of &ldquo;Chinese astrology&rdquo; in the West have never consulted.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Architecture of Chinese Astrology
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Western astrology maps the Sun&apos;s annual path through twelve constellations. Chinese astrology does something fundamentally different. It combines two parallel systems: the Ten Heavenly Stems (天干, <em>Tiangan</em>) and the Twelve Earthly Branches (地支, <em>Dizhi</em>). Because the two cycles have different lengths &mdash; 10 and 12 &mdash; they produce 60 unique combinations before repeating. This is the sexagenary cycle (六十甲子), and it has governed Chinese timekeeping, ritual, divination, and cosmology for three millennia.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The Heavenly Stems encode the five elements (wood, fire, earth, metal, water) in their yin and yang aspects &mdash; ten stems for five pairs. The Earthly Branches correspond to twelve animals and carry their own elemental associations. Every year, month, day, and two-hour period is assigned a stem-branch pair. A person&apos;s birth generates four pairs &mdash; the &ldquo;Four Pillars of Destiny&rdquo; (四柱命理, <em>Sizhu Mingli</em>) &mdash; which form the basis of Chinese astrological analysis.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This is not a character quiz. It is an elaborate cosmological system in which time, space, the body, the landscape, and the heavens are all woven together by the same elemental logic. The Horse (午, Wu) corresponds to midday, the south, the fifth lunar month (approximately June), and the summer solstice &mdash; the moment when yang energy reaches its absolute peak. Its intrinsic element is fire. Its direction faces the emperor. Its colour is red.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Fire on Fire
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          In most Horse years, the Heavenly Stem introduces a counterbalancing element. The Water Horse (壬午, 2002) pairs the Horse&apos;s fire with water. The Wood Horse (甲午, 2014) pairs it with wood. The Earth Horse (戊午, 1978) grounds it. Each combination creates a dynamic tension &mdash; the interplay of <em>sheng</em> (generation) and <em>ke</em> (overcoming) that the Wu Xing (五行) system describes.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          But in 丙午, the stem is 丙 (Bing) &mdash; yang fire. The most active, radiant, expansive expression of the fire element. Paired with the Horse&apos;s own yang fire, it creates the only double-yang-fire combination in the cycle. Traditional Chinese metaphysics describes this as extreme elemental imbalance: fire with nothing to check it. A wildfire on the open plain.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The{' '}
          <Link href="/book/6992cabad4d545ae73fee83d" className="text-amber-700 hover:text-amber-600 underline">五行大義 (<em>Wuxing Dayi</em>, Great Meaning of the Five Elements)</Link>
          , a Sui dynasty (581&ndash;618) treatise now in Source Library in the original Chinese, lays out the cosmological framework. The five elements are not substances but <em>phases</em> &mdash; patterns of change through which all phenomena cycle. Fire&apos;s phase is expansion, illumination, and transformation. Doubled, it signifies a period of extraordinary intensity: purification through combustion, the burning away of what is no longer needed. The process is magnificent. It is also violent.
        </p>

        <div className="border-l-4 border-amber-400 pl-6 mb-8">
          <p className="text-secondary italic mb-2">
            &ldquo;Fire has no definite form but clings to the burning object and thus is bright. It is twofold clarity: as the sun and moon cling to heaven, so the luminaries of the earth cling to what is right.&rdquo;
          </p>
          <p className="text-muted text-sm">
            &mdash; I Ching, Hexagram 30: Li (離), &ldquo;The Clinging, Fire&rdquo;
          </p>
        </div>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Celestial Framework
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The Horse&apos;s position in the cosmos is defined by the Twenty-Eight Mansions (二十八宿, <em>Ershiba Xiu</em>), the Chinese system of lunar constellations. Where the Western zodiac tracks the Sun&apos;s annual path, the Twenty-Eight Mansions track the Moon&apos;s sidereal month, dividing the sky into four quadrants governed by four celestial guardians: the Azure Dragon (east), the Black Tortoise (north), the White Tiger (west), and the Vermilion Bird (south).
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The Horse belongs to the Vermilion Bird of the South &mdash; the fire quadrant. Its associated mansion is the Star (星宿, <em>Xing Xiu</em>), corresponding roughly to parts of Hydra in Western astronomy. The entire southern sky is what Chinese cosmology calls a &ldquo;fire palace&rdquo;: the direction of noon, of summer, of the emperor&apos;s gaze, of maximal yang. The Horse is not merely associated with fire by convention. It is embedded in a fire-coded region of the celestial sphere.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Source Library holds two extraordinary documents of this celestial system. The{' '}
          <Link href="/book/6992ca1ad4d545ae73fed806" className="text-amber-700 hover:text-amber-600 underline">Pelliot chinois 3594 &mdash; the Dunhuang Star Chart</Link>
          {' '}&mdash; is the oldest known complete star atlas in the world, dating to approximately 700 CE. Discovered in the sealed library cave at Dunhuang in 1907, it maps over 1,300 stars across all 28 mansions. The{' '}
          <Link href="/book/6992c93c69b777d72c76353e" className="text-amber-700 hover:text-amber-600 underline">周天星位經緯宿度考 (Study of Celestial Star Positions and Lunar Mansions)</Link>
          {' '}provides the mathematical framework &mdash; the degree measurements and positional calculations for each mansion.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The I Ching and Double Fire
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The most relevant hexagram is number 30: Li (離), &ldquo;The Clinging, Fire.&rdquo; It is composed of two identical fire trigrams, one over the other &mdash; the formal structure of doubling that mirrors the Fire Horse year itself.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Source Library holds seven editions of the I Ching, from{' '}
          <Link href="/book/6953e27477f38f6761be8d28" className="text-amber-700 hover:text-amber-600 underline">James Legge&apos;s 1882 English translation</Link>
          {' '}and{' '}
          <Link href="/book/6990653a726f64800c10a225" className="text-amber-700 hover:text-amber-600 underline">Richard Wilhelm&apos;s German edition</Link>
          {' '}to three Chinese originals, including a{' '}
          <Link href="/book/6992c92869b777d72c763513" className="text-amber-700 hover:text-amber-600 underline">64-hexagram illustrated diagram set</Link>
          {' '}and a{' '}
          <Link href="/book/6992cabdd4d545ae73fee906" className="text-amber-700 hover:text-amber-600 underline">visual commentary on hexagram imagery</Link>
          .
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The teaching of Hexagram 30 is subtle. Fire, unlike earth or water, has no independent substance. It exists only in relation to what it burns. Without fuel, it extinguishes itself. The hexagram&apos;s Judgment counsels: &ldquo;Care of the cow brings good fortune&rdquo; &mdash; prescribing the extreme docility and patience of cattle as the antidote to double fire. The image is deliberate: the cow is the Horse&apos;s opposite. Where the Horse runs, the cow stays. Where the Horse blazes, the cow endures.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Hexagram 50, Ting (鼎), &ldquo;The Cauldron,&rdquo; offers the complementary teaching: fire over wood, the image of cooking and alchemical transformation. The cauldron was the supreme ritual vessel of ancient China &mdash; the symbol of civilisation itself. Raw material transformed by controlled heat into something nourishing. Where Hexagram 30 shows fire&apos;s dependency, Hexagram 50 shows fire&apos;s <em>purpose</em>: destruction in the service of creation.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Girl Who Set Fire to Edo
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          In December 1682, during the Great Fire of Tenna, a greengrocer&apos;s daughter named Oshichi (お七) evacuated with her family to the temple Sh&omacr;sen-in in Edo. There she fell in love with a young temple page named Ikuta Sh&omacr;nosuke. When the fire subsided and her family returned home, Oshichi &mdash; desperate to see her lover again &mdash; reasoned that another fire would send her back to the temple. In early 1683, she set fire to her family&apos;s house.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          She was caught. At her trial, the presiding judge &mdash; knowing that children under 16 could not face capital punishment &mdash; pointedly asked: &ldquo;You must be 15 years old, aren&apos;t you?&rdquo; Oshichi, not understanding his attempt to save her, answered honestly that she was 16. She was burned at the stake at Suzugamori on 29 March 1683.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Oshichi&apos;s birth year is traditionally given as 1666 &mdash; a Fire Horse year. The historical evidence is ambiguous; some scholars believe the 1666 date was assigned retroactively to fit the emerging superstition. But the narrative was too perfect to resist. Within two years, Ihara Saikaku had included Oshichi as the opening tale of his 1685 <em>Koshoku Gonin Onna</em> (Five Women Who Loved Love). By the mid-18th century, she was a staple of bunraku (puppet theatre) and kabuki, performed using the <em>ningyoburi</em> technique &mdash; the actor moving with the stiff, deliberate motions of a puppet, emphasising her tragic helplessness against the force of her own nature.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The transformation is remarkable. The historical Oshichi was an arsonist executed for a reckless crime. The theatrical Oshichi became a tragic heroine consumed by love so intense it was literally incendiary &mdash; a moral tale dressed up as destiny. And the moral, gradually crystallised through generations of retelling, was this: a woman born in a Fire Horse year carries fire within her. She cannot help it. She will burn whatever she touches.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          1966: When Superstition Moved Demographics
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          In 1966, the most recent Fire Horse year, something happened in Japan that has no parallel in any other industrialised nation. The birth rate, which had held steady at approximately 2.0 children per woman throughout the 1960s, plummeted to 1.58. Births dropped from 1.82 million in 1965 to 1.36 million in 1966 &mdash; a decline of approximately 500,000 births, or 25%. In 1967, the rate recovered to 1.94 million.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The cause was the <em>Hinoeuma</em> (丙午) superstition, amplified by a specific mechanism: people born in the previous Fire Horse year of 1906 were still alive in 1966. Grandmothers who had heard the warnings about Fire Horse daughters from their own grandmothers passed them on. Mass media spread the anxiety further. And unlike 1906, mid-century Japan had widespread access to contraception and abortion, allowing millions of families to act on the belief simultaneously.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The consequences were not merely statistical. Academic research has documented that women born in 1966 Japan experienced higher divorce rates, lower educational attainment, and reduced household income compared to women born in adjacent years &mdash; effects caused not by any astrological reality but by the smaller cohort size and the lingering stigma itself. Studies in medical journals documented increased abortion rates in 1966 and anomalies in the reported male-to-female birth ratio consistent with parents falsifying their daughters&apos; birth years. An estimated 721 excess female infant deaths were attributed to the Fire Horse year. The superstition didn&apos;t just predict misfortune; it created it.
        </p>

        <div className="border-l-4 border-amber-400 pl-6 mb-8">
          <p className="text-secondary italic mb-2">
            &ldquo;The 1966 birth rate crash is the only documented case in modern history of a folk superstition producing a measurable, nationwide demographic event in an industrialised country.&rdquo;
          </p>
          <p className="text-muted text-sm">
            &mdash; World Bank, &ldquo;The Curse of the Fire Horse&rdquo; (2014)
          </p>
        </div>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          China, Japan, Korea: Three Responses
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The sexagenary cycle originated in China, and in China the Fire Horse carries no particular stigma against women. The double fire is recognised as intense &mdash; parents may choose names emphasising water or earth imagery to balance it &mdash; but this is routine feng shui, applied to any elemental imbalance. In Chinese tradition, the Fire Horse is powerful, not cursed.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Japan transformed the astrological observation into a gendered folk horror. The Oshichi legend, amplified through two centuries of puppet theatre and kabuki, made the Fire Horse specifically about female destructiveness. Korea inherited the superstition during the Japanese colonial period (1910&ndash;1945); a 2026 <em>Korea Herald</em> article quotes experts calling it &ldquo;a baseless belief rooted in remnants of Japan&apos;s colonial era.&rdquo; Studies show that Koreans living in Japan in 1966 showed a birth rate drop similar to ethnic Japanese, while Koreans in Korea showed no such effect &mdash; demonstrating that the superstition&apos;s power was a function of the Japanese cultural environment, not Korean tradition.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          For 2026, demographers expect the effect to be minimal. Japan&apos;s birth rate is already at historic lows for structural economic reasons. As one Japanese commentator noted: &ldquo;Not having babies is now the default state.&rdquo; The superstition has faded to apathy rather than stigma. But the 1966 event remains a reminder of how profoundly cultural beliefs can shape material reality &mdash; and how dangerous it is to read cosmological systems through the lens of folk prejudice rather than their own philosophical framework.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Fire and the Mandate of Heaven
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          In Chinese political cosmology, fire has a deeper significance than personal character. The Theory of the Five Virtues (五德終始), formulated by Zou Yan (c. 305&ndash;240 BCE), holds that each dynasty rules under the patronage of one element. When a dynasty&apos;s virtue is exhausted, Heaven withdraws its mandate, and a new dynasty rises under the next element in the cycle.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Fire is the element of the Zhou Dynasty, considered the golden age of Chinese civilisation &mdash; the era that produced Confucius, Laozi, and the Hundred Schools of Thought. The Han Dynasty, China&apos;s longest and most culturally definitive, also claimed fire virtue and the colour red. Fire in this framework is not merely destructive. It is the element of illumination, culture, and legitimate authority. The emperor faces south &mdash; the direction of fire &mdash; because his role is to illuminate the realm.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          A Fire Horse year, with its doubled yang fire, can be read through this political lens as a year of intensified cosmic fire: a moment when the element that governs illumination and transformation is at its most powerful and most volatile. Dong Zhongshu (179&ndash;104 BCE), the Confucian philosopher who systematised the relationship between Heaven and the state, argued that elemental excess was not merely dangerous but <em>corrective</em> &mdash; each imbalance creating the conditions for its own resolution.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Source Texts
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Most Western discussions of Chinese astrology rely on a handful of English-language summaries, each one further from the source. Source Library holds the original texts &mdash; the actual Chinese-language works that define the cosmological system the Fire Horse belongs to. Many have never been translated into English.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Divination and Astrology</h3>

        <p className="text-secondary leading-relaxed mb-6">
          The{' '}
          <Link href="/book/6992cac0d4d545ae73feea71" className="text-amber-700 hover:text-amber-600 underline">新刊指南臺司袁天罡先生五星三命大全 (Five Stars Three Fates Complete Guide to Astrology)</Link>
          {' '}is attributed to Yuan Tiangang, the legendary Tang dynasty astrologer who is said to have predicted the rise of Empress Wu Zetian. The text systematises the &ldquo;Three Fates&rdquo; (三命) method of astrological calculation &mdash; the interaction of year, month, and hour pillars with the five planets and their elemental associations. Two{' '}
          <Link href="/book/6992c9af54b3f8b16b4afd0c" className="text-amber-700 hover:text-amber-600 underline">Taiyi divination</Link>
          {' '}<Link href="/book/6992c9a9d4d545ae73fed5e9" className="text-amber-700 hover:text-amber-600 underline">manuals</Link>
          {' '}document the &ldquo;Supreme Unity&rdquo; system, one of the three great Chinese divination methods alongside the I Ching and Qimen Dunjia.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Cosmological Framework</h3>

        <p className="text-secondary leading-relaxed mb-6">
          The{' '}
          <Link href="/book/6992cabad4d545ae73fee83d" className="text-amber-700 hover:text-amber-600 underline">五行大義 (<em>Wuxing Dayi</em>)</Link>
          {' '}is the most important surviving treatise on the five-element system. Written during the Sui dynasty, it synthesises centuries of five-element theory into a comprehensive reference. Two volumes are now in Source Library in the original Chinese.{' '}
          <Link href="/book/695580ac57e3b773024f5c37" className="text-amber-700 hover:text-amber-600 underline">Zhu Xi&apos;s <em>Confucian Cosmogony</em></Link>
          {' '}provides the Neo-Confucian synthesis of yin-yang and five-element theory that shaped later Chinese astrological thought.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">The I Ching</h3>

        <p className="text-secondary leading-relaxed mb-6">
          Seven editions span the collection &mdash; from{' '}
          <Link href="/book/6992c92869b777d72c763513" className="text-amber-700 hover:text-amber-600 underline">original Chinese hexagram diagrams</Link>
          {' '}and{' '}
          <Link href="/book/6992cb54d4d545ae73feef31" className="text-amber-700 hover:text-amber-600 underline"><em>Zhou Yi Xixin</em> (Cleansing the Heart through the Book of Changes)</Link>
          {' '}to the landmark English translations by{' '}
          <Link href="/book/6953e27477f38f6761be8d28" className="text-amber-700 hover:text-amber-600 underline">Legge (1882)</Link>
          {' '}and{' '}
          <Link href="/book/6990653a726f64800c10a225" className="text-amber-700 hover:text-amber-600 underline">Wilhelm</Link>
          . The Chinese originals preserve notation and commentary that no translation can fully convey &mdash; the visual structure of the hexagrams, the interlinear glosses, the layers of commentary accumulated over centuries.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Astronomy and Star Maps</h3>

        <p className="text-secondary leading-relaxed mb-6">
          The{' '}
          <Link href="/book/6992ca1ad4d545ae73fed806" className="text-amber-700 hover:text-amber-600 underline">Dunhuang Star Chart</Link>
          {' '}(Pelliot chinois 3594, c. 700 CE) maps over 1,300 stars across all 28 lunar mansions &mdash; the celestial coordinate system within which the Horse occupies its fire-palace position. The{' '}
          <Link href="/book/6992cc33b81ed280ee32680b" className="text-amber-700 hover:text-amber-600 underline">Chinese celestial planispheres</Link>
          {' '}held at the Biblioth&egrave;que nationale de France show the full sky in traditional Chinese projection.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">The Broader Tradition</h3>

        <p className="text-secondary leading-relaxed mb-6">
          These astrological texts sit within a larger collection of Chinese source material: the{' '}
          <Link href="/book/695924fa1cac2ce31a4a8a33" className="text-amber-700 hover:text-amber-600 underline">Daozang (道藏, Taoist Canon)</Link>
          , the{' '}
          <Link href="/book/699249eda2d53df4853c123d" className="text-amber-700 hover:text-amber-600 underline">Analects of Confucius</Link>
          {' '}(in both{' '}
          <Link href="/book/697a30536dc6ae6bd18cd1e1" className="text-amber-700 hover:text-amber-600 underline">the 1687 Latin Jesuit translation</Link>
          {' '}and modern English), the{' '}
          <Link href="/book/6990659a3dc2ed39a49f1e7b" className="text-amber-700 hover:text-amber-600 underline">Huang Di Nei Jing (Yellow Emperor&apos;s Classic of Internal Medicine)</Link>
          , the{' '}
          <Link href="/book/699065663dc2ed39a49f0c60" className="text-amber-700 hover:text-amber-600 underline">Tao Te Ching</Link>
          , the{' '}
          <Link href="/book/6990656b3dc2ed39a49f0f07" className="text-amber-700 hover:text-amber-600 underline">Zhuangzi</Link>
          , and the{' '}
          <Link href="/book/695363bc77f38f6761bcddfa" className="text-amber-700 hover:text-amber-600 underline">Secret of the Golden Flower</Link>
          . Together, they constitute a philosophical tradition in which astrology, medicine, politics, ethics, and metaphysics are not separate disciplines but facets of a single cosmological vision.
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-300">
                <th className="text-left py-3 px-4 text-primary font-semibold">Text</th>
                <th className="text-left py-3 px-4 text-primary font-semibold">Subject</th>
                <th className="text-left py-3 px-4 text-primary font-semibold">Language</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-stone-200">
                <td className="py-3 px-4"><Link href="/book/6992cac0d4d545ae73feea71" className="text-amber-700 hover:text-amber-600 underline">五星三命大全</Link></td>
                <td className="py-3 px-4">Tang dynasty astrological system (Five Stars, Three Fates)</td>
                <td className="py-3 px-4">Chinese</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-3 px-4"><Link href="/book/6992c9af54b3f8b16b4afd0c" className="text-amber-700 hover:text-amber-600 underline">太乙統宗寶鑑</Link></td>
                <td className="py-3 px-4">Taiyi divination system</td>
                <td className="py-3 px-4">Chinese</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-3 px-4"><Link href="/book/6992cabad4d545ae73fee83d" className="text-amber-700 hover:text-amber-600 underline">五行大義</Link></td>
                <td className="py-3 px-4">Definitive treatise on the five elements</td>
                <td className="py-3 px-4">Chinese</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-3 px-4"><Link href="/book/6992ca1ad4d545ae73fed806" className="text-amber-700 hover:text-amber-600 underline">Dunhuang Star Chart</Link></td>
                <td className="py-3 px-4">Oldest complete star atlas (c. 700 CE)</td>
                <td className="py-3 px-4">Chinese</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-3 px-4"><Link href="/book/6992c93c69b777d72c76353e" className="text-amber-700 hover:text-amber-600 underline">周天星位經緯宿度考</Link></td>
                <td className="py-3 px-4">Lunar mansion positions and degree measurements</td>
                <td className="py-3 px-4">Chinese</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-3 px-4"><Link href="/book/6992c92869b777d72c763513" className="text-amber-700 hover:text-amber-600 underline">易經 64卦圖</Link></td>
                <td className="py-3 px-4">I Ching hexagram diagrams</td>
                <td className="py-3 px-4">Chinese</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-3 px-4"><Link href="/book/6992cabdd4d545ae73fee906" className="text-amber-700 hover:text-amber-600 underline">易象圖說</Link></td>
                <td className="py-3 px-4">Illustrated commentary on hexagram imagery</td>
                <td className="py-3 px-4">Chinese</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-3 px-4"><Link href="/book/695580ac57e3b773024f5c37" className="text-amber-700 hover:text-amber-600 underline">Confucian Cosmogony</Link></td>
                <td className="py-3 px-4">Zhu Xi&apos;s Neo-Confucian yin-yang synthesis</td>
                <td className="py-3 px-4">English</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Reading the Sources
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The difference between reading about Chinese astrology in an English summary and reading the source texts is the difference between a paint-by-numbers guide and the painting. The{' '}
          <Link href="/book/6992cabad4d545ae73fee83d" className="text-amber-700 hover:text-amber-600 underline">五行大義</Link>
          {' '}does not list &ldquo;fire = passion, horse = freedom&rdquo; in the manner of a horoscope column. It traces the element of fire through its cosmological, medical, political, musical, and seasonal manifestations &mdash; fire as the south, as the heart, as the note <em>zhi</em>, as the colour red, as the bitter taste, as the planet Mars, as the virtue of propriety. The system is not a personality quiz. It is a theory of everything.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Source Library&apos;s AI translation pipeline can make these texts accessible in English for the first time. The{' '}
          <Link href="/book/6992cac0d4d545ae73feea71" className="text-amber-700 hover:text-amber-600 underline">Five Stars Three Fates</Link>
          {' '}astrology manual, the{' '}
          <Link href="/book/6992cabad4d545ae73fee83d" className="text-amber-700 hover:text-amber-600 underline">五行大義</Link>
          , the original Chinese I Ching commentaries &mdash; these are the works that define the tradition the Fire Horse belongs to. To understand what the Year of the Fire Horse actually means, you need to read them. Not a summary. Not a horoscope. The text.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Happy New Year. Mind the fire.
        </p>

        <div className="bg-white rounded-xl p-8 shadow-sm border border-border-light mt-12">
          <h3 className="text-xl text-primary mb-4">Explore the Chinese Collection</h3>
          <p className="text-secondary mb-6">
            Browse over 110 Chinese philosophical, astrological, and medical texts in Source Library &mdash; from the Dunhuang Star Chart to the Taoist Canon, from Confucius to the I Ching.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/search?q=Chinese&language=Chinese"
              className="inline-flex items-center gap-2 bg-amber-700 text-white px-6 py-3 rounded-lg hover:bg-amber-800 transition-colors"
            >
              Browse Chinese texts
            </Link>
            <Link
              href="/book/6992cac0d4d545ae73feea71"
              className="inline-flex items-center gap-2 border border-amber-700 text-amber-700 px-6 py-3 rounded-lg hover:bg-amber-50 transition-colors"
            >
              Read the Five Stars astrology manual
            </Link>
          </div>
        </div>
      </article>
    </ContentPageLayout>
  );
}
