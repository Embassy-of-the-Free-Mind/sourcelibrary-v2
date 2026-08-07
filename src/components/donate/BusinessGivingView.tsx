import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import OutboundLink from '@/components/analytics/OutboundLink';
import type { Locale } from '@/lib/i18n';

/**
 * Giving through your company — the acquisition surface for Dutch BV owners and
 * US corporations, in English and Spanish.
 *
 * Spanish exists for the same reason /support does (#2763): Instagram and other
 * webviews give a Spanish-speaking visitor no browser translate, so an
 * English-only page is a wall at the last step of the funnel. The tax content is
 * Dutch and US law either way — a Spanish speaker resident in NL still files
 * vennootschapsbelasting — so the figures are identical and only the prose
 * changes. Dutch legal terms (BV, box 2, periodieke schenking) are kept in Dutch
 * and glossed, because those are the words the reader's accountant will use.
 */

const CONTACT_EMAIL = 'team@sourcelibrary.org';
const MAILTO = `mailto:${CONTACT_EMAIL}?subject=Giving%20through%20my%20company%20%E2%80%94%20Source%20Library`;

const NAF_SOURCELIBRARY_URL =
  'https://form-renderer-app.donorperfect.io/give/embassyofthefreemindsourcelibrary';
const EFM_STRIPE_URL = 'https://donate.stripe.com/9B67sLbO1bOg2GxfxP9fW08';

// Worked examples for a Dutch BV, using the 2026 Vpb rates (19% on the first €200,000 of
// profit, 25.8% above) and the cultural-ANBI multiplier (first €5,000 deducted at 150%,
// extra deduction capped at €2,500). Each row is gift − (deduction × rate).
//
// Stored as NUMBERS and formatted per locale, never as literal strings: Spanish uses "." for
// thousands and "," for decimals, so a hardcoded "€1,000" reads as ONE EURO to a Spanish
// reader. On a page whose whole job is showing what a gift costs, that is not a cosmetic bug.
const NL_EXAMPLES = [
  { gift: 1000, deduction: 1500, costLow: 715, costHigh: 613 },
  { gift: 5000, deduction: 7500, costLow: 3575, costHigh: 3065 },
  { gift: 25000, deduction: 27500, costLow: 19775, costHigh: 17905 },
  { gift: 100000, deduction: 102500, costLow: 80525, costHigh: 73555 },
];

function eur(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-US', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
    // es-ES omits the group separator below 10,000 by default ("5000 €"), but the
    // Spanish prose on this page writes "5.000 €". Force grouping so the table and
    // the sentences beside it agree. No effect on en-US, which always groups.
    useGrouping: 'always',
  }).format(n);
}

interface BusinessStrings {
  eyebrow: string;
  heroTitle: string;
  heroLead: string;

  shortLabel: string;
  shortTitle: string;
  shortBody: string;

  nlLabel: string;
  nlTitle: string;
  nlLeadPre: string;
  nlLeadStrong: string;
  nlLeadPost: string;
  bullet1Pre: string; bullet1Strong: string; bullet1Post: string;
  bullet2Pre: string; bullet2Strong: string; bullet2Post: string;
  bullet3: string;

  thGift: string; thDeduction: string; thCostLow: string; thCostHigh: string;
  tableNote: string;

  aboveLabel: string;
  abovePre: string; aboveStrong: string; abovePost: string;
  sponsorLabel: string;
  sponsorPre: string; sponsorStrong: string; sponsorMid: string; sponsorLink: string;

  usLabel: string;
  usTitle: string;
  usLeadPre: string; usLeadStrong: string; usLeadPost: string;
  usNoteLabel: string;
  usNote: string;

  howTitle: string;
  cardEuLabel: string; cardEuTitle: string; cardEuSub: string;
  cardUsLabel: string; cardUsTitle: string; cardUsSub: string;
  cardTalkLabel: string; cardTalkTitle: string; cardTalkSub: string;

  disclaimerStrong: string;
  disclaimerPre: string;
  disclaimerPost: string;

  whereTitle: string;
  whereBody: string;
  whereCta: string;
}

const STRINGS: Record<Locale, BusinessStrings> = {
  en: {
    eyebrow: 'For business owners',
    heroTitle: 'Giving through your company.',
    heroLead:
      'Most business owners assume a donation has to come out of their own pocket — salary or a dividend first, gift second. In the Netherlands that instinct is expensive. Giving directly from the company is usually the cheapest route by a wide margin, and almost nobody is told so.',

    shortLabel: 'The short version',
    shortTitle: 'Give from wherever the money already sits.',
    shortBody:
      'Taking money out of a BV costs a toll — 24.5% to 31% in box 2 on a dividend, or up to 49.5% in box 1 on salary. The personal gift deduction then refunds you at a rate capped at 37.56%. You pay the toll to move money you were always going to give away, and the deduction never catches up. A gift straight from the company skips the toll entirely.',

    nlLabel: 'Netherlands',
    nlTitle: 'If you have a BV.',
    nlLeadPre:
      'Source Library is a project of the Embassy of the Free Mind in Amsterdam, whose foundation — Stichting Het Wereldhart — is a registered ',
    nlLeadStrong: 'cultural ANBI',
    nlLeadPost: '. For a Dutch company that is the most favourable class of recipient there is.',
    bullet1Pre: 'Your BV deducts gifts against profit, up to 50% of profit with a ceiling of ',
    bullet1Strong: '€100,000 per year',
    bullet1Post: '.',
    bullet2Pre: 'Because we are a cultural ANBI, the first €5,000 you give counts as ',
    bullet2Strong: '€7,500',
    bullet2Post: ' for the deduction — a multiplier worth up to €2,500 of extra relief.',
    bullet3: 'No VAT applies to a genuine gift, so nothing is lost in the transfer.',

    thGift: 'Your gift',
    thDeduction: 'Deducted as',
    thCostLow: 'Net cost at 19%',
    thCostHigh: 'Net cost at 25.8%',
    tableNote:
      'Corporate income tax runs at 19% on the first €200,000 of profit and 25.8% above it, so the right-hand column applies to most established companies. Figures assume the gift sits inside the 50%-of-profit limit.',

    aboveLabel: 'Above €100,000',
    abovePre:
      'Past the ceiling the arithmetic inverts. Since 1 January 2025, a gift above the deductible limit is treated as a distribution to you personally, so you pay the box 2 toll and get no corporate relief. At that point a five-year ',
    aboveStrong: 'periodieke schenking',
    abovePost:
      ' in your own name is the better instrument: no threshold, no 10% cap, deductible up to €1.5 million a year. Talk to us and we will prepare the agreement.',
    sponsorLabel: 'Or sponsor instead',
    sponsorPre:
      'If you would like your company named, sponsorship is fully deductible as a business cost with ',
    sponsorStrong: 'no ceiling at all',
    sponsorMid:
      ' — which matters once you are near the gift limit. It comes with recognition on the library, a private tour of the Bibliotheca for your team, and early access to what we publish. See ',
    sponsorLink: 'corporate partnership',

    usLabel: 'United States',
    usTitle: 'If your company is American.',
    usLeadPre: 'US gifts are tax-deductible through ',
    usLeadStrong: 'The Netherland-America Foundation',
    usLeadPost:
      ', a New York 501(c)(3) that holds a designated Source Library fund. A gift made directly to the Dutch foundation is not deductible in the US, so the NAF route is the one that works.',
    usNoteLabel: 'One change worth knowing about',
    usNote:
      'From the 2026 tax year, a C corporation deducts charitable gifts only above a floor of 1% of taxable income, up to the existing 10% ceiling. Below that floor the deduction is nothing, and it generally does not carry forward. Individuals face a comparable 0.5% floor. A payment with genuine consideration behind it — sponsorship, naming, access, contracted work — is a business expense instead, with no floor and no cap. For many US companies that is now the better structure, and it is worth raising with your CPA before deciding.',

    howTitle: 'How to give.',
    cardEuLabel: 'Netherlands & EU',
    cardEuTitle: 'Give to Stichting Het Wereldhart',
    cardEuSub: 'Cultural ANBI',
    cardUsLabel: 'United States',
    cardUsTitle: 'Give via the Netherland-America Foundation',
    cardUsSub: '501(c)(3) public charity',
    cardTalkLabel: 'Anything larger',
    cardTalkTitle: 'Talk to us directly',
    cardTalkSub: 'Periodic gifts, sponsorship, in kind',

    disclaimerStrong: 'This is general information, not tax advice.',
    disclaimerPre:
      ' Rules described here are current for the 2026 tax year and the right answer depends on your company’s profit, VAT position, and where you are resident. Confirm with your accountant before you give, and write to ',
    disclaimerPost: ' if it would help to have us talk it through with them.',

    whereTitle: 'What your gift pays for.',
    whereBody:
      'Digitisation of fragile manuscripts and rare printed books, AI-assisted translation with scholarly review, and a free reading platform where the original and the translation sit side by side. Everything we produce is published openly under CC BY-SA and free to read.',
    whereCta: 'See all the ways to give',
  },

  es: {
    eyebrow: 'Para empresarios',
    heroTitle: 'Donar a través de tu empresa.',
    heroLead:
      'Casi todos los empresarios dan por hecho que una donación debe salir de su propio bolsillo: primero sueldo o dividendo, después el donativo. En los Países Bajos ese instinto sale caro. Donar directamente desde la empresa suele ser, con diferencia, la vía más económica, y casi nadie lo explica.',

    shortLabel: 'En resumen',
    shortTitle: 'Dona desde donde ya está el dinero.',
    shortBody:
      'Sacar dinero de una BV tiene un peaje: entre el 24,5% y el 31% en box 2 si es dividendo, o hasta el 49,5% en box 1 si es sueldo. La deducción personal por donativos te devuelve después a un tipo limitado al 37,56%. Pagas el peaje por mover un dinero que ibas a donar de todos modos, y la deducción nunca lo compensa. Un donativo directo desde la empresa se ahorra el peaje por completo.',

    nlLabel: 'Países Bajos',
    nlTitle: 'Si tienes una BV.',
    nlLeadPre:
      'Source Library es un proyecto de la Embassy of the Free Mind de Ámsterdam, cuya fundación — Stichting Het Wereldhart — está registrada como ',
    nlLeadStrong: 'ANBI cultural',
    nlLeadPost:
      '. Para una empresa neerlandesa es la categoría de destinatario más favorable que existe.',
    bullet1Pre:
      'Tu BV deduce los donativos del beneficio, hasta el 50% del beneficio con un techo de ',
    bullet1Strong: '100.000 € al año',
    bullet1Post: '.',
    bullet2Pre: 'Al ser una ANBI cultural, los primeros 5.000 € que dones computan como ',
    bullet2Strong: '7.500 €',
    bullet2Post: ' a efectos de la deducción: un multiplicador que vale hasta 2.500 € adicionales.',
    bullet3: 'Un donativo genuino no lleva IVA, así que no se pierde nada en la transferencia.',

    thGift: 'Tu donativo',
    thDeduction: 'Se deduce como',
    thCostLow: 'Coste neto al 19%',
    thCostHigh: 'Coste neto al 25,8%',
    tableNote:
      'El impuesto de sociedades es del 19% sobre los primeros 200.000 € de beneficio y del 25,8% por encima, así que la última columna es la que aplica a la mayoría de empresas consolidadas. Las cifras suponen que el donativo cabe dentro del límite del 50% del beneficio.',

    aboveLabel: 'Por encima de 100.000 €',
    abovePre:
      'Pasado el techo, la aritmética se invierte. Desde el 1 de enero de 2025, un donativo por encima del límite deducible se trata como un reparto a tu favor, así que pagas el peaje de box 2 y no obtienes ninguna deducción en la empresa. Llegado ese punto, una ',
    aboveStrong: 'periodieke schenking',
    abovePost:
      ' (donación periódica) a cinco años a tu nombre es el mejor instrumento: sin mínimo, sin el tope del 10% y deducible hasta 1,5 millones de euros al año. Habla con nosotros y preparamos el acuerdo.',
    sponsorLabel: 'O patrocina',
    sponsorPre:
      'Si prefieres que aparezca el nombre de tu empresa, el patrocinio es plenamente deducible como gasto de la actividad y ',
    sponsorStrong: 'sin techo alguno',
    sponsorMid:
      ', lo cual importa cuando ya estás cerca del límite del donativo. Incluye reconocimiento en la biblioteca, una visita privada a la Bibliotheca para tu equipo y acceso anticipado a lo que publicamos. Consulta ',
    sponsorLink: 'colaboración corporativa',

    usLabel: 'Estados Unidos',
    usTitle: 'Si tu empresa es estadounidense.',
    usLeadPre: 'Los donativos desde EE. UU. son deducibles a través de ',
    usLeadStrong: 'The Netherland-America Foundation',
    usLeadPost:
      ', una entidad 501(c)(3) de Nueva York que mantiene un fondo designado para Source Library. Un donativo hecho directamente a la fundación neerlandesa no es deducible en EE. UU., así que la vía de la NAF es la que funciona.',
    usNoteLabel: 'Un cambio que conviene conocer',
    usNote:
      'Desde el ejercicio fiscal 2026, una C corporation solo deduce los donativos que superen un mínimo del 1% de la base imponible, hasta el techo del 10% ya existente. Por debajo de ese mínimo la deducción es cero y, por lo general, no se traslada a ejercicios siguientes. Las personas físicas tienen un mínimo equivalente del 0,5%. Un pago con contraprestación real detrás — patrocinio, denominación, acceso, trabajo contratado — es en cambio un gasto de la actividad, sin mínimo y sin techo. Para muchas empresas estadounidenses esa es hoy la mejor estructura, y conviene planteárselo a tu asesor fiscal antes de decidir.',

    howTitle: 'Cómo donar.',
    cardEuLabel: 'Países Bajos y UE',
    cardEuTitle: 'Donar a Stichting Het Wereldhart',
    cardEuSub: 'ANBI cultural',
    cardUsLabel: 'Estados Unidos',
    cardUsTitle: 'Donar vía Netherland-America Foundation',
    cardUsSub: 'Entidad benéfica 501(c)(3)',
    cardTalkLabel: 'Algo mayor',
    cardTalkTitle: 'Habla con nosotros',
    cardTalkSub: 'Donaciones periódicas, patrocinio, en especie',

    disclaimerStrong: 'Esto es información general, no asesoramiento fiscal.',
    disclaimerPre:
      ' Las normas descritas corresponden al ejercicio 2026 y la respuesta correcta depende del beneficio de tu empresa, de su situación en el IVA y de dónde seas residente. Consúltalo con tu asesor antes de donar y escríbenos a ',
    disclaimerPost: ' si te sirve que lo comentemos con él.',

    whereTitle: 'A qué se destina tu donativo.',
    whereBody:
      'A digitalizar manuscritos frágiles y libros impresos raros, a la traducción asistida por IA con revisión académica, y a una plataforma de lectura gratuita donde el original y la traducción aparecen uno junto al otro. Todo lo que producimos se publica abiertamente bajo CC BY-SA y es gratis de leer.',
    whereCta: 'Ver todas las formas de donar',
  },
};

export default function BusinessGivingView({ locale = 'en' }: { locale?: Locale }) {
  const s = STRINGS[locale];
  const supportHref = locale === 'es' ? '/es/support' : '/support';

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader homeLocale={locale} />

      {/* Hero */}
      <section className="bg-[#faf8f5] border-b border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto py-14 md:py-20">
          <div className="text-xs uppercase tracking-[0.2em] text-stone-500 mb-3">{s.eyebrow}</div>
          <h1 className="text-3xl md:text-4xl lg:text-5xl text-stone-900 mb-6 leading-tight font-display">
            {s.heroTitle}
          </h1>
          <p className="text-lg text-stone-600 leading-relaxed max-w-3xl">{s.heroLead}</p>
        </div>
      </section>

      {/* The principle */}
      <section className="bg-white py-14 md:py-20">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="bg-stone-900 text-white rounded-xl p-6 md:p-10">
            <div className="text-xs uppercase tracking-[0.2em] text-[#c9a86c] mb-3">
              {s.shortLabel}
            </div>
            <h2 className="font-display text-2xl md:text-3xl mb-4 leading-snug">{s.shortTitle}</h2>
            <p className="text-stone-300 leading-relaxed max-w-3xl">{s.shortBody}</p>
          </div>
        </div>
      </section>

      {/* Netherlands */}
      <section className="bg-[#faf8f5] py-14 md:py-20 border-y border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="text-xs uppercase tracking-[0.2em] text-stone-500 mb-3">{s.nlLabel}</div>
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-6 leading-tight font-display">
            {s.nlTitle}
          </h2>

          <p className="text-lg text-stone-600 leading-relaxed mb-6 max-w-3xl">
            {s.nlLeadPre}
            <strong className="text-stone-800">{s.nlLeadStrong}</strong>
            {s.nlLeadPost}
          </p>

          <ul className="space-y-3 text-stone-700 leading-relaxed mb-10 max-w-3xl">
            <li className="flex gap-3">
              <span className="text-[#9e4a3a] mt-1.5 shrink-0">▸</span>
              <span>
                {s.bullet1Pre}
                <strong>{s.bullet1Strong}</strong>
                {s.bullet1Post}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-[#9e4a3a] mt-1.5 shrink-0">▸</span>
              <span>
                {s.bullet2Pre}
                <strong>{s.bullet2Strong}</strong>
                {s.bullet2Post}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-[#9e4a3a] mt-1.5 shrink-0">▸</span>
              <span>{s.bullet3}</span>
            </li>
          </ul>

          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden mb-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#faf8f5] border-b border-stone-200">
                    <th className="text-left font-semibold text-stone-700 px-5 py-3">{s.thGift}</th>
                    <th className="text-left font-semibold text-stone-700 px-5 py-3">
                      {s.thDeduction}
                    </th>
                    <th className="text-left font-semibold text-stone-700 px-5 py-3">
                      {s.thCostLow}
                    </th>
                    <th className="text-left font-semibold text-stone-700 px-5 py-3">
                      {s.thCostHigh}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {NL_EXAMPLES.map((row) => (
                    <tr key={row.gift} className="border-b border-stone-100 last:border-0">
                      <td className="px-5 py-3 font-semibold text-stone-900 tabular-nums">
                        {eur(row.gift, locale)}
                      </td>
                      <td className="px-5 py-3 text-stone-600 tabular-nums">
                        {eur(row.deduction, locale)}
                      </td>
                      <td className="px-5 py-3 text-stone-600 tabular-nums">
                        {eur(row.costLow, locale)}
                      </td>
                      <td className="px-5 py-3 text-stone-900 font-medium tabular-nums">
                        {eur(row.costHigh, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-stone-500 leading-relaxed mb-10 max-w-3xl">{s.tableNote}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-stone-200 p-6">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                {s.aboveLabel}
              </div>
              <p className="text-sm text-stone-600 leading-relaxed">
                {s.abovePre}
                <strong className="text-stone-800">{s.aboveStrong}</strong>
                {s.abovePost}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-6">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                {s.sponsorLabel}
              </div>
              <p className="text-sm text-stone-600 leading-relaxed">
                {s.sponsorPre}
                <strong className="text-stone-800">{s.sponsorStrong}</strong>
                {s.sponsorMid}
                <Link href="/sponsors" className="text-[#9e4a3a] underline hover:text-[#7e3a2e]">
                  {s.sponsorLink}
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* United States */}
      <section className="bg-white py-14 md:py-20">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="text-xs uppercase tracking-[0.2em] text-stone-500 mb-3">{s.usLabel}</div>
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-6 leading-tight font-display">
            {s.usTitle}
          </h2>

          <p className="text-lg text-stone-600 leading-relaxed mb-6 max-w-3xl">
            {s.usLeadPre}
            <strong className="text-stone-800">{s.usLeadStrong}</strong>
            {s.usLeadPost}
          </p>

          <div className="bg-[#faf8f5] rounded-xl border border-stone-200 p-6 md:p-8 max-w-3xl">
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
              {s.usNoteLabel}
            </div>
            <p className="text-sm text-stone-600 leading-relaxed">{s.usNote}</p>
          </div>
        </div>
      </section>

      {/* How to give */}
      <section className="bg-[#faf8f5] py-14 md:py-20 border-t border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-8 leading-tight font-display">
            {s.howTitle}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
            <OutboundLink
              href={EFM_STRIPE_URL}
              surface="support_business"
              channel="efm_stripe"
              locale={locale}
              className="bg-white rounded-xl border border-stone-200 p-5 hover:border-stone-400 transition-colors block"
            >
              <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">
                {s.cardEuLabel}
              </span>
              <span className="block text-sm font-semibold text-stone-900">{s.cardEuTitle}</span>
              <span className="block text-xs text-stone-500 mt-1">{s.cardEuSub}</span>
            </OutboundLink>
            <OutboundLink
              href={NAF_SOURCELIBRARY_URL}
              surface="support_business"
              channel="naf_donorperfect"
              locale={locale}
              className="bg-white rounded-xl border border-stone-200 p-5 hover:border-stone-400 transition-colors block"
            >
              <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">
                {s.cardUsLabel}
              </span>
              <span className="block text-sm font-semibold text-stone-900">{s.cardUsTitle}</span>
              <span className="block text-xs text-stone-500 mt-1">{s.cardUsSub}</span>
            </OutboundLink>
            <OutboundLink
              href={MAILTO}
              surface="support_business"
              channel="email"
              locale={locale}
              className="bg-white rounded-xl border border-stone-200 p-5 hover:border-stone-400 transition-colors block"
            >
              <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">
                {s.cardTalkLabel}
              </span>
              <span className="block text-sm font-semibold text-stone-900">{s.cardTalkTitle}</span>
              <span className="block text-xs text-stone-500 mt-1">{s.cardTalkSub}</span>
            </OutboundLink>
          </div>

          <p className="text-sm text-stone-500 leading-relaxed max-w-3xl">
            <strong className="text-stone-700">{s.disclaimerStrong}</strong>
            {s.disclaimerPre}
            <OutboundLink
              href={MAILTO}
              surface="support_business"
              channel="email"
              locale={locale}
              className="text-[#9e4a3a] underline hover:text-[#7e3a2e]"
            >
              {CONTACT_EMAIL}
            </OutboundLink>
            {s.disclaimerPost}
          </p>
        </div>
      </section>

      {/* Where it goes */}
      <section className="bg-white py-14 md:py-20 border-t border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl text-stone-900 mb-4 leading-tight font-display">
            {s.whereTitle}
          </h2>
          <p className="text-stone-600 leading-relaxed max-w-3xl mb-6">{s.whereBody}</p>
          <Link
            href={supportHref}
            className="inline-flex items-center px-5 py-3 rounded-md bg-[#9e4a3a] text-white text-sm font-semibold hover:bg-[#7e3a2e] transition-colors"
          >
            {s.whereCta}
          </Link>
        </div>
      </section>
    </div>
  );
}
