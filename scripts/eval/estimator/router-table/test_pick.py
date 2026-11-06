#!/usr/bin/env python3
# PRIOR ART: none — looked in scripts/eval/estimator/ (no test beside build.py, allocate_v2.py or route_ocr_v1.py).
"""The router table's decision (#8283): severity-weighted defects per 1,000 words, against the live route.

  python3 -m unittest scripts/eval/estimator/router-table/test_pick.py   (repo root)
"""
import importlib.util, json, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('build', os.path.join(HERE, 'build.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
sys.path.insert(0, HERE)
import kn_rule as K
STEADY = lambda r: r['_usd_acc']


def route(rid, acc, usd_raw, n=30):
    """A measured route with a tight posterior at `acc`, priced at usd_raw dollars per raw page."""
    d = [acc - 0.01, acc, acc + 0.01] * 100
    return dict(id=rid, mean=acc, _d=d, wrong=0, wrate=0.0, n=n, p80=sum(v >= 0.8 for v in d) / len(d),
                _usd_raw=usd_raw, _usd_acc=usd_raw / acc)


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
        self.assertNotIn('read@4', [r['id'] for r in K.gate([cheap, best], self.Q, WTQ, 0.08)[1]])   # the independent gate refuses
        # the two arms accept and refuse the same pages: paired, the cheaper one passes
        pd = B.paired_draws({'both': 23, 'a_only': 0, 'b_only': 0, 'neither': 1}, 20000, random.Random(7701))
        cheap['_pd'] = {best['id']: pd}; best['_pd'] = {cheap['id']: [-x for x in pd]}
        self.assertGreater(B.within_p(cheap, best, 0.08), 0.9)
        self.assertIn('read@4', [r['id'] for r in K.gate([cheap, best], self.Q, WTQ, 0.08)[1]])
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
    """#8283: defects per 1,000 words decide (rules.json decision_rule), k/n acceptance is only the floor."""
    Q = {'switch': {'bar': 'opus', 'within': 0.08, 'p': 0.9, 'wrong_text_max': 0.04}, 'hold': {'acc': 0.8, 'p': 0.9},
         'hard_floor': {'in_force': True},
         'decision_rule': {'misleads_usd': 0.01, 'misleads_usd_sensitivity': [0.001, 0.1], 'wrong_text_weight': 3,
                           'wrong_text_delta_per_1k': 0.15, 'ceiling_per_1k': 1.0, 'ceiling_p': 0.9, 'accept_floor': {'within': 0.05, 'p': 0.5}, 'min_books': 10}}
    CAL = {'misleads': 0.625, 'wrong_text': 0.8}

    def r(self, rid, acc, usd_raw, wt, ml, books=30, words=250, channel='agy', **kw):
        d = route(rid, acc, usd_raw)
        d.update(channel=channel, defects=None if wt is None else dict(books=books, median_words_per_page=words,
                 wrong_text_per_1k_posterior=[wt / 2, wt, wt * 2], misleads_per_1k_posterior=[ml / 2, ml, ml * 2],
                 wrong_text_per_1k_gamma=[max(wt, 0.01) * 50, 50]), **kw)
        return d

    def decide(self, rs, live, cur=None, cell=None):
        return B.decide_defects(cell or {'id': 'c'}, rs, rs, cur or live, live['id'], self.Q, self.CAL)

    def test_fewer_defects_switch_where_kn_keeps(self):
        # both accepted ~0.92, the cheaper live route would keep on k/n; per word the dearer one has a fifth of the misleads
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

    def test_an_unrated_live_route_has_no_privilege(self):
        live = self.r('live', 0.92, 0.0004, wt=None, ml=None)
        alt = self.r('alt', 0.92, 0.0008, wt=0.2, ml=0.8)
        dec, pk, info = self.decide([live, alt], live)
        self.assertEqual((dec, pk['id']), ('switch', 'alt'))
        self.assertIn('is not rated', info['bar'])
        few = self.r('live', 0.92, 0.0004, wt=0.6, ml=4.0, books=9)   # < min_books is not rated either
        self.assertEqual(self.decide([few, alt], few)[1]['id'], 'alt')

    def test_nothing_rated_is_undecided(self):
        live = self.r('live', 0.92, 0.0004, wt=None, ml=None)
        dec, pk, info = self.decide([live], live)
        self.assertIsNone(dec); self.assertIn('10 books', info['why'])

    def test_one_rated_route_that_is_not_agy_is_compared_with_nothing(self):
        lite = self.r('lite', 0.90, 0.0, wt=0.5, ml=2.0, channel=None)
        agy = self.r('agy', 0.90, 0.0008, wt=None, ml=None)
        dec, _, info = self.decide([lite, agy], lite)
        self.assertIsNone(dec); self.assertIn('compared with nothing', info['why'])

    def test_opus_is_a_bar_not_a_candidate_unless_live(self):
        live = self.r('lite>agy', 0.90, 0.0008, wt=0.6, ml=2.0)
        opus = self.r('lite>opus', 0.96, 0.0010, wt=0.1, ml=0.5, channel='claude', _bar=True)
        self.assertEqual(self.decide([live, opus], live)[1]['id'], 'lite>agy')   # in print Opus is the bar, never a candidate
        dec, pk, _ = self.decide([live, opus], opus)
        self.assertEqual((dec, pk['id']), ('keep', 'lite>opus'))     # the live Opus route is kept against a worse agy route

    def test_opus_only_where_every_agy_route_fails_the_floor(self):
        lite = self.r('lite', 0.70, 0.0, wt=2.3, ml=6.0, channel=None)
        opus = self.r('opus', 0.90, 0.00001, wt=1.4, ml=4.0, channel='claude', _bar=True)
        agy = self.r('agy', 0.60, 0.0008, wt=1.5, ml=4.0, hard_floor_block=True)
        dec, pk, _ = self.decide([lite, opus, agy], lite)
        self.assertEqual((dec, pk['id']), ('switch', 'opus'))
        agy2 = self.r('agy2', 0.60, 0.0008, wt=None, ml=None)        # another agy route clear of it: Opus stays the bar, the menu default decides
        self.assertIn('compared with nothing', self.decide([lite, opus, agy, agy2], lite)[2]['why'])

    def test_hard_floor_blocks_the_rule(self):
        live = self.r('live', 0.90, 0.0, wt=1.0, ml=3.0, channel=None, hard_floor_block=True)
        dec, pk, _ = self.decide([live], live)
        self.assertEqual((dec, pk['id']), ('HOLD (hard floor: no measured route clears it)', 'live'))
        unrated = self.r('opus', 0.90, 0.001, wt=None, ml=None, channel='claude', _bar=True)
        self.assertEqual(self.decide([live, unrated], live)[0], 'HOLD (hard floor: no rated route clears it)')
        self.assertEqual(self.decide([live, unrated], live)[1]['id'], 'opus')   # names the measured route clear of the floor

    def test_a_blocked_live_route_with_agy_unmeasured_is_an_open_test(self):
        live = self.r('flash3', 0.72, 0.0, wt=0.9, ml=3.7, channel=None, hard_floor_block=True)
        opus = self.r('opus', 0.81, 0.001, wt=1.0, ml=4.0, channel='claude', _bar=True)
        dec, pk, _ = self.decide([live, opus], live)
        self.assertEqual((dec, pk['id']), ('HOLD (hard floor: only opus clears it)', 'opus'))
        self.assertIsNone(B.menu_default({'current': 'flash3'}, dec, [live, opus], [live, opus, dict(id='agy', channel='agy', stage='agy', tested=False, mean=0.5)], {'menu': {'in_force': True, 'off_menu_stages': []}, **self.Q}))

    def test_no_text_served_takes_the_ceiling(self):
        scans = self.r('scans-only', 0.5, 0.0, wt=None, ml=None, channel=None)
        read = self.r('read', 0.92, 0.0008, wt=0.2, ml=0.8)
        dec, pk, info = self.decide([scans, read], scans)
        self.assertEqual((dec, pk['id']), ('switch', 'read'))
        self.assertTrue(info['gates']['read']['wrong_text'])

    def test_a_route_with_only_store_verdicts_takes_the_floor_from_them(self):
        d = dict(accept='8/10', wrong_text_pages='1/10', books=10, classes_k_of_n={'O1': '1/10'}, _group=None)
        x = B.pool_sources([d], True, ('O1',))
        self.assertEqual((x['accept'], x['inv'], x['eff'][1]), ('8/10', '1/10', 10.0))


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
        self.assertEqual(K.pick([unpriced, cheap], free, STEADY)['id'], 'cheap')


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


class HardFloor(unittest.TestCase):
    """Derek, 2026-11-02 (#7263): a floor on invented / wrong-leaf text."""
    Q = {'hard_floor': {'in_force': True, 'classes': ['O1', 'I1'], 'rate': 0.02, 'p': 0.9, 'prior': [0.5, 0.5], 'min_pages': 1, 'draws': 4000}}

    def test_floor_block_needs_seen_pages(self):
        r = lambda inv, eff: dict(inv=inv, inv_eff=eff[0], eff=[0, eff[1], 0])
        self.assertEqual(B.hard_floor_block(r('0/30', (0.0, 5.0)), self.Q, 1)[0], False)    # none seen: never blocked
        self.assertEqual(B.hard_floor_block(r('6/30', (6.0, 30.0)), self.Q, 1)[0], True)     # 20%: blocked
        self.assertEqual(B.hard_floor_block(r('1/600', (1.0, 600.0)), self.Q, 1)[0], False)  # 0.2%: under the floor
        self.assertEqual(B.hard_floor_block(dict(inv=None), self.Q, 1), (False, None))       # untested

    def test_pool_sources_counts_floor_classes(self):
        x = dict(accept='20/30', wrong_text_pages='5/30', books=10, classes_k_of_n={'O1': '2/30', 'I1': '1/30', 'O6': '9/30'})
        p = B.pool_sources([x], True, ('O1', 'I1'))
        self.assertEqual(p['inv'], '3/30')
        self.assertAlmostEqual(p['inv_eff'], 3 * 10 / 30)
        self.assertEqual(B.pool_sources([x], True)['inv'], '0/30')   # no classes named: nothing counted


class FrozenKn(unittest.TestCase):
    """kn_rule.py: the retired k/n decision, kept so that v3_sim.py can reproduce V3 (#7263). The table does not read it."""
    def P(self, **mu):
        return {'switch': {'bar': 'opus', 'within': 0.08, 'p': 0.9, 'wrong_text_max': 0.04, 'multiplicity': mu}, 'hold': {'acc': 0.8, 'p': 0.9}}

    def test_simulated_false_pick_rate(self):
        # v3_sim at the boundary (every candidate truly margin + 0.01 below the bar): six candidates at n = 30
        sp = importlib.util.spec_from_file_location('v3_sim', os.path.join(HERE, 'v3_sim.py'))
        V = importlib.util.module_from_spec(sp); sp.loader.exec_module(V)
        routes = [dict(id='opus', n=30, prior=[4.7, 0.3], usd=0.002, _bar=True, est=0.95)] + \
                 [dict(id=f'c{i}', n=30, prior=[4.4, 0.6], usd=0.0005 + i * 1e-4, _bar=False, est=0.87) for i in range(6)]
        cell = dict(id='sim', current='opus', routes=routes, ref='opus', K=6)
        Q = dict(self.P(method='none'), seed=1)
        _, r = V.sim_cell((cell, Q, 300, 1000, 1, {'none': {'method': 'none'}, 'max-bonferroni': {'method': 'max-bonferroni', 'alpha': 0.05}}))
        self.assertGreater(r['rates']['none']['boundary'], 0.10)          # the rule before: one of six passes often
        self.assertLessEqual(r['rates']['max-bonferroni']['boundary'], 0.05)

    def test_legacy_puts_the_retired_sections_back(self):
        R = json.load(open(os.path.join(HERE, 'rules.json')))
        for k in ('loss', 'absolute_bar', 'no_absolute_gate', 'no_served_privilege'):
            self.assertFalse(R[k]['in_force'], k)
            self.assertTrue(K.legacy(R)[k]['in_force'], k)
        self.assertEqual(R['loss']['lambda_sensitivity'], [5, 20, 100])   # sonnet_plan.py reads it


class Menu(unittest.TestCase):
    """#8283: the route menu (agy or Opus, alone or over a draft) and the default for an undecided cell."""
    PM = {'menu': {'in_force': True, 'off_menu_stages': ['sonnet-read@1', 'lite-text']}, 'decision_rule': {'accept_floor': {'within': 0.05, 'p': 0.5}}}
    C = {'current': 'lite'}

    def r(self, rid, channel, stage, mean=0.8, tested=True):
        return dict(id=rid, channel=channel, stage=stage, mean=mean, tested=tested, _d=[mean] * 10)

    def test_off_menu_stages_are_not_routes(self):
        self.assertFalse(B.on_menu(self.r('sonnet-read', 'claude', 'sonnet-read@1'), self.PM))
        self.assertTrue(B.on_menu(self.r('lite>opus', 'claude', 'opus-img@10'), self.PM))
        self.assertTrue(B.on_menu(self.r('sonnet-read', 'claude', 'sonnet-read@1'), {}))   # menu off: the rule before

    def test_untested_cell_gets_the_plainest_agy_route_not_the_incumbent(self):
        lite = self.r('lite', None, 'none')
        chain = self.r('pero>agy-flash-low@4-written', 'agy', 'agy@4', mean=0.95, tested=False)
        plain = self.r('agy-flash-low-read', 'agy', 'agy-read', mean=0.85, tested=False)
        dec, pk = B.menu_default(self.C, 'keep (UNTESTED)', [], [lite, chain, plain], self.PM)
        self.assertEqual(pk['id'], 'agy-flash-low-read')     # fewer stages beats a higher prior
        self.assertTrue(dec.startswith('switch (default: agy, unmeasured here'))

    def test_nothing_to_compare_is_undecided_but_a_rule_decision_stands(self):
        lite, agy = self.r('lite', None, 'none'), self.r('agy-flash-low-read', 'agy', 'agy-read', tested=False)
        self.assertEqual(B.menu_default(self.C, 'HOLD (no defect verdicts: only lite is rated: compared with nothing)', [lite], [lite, agy], self.PM)[1]['id'], 'agy-flash-low-read')
        self.assertEqual(B.menu_default(self.C, 'HOLD (defects: no rated route passes)', [lite], [lite, agy], self.PM)[1]['id'], 'agy-flash-low-read')
        for rule_decision in ('keep', 'switch', 'HOLD (defects: the pick moves with the misleads weight)'):
            self.assertIsNone(B.menu_default(self.C, rule_decision, [lite], [lite, agy], self.PM), rule_decision)
        self.assertIsNone(B.menu_default(self.C, 'HOLD (hard floor: no measured route clears it)', [lite], [lite, agy], self.PM))
        self.assertIsNone(B.menu_default(self.C, 'HOLD (judge not valid: self-preference)', [lite], [lite, agy], self.PM))
        self.assertIsNone(B.menu_default({'current': 'lite', 'planned': {'route': 'lite>opus'}}, 'UNTESTED', [], [lite, agy], self.PM))

    def test_a_floor_blocked_agy_route_is_not_a_default(self):
        lite, agy = self.r('lite', None, 'none'), dict(self.r('agy', 'agy', 'agy-read'), hard_floor_block=True)
        Q = dict(self.PM, hard_floor={'in_force': True})
        self.assertIsNone(B.menu_default(self.C, 'keep (UNTESTED)', [], [lite, agy], Q))

    def test_the_default_says_keep_when_it_is_the_current_route(self):
        agy = self.r('agy', 'agy', 'agy-read')
        self.assertTrue(B.menu_default({'current': 'agy'}, 'keep (UNTESTED)', [], [agy], self.PM)[0].startswith('keep (default'))


if __name__ == '__main__':
    unittest.main()
