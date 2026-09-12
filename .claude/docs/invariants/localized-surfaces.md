# Localized surfaces (`/es/*`, locale-aware views)

**Read this when** you add or edit a page that exists in more than one language, add a
route under `src/app/es/`, or touch a component that takes a `locale` prop.

Spanish exists for a concrete reason (#2763): Instagram and other in-app webviews give a
Spanish-speaking visitor no browser translate, so an English-only page is a hard wall,
not an inconvenience. That matters most on the pages where something is asked of the
reader — sign-up, giving — because the wall lands at the last step.

## Never hardcode a formatted number in a shared view

**A literal `€1,000` in a string table is wrong in Spanish, and wrong in a way that
changes the number.** `es-ES` uses `.` for thousands and `,` for decimals, so `€1,000`
reads as **one euro**. On `/support/business`, whose entire job is showing what a gift
costs, that shipped as far as review before being caught (2026-08-07).

Store the value as a **number** and format it per locale:

```ts
new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-US', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
  useGrouping: 'always',
}).format(n)
```

`useGrouping: 'always'` is deliberate: `es-ES` omits the separator below 10,000 by
default (`5000 €`), while Spanish prose beside the table writes `5.000 €`, and a table
disagreeing with the sentence above it reads as a bug. No effect on `en-US`.

The same applies to dates and to any percentage written into prose — `25.8%` is `25,8%`
in Spanish. Percentages inside *translated strings* are fine because the translator
writes them; the trap is only shared, non-translated data.

## A layout's `alternates` covers every child route

Next.js merges `metadata` per top-level key, so `src/app/support/layout.tsx` setting
`alternates.canonical = '/support'` applies to **every** page beneath it. A child that
does not declare its own `alternates` advertises the parent as canonical and drops
itself from the index entirely. `/support/business` needs its own block; so will the
next child added there.

Declare `languages` on **both** twins pointing at each other, or hreflang is one-way and
the pair is not recognised as a pair.

## The twin pattern, and the two things that get forgotten

A localized page is a thin route rendering a shared view:
`src/app/<path>/page.tsx` and `src/app/es/<path>/page.tsx` both render
`<SomeView locale="en|es" />`. Strings live in a `Record<Locale, …>` map in the view
(`SupportView`, `BusinessGivingView`).

Two things are routinely missed:

- **`src/app/sitemap.ts` enumerates static routes by hand.** A new `/es/*` page that is
  not added there is invisible to crawlers — the page works, and nobody finds it.
- **Internal links must be locale-aware.** A Spanish page linking to `/support` throws
  the reader back into English mid-funnel. Branch on the locale you already have
  (`locale === 'es' ? '/es/support' : '/support'`); do not branch on `usePathname()`,
  for the reason in `tenant-lockdown.md`.

## Keep domain terms in the source language

Dutch tax and legal terms — `BV`, `box 2`, `periodieke schenking`, `ANBI` — stay in
Dutch in the Spanish copy, glossed on first use. Those are the words the reader's
accountant will say back to them; translating them makes the page harder to act on, not
easier.
