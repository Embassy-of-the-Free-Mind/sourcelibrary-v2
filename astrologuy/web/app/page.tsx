"use client";

import { MoonDisplay } from "@/components/viz/MoonDisplay";
import { PhaseWheel } from "@/components/viz/PhaseWheel";
import { MoonHeatmap } from "@/components/viz/MoonHeatmap";
import { YearCalendar } from "@/components/viz/YearCalendar";
import { DriftChart } from "@/components/viz/DriftChart";
import { ZodiacWheel } from "@/components/viz/ZodiacWheel";
import { EclipseTimeline } from "@/components/viz/EclipseTimeline";
import { BirthDateInput } from "@/components/ui/BirthDateInput";
import { useHydrated } from "@/lib/hooks";
import { useAppState } from "@/lib/store";
import { SYNODIC_MONTH } from "@/lib/constants";

export default function EssayPage() {
  const hydrated = useHydrated();
  const { birthDate } = useAppState();

  return (
    <article className="essay">
      {/* ═══════════════════════════════════════════════
          I. THE HOOK
          ═══════════════════════════════════════════════ */}
      <header className="essay-hero">
        <h1 className="essay-title">
          The Calendar You Never Knew You Were Missing
        </h1>
        <p className="essay-subtitle">
          An interactive essay on the moon, the month, and the year that should have been.
        </p>
      </header>

      <section className="essay-section">
        <div className="essay-prose">
          <p className="essay-lede">
            The word <em>month</em> comes from <em>moon.</em> Old English <em>m&#x14D;nath</em>,
            from Proto-Germanic <em>*m&#x113;n&#x14D;th-</em>, literally &ldquo;moon-time.&rdquo;
            In every Indo-European language, the connection is transparent.
          </p>
          <p>
            But look at your calendar. January has 31 days. February has 28.
            March has 31 again. None of these have anything to do with the moon.
            The months don&rsquo;t start at the new moon. The full moon doesn&rsquo;t fall
            mid-month. The word <em>month</em> is a fossil &mdash; a linguistic ghost
            of a relationship your calendar severed two thousand years ago.
          </p>
          <p>
            This essay is about what we lost, and what we&rsquo;d gain by looking at it again.
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          II. RIGHT NOW
          ═══════════════════════════════════════════════ */}
      <section className="essay-section">
        <h2 className="essay-heading">The Moon Right Now</h2>
        <div className="essay-prose">
          <p>
            Before we talk about calendars, look up. Or rather, look here.
            The visualization below shows the moon&rsquo;s current phase,
            computed in real time from orbital mechanics &mdash; the same
            math that governs the tides and eclipses.
          </p>
        </div>

        <figure className="essay-figure">
          {hydrated ? (
            <MoonDisplay />
          ) : (
            <div className="w-full max-w-sm mx-auto text-center py-8">
              <div className="text-5xl">&#127761;</div>
              <div className="text-faint text-sm mt-3">Computing moon position&hellip;</div>
            </div>
          )}
          <figcaption>
            The illuminated portion matches the real moon right now.
            The sun indicator shows the light source direction.
            Every data point is computed from the actual positions of Earth, Moon, and Sun.
          </figcaption>
        </figure>

        <div className="essay-prose">
          <p>
            This isn&rsquo;t decorative. No server, no lookup table &mdash;
            your browser is doing the orbital mechanics right now, using the
            same <em>astronomy-engine</em> library that powers planetarium software.
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          III. THE ORIGINAL MONTH
          ═══════════════════════════════════════════════ */}
      <section className="essay-section">
        <h2 className="essay-heading">The Original Month</h2>
        <div className="essay-prose">
          <p>
            For most of human history, a &ldquo;month&rdquo; meant one thing: the time
            between two new moons. Every civilization on Earth &mdash; Babylonian,
            Egyptian, Chinese, Hebrew, Islamic, Hindu, Maya &mdash; organized
            time around the lunar cycle.
          </p>
          <p>
            The reason is obvious. The moon is the most visible clock in the sky.
            It takes {SYNODIC_MONTH} days to go from invisible (new) to full and back
            to invisible again. Unlike the sun, which requires instruments to track
            precisely, the moon&rsquo;s phase is readable at a glance.
            Anyone can count to 29.
          </p>
        </div>

        <figure className="essay-figure">
          <div className="max-w-sm mx-auto">
            {hydrated ? <PhaseWheel size={300} /> : (
              <div className="w-[300px] h-[300px] mx-auto flex items-center justify-center text-faint text-sm">
                Loading phase wheel&hellip;
              </div>
            )}
          </div>
          <figcaption>
            The eight phases of a single lunation. New moon at top, full moon at bottom.
            The golden pointer shows where we are right now.
          </figcaption>
        </figure>

        <div className="essay-prose">
          <p>
            Each lunation has a built-in structure. The first half &mdash; waxing &mdash;
            the moon grows brighter every night. The full moon marks the midpoint.
            Then the waning half, as it fades back to nothing. Four weeks, four quarters,
            an obvious and elegant division of time.
          </p>
          <p>
            The seven-day week almost certainly comes from this: each quarter of the
            moon lasts roughly seven days. Sunday to Saturday isn&rsquo;t arbitrary &mdash;
            it&rsquo;s a quarter-moon.
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          IV. THE BREAK
          ═══════════════════════════════════════════════ */}
      <section className="essay-section">
        <h2 className="essay-heading">The Break</h2>
        <div className="essay-prose">
          <p>
            In 46 BC, Julius Caesar hired the Alexandrian astronomer Sosigenes to
            redesign Rome&rsquo;s calendar. The old Roman calendar was lunar &mdash;
            and a mess. Priests had been manipulating the intercalary month for
            political advantage, and the calendar had drifted months from the actual
            seasons.
          </p>
          <p>
            Sosigenes&rsquo;s solution was radical: abandon the moon entirely. Make the
            year 365 days with a leap day every four years. Distribute days into
            12 months of 28&ndash;31 days, chosen for political and superstitious
            reasons (even numbers were unlucky in Rome), not astronomical ones.
          </p>
          <p>
            It worked brilliantly for keeping track of seasons. And it completely
            severed the connection between &ldquo;month&rdquo; and &ldquo;moon.&rdquo;
          </p>
          <p>
            We&rsquo;ve been using a modified version of Caesar&rsquo;s calendar for
            2,070 years. Most people alive today have never experienced the rhythm
            it replaced.
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          V. WHAT WE LOST — THE HIDDEN RHYTHM
          ═══════════════════════════════════════════════ */}
      <section className="essay-section">
        <h2 className="essay-heading">The Hidden Rhythm</h2>
        <div className="essay-prose">
          <p>
            But the moon didn&rsquo;t stop. It&rsquo;s still up there, cycling through its
            phases every {SYNODIC_MONTH} days, completely indifferent to our calendars.
            The rhythm is still happening &mdash; we just can&rsquo;t see it on a wall calendar.
          </p>
          <p>
            Here&rsquo;s what it looks like. Every cell below is one day of the current year,
            colored by moon illumination &mdash; brighter gold means a fuller moon.
            See the waves?
          </p>
        </div>

        <figure className="essay-figure essay-figure-wide">
          {hydrated ? <MoonHeatmap /> : (
            <div className="w-full h-32 flex items-center justify-center text-faint text-sm">
              Computing illumination data&hellip;
            </div>
          )}
          <figcaption>
            Every day of the year, colored by moon illumination. Each bright wave is a
            full moon; each dark trough is a new moon. The rhythm is as regular as breathing &mdash;
            roughly 29.5 days per cycle, 12 to 13 times per year.
          </figcaption>
        </figure>

        <div className="essay-prose">
          <p>
            That rhythm &mdash; those regular golden waves &mdash; is what the word
            &ldquo;month&rdquo; used to describe. Twelve and a half lunations per
            solar year, each one as predictable as the tides (which, not coincidentally,
            the moon also controls).
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          VI. THE SOLUTION — 13 × 28
          ═══════════════════════════════════════════════ */}
      <section className="essay-section essay-section-hero">
        <h2 className="essay-heading">Thirteen Months</h2>
        <div className="essay-prose">
          <p>
            Here is the year as the moon sees it.
          </p>
          <p>
            Below, each card is one <em>lunation</em> &mdash; one complete cycle from
            new moon to new moon. Day 1 is always the new moon. Day 7 is always the first
            quarter. Day 14 is always the full moon. Day 21 is always the third quarter.
            Day 28 wraps a perfect four-week month.
          </p>
          <p>
            Thirteen of these months give you 364 days &mdash; plus one
            &ldquo;Day Out of Time&rdquo; to complete the solar year.
          </p>
          <p className="text-accent-gold font-serif text-2xl sm:text-3xl text-center my-8">
            13 &times; 28 = 364 + 1 = 365
          </p>
          <p>
            Every month has the same structure. Every month starts the same way.
            The full moon is <em>always</em> mid-month. You never have to look up
            when the full moon is &mdash; it&rsquo;s the 14th and 15th, every month,
            forever.
          </p>
        </div>

        <figure className="essay-figure essay-figure-wide">
          {hydrated ? <YearCalendar /> : (
            <div className="w-full h-64 flex items-center justify-center text-faint text-sm">
              Building 13-month calendar&hellip;
            </div>
          )}
          <figcaption>
            The year as thirteen 28-day months. Each month starts at the new moon.
            Real lunations average {SYNODIC_MONTH} days &mdash; the extra ~1.5 days per month
            accumulate into the &ldquo;Day Out of Time&rdquo; at year&rsquo;s end.
            Toggle to &ldquo;Astronomical&rdquo; for real lunation lengths,
            or &ldquo;Solar&rdquo; to see lunar months overlaid on the Gregorian calendar.
          </figcaption>
        </figure>

        <div className="essay-prose">
          <p>
            Compare this to the Gregorian calendar. In the 13-month calendar,
            every month is identical. Every paycheck falls on the same dates.
            Every quarter is exactly 91 days. Planning is trivial.
          </p>
          <p>
            This isn&rsquo;t a new idea. The International Fixed Calendar, proposed by
            Moses B. Cotsworth in 1902 and championed by George Eastman (of Kodak),
            had exactly this structure. Kodak used it internally from 1928 to 1989.
            The League of Nations considered adopting it globally. It&rsquo;s been
            proposed to the UN multiple times.
          </p>
          <p>
            It never caught on, partly because of religious resistance (some sabbaths
            would need rescheduling), partly because of inertia. But the math doesn&rsquo;t
            care about politics. Thirteen months is what the moon gives us.
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          VII. YOUR LUNAR BIRTHDAY
          ═══════════════════════════════════════════════ */}
      <section className="essay-section">
        <h2 className="essay-heading">Your Lunar Birthday</h2>
        <div className="essay-prose">
          <p>
            Here&rsquo;s where it gets personal. Enter your birth date, and the rest of
            this essay adapts to you.
          </p>
        </div>

        <div className="flex justify-center my-8">
          <BirthDateInput />
        </div>

        {birthDate && (
          <div className="essay-prose">
            <p>
              In the lunar calendar, your birthday falls on a different Gregorian date
              every year. It drifts about 11 days earlier each year &mdash; because
              12 lunations add up to only 354 days, not 365.
            </p>
            <p>
              But here&rsquo;s the remarkable thing: after exactly 19 years &mdash; a period
              called the <em>Metonic cycle</em>, discovered by the Athenian astronomer
              Meton in 432 BC &mdash; the lunar and solar calendars realign almost perfectly.
              Your lunar birthday returns to nearly the same Gregorian date.
            </p>
            <p>
              The chart below shows this drift across 19 years. Gold bars mark where your
              lunar birthday falls each year. Violet bars mark leap years that insert
              a 13th month to correct the drift.
            </p>
          </div>
        )}

        <figure className="essay-figure essay-figure-wide">
          {hydrated ? <DriftChart /> : (
            <div className="w-full h-48 flex items-center justify-center text-faint text-sm">
              Calculating lunar drift&hellip;
            </div>
          )}
          <figcaption>
            {birthDate
              ? "Your lunar birthday drifting across 19 years. Gold bars = normal years, violet = years with a leap month (13 lunations). After 19 years, it returns to nearly the same Gregorian date."
              : "Enter your birth date above to see the 19-year Metonic cycle drift."}
          </figcaption>
        </figure>

        {!birthDate && (
          <div className="essay-prose">
            <p>
              Your birthday in the lunar calendar doesn&rsquo;t fall on the same Gregorian
              date each year. It drifts approximately 11 days earlier annually,
              then corrects with a leap month every 2&ndash;3 years. After 19 years
              (the Metonic cycle), it returns to nearly the same date. Enter your
              birth date above to see your personal drift pattern.
            </p>
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════
          VIII. THE LIVING CALENDAR — CHINESE ZODIAC
          ═══════════════════════════════════════════════ */}
      <section className="essay-section">
        <h2 className="essay-heading">The Living Calendar</h2>
        <div className="essay-prose">
          <p>
            While the West abandoned the moon, one major civilization never did.
            The Chinese calendar is a <em>lunisolar</em> calendar &mdash; months follow
            the moon, but leap months keep the whole system aligned with the sun
            and the seasons. It&rsquo;s been in continuous use for over 4,000 years.
          </p>
          <p>
            The twelve-animal zodiac cycle (Rat, Ox, Tiger&hellip;) is layered on top of
            a deeper system: the Heavenly Stems and Earthly Branches, a 60-year
            supercycle that combines 10 celestial stems with 12 terrestrial branches.
            Each year has an animal <em>and</em> an element (Wood, Fire, Earth, Metal, Water),
            creating a pattern that takes six decades to repeat.
          </p>
          <p>
            Click any animal below to explore its traits.
          </p>
        </div>

        <figure className="essay-figure essay-figure-wide">
          {hydrated ? <ZodiacWheel /> : (
            <div className="w-full h-64 flex items-center justify-center text-faint text-sm">
              Drawing zodiac wheel&hellip;
            </div>
          )}
          <figcaption>
            The twelve Chinese zodiac animals, colored by element. Your zodiac animal
            {birthDate ? " is highlighted based on your birth year" : " will highlight when you enter your birth date above"}.
            Click any animal to see traits and compatibility.
          </figcaption>
        </figure>

        <div className="essay-prose">
          <p>
            The Chinese calendar solves the fundamental problem that Caesar gave up on:
            how to reconcile the moon&rsquo;s 29.5-day cycle with the sun&rsquo;s 365.25-day
            year. The answer is leap months &mdash; roughly every three years, an extra
            lunation is inserted to keep the months in sync with the seasons. It&rsquo;s
            more complex than the Julian solution, but it preserves the lunar connection
            that the West lost.
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          IX. THE COSMIC CLOCK
          ═══════════════════════════════════════════════ */}
      <section className="essay-section">
        <h2 className="essay-heading">The Cosmic Clock</h2>
        <div className="essay-prose">
          <p>
            Eclipses are the most dramatic proof that these cycles are real and
            predictable. A solar eclipse means the moon has passed directly between
            Earth and Sun &mdash; which can only happen at a new moon. A lunar eclipse
            means Earth&rsquo;s shadow has fallen on the moon &mdash; which can only happen
            at a full moon.
          </p>
          <p>
            Ancient astronomers used eclipse records to discover the <em>Saros cycle</em>:
            after 18 years, 11 days, and 8 hours, the Sun, Earth, and Moon return to
            nearly the same relative positions, and the pattern of eclipses repeats.
            The Babylonians knew this. The Greeks used it to predict eclipses centuries
            in advance. We&rsquo;re still using the same orbital mechanics.
          </p>
        </div>

        <figure className="essay-figure">
          {hydrated ? <EclipseTimeline count={6} /> : (
            <div className="w-full h-48 flex items-center justify-center text-faint text-sm">
              Computing eclipse forecast&hellip;
            </div>
          )}
          <figcaption>
            The next six eclipses, computed from orbital mechanics. Solar eclipses
            always fall on a new moon; lunar eclipses always fall on a full moon.
          </figcaption>
        </figure>
      </section>

      {/* ═══════════════════════════════════════════════
          X. CODA
          ═══════════════════════════════════════════════ */}
      <section className="essay-section essay-coda">
        <div className="essay-prose">
          <p>
            The Gregorian calendar is a fine piece of engineering. It keeps the
            seasons in place, it&rsquo;s simple, and the whole world agrees on it.
            We&rsquo;re not going to replace it.
          </p>
          <p>
            But there&rsquo;s something lost when we can&rsquo;t feel the month anymore.
            When &ldquo;October 17th&rdquo; has no relationship to anything happening
            in the sky. When the full moon is a surprise because it isn&rsquo;t on
            anyone&rsquo;s calendar.
          </p>
          <p>
            The lunar calendar doesn&rsquo;t compete with the Gregorian calendar.
            It&rsquo;s a layer underneath it &mdash; the older, deeper rhythm that the
            sun calendar was built to replace but never fully erased. The tides
            still follow the moon. The months still bear its name.
          </p>
          <p>
            Thirteen months. Four weeks each. Every month the same.
            Day 1 is dark. Day 14 is bright. The pattern repeats forever.
          </p>
          <p className="text-accent-gold font-serif text-xl text-center mt-8">
            The moon is still keeping time. We just stopped listening.
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          FOOTER LINKS TO DEEP DIVES
          ═══════════════════════════════════════════════ */}
      <nav className="essay-deeplinks">
        <h3>Explore Further</h3>
        <div className="essay-deeplinks-grid">
          <a href="/calendar">
            <strong>Full Calendar</strong>
            <span>13-month calendar with astronomical mode, year picker, and illumination heatmap.</span>
          </a>
          <a href="/birthday">
            <strong>Lunar Birthday</strong>
            <span>Your birth moon phase, lunar birthday dates, and full 19-year drift chart.</span>
          </a>
          <a href="/zodiac">
            <strong>Chinese Zodiac</strong>
            <span>Interactive zodiac wheel with traits, compatibility, and element cycles.</span>
          </a>
          <a href="/eclipses">
            <strong>Eclipse Forecast</strong>
            <span>Full timeline of upcoming lunar and solar eclipses with type and visibility.</span>
          </a>
          <a href="/crescent">
            <strong>Crescent Predictor</strong>
            <span>When will the moon&rsquo;s horns point up? Bowl crescent forecast for your location.</span>
          </a>
        </div>
      </nav>
    </article>
  );
}
