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
