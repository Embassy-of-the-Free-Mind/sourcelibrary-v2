# Parse SOL raw HTML mirror -> sol.jsonl (one line per Adler entry). Issue #3884.
# Fields: adler_id, headword_betacode, headword_unicode, translated_headword,
#         vetting_status, translation, greek_betacode, greek_unicode, notes,
#         keywords, translator, translated_date, n_vetting_events
import json, re, sys, unicodedata
from pathlib import Path
import os

RAW = Path(os.environ.get("SOL_DATA_DIR", "scripts/output/sol-harvest")) / "raw"
OUT = Path(os.environ.get("SOL_DATA_DIR", "scripts/output/sol-harvest")) / "sol.jsonl"

LET = {"a":"α","b":"β","g":"γ","d":"δ","e":"ε","z":"ζ","h":"η","q":"θ","i":"ι",
       "k":"κ","l":"λ","m":"μ","n":"ν","c":"ξ","o":"ο","p":"π","r":"ρ","s":"σ",
       "t":"τ","u":"υ","f":"φ","x":"χ","y":"ψ","w":"ω","v":"ϝ"}
DIA = {")":"\u0313","(":"\u0314","/":"\u0301","\\":"\u0300","=":"\u0342",
       "|":"\u0345","+":"\u0308"}

def beta2uni(s):
    out, i, n = [], 0, len(s)
    while i < n:
        ch = s[i]
        if ch == "*":  # uppercase: * [diacritics] letter [diacritics]
            i += 1; pre = []
            while i < n and s[i] in DIA: pre.append(DIA[s[i]]); i += 1
            if i < n and s[i].lower() in LET:
                out.append(LET[s[i].lower()].upper()); i += 1
                out.extend(pre)
            else: out.extend(pre)
        elif ch.lower() in LET:
            out.append(LET[ch.lower()]); i += 1
        elif ch in DIA:
            out.append(DIA[ch]); i += 1
        else:
            out.append(ch); i += 1
    txt = unicodedata.normalize("NFC", "".join(out))
    # final sigma
    return re.sub(r"σ(?![\u0300-\u0345]*[a-zA-Zα-ωΑ-Ωϝ\u0300-\u0345])", "ς", txt)

TAG = re.compile(r"<[^>]+>")
def strip(html):
    t = TAG.sub("", html)
    t = t.replace("&amp;","&").replace("&lt;","<").replace("&gt;",">").replace("&quot;",'"').replace("&nbsp;"," ").replace("&#39;","'")
    return re.sub(r"\s+"," ", t).strip()

def block(html, cls):
    m = re.search(rf'<div class="{cls}">(.*?)</div>', html, re.S)
    return m.group(1) if m else None

def parse(path, letter, num):
    html = path.read_text(errors="replace")
    if "Headword:" not in html: return None
    hw_zone = html.split("Headword: </strong>",1)[1].split("<br/>",1)[0] if "Headword: </strong>" in html else ""
    hw_links = re.findall(r'lookup=[^>]*>([^<]+)</a>', hw_zone)
    hw_beta = " ".join(x.strip() for x in hw_links) or strip(hw_zone)
    thw = re.search(r"Translated headword: </strong>([^<]*)", html)
    vet = re.search(r'Vetting Status: (\w+)', html)
    trans = block(html, "translation")
    greek = block(html, "greek")
    notes = block(html, "notes")
    kws = re.findall(r'field=keyword[^>]*>([^<]+)</a>', html)
    tb = re.search(r"Translated by</strong>: <a[^>]*>([^<]+)</a> on ([0-9A-Za-z @:]+)", html)
    editor = block(html, "editor") or ""
    return {
        "adler_id": f"{letter},{num}",
        "headword_betacode": hw_beta,
        "headword_unicode": beta2uni(hw_beta),
        "translated_headword": thw.group(1).strip() if thw else None,
        "vetting_status": vet.group(1) if vet else None,
        "translation": strip(trans) if trans else None,
        "greek_betacode": strip(greek) if greek else None,
        "greek_unicode": beta2uni(strip(greek)) if greek else None,
        "notes": strip(notes) if notes else None,
        "keywords": kws,
        "translator": tb.group(1) if tb else None,
        "translated_date": tb.group(2).strip() if tb else None,
        "n_vetting_events": editor.count("<br/>"),
    }

count, errs = 0, 0
with OUT.open("w") as f:
    for ldir in sorted(RAW.iterdir()):
        if not ldir.is_dir(): continue
        for p in sorted(ldir.glob("*.html"), key=lambda x: int(x.stem)):
            try:
                row = parse(p, ldir.name, p.stem)
                if row: f.write(json.dumps(row, ensure_ascii=False) + "\n"); count += 1
                else: errs += 1
            except Exception as e:
                errs += 1; print(f"ERR {ldir.name}/{p.stem}: {e}", file=sys.stderr)
print(f"parsed {count} entries, {errs} skipped/errors -> {OUT}")
