#!/usr/bin/env python3
# PRIOR ART: none — looked in scripts/eval/estimator/ (no test beside build.py, allocate_v2.py or route_ocr_v1.py).
"""The router table's pick (#6740): dollars per ACCEPTED page, idle quota free this week.

  python3 -m unittest scripts/eval/estimator/router-table/test_pick.py   (repo root)
"""
import importlib.util, os, unittest

spec = importlib.util.spec_from_file_location('build', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
P = {'switch': {'within': 0.05, 'p': 0.9, 'wrong_text_max': 0.02}, 'hold': {'acc': 0.8, 'p': 0.9}}
WT = lambda best: P['switch']['wrong_text_max']
STEADY = lambda r: r['_usd_acc']
WEEK = lambda r: r['_usd_acc'] * (1 - r['idle_fit'])


def route(rid, acc, usd_raw, idle_fit=0.0, n=30):
    """A measured route with a tight posterior at `acc`, priced at usd_raw dollars per raw page."""
    d = [acc - 0.01, acc, acc + 0.01] * 100
    return dict(id=rid, mean=acc, _d=d, wrong=0, wrate=0.0, n=n, p80=sum(v >= 0.8 for v in d) / len(d),
                _usd_raw=usd_raw, _usd_acc=usd_raw / acc, idle_fit=idle_fit)


class Pick(unittest.TestCase):
    def test_cheaper_per_raw_page_loses_per_accepted_page(self):
        draft = route('draft', 0.60, 0.0)                        # free but fails the gate (0.32 below the best)
        a = route('a', 0.88, 0.0100)                             # cheaper per raw page: $0.01136 per accepted page
        b = route('b', 0.92, 0.0103)                             # dearer per raw page:  $0.01120 per accepted page
        M = [draft, a, b]
        self.assertEqual({r['id'] for r in B.gate(M, P, WT, 0.05)[1]}, {'a', 'b'})
        self.assertEqual(min([a, b], key=lambda r: r['_usd_raw'])['id'], 'a')   # the old per-raw-page rule
        dec, pk = B.decide({}, M, draft, P, STEADY, WT)
        self.assertEqual((dec, pk['id']), ('switch', 'b'))

    def test_idle_quota_flips_the_choice(self):
        draft = route('draft', 0.50, 0.0)
        agy = route('agy', 0.90, 0.0009)                         # agy call: cheap
        opus = route('opus', 0.93, 0.0018)                       # Opus points: twice the price
        M = [draft, agy, opus]
        self.assertEqual(B.decide({}, M, draft, P, STEADY, WT)[1]['id'], 'agy')
        opus['idle_fit'] = 1.0                                   # the whole cell fits in Claude's idle share
        self.assertEqual(B.decide({}, M, draft, P, WEEK, WT)[1]['id'], 'opus')
        opus['idle_fit'] = 0.4                                   # only 40% fits: 0.6 x $0.00194 > $0.0010
        self.assertEqual(B.decide({}, M, draft, P, WEEK, WT)[1]['id'], 'agy')

    def test_free_tie_goes_to_higher_acceptance(self):
        lo, hi = route('lo', 0.90, 0.0010, idle_fit=1.0), route('hi', 0.93, 0.0020, idle_fit=1.0)
        self.assertEqual(B.pick([lo, hi], lo, WEEK)['id'], 'hi')

    def test_hold_floor_kept(self):
        r = route('r', 0.70, 0.001)
        self.assertEqual(B.decide({}, [r], r, P, STEADY, WT)[0], 'HOLD')


class Paired(unittest.TestCase):
    """#7701: two arms judged on the SAME pages are compared by their paired outcomes, not as independent posteriors."""
    Q = {'switch': {'within': 0.08, 'p': 0.9, 'wrong_text_max': 0.04}, 'hold': {'acc': 0.8, 'p': 0.9}}

    def beta_route(self, rid, k, n, seed):
        import random
        rng = random.Random(seed); d = [rng.betavariate(1 + k, 1 + n - k) for _ in range(20000)]
        return dict(id=rid, mean=sum(d) / len(d), _d=d, wrate=0.0, wrong=0, n=n)

    def test_identical_kn_on_shared_pages_passes_paired_not_independent(self):
        import random
        # #7701 German: read@4 (cheap) and read@4>correct (best) both 23/24 written, on the same 24 pages
        cheap, best = self.beta_route('read@4', 23, 24, 1), self.beta_route('read@4>agy', 23.2, 24, 2)
        best['mean'] = cheap['mean'] + 0.001
        WTQ = lambda b: 0.04
        self.assertNotIn('read@4', [r['id'] for r in B.gate([cheap, best], self.Q, WTQ, 0.08)[1]])   # the independent gate refuses
        # the two arms accept and refuse the same pages: paired, the cheaper one passes
        pd = B.paired_draws({'both': 23, 'a_only': 0, 'b_only': 0, 'neither': 1}, 20000, random.Random(7701))
        cheap['_pd'] = {best['id']: pd}; best['_pd'] = {cheap['id']: [-x for x in pd]}
        self.assertGreater(B.within_p(cheap, best, 0.08), 0.9)
        self.assertIn('read@4', [r['id'] for r in B.gate([cheap, best], self.Q, WTQ, 0.08)[1]])
        # one page each way at n = 24 is still too few pages to say (the honest flat prior): 0.88
        pd1 = B.paired_draws({'both': 22, 'a_only': 1, 'b_only': 1, 'neither': 0}, 20000, random.Random(7701))
        self.assertLess(B.within_p(dict(cheap, _pd={best['id']: pd1}), best, 0.08), 0.9)
        # at n = 60 (the brief's German cell), two pages each way passes
        pd2 = B.paired_draws({'both': 55, 'a_only': 2, 'b_only': 2, 'neither': 1}, 20000, random.Random(7701))
        self.assertGreater(B.within_p(dict(cheap, _pd={best['id']: pd2}), best, 0.08), 0.95)

    def test_paired_losses_still_fail(self):
        import random
        cheap, best = self.beta_route('a', 19, 24, 3), self.beta_route('b', 24, 24, 4)
        pd = B.paired_draws({'both': 19, 'a_only': 0, 'b_only': 5, 'neither': 0}, 20000, random.Random(1))
        cheap['_pd'] = {'b': pd}
        self.assertLess(B.within_p(cheap, best, 0.08), 0.9)

    def test_paired_draws_mean_and_book_scaling(self):
        import random
        pd = B.paired_draws({'both': 50, 'a_only': 6, 'b_only': 2, 'neither': 2}, 20000, random.Random(5))
        self.assertAlmostEqual(sum(pd) / len(pd), (1 + 6 - 1 - 2) / (4 + 60), delta=0.005)
        wide = B.paired_draws({'both': 50, 'a_only': 6, 'b_only': 2, 'neither': 2}, 20000, random.Random(5), scale=0.25)
        sd = lambda xs: (sum((x - sum(xs) / len(xs)) ** 2 for x in xs) / len(xs)) ** 0.5
        self.assertGreater(sd(wide), sd(pd))   # fewer books than pages: a wider difference


class DefectRule(unittest.TestCase):
    """#6740: defects per 1,000 words decide (rules.json decision_rule), k/n acceptance is the floor and the fallback."""
    Q = {'switch': {'bar': 'opus', 'within': 0.08, 'p': 0.9, 'wrong_text_max': 0.04}, 'hold': {'acc': 0.8, 'p': 0.9},
         'decision_rule': {'in_force': 'defects', 'misleads_usd': 0.01, 'misleads_usd_sensitivity': [0.001, 0.1], 'wrong_text_weight': 3,
                           'wrong_text_delta_per_1k': 0.15, 'ceiling_per_1k': 1.0, 'ceiling_p': 0.9, 'accept_floor': {'within': 0.05, 'p': 0.5}, 'min_books': 10}}
    CAL = {'misleads': 0.625, 'wrong_text': 0.8}

    def r(self, rid, acc, usd_raw, wt, ml, books=30, words=250, channel='agy'):
        d = route(rid, acc, usd_raw)
        d.update(channel=channel, defects=None if wt is None else dict(books=books, median_words_per_page=words,
                 wrong_text_per_1k_posterior=[wt / 2, wt, wt * 2], misleads_per_1k_posterior=[ml / 2, ml, ml * 2],
                 wrong_text_per_1k_gamma=[max(wt, 0.01) * 50, 50]))
        return d

    def decide(self, rs, live, cur=None, cell=None):
        return B.decide_defects(cell or {'id': 'c'}, rs, rs, cur or live, live['id'], self.Q, self.CAL)

    def test_fewer_defects_switch_where_kn_keeps(self):
        # k/n: both accepted ~0.92, the cheaper live route keeps; per word the dearer one has a fifth of the misleads
        live = self.r('live', 0.92, 0.0004, wt=0.6, ml=4.0)
        alt = self.r('alt', 0.92, 0.0008, wt=0.2, ml=0.8)
        dec, pk, info = self.decide([live, alt], live)
        self.assertEqual((dec, pk['id']), ('switch', 'alt'))
        self.assertEqual(info['picks'], {'0.001': 'alt', '0.01': 'alt', '0.1': 'alt'})

    def test_wrong_text_gate_refuses(self):
        live = self.r('live', 0.92, 0.0008, wt=0.2, ml=1.0)
        cheap = self.r('cheap', 0.95, 0.0, wt=0.6, ml=0.1)        # 0.8 x 0.6 > 0.8 x 0.2 + 0.15: fails, though free
        dec, pk, info = self.decide([live, cheap], live)
        self.assertEqual((dec, pk['id']), ('keep', 'live'))
        self.assertFalse(info['gates']['cheap']['wrong_text'])

    def test_acceptance_floor_kept(self):
        live = self.r('live', 0.95, 0.0008, wt=0.3, ml=3.0)
        worse = self.r('worse', 0.85, 0.0004, wt=0.1, ml=0.5)      # fewer defects but 10 points below on accept
        dec, pk, info = self.decide([live, worse], live)
        self.assertEqual(pk['id'], 'live')
        self.assertFalse(info['gates']['worse']['accept'])

    def test_a_pick_that_moves_with_the_weight_is_hold(self):
        live = self.r('live', 0.92, 0.0004, wt=0.3, ml=3.0, words=250)
        alt = self.r('alt', 0.92, 0.0012, wt=0.1, ml=1.0, words=250)   # weighted defects a page 0.65 vs 0.22: break-even ~$0.0019
        dec, pk, info = self.decide([live, alt], live)
        self.assertEqual(info['picks'], {'0.001': 'live', '0.01': 'alt', '0.1': 'alt'})
        self.assertTrue(dec.startswith('HOLD (defects'))

    def test_falls_back_to_kn(self):
        live = self.r('live', 0.92, 0.0004, wt=None, ml=None)
        alt = self.r('alt', 0.92, 0.0008, wt=0.2, ml=0.8)
        self.assertEqual(self.decide([live, alt], live)[0], None)
        self.assertIn('no defect verdicts', self.decide([live, alt], live)[2]['why'])
        few = self.r('live', 0.92, 0.0004, wt=0.6, ml=4.0, books=9)
        self.assertIn('no defect verdicts', self.decide([few, alt], few)[2]['why'])           # < min_books
        self.assertIn('no other route', self.decide([self.r('live', 0.9, 0, 0.2, 1.0)], self.r('live', 0.9, 0, 0.2, 1.0))[2]['why'])
        self.assertIn('manuscript', self.decide([live, alt], live, cell={'id': 'c', 'script': 'manuscript'})[2]['why'])

    def test_opus_is_a_bar_not_a_candidate_unless_live(self):
        live = self.r('lite>agy', 0.90, 0.0008, wt=0.6, ml=2.0)
        opus = self.r('lite>opus', 0.96, 0.0010, wt=0.1, ml=0.5, channel='claude')
        self.assertIn('no other route', self.decide([live, opus], live)[2]['why'])   # in print Opus is the bar, never a candidate
        dec, pk, _ = self.decide([live, opus], opus)
        self.assertEqual(pk['id'], 'lite>opus')     # the live Opus route is kept against a worse agy route


class Size(unittest.TestCase):
    Z = {'output_weight': 5, 'overhead': {'in': 10000, 'out': 0}, 'min_pages_for_measured_cpt': 30, 'english_chars_per_token': 4.0,
         'chars_per_token_default': {'other': 2.0}, 'pages_per_call': {'single': 10, 'multi': 5}}
    def cell(self, chars, multi=0.0):
        return {'language': 'Latin', 'draft_chars': {'median': chars, 'p90': chars}, 'image_tokens': {'median': 1000, 'p90': 1000},
                'gemini_chars_per_output_token': {'median': None, 'n': 0}, 'multi_column_share': multi}

    def test_batching_saves_overhead_only(self):
        K = {'overhead_eq': 10000, 'central': {'correct': 1e-6}, 'low': 1e-6, 'high': 1e-6}
        st = {'size': 'correct', 'pages_per_call': 'layout'}
        single, multi = B.size_points(st, self.cell(2000), self.Z, K), B.size_points(st, self.cell(2000, 1.0), self.Z, K)
        self.assertAlmostEqual(single['central'], 1e-6 * (10000 / 10 + 1000 + 1000 + 5 * 1000))   # 2,000 chars = 1,000 tokens
        self.assertAlmostEqual(multi['central'] - single['central'], 1e-6 * (10000 / 5 - 10000 / 10))
        self.assertEqual(multi['pages_per_call'], 5)

    def test_bigger_page_costs_more(self):
        K = {'overhead_eq': 10000, 'central': {'correct': 1e-6}, 'low': 1e-6, 'high': 1e-6}
        st = {'size': 'correct', 'pages_per_call': 'layout'}
        self.assertGreater(B.size_points(st, self.cell(6000), self.Z, K)['central'], B.size_points(st, self.cell(500), self.Z, K)['central'])


class Units(unittest.TestCase):
    def test_one_unit(self):
        rates = dict(claude=0.5, agy_month=200)
        self.assertAlmostEqual(B.usd_per_page({'channel': 'claude', 'points': 0.004}, rates), 0.002)
        self.assertAlmostEqual(B.usd_per_page({'channel': 'agy', 'draw': 1.02, 'agy_share': 4.45e-06}, rates), 1.02 * 4.45e-06 * 200)
        self.assertEqual(B.usd_per_page({'channel': None, 'draw': 0, 'api_usd': 0}, rates), 0.0)
        self.assertEqual(B.usd_per_page({'channel': None, 'paid': True, 'api_usd': 0.08}, rates), 0.08)



class LatentCrashes(unittest.TestCase):
    """#7263 audit 2026-11-01: n = 0 evidence and api_usd = None on a paid stage crashed the build."""
    src = lambda self, k, n, books, w=0, **kw: dict(accept=f'{k}/{n}', wrong_text_pages=f'{w}/{n}', books=books, classes_k_of_n={}, **kw)

    def test_zero_page_source_is_dropped(self):
        x = B.pool_sources([self.src(0, 0, 0), self.src(9, 10, 5, w=1)], True)
        self.assertEqual((x['accept'], x['sources']), ('9/10', 1))
        self.assertAlmostEqual(x['eff'][1], 5.0)                        # 10 pages in 5 books: 5 book-scaled pages
        self.assertIsNone(B.pool_sources([self.src(0, 0, 0)], True))    # nothing judged: untested, not a crash
        self.assertIsNone(B.pool_sources([], True))

    def test_zero_page_source_in_a_book_group(self):
        x = B.pool_sources([self.src(0, 0, 3, _group='g'), self.src(8, 10, 4, _group='g')], True)
        self.assertAlmostEqual(x['eff'][1], 4.0)

    def test_no_books_behind_the_pages_is_untested(self):
        self.assertIsNone(B.pool_sources([self.src(3, 4, 0)], True))   # books 0 scales n to 0: no wrate = w / 0

    def test_paid_stage_without_a_price_is_never_cheapest(self):
        rates = dict(claude=0.5, agy_month=200)
        u = B.usd_per_page({'channel': None, 'paid': True, 'api_usd': None}, rates)
        self.assertEqual(u, float('inf'))
        free, unpriced = route('free', 0.95, 0.0), route('unpriced', 0.96, u)
        cheap = route('cheap', 0.95, 0.001)
        self.assertEqual(B.pick([unpriced, cheap], free, STEADY)['id'], 'cheap')


class JudgeValidity(unittest.TestCase):
    """V2 (#7263, #7880): where the judge prefers its own family's text, an Opus-written route cannot win on it alone."""
    S = {'opus-img@10': {'channel': 'claude'}, 'agy': {'channel': 'agy'}, 'none': {'channel': None}}
    Q = {'hold': {'acc': 0.8, 'p': 0.9}, 'judge_validity': {'in_force': True, 'judge_family': 'claude', 'second_judges': [], 'strata': {
        'ocr/print': {'self_preference_valid': True, 'dbg': [-0.02, -0.18, 0.12]},
        'ocr/manuscript': {'self_preference_valid': False, 'dbg': [0.43, 0.20, 0.66]},
        'ocr/unknown': {'self_preference_valid': None}}}}
    opus, agy = {'id': 'paddle>opus', 'stage': 'opus-img@10'}, {'id': 'paddle>agy', 'stage': 'agy'}

    def gate(self, cell, dec, pk, Q=None):
        return B.judge_gate(cell, dec, pk, Q or self.Q, self.S)

    def test_manuscript_opus_keep_holds(self):
        ms = {'id': 'zh-6561-served/manuscript', 'base': 'zh-6561-served', 'script': 'manuscript'}
        dec, info = self.gate(ms, 'keep (k/n: manuscript: the defect rates are not split by script type)', self.opus)
        self.assertEqual(dec, 'HOLD (judge not valid: self-preference)')
        self.assertEqual(info['held'], 'keep paddle>opus')
        self.assertEqual(self.gate(ms, 'switch', self.opus)[0], 'HOLD (judge not valid: self-preference)')

    def test_other_writers_and_valid_strata_pass(self):
        ms = {'id': 'x/manuscript', 'base': 'x', 'script': 'manuscript'}
        self.assertEqual(self.gate(ms, 'switch', self.agy)[0], 'switch')                          # not the judge's family
        self.assertEqual(self.gate(dict(ms, script='print', id='x/print'), 'keep', self.opus)[0], 'keep')   # print passes V2
        self.assertEqual(self.gate(dict(ms, script='unknown', id='x/unknown'), 'keep', self.opus)[0], 'keep')  # unmeasured
        self.assertEqual(self.gate(ms, 'HOLD', self.opus)[0], 'HOLD')
        self.assertEqual(self.gate(ms, 'keep (UNTESTED)', self.opus)[0], 'keep (UNTESTED)')       # no judge involved
        off = dict(self.Q, judge_validity=dict(self.Q['judge_validity'], in_force=False))
        self.assertEqual(self.gate(ms, 'keep', self.opus, off), ('keep', None))

    def test_translation_cells_are_their_own_stratum(self):
        self.assertEqual(B.judge_stratum({'id': 'tibetan-tr/manuscript', 'base': 'tibetan-tr', 'script': 'manuscript'}), 'translate/manuscript')
        self.assertEqual(B.judge_stratum({'id': 'german-tr-lite/print', 'base': 'german-tr-lite', 'script': 'print'}), 'translate/print')
        self.assertEqual(B.judge_stratum({'id': 'tibetan-yigdzin/manuscript', 'base': 'tibetan-yigdzin', 'script': 'manuscript'}), 'ocr/manuscript')
        tr = {'id': 'tibetan-tr/manuscript', 'base': 'tibetan-tr', 'script': 'manuscript'}
        self.assertEqual(self.gate(tr, 'keep', self.opus)[0], 'keep')   # translate/manuscript not in strata: unmeasured

    def test_a_second_judge_of_another_family_can_clear_it(self):
        ms = {'id': 'x/manuscript', 'base': 'x', 'script': 'manuscript'}
        jv = lambda e: dict(self.Q, judge_validity=dict(self.Q['judge_validity'], second_judges=[e]))
        ok = dict(cell='x/manuscript', route='paddle>opus', judge='gemini-3.8-pro', family='gemini', accept='29/30')
        dec, info = self.gate(ms, 'keep', self.opus, jv(ok))
        self.assertEqual(dec, 'keep'); self.assertTrue(info['second_judge']['agrees'])
        self.assertEqual(self.gate(ms, 'keep', self.opus, jv(dict(ok, accept='20/30')))[0], 'HOLD (judge not valid: self-preference)')
        self.assertEqual(self.gate(ms, 'keep', self.opus, jv(dict(ok, family='claude', judge='sonnet')))[0], 'HOLD (judge not valid: self-preference)')


class Multiplicity(unittest.TestCase):
    """V3 (#7263): the cheapest passer of K candidates is picked, so the gate must control the error over all K."""
    def P(self, **mu):
        return {'switch': {'bar': 'opus', 'within': 0.08, 'p': 0.9, 'wrong_text_max': 0.04, 'multiplicity': mu}, 'hold': {'acc': 0.8, 'p': 0.9}}

    def test_gate_p(self):
        self.assertEqual(B.gate_p(self.P(method='none'), 6), 0.9)
        self.assertAlmostEqual(B.gate_p(self.P(method='bonferroni', alpha=0.05), 5), 0.99)
        self.assertAlmostEqual(B.gate_p(self.P(method='sidak', alpha=0.05), 1), 0.95)

    def beta(self, rid, k, n, seed, channel='agy'):
        import random
        rng = random.Random(seed); d = [rng.betavariate(1 + k, 1 + n - k) for _ in range(4000)]
        return dict(id=rid, mean=sum(d) / len(d), _d=d, wrate=0.0, wrong=0, n=n, channel=channel, _usd_acc=0.001,
                    p80=sum(v >= 0.8 for v in d) / len(d))

    def test_more_candidates_need_more_evidence(self):
        bar = dict(self.beta('opus', 28, 30, 1), _bar=True)
        c = dict(self.beta('agy', 29, 30, 2), _bar=False)
        P0, P1 = self.P(method='none'), self.P(method='max-bonferroni', alpha=0.05)
        pr = B.within_p(c, bar, 0.08)
        self.assertTrue(0.9 <= pr < 0.99)                                          # passes alone at 0.9 ...
        self.assertIn('agy', [r['id'] for r in B.gate([bar, c], P0, lambda b: 1, 0.08)[1]])
        five = [c] + [dict(self.beta(f'x{i}', 20, 30, 10 + i), _bar=False) for i in range(4)]
        self.assertNotIn('agy', [r['id'] for r in B.gate([bar] + five, P1, lambda b: 1, 0.08)[1]])   # ... not as one of 5 at 1 - 0.05 / 5

    def test_no_bar_a_route_is_not_its_own_reference(self):
        # no Opus route measured: before, the best by mean passed against itself however few its pages
        lucky = dict(self.beta('lucky', 5, 5, 3), _bar=False)              # 5/5: posterior mean 0.86
        solid = dict(self.beta('solid', 49, 60, 4), _bar=False)            # 49/60: 0.81
        P0, P1 = self.P(method='none'), self.P(method='max-bonferroni', alpha=0.05)
        self.assertEqual(B.gate([lucky, solid], P0, lambda b: 1, 0.08)[0]['id'], 'lucky')
        self.assertIn('lucky', [r['id'] for r in B.gate([lucky, solid], P0, lambda b: 1, 0.08)[1]])     # the reference passes itself
        self.assertNotIn('lucky', [r['id'] for r in B.gate([lucky, solid], P1, lambda b: 1, 0.08)[1]])  # 5 pages cannot show it

    def test_simulated_false_pick_rate(self):
        # v3_sim at the boundary (every candidate truly margin + 0.01 below the bar): six candidates at n = 30
        import importlib.util as iu
        sp = iu.spec_from_file_location('v3_sim', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v3_sim.py'))
        V = iu.module_from_spec(sp); sp.loader.exec_module(V)
        routes = [dict(id='opus', n=30, prior=[4.7, 0.3], usd=0.002, _bar=True, est=0.95)] + \
                 [dict(id=f'c{i}', n=30, prior=[4.4, 0.6], usd=0.0005 + i * 1e-4, _bar=False, est=0.87) for i in range(6)]
        cell = dict(id='sim', current='opus', routes=routes, ref='opus', K=6)
        Q = dict(self.P(method='none'), seed=1)
        _, r = V.sim_cell((cell, Q, 300, 1000, 1, {'none': {'method': 'none'}, 'max-bonferroni': {'method': 'max-bonferroni', 'alpha': 0.05}}))
        self.assertGreater(r['rates']['none']['boundary'], 0.10)          # the rule before: one of six passes often
        self.assertLessEqual(r['rates']['max-bonferroni']['boundary'], 0.05)

if __name__ == '__main__':
    unittest.main()
