#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/router-table/evidence/derive_backfill.py and derive_backfill_all.py — they turn stored
# verdict files of earlier tests into route-judge-format score.json files, and are the pattern followed here. They do not
# fit as is: neither reads #7243's severity files (one blind Opus grader a page on the #6740 0-4 scale plus a REVIEWER.md
# severity, against the image and a frozen reference), and the mapping from that instrument has to be declared.
"""Router-table evidence from the #7243 Sanskrit print confirmation (v3 #95). No model calls; reads one stored file.

  python3 scripts/eval/estimator/router-table/evidence/derive_sanskrit_7243.py   (repo root)

Reads  scripts/eval/sanskrit-gex45-7243/severity-confirm.json (50 printed Devanagari pages, one a book, drawn
       page-weighted over the hidden Sanskrit books and kept in draw order when printed Devanagari by eye; arms S = Surya 2
       on gex45 and F = Flash: the stored gemini-3-flash-preview read on 10 pages, agy gemini-3.8-flash-low on 40).
Writes sanskrit-surya-7243.score.json beside this file and by-script/sanskrit-surya-7243.score.json (every page is print
       by construction), the schema build.py's `evidence` entries read.

THE MAPPING (rules.json evidence_rules 1: "a serious-error flag"; the same words as the #6553 cells: wrong text = serious
or invented, accept = text and not serious):
  wrong text = the grader's REVIEWER.md severity is `serious`, or the #6740 grade is 4 (text that is not on the page);
  accept     = the page was read (not DNR) and is not wrong text;
  invented   = grade 4 (the hard floor's `invented` label).
THIS INSTRUMENT IS STRICTER THAN THE ROUTE JUDGE, and its k/n must not be read beside a route-judge k/n as if they were
one scale: the grader worked from a word-level diff against the reference, and it called a page `serious` on ONE planted
word swap or dropped line in 41 of 50 control pages. The two arms are comparable with each other (same pages, same
grader); neither is comparable with a cell judged by route-judge-6740. The file therefore also carries the other cuts
(`sensitivity`) and the controls, and rules.json names the cell's route as `planned`, not as the rule's pick.
The exploratory run (2026-10-24, 30 print books) is not ingested: its severity file stores no REVIEWER.md severity.
"""
import json, os

D = 'scripts/eval/estimator/router-table/evidence/'
SRC = 'scripts/eval/sanskrit-gex45-7243/severity-confirm.json'
ARMS = {'S': ('surya', 'Surya 2 (datalab-to/surya-ocr-2) on gex45 through vLLM, the whole page at <= 2,400 px, no guards applied'),
        'F': ('flash-7243', 'Flash as #7243 defined the arm: the stored gemini-3-flash-preview read where there was one (10 pages), else agy gemini-3.8-flash-low, one page a call (40 pages)')}
frac = lambda k, n: f'{k}/{n}'


def route(per_page, arm, served):
    rows = [(slug, v[arm]) for slug, v in sorted(per_page.items()) if arm in v]
    n = len(rows)
    dnr = [s for s, r in rows if r['grade'] == 'DNR']
    wrong = [s for s, r in rows if r['grade'] != 'DNR' and (r.get('reviewer_severity') == 'serious' or r['grade'] == 4)]
    inv = [s for s, r in rows if r['grade'] == 4]
    acc = n - len(dnr) - len(wrong)
    ge = lambda g: sum(1 for _, r in rows if r['grade'] != 'DNR' and r['grade'] >= g)
    return {
        'n': n, 'books': n, 'accept': frac(acc, n), 'wrong_text_pages': frac(len(wrong), n),
        'classes_k_of_n': ({'invented': frac(len(inv), n)} if inv else {}), 'invented_pages': frac(len(inv), n),
        'did_not_read': frac(len(dnr), n), 'served': served,
        'sensitivity': {'_about': 'the same pages under other cuts of the same grades; none is the route judge\'s scale',
                        'wrong_text_if_grade_ge_2_meaning_changed': frac(ge(2), n), 'wrong_text_if_grade_ge_3_structural': frac(ge(3), n),
                        'wrong_text_if_grade_4_only': frac(ge(4), n), 'errors_ge2_counted': sum(r.get('n_ge2', 0) for _, r in rows)},
    }


def main():
    sev = json.load(open(SRC))
    pp = sev['per_page']
    routes = {rid: route(pp, arm, served) for arm, (rid, served) in ARMS.items()}
    acc = lambda arm, slug: pp[slug][arm]['grade'] != 'DNR' and not (pp[slug][arm].get('reviewer_severity') == 'serious' or pp[slug][arm]['grade'] == 4)
    both = [s for s in pp if 'S' in pp[s] and 'F' in pp[s]]
    pair = {'both': sum(acc('S', s) and acc('F', s) for s in both), 'a_only': sum(acc('S', s) and not acc('F', s) for s in both),
            'b_only': sum(acc('F', s) and not acc('S', s) for s in both), 'neither': sum(not acc('S', s) and not acc('F', s) for s in both)}
    k1 = sev['arms']['K1']; c = sev['controls']
    cell = {
        'task': 'ocr', 'lang': 'Sanskrit', 'pages': sev['n_pages'], 'script': 'print (printed Devanagari by eye; manuscripts, lithographs and other scripts were set aside before the test)',
        'controls': {'planted_caught': frac(c['K1_caught_at_expected_grade'], c['K1_n']), 'unchanged_reference_false_alarms': frac(c['K0_false_alarm_grade_ge1'], c['K0_n']),
                     'planted_one_error_called_serious': frac(k1['reviewer']['serious'], k1['n']),
                     '_note': 'K1 is the reference with ONE planted word swap or dropped line: the share called serious is how strict the wrong-text cut is',
                     'valid': bool(sev.get('reliable'))},
        'routes': routes, 'paired': {'surya|flash-7243': pair},
    }
    head = {
        'generated_by': 'scripts/eval/estimator/router-table/evidence/derive_sanskrit_7243.py (v3 #95; no model calls)',
        'provenance': '#7243 confirmation, scripts/eval/experiments/2026-11-03-sanskrit-surya-print-confirm-7243.md: 50 printed Devanagari books, one page each, preregistered (scripts/eval/sanskrit-gex45-7243/CONFIRM.md); per-page grades in ' + SRC,
        'judge': 'one blind Opus grader a page (claude -p), image tiles + frozen two-reader reference + word-level diff spans; #6740 0-4 grade and REVIEWER.md severity',
        'mapping': 'wrong_text = REVIEWER.md severity serious, or grade 4; accept = read (not DNR) and not wrong text; invented = grade 4. Stricter than the route judge (see controls.planted_one_error_called_serious): compare the two routes with each other, not with a route-judge cell.',
    }
    json.dump({**head, 'cells': {'sa-print-7243': cell}}, open(D + 'sanskrit-surya-7243.score.json', 'w'), indent=1, ensure_ascii=False)
    os.makedirs(D + 'by-script', exist_ok=True)
    json.dump({'source': D + 'sanskrit-surya-7243.score.json', 'of': 'every page of the test is print by construction (chosen by eye as printed Devanagari), so the print cut is the whole test',
               'cells': {'sa-print-7243|print': cell}}, open(D + 'by-script/sanskrit-surya-7243.score.json', 'w'), indent=1, ensure_ascii=False)
    for rid, r in routes.items(): print(rid, 'accept', r['accept'], 'wrong text', r['wrong_text_pages'], 'invented', r['invented_pages'], 'DNR', r['did_not_read'], r['sensitivity'])
    print('paired surya|flash-7243', pair, '| planted one error called serious', cell['controls']['planted_one_error_called_serious'])


if __name__ == '__main__':
    main()
