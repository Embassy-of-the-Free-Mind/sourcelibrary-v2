import sys, os
from PIL import Image, ImageDraw, ImageFont
os.chdir(os.path.dirname(os.path.abspath(__file__)))
ttf = sys.argv[1]; out = sys.argv[2]
lines = [
 (72, "abcdefghijklmnopqrstuvwxyz ſ æ ę"),
 (72, "ABCDEFGHIJKLMNOPQRSTUVWXYZ Iulius Jove vvw jam"),
 (72, "0123456789 · ab.110.43.&.256.11."),
 (56, "BEMBVS PATER Eſt ita, ut dicis:"),
 (56, "nam cum ab urbe propterea me,"),
 (56, "frequentiáq; hominum; tanq a fluctibus,"),
 (56, "in hunc ſolitudinis portum recipiam;"),
 (56, "quoniam tibi id cum modice contingeret."),
 (56, "liſper animũ; méq; ipſum reſtituã mihi, Eſt, quæ ę, à è ì ò ù á é í ó ú ã ẽ ĩ õ ũ"),
 (40, "Aldus Manutius printed this roman in Venice in 1496, cut by Francesco Griffo."),
 (40, "Source Library: reading and quoting the originals."),
]
W = 1800; y = 40
img = Image.new('L', (W, 1000), 255); d = ImageDraw.Draw(img)
for size, text in lines:
    f = ImageFont.truetype(ttf, size)
    d.text((40, y), text, font=f, fill=0)
    y += int(size * 1.35)
img = img.crop((0, 0, W, y + 20)); img.save(out)
