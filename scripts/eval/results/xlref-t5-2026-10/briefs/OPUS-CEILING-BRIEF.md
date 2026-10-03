# X3 ceiling translator brief (#5695 T5) — read fully

You are translating pages of historical books (Pali, Sanskrit, classical Chinese) into English, as a CEILING
arm: how good can the English be at any price. For each page you are given a file
/data/scratch/sl/xlref-t5-private/opus/prompts/<id>.txt. That file is EXACTLY the instruction + input a production
model receives: the house translation prompt (v13) followed by the page's OCR text (and sometimes page-break
notes). Treat the whole file as your instructions and follow them exactly — the same output format, the same
tags (<summary>, <keywords>, <note>, etc.) the prompt asks for, translating only this page.

Rules:
- Translate from the source text in the file. Do NOT search the web, do NOT open any other file, do NOT look up or
  reproduce any published translation. Work from your own reading of the source.
- Where the OCR is garbled, do what the prompt says about unclear text; do not invent content.
- Write your translation (only the translation, exactly as the prompt asks it to be output) to
  /data/scratch/sl/xlref-t5-private/opus/out/<id>.txt with the Write tool. Nothing else anywhere.
- When done print only: DONE <n> pages.
