# PRIOR ART: scripts/eval/zh-print-arms-7263/crosscheck.py — counts every F/O difference; this adds the hand list of variant forms, so only substantive pairs count.
# Usage: python3 pairs.py SCRATCH_DIR (needs <set>/plan.json, <set>/texts and pages-v.json from analyze.mjs).
import json,re,difflib,unicodedata,collections,sys
SCR=sys.argv[1]
TAGS=re.compile(r'<(language|script|page-type|meta|header|page-num|image-desc|scan-quality|quality|vocab|warning|sig|catchword|columns|gloss)[^>]*>[\s\S]*?</\1>',re.I)
han=lambda t:''.join(c for c in TAGS.sub(' ',t) if re.match(r'[㐀-鿿豈-﫿぀-ヿ\U00020000-\U0002ffff]',c))
fold=lambda c:unicodedata.normalize('NFKC',c)
pg=json.load(open(SCR+'/pages-v.json'));V={p['key']:p['v'] for p in pg}
withF=collections.Counter();withO=collections.Counter();third=collections.Counter();perpage=[]
for st in('one','ten'):
  for s in json.load(open(f'{SCR}/{st}/plan.json'))['selected']:
    rd=lambda a:han(open(f"{SCR}/{st}/texts/{s['key']}.{a}.txt",encoding='utf8').read())
    F,O,Pd=rd('F'),rd('O'),rd('Pu');m={}
    for t,a,b,c,d in difflib.SequenceMatcher(None,O,Pd,autojunk=False).get_opcodes():
      if t=='equal' or(t=='replace' and b-a==d-c):
        for k in range(b-a):m[a+k]=Pd[c+k]
    f=o=0
    for t,a,b,c,d in difflib.SequenceMatcher(None,O,F,autojunk=False).get_opcodes():
      if t=='replace' and b-a==d-c:
        for k in range(b-a):
          x,y=O[a+k],F[c+k];p=m.get(a+k)
          if fold(x)==fold(y) or p is None:continue
          if fold(p)==fold(y):withF[(x,y)]+=1;f+=1
          elif fold(p)==fold(x):withO[(x,y)]+=1;o+=1
          else:third[(x,y,p)]+=1
    v=V[s['key']];perpage.append((st,s['key'][-8:],f,o,v['O']['accept'],v['F']['accept'],len(O),len(F),len(Pd)))
print('Paddle with F (O>F):',withF.most_common(45));print('Paddle with O (O>F):',withO.most_common(45))
top=sorted(perpage,key=lambda r:-(r[2]+r[3]))[:12]
for r in top:print(r)
VAR=set('為爲 眾衆 來来 欸欵 炁氣 絶絕 無无 單单 脩修 偽僞 蹰躕 凉涼 慎愼 爾尒 孥拏 剎刹 嗥嘷 構搆 内內 眞真 強强 説說 别別 寶寳 即卽 麽麼 啓啟 遙遥 鬪鬬 闘鬬 棃梨 尅剋 壻婿 凄淒 珮佩 蛇虵 禮礼 玳瑇 蹰躕 鬬闕'.split())
isvar=lambda x,y:(x+y) in VAR or (y+x) in VAR
print('\nsubstantive with F',sum(n for (x,y),n in withF.items() if not isvar(x,y)),'with O',sum(n for (x,y),n in withO.items() if not isvar(x,y)),'| variants with F',sum(n for (x,y),n in withF.items() if isvar(x,y)),'with O',sum(n for (x,y),n in withO.items() if isvar(x,y)))
print('sub F',[(x+y,n) for (x,y),n in withF.most_common() if not isvar(x,y)])
print('sub O',[(x+y,n) for (x,y),n in withO.most_common() if not isvar(x,y)])
for st in('one','ten'):
  for s in json.load(open(f'{SCR}/{st}/plan.json'))['selected']:
    F=han(open(f"{SCR}/{st}/texts/{s['key']}.F.txt",encoding='utf8').read())
    O=han(open(f"{SCR}/{st}/texts/{s['key']}.O.txt",encoding='utf8').read())
    n=sum(1 for t,a,b,c,d in difflib.SequenceMatcher(None,O,F,autojunk=False).get_opcodes() if t=='replace' and b-a==d-c for k in range(b-a) if O[a+k]=='官' and F[c+k]=='宫')
    if n: print('官>宫',st,s['key'],n,s['title'][:30],s['image'])
