// PRIOR ART: moved out of build-controls.mjs (#5829) unchanged, so #6121's controls plant the same
// error shapes. R is the caller's seeded rng; the draw order is the same as before the move.
import { shuffle } from './common.mjs';

export function makePlanters(R) {
  // Planting. Each works on one body sentence (outside <note>/<term>/<summary>), and returns the sentence before/after.
  const FLIPS = [[/\bis not\b/, 'is'], [/\bare not\b/, 'are'], [/\bdoes not\b/, 'does'], [/\bdo not\b/, 'do'], [/\bcannot\b/, 'can'],
    [/\bis\b/, 'is not'], [/\bare\b/, 'are not'], [/\bexists\b/, 'does not exist'], [/\bwill\b/, 'will not']];
  const TERMS = [['emptiness', 'impermanence'], ['impermanence', 'emptiness'], ['inference', 'direct perception'], ['valid cognition', 'conceptual thought'],
    ['afflictions', 'aggregates'], ['aggregates', 'sense bases'], ['merit', 'wisdom'], ['compassion', 'equanimity'], ['liberation', 'rebirth'],
    ['nirvana', 'samsara'], ['nirvāṇa', 'saṃsāra'], ['saṃsāra', 'nirvāṇa'], ['mandala', 'stupa'], ['maṇḍala', 'stūpa'], ['mantra', 'mudra'], ['mudra', 'mantra'],
    ['ultimate', 'conventional'], ['conventional', 'ultimate'], ['cessation', 'arising'], ['monk', 'novice'], ['concentration', 'discernment'],
    ['consciousness', 'feeling'], ['wisdom', 'faith'], ['Hearers', 'Bodhisattvas'], ['śrāvakas', 'bodhisattvas'], ['perception', 'inference'],
    ['deity', 'disciple'], ['offence', 'merit'], ['offense', 'merit'], ['bliss', 'pain'], ['vows', 'offerings'], ['meditation', 'recitation']];
  const COMMON = new Set(['The', 'This', 'That', 'These', 'Those', 'If', 'When', 'In', 'It', 'As', 'For', 'Therefore', 'Thus', 'Because', 'However', 'But', 'And', 'Since', 'One', 'Why', 'What', 'How', 'Here', 'There', 'Regarding', 'Furthermore', 'Moreover', 'Likewise', 'Similarly', 'Then', 'Now', 'Even', 'Also', 'Although', 'Thereby', 'Again', 'Accordingly', 'Hence', 'Some', 'Other', 'Others', 'Such', 'Whoever', 'Whatever', 'Not', 'Just', 'With', 'From', 'By', 'To', 'On', 'At', 'Of', 'Is', 'Are', 'Do', 'Does', 'He', 'She', 'They', 'We', 'You', 'I', 'His', 'Her', 'Their', 'Our', 'Your', 'My', 'Its', 'All', 'Each', 'Every', 'No', 'Neither', 'Either', 'Both', 'Teacher', 'Buddha', 'Blessed', 'One']);
  function bodySentences(en) {
    const body = en.replace(/<(summary|keywords|meta)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<(note|term)>[\s\S]*?<\/\1>/g, '\u0000');
    return body.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.length > 50 && s.length < 450 && !s.includes('\u0000') && !/[<>]/.test(s));
  }
  function plantReversal(en) {
    for (const s of shuffle(bodySentences(en), R)) for (const [pat, rep] of FLIPS) if (pat.test(s)) { const ns = s.replace(pat, rep); return { old: s, new: ns, how: `${pat.source} → ${rep}` }; }
    return null;
  }
  // Agent swap: who speaks or acts. Pronoun/role swaps first (speaker and questioner errors are the
  // observed shape in #5797 and #5800); else two person names in one sentence, swapped.
  const NOT_AGENTS = /^(Dharma|Jewel|Jewels|Light|Radiant|Sangha|Saṅgha|Buddhahood|Vajra|Mantra|Mahayana|Mahāyāna|Great|Vehicle|Perfection|Wisdom|Truth|Truths|Noble|Mind|Body|Speech|Mount|Mountain|Sutra|Sūtra|Tantra|Chapter|Section|Realm|Heaven|Land|Pure|Wheel|Tathagata's|Dharma's)$/;
  function plantAgent(en) {
    const sents = shuffle(bodySentences(en), R);
    const V = '(?:have|had|said|say|declare|explain|ask|teach|will|shall|did|can|must|should|would|know|see|state|maintain|hold|accept|assert|claim|think)';
    const PAIRS = [[/\bI am\b/, 'you are'], [/\b[Yy]ou are\b/, 'I am'], [/\bI was\b/, 'you were'], [/\b[Yy]ou were\b/, 'I was'],
      [new RegExp(`\\bI (${V})\\b`), 'you $1'], [new RegExp(`\\b[Yy]ou (${V})\\b`), 'I $1'], [/\b[Ww]e (have|had|said|say|explain|ask|teach|hold|accept|assert|maintain|think)\b/, 'you $1'],
      [/\bthe opponent\b/, 'we'], [/\bthe disciple\b/, 'the teacher'], [/\bthe teacher\b/, 'the disciple'], [/\bthe master\b/, 'the student'], [/\bthe student\b/, 'the master']];
    const cap = (s, i, r) => (i === 0 || /[."':]\s*$/.test(s.slice(0, i)) ? r[0].toUpperCase() + r.slice(1) : r);
    for (const s of sents) for (const [pat, rep] of PAIRS) {
      const m = s.match(pat);
      if (m) { const r = cap(s, m.index, m[0].replace(pat, rep)); return { old: s, new: s.slice(0, m.index) + r + s.slice(m.index + m[0].length), how: `${pat.source} → ${rep}` }; }
    }
    for (const s of sents) {
      const names = [...new Set([...s.matchAll(/(?<=\s)([A-ZĀĪŪŚṢṆṬḌṚ][\p{L}\u0300-\u036f-]{3,}(?:\s[A-ZĀĪŪŚṢṆṬḌṚ][\p{L}\u0300-\u036f-]{3,})?)/gu)].map((m) => m[1]))]
        .filter((n) => !COMMON.has(n.split(' ')[0]) && !n.split(' ').some((w) => NOT_AGENTS.test(w)));
      if (names.length >= 2) {
        const [a, b] = names; const tmp = '\u0001';
        const ns = s.replace(a, tmp).replace(b, a).replace(tmp, b);
        if (ns !== s) return { old: s, new: ns, how: `swap ${a} ↔ ${b}` };
      }
    }
    return null;
  }
  function plantTerm(en) {
    for (const s of shuffle(bodySentences(en), R)) for (const [a, b] of shuffle(TERMS, R)) {
      const re = new RegExp(`\\b${a}\\b`);
      if (re.test(s)) { const ns = s.replace(re, b); return { old: s, new: ns, how: `${a} → ${b}` }; }
    }
    return null;
  }

  return { plantReversal, plantAgent, plantTerm, bodySentences };
}
