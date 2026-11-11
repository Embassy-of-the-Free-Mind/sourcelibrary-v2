"""Whish 147 Kraken line model (#7119): the `kraken` CLI with the centre-line normaliser switched off.
PRIOR ART: /root/bench/kraken/bin/kraken (the CLI entry point, kraken 7.1.1) — called unchanged. The models here were
trained on line strips compiled with `--force-type baseline`, i.e. WITHOUT ketos' legacy centre-line normaliser, but
`kraken ocr -s` treats each image as a bbox line and turns that normaliser on (models/ctc.py: valid_norm = True for
non-baseline segmentations). Read that way, validation lines that score 0.73 accuracy in training come out as noise.
This wrapper makes every ImageInputTransforms use valid_norm=False, so reading matches training.
Usage: python kraken_nonorm.py <kraken CLI args …>
"""
import sys
from kraken.lib.dataset import utils as du
_orig = du.ImageInputTransforms.__init__

def _init(self, batch, height, width, channels, pad, valid_norm=True, *a, **k):
    _orig(self, batch, height, width, channels, pad, False, *a, **k)

du.ImageInputTransforms.__init__ = _init
from kraken.kraken import cli  # noqa: E402
sys.argv[0] = 'kraken'
sys.exit(cli())
