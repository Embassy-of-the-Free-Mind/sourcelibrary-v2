#!/usr/bin/env python3
"""Tests for halfjoin.py (#60). Run: python3 -m pytest -q test_halfjoin.py  (or python3 test_halfjoin.py)
PRIOR ART: none — halfjoin.py is new; see its docstring."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from halfjoin import join_leaf, join_line, piece_spans  # noqa: E402

LINE = "བཅོམ་ལྡན་འདས་ཀྱིས་བཀའ་སྩལ་པ། །རབ་འབྱོར་དེ་ནི་དེ་བཞིན་ཏེ། །བྱང་ཆུབ་སེམས་དཔའ་སེམས་དཔའ་ཆེན་པོ"
SYL = LINE.replace("། །", "་").split("་")


def test_spans_halves():
    assert piece_spans(1000, 2) == [(0, 550), (450, 1000)]
    s3 = piece_spans(1000, 3)
    assert s3[0][0] == 0 and s3[-1][1] == 1000
    for (a0, a1), (b0, b1) in zip(s3, s3[1:]):
        assert a1 - b0 == 100            # 10 % of the width shared by neighbours


def test_join_exact_overlap():
    a = "བཅོམ་ལྡན་འདས་ཀྱིས་བཀའ་སྩལ་པ། །རབ་འབྱོར་དེ"
    b = "བཀའ་སྩལ་པ། །རབ་འབྱོར་དེ་ནི་དེ་བཞིན་ཏེ།"
    t, run = join_line(a, b)
    assert run >= 2
    assert t == "བཅོམ་ལྡན་འདས་ཀྱིས་བཀའ་སྩལ་པ། །རབ་འབྱོར་དེ་ནི་དེ་བཞིན་ཏེ།"


def test_join_drops_cut_syllables():
    # the left piece ends on a half-cut syllable (ད), the right piece starts on one (ར): both are dropped
    a = "བཅོམ་ལྡན་འདས་ཀྱིས་བཀའ་སྩལ་ད"
    b = "ར་ཀྱིས་བཀའ་སྩལ་པ། །རབ་འབྱོར"
    t, run = join_line(a, b)
    assert run == 3 and t == "བཅོམ་ལྡན་འདས་ཀྱིས་བཀའ་སྩལ་པ། །རབ་འབྱོར"


def test_join_no_overlap_concatenates():
    t, run = join_line("བཅོམ་ལྡན་འདས", "རབ་འབྱོར")
    assert run == 0 and t == "བཅོམ་ལྡན་འདས་རབ་འབྱོར"


def test_join_one_side_empty():
    assert join_line("", "རབ་འབྱོར") == ("རབ་འབྱོར", 0)
    assert join_line("རབ་འབྱོར", "  ") == ("རབ་འབྱོར", 0)


def test_join_leaf_lines():
    left = "བཅོམ་ལྡན་འདས་ཀྱིས་བཀའ\nབྱང་ཆུབ་སེམས་དཔའ་ཆེན"
    right = "ཀྱིས་བཀའ་སྩལ་པ།\nསེམས་དཔའ་ཆེན་པོ།"
    t, info = join_leaf([left, right])
    assert not info["line_mismatch"] and info["joins"] == 2 and info["no_overlap"] == 0
    assert t == "བཅོམ་ལྡན་འདས་ཀྱིས་བཀའ་སྩལ་པ།\nབྱང་ཆུབ་སེམས་དཔའ་ཆེན་པོ།"


def test_join_leaf_mismatch_keeps_both():
    left = "བཅོམ་ལྡན་འདས\nབྱང་ཆུབ"; right = "ཀྱིས་བཀའ"
    t, info = join_leaf([left, right])
    assert info["line_mismatch"] and info["counts"] == [2, 1]
    assert t == left + "\n" + right


def test_join_three_pieces():
    p = ["བཅོམ་ལྡན་འདས་ཀྱིས", "འདས་ཀྱིས་བཀའ་སྩལ", "བཀའ་སྩལ་པ།"]
    t, info = join_leaf(p)
    assert t == "བཅོམ་ལྡན་འདས་ཀྱིས་བཀའ་སྩལ་པ།" and info["joins"] == 2


if __name__ == "__main__":
    for k, v in list(globals().items()):
        if k.startswith("test_"):
            v(); print("ok", k)
