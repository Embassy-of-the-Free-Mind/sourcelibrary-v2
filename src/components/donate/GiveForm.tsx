'use client';

import { useState } from 'react';
import OutboundLink from '@/components/analytics/OutboundLink';
import {
  GIVE_PRESETS,
  GIVE_DEFAULT_AMOUNT,
  GIVE_MIN_AMOUNT,
  GIVE_MAX_AMOUNT,
  GIVE_CURRENCY,
  giveDestination,
  supportsFrequency,
  formatGiveAmount,
  type GiveFrequency,
  type GiveRoute,
} from '@/lib/give-routes';

/**
 * The whole ask, on one screen: how much, how often, and one button that leaves
 * with the amount already attached.
 *
 * The shape is borrowed from the Internet Archive's donate page, which is the
 * closest comparable audience solving the same problem — amount first, payment
 * second, everything visible without scrolling. What we can't copy is card entry
 * on our own domain: the receipt has to come from whichever entity receives the
 * gift, and that is never us (see src/lib/give-routes.ts). So the last step is a
 * handoff — but a handoff that carries the amount, which is the part that
 * actually costs a donor something to redo.
 *
 * Mounted twice: standalone at /give (the header's destination) and inside
 * /support, which keeps the longer case for giving around it. One component so
 * the two can't drift.
 */

interface Copy {
  frequencyLabel: string;
  once: string;
  monthly: string;
  amountLabel: string;
  custom: string;
  give: string;
  giveMonthly: string;
  usRoute: string;
  intlRoute: string;
  switchToUs: string;
  switchToIntl: string;
  monthlyUnavailable: string;
  taxUs: string;
  taxIntl: string;
  amountError: string;
  largeGift: string;
}

const COPY: Record<'en' | 'es', Copy> = {
  en: {
    frequencyLabel: 'How often',
    once: 'One time',
    monthly: 'Monthly',
    amountLabel: 'Amount',
    custom: 'Other',
    give: 'Give',
    giveMonthly: 'a month',
    usRoute: 'US tax-deductible — Netherland-America Foundation',
    intlRoute: 'International — Embassy of the Free Mind',
    switchToUs: 'Giving from the United States?',
    switchToIntl: 'Giving from outside the United States?',
    monthlyUnavailable: 'Monthly giving is currently available on the US route only.',
    taxUs: 'NAF is a 501(c)(3) public charity and issues your receipt. Your gift is earmarked for Source Library.',
    taxIntl: 'Goes to Stichting het Wereldhart (Cultural ANBI). Stripe issues your receipt automatically. Apple Pay, iDEAL and card accepted.',
    amountError: 'Enter a whole number',
    largeGift: 'Giving a larger amount, or by wire, stock, or donor-advised fund?',
  },
  es: {
    frequencyLabel: 'Frecuencia',
    once: 'Una vez',
    monthly: 'Mensual',
    amountLabel: 'Cantidad',
    custom: 'Otra',
    give: 'Donar',
    giveMonthly: 'al mes',
    usRoute: 'Deducible en EE. UU. — Netherland-America Foundation',
    intlRoute: 'Internacional — Embassy of the Free Mind',
    switchToUs: '¿Donas desde Estados Unidos?',
    switchToIntl: '¿Donas desde fuera de Estados Unidos?',
    monthlyUnavailable: 'La donación mensual está disponible por ahora solo en la vía de EE. UU.',
    taxUs: 'La NAF es una entidad benéfica 501(c)(3) y emite tu recibo. Tu donación se destina a Source Library.',
    taxIntl: 'Va a Stichting het Wereldhart (ANBI Cultural). Stripe emite el recibo automáticamente. Se acepta Apple Pay, iDEAL y tarjeta.',
    amountError: 'Introduce un número entero',
    largeGift: '¿Donas una cantidad mayor, o por transferencia, acciones o fondo asesorado?',
  },
};

export default function GiveForm({
  defaultRoute,
  locale = 'en',
  surface = 'give',
  contactEmail = 'team@sourcelibrary.org',
}: {
  /** Resolved server-side from the request country so the common case needs no choice. */
  defaultRoute: GiveRoute;
  locale?: 'en' | 'es';
  /** Distinguishes the /give mount from the /support mount in analytics. */
  surface?: string;
  contactEmail?: string;
}) {
  const t = COPY[locale];
  const [route, setRoute] = useState<GiveRoute>(defaultRoute);
  const [frequency, setFrequency] = useState<GiveFrequency>('once');
  const [amount, setAmount] = useState<number>(GIVE_DEFAULT_AMOUNT.once);
  // Empty string is a real state here, distinct from 0: it means "the donor is
  // mid-typing", and showing a validation error at that moment is hostile.
  const [customText, setCustomText] = useState('');

  const presets = GIVE_PRESETS[frequency];
  const symbol = GIVE_CURRENCY[route].symbol;
  const usingCustom = customText !== '' || !presets.includes(amount);

  // A custom entry is only an error once it is non-empty and still unusable.
  const customInvalid =
    customText !== '' &&
    (!/^\d+$/.test(customText) ||
      Number(customText) < GIVE_MIN_AMOUNT ||
      Number(customText) > GIVE_MAX_AMOUNT);
  const canGive = amount >= GIVE_MIN_AMOUNT && amount <= GIVE_MAX_AMOUNT && !customInvalid;

  function pickFrequency(next: GiveFrequency) {
    setFrequency(next);
    // Move the amount onto the new ladder rather than carrying a rung that
    // doesn't exist there — 250/month is not a sensible default for someone who
    // just toggled monthly.
    if (!customText) setAmount(GIVE_DEFAULT_AMOUNT[next]);
    // Monthly can't be honoured internationally, so choosing it moves the donor
    // to the route that can. Doing this silently would be worse than the switch:
    // the note below the button says it happened.
    if (next === 'monthly' && !supportsFrequency(route, 'monthly')) setRoute('us');
  }

  function pickPreset(value: number) {
    setAmount(value);
    setCustomText('');
  }

  function pickCustom(text: string) {
    setCustomText(text);
    if (/^\d+$/.test(text)) setAmount(Number(text));
  }

  const destination = canGive ? giveDestination(route, amount, frequency) : null;
  const buttonLabel =
    frequency === 'monthly'
      ? `${t.give} ${formatGiveAmount(route, amount)} ${t.giveMonthly}`
      : `${t.give} ${formatGiveAmount(route, amount)}`;

  const routedAwayFromIntl = frequency === 'monthly' && defaultRoute === 'international';

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-6 shadow-sm">
      {/* Frequency */}
      <fieldset>
        <legend className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-2">
          {t.frequencyLabel}
        </legend>
        <div className="grid grid-cols-2 gap-2 mb-6">
          {(['once', 'monthly'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => pickFrequency(f)}
              aria-pressed={frequency === f}
              className={`py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
                frequency === f
                  ? 'bg-accent-rust text-white border-accent-rust'
                  : 'bg-white text-stone-700 border-stone-300 hover:border-stone-400'
              }`}
            >
              {f === 'once' ? t.once : t.monthly}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Amount */}
      <fieldset>
        <legend className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-2">
          {t.amountLabel}
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {presets.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => pickPreset(value)}
              aria-pressed={!usingCustom && amount === value}
              className={`py-3 rounded-lg text-base font-semibold border transition-colors ${
                !usingCustom && amount === value
                  ? 'bg-accent-rust text-white border-accent-rust'
                  : 'bg-white text-stone-800 border-stone-300 hover:border-stone-400'
              }`}
            >
              {symbol}
              {value}
            </button>
          ))}
          <div
            className={`flex items-center rounded-lg border transition-colors ${
              customInvalid
                ? 'border-red-400'
                : usingCustom
                  ? 'border-accent-rust ring-1 ring-accent-rust'
                  : 'border-stone-300'
            }`}
          >
            <span className="pl-3 text-base font-semibold text-stone-500">{symbol}</span>
            <input
              type="text"
              inputMode="numeric"
              value={customText}
              onChange={(e) => pickCustom(e.target.value.replace(/[^\d]/g, ''))}
              placeholder={t.custom}
              aria-label={t.custom}
              aria-invalid={customInvalid}
              className="w-full bg-transparent px-1.5 py-3 text-base font-semibold text-stone-800 placeholder:font-normal placeholder:text-stone-400 outline-none min-w-0"
            />
          </div>
        </div>
        {customInvalid && (
          <p className="mt-2 text-xs text-red-600">{t.amountError}</p>
        )}
      </fieldset>

      {/* The one button. Rendered as a link so it survives a right-click, a
          middle-click, and a broken analytics beacon. */}
      <div className="mt-6">
        {destination ? (
          <OutboundLink
            href={destination.url}
            surface={surface}
            channel={destination.channel}
            locale={locale}
            amount={amount}
            frequency={frequency}
            className="block w-full text-center bg-accent-rust hover:bg-accent-gold-dark text-white text-lg font-semibold py-4 rounded-xl transition-colors"
          >
            {buttonLabel}
          </OutboundLink>
        ) : (
          <span className="block w-full text-center bg-stone-200 text-stone-500 text-lg font-semibold py-4 rounded-xl cursor-not-allowed">
            {buttonLabel}
          </span>
        )}

        <p className="mt-3 text-xs text-stone-500 leading-relaxed">
          {route === 'us' ? t.taxUs : t.taxIntl}
        </p>

        {routedAwayFromIntl && (
          <p className="mt-2 text-xs text-stone-500 leading-relaxed">{t.monthlyUnavailable}</p>
        )}

        {/* Switching route is a quiet secondary action, not a decision we make
            the donor face first — the country default already got it right for
            most people. Hidden when monthly has pinned the route to US, since
            offering a switch we would immediately undo is just a dead control. */}
        {!(frequency === 'monthly') && (
          <button
            type="button"
            onClick={() => setRoute(route === 'us' ? 'international' : 'us')}
            className="mt-3 text-xs text-accent-rust hover:text-accent-gold-dark underline underline-offset-2"
          >
            {route === 'us' ? t.switchToIntl : t.switchToUs}
          </button>
        )}
      </div>

      <p className="mt-5 pt-4 border-t border-stone-200 text-xs text-stone-500 leading-relaxed">
        {t.largeGift}{' '}
        <OutboundLink
          href={`mailto:${contactEmail}?subject=Source%20Library%20%E2%80%94%20Donation%20Inquiry`}
          surface={surface}
          channel="email"
          locale={locale}
          className="text-accent-rust hover:text-accent-gold-dark underline break-all"
        >
          {contactEmail}
        </OutboundLink>
      </p>
    </div>
  );
}
