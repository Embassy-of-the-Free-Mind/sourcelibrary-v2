import { describe, it, expect } from 'vitest';
import {
  renderRubric, routeBook, postSearchRoute, traditionRulesFor,
  FAILURE_MODES, POLICY_RULES, HARD_CLASS_SIGNALS,
} from '@/lib/first-translation/casebook';

describe('casebook rubric (#3778 — the fourth memory-bank layer)', () => {
  it('always carries every failure mode and policy rule', () => {
    const r = renderRubric({ language: 'Latin' });
    for (const rule of FAILURE_MODES) expect(r).toContain(rule.rule);
    for (const rule of POLICY_RULES) expect(r).toContain(rule.rule);
  });

  it('selects tradition rules by source language', () => {
    expect(traditionRulesFor('Chinese').map((r) => r.id)).toContain('cjk_catalogue_blind');
    expect(traditionRulesFor('Tibetan').map((r) => r.id)).toContain('tibetan_practitioner_pdfs');
    expect(traditionRulesFor('Latin').map((r) => r.id)).toContain('latin_greek_modern_imprints');
    expect(traditionRulesFor('Chinese').map((r) => r.id)).not.toContain('tibetan_practitioner_pdfs');
  });

  it('original_language wins over the edition language for the rubric', () => {
    // books.language is the language of the WORK we hold, not necessarily the
    // source tradition — original_language is the tradition when present.
    const r = renderRubric({ language: 'German', original_language: 'Hebrew' });
    expect(r).toContain('Kabbalistic and rabbinic titles collide');
  });
});

describe('casebook routing — hard classes never pay for rung 2', () => {
  it('routes hard-class screen signals to claude', () => {
    const d = routeBook({ title: 'Opera omnia' }, ['container_title']);
    expect(d.route).toBe('claude');
    expect(d.reasons).toEqual(['hard_class:container_title']);
  });

  it('every hard-class signal is a real detector code', () => {
    // Guards against drift between the casebook and ft-demote-screen.mjs.
    const known = new Set([
      'item_is_a_witness', 'work_plus_apparatus', 'container_title', 'no_named_translator',
      'amalgamated_translator', 'prior_is_a_study', 'prior_without_year',
      'no_complete_prior_claimed', 'first_modern_candidate',
    ]);
    for (const s of HARD_CLASS_SIGNALS) expect(known.has(s)).toBe(true);
  });

  it('clean screen → gemini', () => {
    expect(routeBook({ title: 'A single work' }, []).route).toBe('gemini');
    // Prior-shaped signals (fabrication signatures) stay at gemini — verifying
    // whether a citation exists is exactly what rung 2 is for.
    expect(routeBook({ title: 'X' }, ['no_named_translator']).route).toBe('gemini');
  });

  it('practitioner-source priors are a HUMAN policy hold, not a verdict', () => {
    const d = postSearchRoute([
      { english_title: 'Gates of Light', source_url: 'https://www.sefaria.org/Shaarei_Orah' },
    ]);
    expect(d.route).toBe('human');
    expect(d.reasons[0]).toContain('practitioner_source');
    expect(postSearchRoute([{ english_title: 'X', source_url: 'https://archive.org/x' }]).route).toBe('gemini');
  });
});
