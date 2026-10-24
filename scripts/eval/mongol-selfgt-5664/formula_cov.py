# How many of the 20 Kanjur formula words each lexicon holds, exact and by shape key (#5664, mongol-selfgt; inbox note).
# PRIOR ART: formula.py (session research) — same 20 words; it counted them in LoRA reads, this counts them in lexicons.
import sys; sys.path.insert(0, '.')
from lexicons import key, load
F = {'enedkeg': 'ᠡᠨᠡᠳᠬᠡᠭ', 'kele': 'ᠬᠡᠯᠡ', 'kelen': 'ᠬᠡᠯᠡᠨ', 'ber': 'ᠪᠡᠷ', 'töbed': 'ᠲᠥᠪᠡᠳ', 'mongγol': 'ᠮᠣᠩᠭᠣᠯ', 'qutuγtu': 'ᠬᠣᠲᠣᠭᠲᠣ',
     'qutuγtu(u)': 'ᠬᠤᠲᠤᠭᠲᠤ', 'neretü': 'ᠨᠡᠷᠡᠲᠦ', 'yeke': 'ᠶᠡᠬᠡ', 'kölgen': 'ᠬᠥᠯᠭᠡᠨ', 'sudur': 'ᠰᠤᠳᠤᠷ', 'burqan': 'ᠪᠤᠷᠬᠠᠨ',
     'bodisung': 'ᠪᠣᠳᠢᠰᠤᠩ', 'nögčigsen': 'ᠨᠥᠭᠴᠢᠭᠰᠡᠨ', 'tegüs': 'ᠲᠡᠭᠦᠰ', 'ilaǰu': 'ᠢᠯᠠᠵᠤ', 'nom': 'ᠨᠣᠮ', 'sayin': 'ᠰᠠᠶᠢᠨ', 'činar': 'ᠴᠢᠨᠠᠷ'}
for name in ('labels', 'mc2'):
    lex, lk = load(name)
    ex = [(l, lex[u]) for l, u in F.items() if lex[u]]; sk = [(l, sum(lk[key(u)].values())) for l, u in F.items() if key(u) in lk]
    print(f'{name}: exact {len(ex)}/20, shape key {len(sk)}/20')
    print('   exact:', ', '.join(f'{l} {n}' for l, n in ex))
    print('   missing even by shape:', ', '.join(l for l, u in F.items() if key(u) not in lk))
