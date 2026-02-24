"use client";

import { CrescentPredictor } from "@/components/viz/CrescentPredictor";
import { useHydrated } from "@/lib/hooks";

export default function CrescentPage() {
  const hydrated = useHydrated();

  return (
    <article className="essay">
      <header className="essay-hero">
        <h1 className="essay-title">
          When the Moon Holds Water
        </h1>
        <p className="essay-subtitle">
          Predicting the &ldquo;wet moon&rdquo; &mdash; when the crescent tips back and the horns point up.
        </p>
      </header>

      <section className="essay-section">
        <div className="essay-prose">
          <p className="essay-lede">
            Sometimes the crescent moon lies on its back like a bowl, horns pointing
            straight up. The old name for this is the <em>wet moon</em> &mdash; a crescent
            that could hold water. Other nights it stands upright like a letter D, or
            tips forward like a frown.
          </p>
          <p>
            What determines the orientation isn&rsquo;t mystical &mdash; it&rsquo;s geometry.
            The bright limb of the crescent always points toward the sun. How that
            translates into &ldquo;horns up&rdquo; or &ldquo;horns sideways&rdquo; depends
            on three things: the angle between the moon and sun on the celestial sphere,
            the observer&rsquo;s latitude, and the time of year.
          </p>
        </div>
      </section>

      <section className="essay-section">
        <h2 className="essay-heading">The Geometry</h2>
        <div className="essay-prose">
          <p>
            The key concept is the <em>position angle of the bright limb</em>: the direction
            from the moon&rsquo;s center to the brightest point on its edge, measured from
            celestial north. But celestial north isn&rsquo;t &ldquo;up&rdquo; in your sky &mdash;
            it&rsquo;s rotated by an amount called the <em>parallactic angle</em>, which
            depends on your latitude and where the moon is in the sky.
          </p>
          <p>
            Subtract the parallactic angle from the position angle, and you get the
            <em> tilt</em> &mdash; how the bright limb is oriented relative to
            &ldquo;up&rdquo; as you see it. When the bright limb points straight down,
            the cusps (horns) point straight up: a perfect bowl.
          </p>
          <p>
            This happens most often in the tropics. Near the equator, the ecliptic
            (the sun and moon&rsquo;s path) sets nearly vertically, which pushes the
            bright limb below the crescent and the cusps upward. At high latitudes,
            the ecliptic tilts, and the crescent tends to stand on its side.
          </p>
        </div>
      </section>

      <section className="essay-section">
        <h2 className="essay-heading">Your Crescent Forecast</h2>
        <div className="essay-prose">
          <p>
            The predictor below computes the crescent orientation for your location
            using the same orbital mechanics as the rest of this site. Pick a city
            (or use your device&rsquo;s GPS) and see when the next bowl crescents will
            appear in your sky.
          </p>
          <p>
            The &ldquo;cuspsUp&rdquo; score ranges from +1 (perfect bowl, horns straight
            up) to &minus;1 (perfect frown, horns straight down). Anything above +0.5
            is a satisfying bowl crescent; above +0.8 is striking.
          </p>
        </div>

        <figure className="essay-figure essay-figure-wide">
          {hydrated ? (
            <CrescentPredictor />
          ) : (
            <div className="w-full h-48 flex items-center justify-center text-faint text-sm">
              Computing crescent forecast&hellip;
            </div>
          )}
        </figure>
      </section>

      <section className="essay-section essay-coda">
        <div className="essay-prose">
          <p>
            The Hawaiian word for the crescent moon is <em>mahina hoaka</em> &mdash;
            &ldquo;bright crescent.&rdquo; In many tropical cultures, the bowl-shaped
            crescent is the default image of the moon. It&rsquo;s the crescent on the
            flags of Turkey and Pakistan, on mosque domes, on the Dreamworks logo.
          </p>
          <p>
            At higher latitudes &mdash; London, Stockholm, Anchorage &mdash; the
            crescent more often stands upright, like a Cheshire Cat smile turned
            sideways. The orientation is so latitude-dependent that ancient navigators
            could estimate their north-south position from how the moon&rsquo;s horns tilted.
          </p>
          <p className="text-accent-gold font-serif text-xl text-center mt-8">
            Every crescent tells you where you are on Earth.
          </p>
        </div>
      </section>
    </article>
  );
}
