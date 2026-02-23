"use client";

import { useState, useMemo } from "react";
import { useAppState } from "@/lib/store";
import { ZODIAC_ANIMALS, ZODIAC_TRAITS, ZODIAC_ANIMAL_EMOJIS } from "@/lib/constants";
import { getZodiacInfo } from "@/lib/lunar";

const ELEMENTS = ["Wood", "Fire", "Earth", "Metal", "Water"];
const ELEMENT_CSS: Record<string, string> = {
  Wood: "var(--accent-sage)",
  Fire: "var(--accent-rust)",
  Earth: "var(--accent-gold)",
  Metal: "#d4cfc4",
  Water: "var(--accent-violet)",
};

export function ZodiacWheel() {
  const { birthDate } = useAppState();
  const [selectedAnimal, setSelectedAnimal] = useState<string | null>(null);

  const userZodiac = useMemo(() => {
    if (!birthDate) return null;
    try {
      const bd = new Date(birthDate.getTime());
      return getZodiacInfo(bd.getFullYear(), bd);
    } catch {
      return null;
    }
  }, [birthDate]);

  const activeAnimal = selectedAnimal || userZodiac?.animal || null;
  const traits = activeAnimal ? ZODIAC_TRAITS[activeAnimal] : null;

  const cx = 200;
  const cy = 200;
  const outerR = 180;
  const innerR = 100;

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* Wheel */}
      <div className="flex-shrink-0">
        <svg width={400} height={400} viewBox="0 0 400 400" className="max-w-full h-auto">
          {ZODIAC_ANIMALS.map((animal, i) => {
            const startAngle = (i * 30 - 90) * (Math.PI / 180);
            const endAngle = ((i + 1) * 30 - 90) * (Math.PI / 180);
            const midAngle = ((i + 0.5) * 30 - 90) * (Math.PI / 180);

            // Determine element (cycles every 2 years in the traditional sequence)
            const elementIndex = Math.floor(((i + 0) % 10) / 2);
            const element = ELEMENTS[elementIndex];
            const color = ELEMENT_CSS[element];

            const isActive = animal === activeAnimal;
            const isUser = animal === userZodiac?.animal;

            const x1 = cx + outerR * Math.cos(startAngle);
            const y1 = cy + outerR * Math.sin(startAngle);
            const x2 = cx + outerR * Math.cos(endAngle);
            const y2 = cy + outerR * Math.sin(endAngle);
            const x3 = cx + innerR * Math.cos(endAngle);
            const y3 = cy + innerR * Math.sin(endAngle);
            const x4 = cx + innerR * Math.cos(startAngle);
            const y4 = cy + innerR * Math.sin(startAngle);

            const path = `M ${x1} ${y1} A ${outerR} ${outerR} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 0 0 ${x4} ${y4} Z`;

            const labelR = (outerR + innerR) / 2;
            const labelX = cx + labelR * Math.cos(midAngle);
            const labelY = cy + labelR * Math.sin(midAngle);

            const emojiR = outerR + 12;
            const emojiX = cx + emojiR * Math.cos(midAngle);
            const emojiY = cy + emojiR * Math.sin(midAngle);

            return (
              <g
                key={animal}
                onClick={() => setSelectedAnimal(animal === selectedAnimal ? null : animal)}
                style={{ cursor: "pointer" }}
              >
                <path
                  d={path}
                  fill={color}
                  opacity={isActive ? 0.7 : 0.25}
                  stroke={isUser ? "var(--accent-gold)" : "var(--color-border)"}
                  strokeWidth={isUser ? 2.5 : 0.5}
                />
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11}
                  fontFamily="var(--font-sans)"
                  fill={isActive ? "var(--color-cream)" : "var(--color-muted)"}
                  fontWeight={isActive ? 600 : 400}
                >
                  {animal}
                </text>
                <text
                  x={emojiX}
                  y={emojiY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={16}
                >
                  {ZODIAC_ANIMAL_EMOJIS[animal]}
                </text>
              </g>
            );
          })}

          {/* Center label */}
          <text
            x={cx}
            y={cy - 10}
            textAnchor="middle"
            fontSize={14}
            fill="var(--color-cream)"
            fontFamily="var(--font-serif)"
            fontWeight={600}
          >
            {activeAnimal || "Chinese"}
          </text>
          <text
            x={cx}
            y={cy + 10}
            textAnchor="middle"
            fontSize={11}
            fill="var(--color-muted)"
            fontFamily="var(--font-sans)"
          >
            {activeAnimal ? (userZodiac?.element || "") : "Zodiac"}
          </text>
        </svg>
      </div>

      {/* Traits panel */}
      <div className="flex-1 min-w-0">
        {traits && activeAnimal ? (
          <div className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">
                {ZODIAC_ANIMAL_EMOJIS[activeAnimal]}
              </span>
              <div>
                <h3 className="font-serif text-xl font-semibold text-cream">{activeAnimal}</h3>
                {userZodiac && activeAnimal === userZodiac.animal && (
                  <span className="text-xs text-accent-gold">Your zodiac animal</span>
                )}
              </div>
            </div>

            <div>
              <div className="text-faint text-xs uppercase tracking-wider mb-1">Personality</div>
              <p className="text-cream text-sm">{traits.personality}</p>
            </div>

            <div>
              <div className="text-faint text-xs uppercase tracking-wider mb-1">Strengths</div>
              <p className="text-cream text-sm">{traits.strengths.join(", ")}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-faint text-xs uppercase tracking-wider mb-1">Compatible</div>
                <div className="flex flex-wrap gap-1">
                  {traits.compatible.map((a) => (
                    <span key={a} className="text-xs bg-accent-sage/15 text-accent-sage px-2 py-0.5 rounded">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-faint text-xs uppercase tracking-wider mb-1">Incompatible</div>
                <div className="flex flex-wrap gap-1">
                  {traits.incompatible.map((a) => (
                    <span key={a} className="text-xs bg-accent-rust/15 text-accent-rust px-2 py-0.5 rounded">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-faint text-xs uppercase tracking-wider mb-1">Lucky Numbers</div>
                <p className="text-cream text-sm">{traits.lucky_numbers.join(", ")}</p>
              </div>
              <div>
                <div className="text-faint text-xs uppercase tracking-wider mb-1">Lucky Colors</div>
                <p className="text-cream text-sm">{traits.lucky_colors.join(", ")}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
            <p className="text-muted">Click an animal on the wheel to see its traits.</p>
            {!birthDate && (
              <p className="text-faint text-sm mt-2">Or enter your birth date to highlight your zodiac animal.</p>
            )}
          </div>
        )}

        {/* Element legend */}
        <div className="flex flex-wrap gap-3 mt-4 text-xs text-faint">
          {ELEMENTS.map((el) => (
            <span key={el} className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ background: ELEMENT_CSS[el], opacity: 0.6 }}
              />
              {el}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
