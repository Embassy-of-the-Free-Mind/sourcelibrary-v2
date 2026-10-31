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


if __name__ == '__main__':
    unittest.main()
